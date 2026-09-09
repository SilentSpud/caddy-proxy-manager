/**
 * Reaching the agents, from the controller's side.
 *
 * This used to be an HTTP client: the controller held every agent's address and dialled it. It no
 * longer dials anything. Agents connect inbound and hold an event stream open, so this file is now
 * a facade over `registry.ts` - the map of who is currently attached - and the shape of the
 * functions is all that survives the inversion.
 *
 * That shape is deliberate. Nine modules call into here, and keeping their signatures identical is
 * what let the transport change underneath without a rewrite reaching `lib/caddy.ts`.
 *
 * The one real behaviour change is timing. Publishing ports and rebuilding Caddy used to be
 * requests that returned the status the agent started in; they are desired state now, so they
 * return `pending` and the agent's own status reports the rest. Callers already polled for that,
 * because both operations always outlived their request.
 */

import type {
  AgentStatus,
  CaddyAdminProxyRequest,
  CaddyAdminProxyResponse,
  CaddyBuildStatus,
  L4PortsStatus,
} from "@cpm/shared";
import { pushDesiredState } from "./desired-state";
import {
  AgentCommandError,
  AgentNotConnectedError,
  type ConnectedAgent,
  connectedAgents,
  dispatchCaddyAdmin,
} from "./registry";

export class AgentUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentUnavailableError";
  }
}

export class AgentRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "AgentRequestError";
  }
}

/** One agent's answer, kept separate from the others so a partial failure is visible. */
export type AgentResult<T> =
  | { agent: string; ok: true; value: T }
  | { agent: string; ok: false; error: string };

function noAgentError(): AgentUnavailableError {
  return new AgentUnavailableError(
    "No agent is connected. Start the agent and pair it from Settings → Agents.",
  );
}

/**
 * Every agent currently attached to this controller.
 *
 * "Configured" and "reachable" used to be different questions - a row could exist for a host that
 * was down. They are the same question now: an agent that is not holding a stream open cannot be
 * reached by any means, so it is not a target.
 */
export async function listAgentTargets(): Promise<ConnectedAgent[]> {
  return connectedAgents();
}

/**
 * Every paired agent, connected or not, for the pickers that assign work to one.
 *
 * Deliberately not `listAgentTargets`: a host is pinned to an agent that exists, not to one that
 * happens to be holding a stream right now. An agent that is down still has hosts placed on it and
 * still appears here - with `connected` false, so the form can say so rather than hiding it and
 * losing the assignment on the next save.
 */
export async function listAgentOptions(): Promise<
  { id: number; name: string; connected: boolean; hasOwnBuildSettings: boolean }[]
> {
  const { listAgents } = await import("../models/agents");
  const live = new Set(connectedAgents().map((agent) => agent.agentId));
  return (await listAgents()).map((agent) => ({
    id: agent.id,
    name: agent.name,
    connected: live.has(agent.agentId),
    hasOwnBuildSettings: agent.hasOwnBuildSettings,
  }));
}

function primary(): ConnectedAgent | null {
  return connectedAgents()[0] ?? null;
}

// ─── Status ──────────────────────────────────────────────────────────────────

/** Whether any agent is connected. Never throws. */
export async function isAgentAvailable(): Promise<boolean> {
  return connectedAgents().length > 0;
}

/**
 * The primary agent's state. Throws when there is none, or it has not reported yet.
 *
 * No round trip: the agent pushes its status and the controller keeps the last one beside the live
 * connection. What used to be the slowest read on several pages is now a map lookup, which is why
 * the in-flight request sharing this file used to carry is gone.
 */
export async function getAgentStatus(): Promise<AgentStatus> {
  const agent = primary();
  if (!agent) throw noAgentError();
  if (!agent.status) {
    throw new AgentRequestError(`${agent.name} has connected but not reported yet.`, 503);
  }
  return agent.status;
}

/**
 * The primary agent's state, or null when there is none.
 *
 * Callers that render a page use this rather than getAgentStatus: a missing agent must not turn
 * the Settings page into an error, and every caller would otherwise write the same try/catch.
 */
