/**
 * The controller's side of the agent API.
 *
 * Everything that reaches a Caddy host goes through here: recreating the container, rebuilding its
 * image, and configuring the Caddy inside it. The controller has no Docker socket and no address
 * for any Caddy of its own — the agent is the only thing that knows where its Caddy is, which is
 * what lets one live on a different host from this controller.
 *
 * A deployment can have several agents, and they all run the identical configuration. Writes fan
 * out to every one of them and report per agent; reads go to the first, since a second would only
 * return the same answer. Nothing here decides *what* the configuration is — that is the
 * controller's database, and it is the single source of truth for the whole fleet.
 *
 * Every request is signed with a shared secret rather than carrying a bearer token, so the secret
 * never appears in a request the way a token would. In standalone mode the agent writes that secret
 * beside its socket on the shared volume and rotates it on every start, so it is read per request
 * rather than cached — a cached copy would break silently the first time the agent restarted.
 */

import { createHmac } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AGENT_CONTROLLER_HEADER,
  AGENT_ROUTES,
  AGENT_SIGNATURE_HEADER,
  AGENT_TIMESTAMP_HEADER,
  signatureBase,
  type AgentStatus,
  type ApplyCaddyBuildRequest,
  type ApplyL4PortsRequest,
  type CaddyAdminProxyRequest,
  type CaddyAdminProxyResponse,
  type CaddyBuildStatus,
  type L4PortsStatus,
} from "@cpm/shared";
import { getControllerId, listActiveAgents, recordAgentContact } from "../models/agents";

/** Matches the agent's own default, and its `LOCAL_CONTROLLER_ID`. */
const LOCAL_CONTROLLER_ID = "local";
const SECRET_FILE = "agent-secret";
const SOCKET_FILE = "agent.sock";

/**
 * Where the shared volume is mounted. Named for the setting it originally served so a deployment
 * that already points it at a scratch directory — every test rig does — keeps working.
 */
function dataDir(): string {
  return process.env.L4_PORTS_DIR || "/app/data";
}

function socketPath(): string {
  return process.env.AGENT_SOCKET || join(dataDir(), SOCKET_FILE);
}

/**
 * How long to wait on the agent.
 *
 * Every call here is either a local socket round trip or a status read; the long operations return
 * immediately with a status and are polled. A request that has not answered in this long means the
 * agent is wedged, and reporting that is more useful than waiting.
 */
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Longer, for anything that reaches Caddy through an agent.
 *
 * Loading a large config is Caddy's own work — provisioning TLS, building the WAF — and it happens
 * inside the request. The agent adds one hop to that, not a bound on it.
 */
const CADDY_ADMIN_TIMEOUT_MS = 60_000;

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

type Transport = {
  /** How this agent is named in a message an operator reads. */
  name: string;
  /** Base URL. Ignored by the socket transport beyond supplying a host for the Request. */
  origin: string;
  unix?: string;
  secret: string;
  controllerId: string;
  /** Row id of the paired agent, when the transport came from the database. */
  agentRowId?: number;
};

/** One agent's answer, kept separate from the others so a partial failure is visible. */
export type AgentResult<T> =
  | { agent: string; ok: true; value: T }
  | { agent: string; ok: false; error: string };

/** The local agent, found by its socket and secret on the shared volume, or null if absent. */
function resolveLocalTransport(): Transport | null {
  const secretFile = join(dataDir(), SECRET_FILE);
  const socket = socketPath();
  if (!existsSync(secretFile) || !existsSync(socket)) return null;

  try {
    const fileSecret = readFileSync(secretFile, "utf-8").trim();
    if (fileSecret.length === 0) return null;
    return {
      name: "the local agent",
      // The agent listens on a socket, so the authority is never dialled. It still has to be a
      // valid URL for Request, and it is part of nothing that gets signed.
      origin: "http://agent.local",
      unix: socket,
      secret: fileSecret,
      controllerId: LOCAL_CONTROLLER_ID,
    };
  } catch {
    return null;
  }
}

/**
 * Every agent this controller should be driving.
 *
 * Empty is a normal state, not an error: a deployment that has not started the agent container
 * still serves every page — it just cannot publish a port, rebuild Caddy, or apply config, and the
 * UI says so.
 *
 * Three sources, in order, and only the first that yields anything is used. Paired agents win,
 * because pairing is an explicit act by an operator and must not be silently overridden by a
 * leftover variable. `AGENT_URL` + `AGENT_SECRET` come next, for a deployment that configures its
 * agent the way it configures everything else. The local socket is the fallback, and the case
 * almost every deployment is in.
 */