export async function tryGetAgentStatus(): Promise<AgentStatus | null> {
  return primary()?.status ?? null;
}

/**
 * One agent's state by its `agents` row id, or null when it is not connected.
 *
 * Row id rather than the self-asserted `agentId`, because everything that configures an agent
 * separately - its module selection, the hosts pinned to it - is keyed on the row an operator
 * picked from a list.
 */
export async function getAgentStatusFor(agentRowId: number): Promise<AgentStatus | null> {
  return connectedAgents().find((agent) => agent.agentRowId === agentRowId)?.status ?? null;
}

/** Every agent's state, for the screen that lists them. Never throws. */
export async function getAllAgentStatuses(): Promise<AgentResult<AgentStatus>[]> {
  return connectedAgents().map((agent) =>
    agent.status
      ? { agent: agent.name, ok: true as const, value: agent.status }
      : { agent: agent.name, ok: false as const, error: "Connected, but has not reported yet." },
  );
}

// ─── Desired state ───────────────────────────────────────────────────────────

/**
 * Publish the same ports on every agent.
 *
 * Every agent runs the same configuration, so a port an L4 host needs has to be published on all
 * of them - a request that lands on one Caddy and not another is the split brain this exists to
 * prevent. The fan-out is the broadcast inside `pushDesiredState`; `ports` is not passed on,
 * because desired state is recomputed from the settings that just changed rather than trusted from
 * the caller. Two sources for one fact is how they drift.
 */
export async function requestL4Ports(_ports: string[]): Promise<L4PortsStatus> {
  if (connectedAgents().length === 0) throw noAgentError();
  await pushDesiredState();
  return { state: "pending", triggeredAt: new Date().toISOString() };
}

/** Rebuild every agent's Caddy with the same module set, for the same reason. */
export async function requestCaddyBuild(_modules: string[]): Promise<CaddyBuildStatus> {
  if (connectedAgents().length === 0) throw noAgentError();
  await pushDesiredState();
  return { state: "pending", triggeredAt: new Date().toISOString() };
}

// ─── Caddy admin ─────────────────────────────────────────────────────────────

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * A read against the primary agent's Caddy.
 *
 * Reads go to one agent because every Caddy in the fleet carries the identical document, so a
 * second answer would only be the same answer again.
 */
export async function caddyAdminViaAgent(
  request: CaddyAdminProxyRequest,
): Promise<CaddyAdminProxyResponse> {
  const agent = primary();
  if (!agent) throw noAgentError();
  try {
    return await dispatchCaddyAdmin(agent.agentId, request);
  } catch (error) {
    if (error instanceof AgentNotConnectedError) throw noAgentError();
    if (error instanceof AgentCommandError)
      throw new AgentRequestError(error.message, error.status);
    throw error;
  }
}

/**
 * A write to every agent's Caddy, reported per agent.
 *
 * Aggregating this into one response would hide the case that matters: a config that loaded on one
 * host and was rejected on another, leaving the fleet serving two different things.
 *
 * `request` may be a function, which is how the config apply sends each agent a document built for
 * it. A function that throws fails only its own agent: building one agent's config badly must not
 * stop the rest of the fleet from being configured.
 */
export async function broadcastCaddyAdmin(
  request:
    | CaddyAdminProxyRequest
    | ((agent: ConnectedAgent) => CaddyAdminProxyRequest | Promise<CaddyAdminProxyRequest>),
): Promise<AgentResult<CaddyAdminProxyResponse>[]> {
  const agents = connectedAgents();
  return Promise.all(
    agents.map(async (agent): Promise<AgentResult<CaddyAdminProxyResponse>> => {
      try {
        const forAgent = typeof request === "function" ? await request(agent) : request;
        return {
          agent: agent.name,
          ok: true,
          value: await dispatchCaddyAdmin(agent.agentId, forAgent),
        };
      } catch (error) {
        return { agent: agent.name, ok: false, error: describe(error) };
      }
    }),
  );
}