export async function listAgentTargets(): Promise<Transport[]> {
  try {
    const paired = await listActiveAgents();
    if (paired.length > 0) {
      const controllerId = await getControllerId();
      return paired.map((agent) => ({
        name: agent.name,
        origin: agent.address.replace(/\/$/, ""),
        secret: agent.secret,
        controllerId,
        agentRowId: agent.id,
      }));
    }
  } catch (error) {
    // A database that cannot be read is not a reason to stop trying the local socket, which is
    // what a single-host deployment uses and which needs no database at all.
    console.warn("[agent] could not read the paired agents:", error);
  }

  const url = process.env.AGENT_URL?.trim();
  const secret = process.env.AGENT_SECRET?.trim();
  if (url && secret) {
    return [
      {
        name: new URL(url).hostname,
        origin: url.replace(/\/$/, ""),
        secret,
        controllerId: process.env.AGENT_CONTROLLER_ID?.trim() || LOCAL_CONTROLLER_ID,
      },
    ];
  }

  const local = resolveLocalTransport();
  return local ? [local] : [];
}

/**
 * The agent to ask when one answer is enough — a config read, a Caddyfile conversion.
 *
 * Every agent runs the identical configuration, so any of them can answer a read. The first is
 * used rather than a random one so repeated reads stay consistent with each other.
 */
async function primaryTarget(): Promise<Transport | null> {
  return (await listAgentTargets())[0] ?? null;
}

function noAgentError(): AgentUnavailableError {
  return new AgentUnavailableError(
    "No agent is reachable. Start the agent container — it is what recreates and configures the " +
      "Caddy container, which the controller has no Docker access to do itself.",
  );
}

async function sha256Hex(body: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(body);
  return hasher.digest("hex");
}

/** One signed request to one agent. */
async function callOn<T>(
  transport: Transport,
  path: string,
  options: { method?: "GET" | "POST"; body?: unknown; timeoutMs?: number } = {},
): Promise<T> {
  const method = options.method ?? "GET";
  const body = options.body === undefined ? "" : JSON.stringify(options.body);
  const timestamp = Date.now();
  const signature = createHmac("sha256", transport.secret)
    .update(signatureBase(method, path, timestamp, await sha256Hex(body)))
    .digest("hex");

  let response: Response;
  try {
    response = await fetch(`${transport.origin}${path}`, {
      method,
      ...(transport.unix ? { unix: transport.unix } : {}),
      headers: {
        "content-type": "application/json",
        [AGENT_CONTROLLER_HEADER]: transport.controllerId,
        [AGENT_TIMESTAMP_HEADER]: String(timestamp),
        [AGENT_SIGNATURE_HEADER]: signature,
      },
      ...(method === "POST" ? { body } : {}),
      signal: AbortSignal.timeout(options.timeoutMs ?? REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    // Never surfaces the underlying message: it carries the socket path and, on some failures, the
    // request headers — which include the signature.
    console.error("[agent] request failed", { agent: transport.name, path, method, error });
    if (transport.agentRowId !== undefined) {
      await recordAgentContact(transport.agentRowId, { ok: false, error: "Unreachable" });
    }
    throw new AgentUnavailableError(`${transport.name} did not answer.`);
  }

  if (!response.ok) {
    // The agent's error bodies are its own authored strings, not echoes of the request, so they
    // are safe to pass on — and they are the only explanation the operator will get.
    const detail = await response
      .json()
      .then((parsed: unknown) =>
        parsed && typeof parsed === "object" && "error" in parsed
          ? String((parsed as { error: unknown }).error)
          : null,
      )
      .catch(() => null);
    if (transport.agentRowId !== undefined) {
      await recordAgentContact(transport.agentRowId, {
        ok: false,
        error: detail ?? `HTTP ${response.status}`,
      });
    }
    throw new AgentRequestError(
      detail ?? `${transport.name} rejected the request (HTTP ${response.status}).`,
      response.status,
    );
  }

  if (transport.agentRowId !== undefined) {
    await recordAgentContact(transport.agentRowId, { ok: true });
  }
  return (await response.json()) as T;
}

/** The same request to every agent, reported per agent rather than as one aggregate. */
async function callOnAll<T>(
  path: string,
  options: { method?: "GET" | "POST"; body?: unknown; timeoutMs?: number } = {},
): Promise<AgentResult<T>[]> {
  const targets = await listAgentTargets();
  if (targets.length === 0) throw noAgentError();

  // In parallel, and settled rather than raced: one unreachable agent must not stop the others
  // from being configured, and the caller needs to know which one failed.
  return Promise.all(
    targets.map(async (transport): Promise<AgentResult<T>> => {
      try {
        return {
          agent: transport.name,
          ok: true,
          value: await callOn<T>(transport, path, options),
        };
      } catch (error) {
        return {
          agent: transport.name,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );
}

/** Throw when any agent failed, naming them. Used where a partial apply is not an outcome. */
function assertAllSucceeded<T>(results: AgentResult<T>[], what: string): T[] {
  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    // Naming them matters: with several agents, "it failed" leaves the operator with no idea
    // which host is now out of step with the others.
    throw new AgentRequestError(
      `${what} failed on ${failed.map((r) => `${r.agent} (${r.error})`).join(", ")}.`,
      502,
    );
  }
  return results.map((r) => (r.ok ? r.value : (undefined as never)));
}

// ─── Public surface ──────────────────────────────────────────────────────────

/** Whether any agent is configured and answering. Never throws. */
export async function isAgentAvailable(): Promise<boolean> {
  const target = await primaryTarget();
  if (!target) return false;
  try {
    await callOn<AgentStatus>(target, AGENT_ROUTES.status);
    return true;
  } catch {
    return false;
  }
}

/** The primary agent's state. Throws when there is none, or it does not answer. */
export async function getAgentStatus(): Promise<AgentStatus> {
  const target = await primaryTarget();
  if (!target) throw noAgentError();
  return callOn<AgentStatus>(target, AGENT_ROUTES.status);
}

/**
 * The primary agent's state, sharing a round trip with any concurrent caller.
 *
 * The read paths that render a page use this: several of them run in the same `Promise.all`, and
 * asking every agent once per caller is what made the layer-4 page slow enough to notice.
 */
async function sharedPrimaryStatus(): Promise<AgentStatus | null> {
  const statuses = await getAllAgentStatuses();
  const first = statuses[0];
  return first?.ok ? first.value : null;
}

/**
 * The primary agent's state, or null when there is none.
 *
 * Callers that render a page use this rather than getAgentStatus: a missing agent must not turn
 * the Settings page into an error, and every caller would otherwise write the same try/catch.
 */
export async function tryGetAgentStatus(): Promise<AgentStatus | null> {
  return sharedPrimaryStatus();
}

/**
 * Every agent's state, for the screen that lists them. Never throws.
 *
 * Concurrent callers share one round trip. A single render asks for this several times — the port
 * diff and the port status, the build diff and the module gate — and each was a file read before
 * the agent spoke HTTP. Fanning that out to N agents per caller made a page's time-to-interactive
 * visibly worse. Only in-flight calls are shared, never a completed one, so nothing is ever served
 * a stale status: a later call always goes back to the agents.
 */
let statusesInFlight: Promise<AgentResult<AgentStatus>[]> | null = null;

export async function getAllAgentStatuses(): Promise<AgentResult<AgentStatus>[]> {
  if (statusesInFlight) return statusesInFlight;

  statusesInFlight = callOnAll<AgentStatus>(AGENT_ROUTES.status)
    .catch(() => [] as AgentResult<AgentStatus>[])
    .finally(() => {
      statusesInFlight = null;
    });
  return statusesInFlight;
}

/**
 * Publish the same ports on every agent.
 *
 * Every agent runs the same configuration, so a port an L4 host needs has to be published on all
 * of them — a request that lands on one Caddy and not another is the split brain this fan-out
 * exists to prevent.
 */
export async function requestL4Ports(ports: string[]): Promise<L4PortsStatus> {
  const results = await callOnAll<{ status: L4PortsStatus }>(AGENT_ROUTES.l4Ports, {
    method: "POST",
    body: { ports } satisfies ApplyL4PortsRequest,
  });
  const statuses = assertAllSucceeded(results, "Publishing ports");
  return statuses[0].status;
}

/** Rebuild every agent's Caddy with the same module set, for the same reason. */
export async function requestCaddyBuild(modules: string[]): Promise<CaddyBuildStatus> {
  const results = await callOnAll<{ status: CaddyBuildStatus }>(AGENT_ROUTES.caddyBuild, {
    method: "POST",
    body: { modules } satisfies ApplyCaddyBuildRequest,
  });
  const statuses = assertAllSucceeded(results, "Rebuilding Caddy");
  return statuses[0].status;
}

// ─── Caddy admin ─────────────────────────────────────────────────────────────

/**
 * A read against the primary agent's Caddy.
 *
 * Reads go to one agent because every Caddy in the fleet carries the identical document, so a
 * second answer would only be the same answer again.
 */
export async function caddyAdminViaAgent(
  request: CaddyAdminProxyRequest,
): Promise<CaddyAdminProxyResponse> {
  const target = await primaryTarget();
  if (!target) throw noAgentError();
  return callOn<CaddyAdminProxyResponse>(target, AGENT_ROUTES.caddyAdmin, {
    method: "POST",
    body: request,
    timeoutMs: CADDY_ADMIN_TIMEOUT_MS,
  });
}

/**
 * A write to every agent's Caddy, reported per agent.
 *
 * Aggregating this into one response would hide the case that matters: a config that loaded on one
 * host and was rejected on another, leaving the fleet serving two different things.
 */
export async function broadcastCaddyAdmin(
  request: CaddyAdminProxyRequest,
): Promise<AgentResult<CaddyAdminProxyResponse>[]> {
  return callOnAll<CaddyAdminProxyResponse>(AGENT_ROUTES.caddyAdmin, {
    method: "POST",
    body: request,
    timeoutMs: CADDY_ADMIN_TIMEOUT_MS,
  });
}
