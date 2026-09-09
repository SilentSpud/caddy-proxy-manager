/**
 * Every agent currently attached to this controller, and the only way to reach one.
 *
 * The agent dials in and holds a GraphQL subscription open over SSE; the controller can no longer
 * call out. So "reaching an agent" is pushing onto a queue this map is holding, and an agent that
 * is not in here is unreachable no matter what the database says about it.
 *
 * This file deliberately knows nothing about SSE. It used to encode the frames itself, which was
 * fine while it owned the response; the transport is the GraphQL server's now, so what `attach`
 * hands back is an async iterable of events and the framing happens above it. The keepalive moved
 * into the protocol as a `ping` event for the same reason.
 *
 * In memory, deliberately. A connection is a property of *this* process - the socket lives here or
 * nowhere - so persisting it would only produce rows describing streams that no longer exist. The
 * consequence to know about: this controller is a single container, and a second replica would
 * each hold half the fleet with no way to reach the other half. If that day comes, this is the file
 * that needs a broker behind it, not the callers.
 */

import { randomUUID } from "node:crypto";
import {
  AGENT_COMMAND_TIMEOUT_MS,
  AGENT_STREAM_KEEPALIVE_MS,
  type AgentCommand,
  type AgentCommandResult,
  type AgentDesiredState,
  type AgentServerEvent,
  type AgentStatus,
  type CaddyAdminProxyRequest,
  type CaddyAdminProxyResponse,
} from "@cpm/shared";

/** One attached agent. */
type Connection = {
  agentId: string;
  /** Operator-facing name, from the agents row. Used in messages, never for routing. */
  name: string;
  agentRowId: number;
  connectedAt: number;
  /** Writes one SSE frame. Returns false once the stream is gone. */
  send: (event: AgentServerEvent) => boolean;
  close: () => void;
  /** Last status this agent posted, or null before its first report. */
  status: AgentStatus | null;
  lastSeenAt: number;
};

type Waiter = {
  resolve: (result: CaddyAdminProxyResponse) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

const connections = new Map<string, Connection>();
const waiters = new Map<string, Waiter>();

export class AgentNotConnectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentNotConnectedError";
  }
}

export class AgentCommandError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "AgentCommandError";
  }
}

// ─── Attaching ───────────────────────────────────────────────────────────────

export type AttachedAgent = {
  /**
   * The events to publish, in order, until the agent goes away.
   *
   * Returning an iterable rather than a stream is what lets the GraphQL layer own the transport:
   * the same source would serve a websocket or a poll without this file changing.
   */
  events: AsyncIterableIterator<AgentServerEvent>;
  /** Push new desired state to this agent alone. */
  push: (state: AgentDesiredState) => void;
};

/**
 * Attach an agent and hand back the stream to respond with.
 *
 * A second connection from the same agent replaces the first rather than joining it: an agent that
 * reconnected after a network partition has an old stream this process still believes in, and
 * leaving both attached would double every command it is sent.
 */
export function attach(params: {
  agentId: string;
  agentRowId: number;
  name: string;
  controllerId: string;
  controllerName: string;
  initialState: AgentDesiredState;
}): AttachedAgent {
  const existing = connections.get(params.agentId);
  if (existing) {
    existing.close();
    connections.delete(params.agentId);
  }

  // A queue rather than a stream: events are produced by whoever is pushing commands, and consumed
  // by the subscription at its own pace. `pending` holds what has been produced and not yet taken;
  // `waiting` holds a consumer that arrived first. Exactly one of the two is ever non-empty.
  const pending: AgentServerEvent[] = [];
  let waiting: ((event: IteratorResult<AgentServerEvent>) => void) | null = null;
  let closed = false;
  let keepalive: ReturnType<typeof setInterval> | null = null;

  const send = (event: AgentServerEvent): boolean => {
    if (closed) return false;
    if (waiting) {
      const resolve = waiting;
      waiting = null;
      resolve({ value: event, done: false });
      return true;
    }
    pending.push(event);
    return true;
  };

  const close = (): void => {
    if (closed) return;
    closed = true;
    if (keepalive) clearInterval(keepalive);
    keepalive = null;
    // Ends the consumer's `for await`, which is what tears the subscription down.
    if (waiting) {
      const resolve = waiting;
      waiting = null;
      resolve({ value: undefined, done: true });
    }
  };

  const events: AsyncIterableIterator<AgentServerEvent> = {
    [Symbol.asyncIterator]() {
      return this;
    },
    next() {
      const queued = pending.shift();
      if (queued) return Promise.resolve({ value: queued, done: false });
      if (closed)
        return Promise.resolve({
          value: undefined,
          done: true,
        } as IteratorResult<AgentServerEvent>);
      return new Promise<IteratorResult<AgentServerEvent>>((resolve) => {
        waiting = resolve;
      });
    },
    // Called when the consumer stops - the agent hung up, or the server is shutting the
    // subscription down. Either way this connection is over.
    return() {
      detach(params.agentId);
      return Promise.resolve({ value: undefined, done: true } as IteratorResult<AgentServerEvent>);
    },
    throw(error) {
      detach(params.agentId);
      return Promise.reject(error);
    },
  };

  // `hello` first, so the agent can log what it attached to before any state arrives.
  send({
    type: "hello",
    controllerId: params.controllerId,
    controllerName: params.controllerName,
  });
  send({ type: "desired-state", state: params.initialState });

  keepalive = setInterval(() => {
    send({ type: "ping" });
  }, AGENT_STREAM_KEEPALIVE_MS);

  connections.set(params.agentId, {
    agentId: params.agentId,
    name: params.name,
    agentRowId: params.agentRowId,
    connectedAt: Date.now(),
    send,
    close,
    status: null,
    lastSeenAt: Date.now(),
  });

  return {
    events,
    push: (state) => {
      send({ type: "desired-state", state });
    },
  };
}

export function detach(agentId: string): void {
  const connection = connections.get(agentId);
  if (!connection) return;
  connection.close();
  connections.delete(agentId);

  // Fail anything still waiting on this agent rather than letting it run to its own timeout: the
  // answer is already known, and a caller holding a request open for another minute helps nobody.
  for (const [id, waiter] of waiters) {
    if (id.startsWith(`${agentId}:`)) {
      clearTimeout(waiter.timer);
      waiter.reject(new AgentNotConnectedError(`${connection.name} disconnected.`));
      waiters.delete(id);
    }
  }
}

// ─── Reading ─────────────────────────────────────────────────────────────────

export type ConnectedAgent = {
  agentId: string;
  name: string;
  agentRowId: number;
  status: AgentStatus | null;
  lastSeenAt: number;
};

export function connectedAgents(): ConnectedAgent[] {
  return [...connections.values()].map((c) => ({
    agentId: c.agentId,
    name: c.name,
    agentRowId: c.agentRowId,
    status: c.status,
    lastSeenAt: c.lastSeenAt,
  }));
}

export function isConnected(agentId: string): boolean {
  return connections.has(agentId);
}

export function recordStatus(agentId: string, status: AgentStatus): void {
  const connection = connections.get(agentId);
  if (!connection) return;
  connection.status = status;
  connection.lastSeenAt = Date.now();
}

// ─── Desired state ───────────────────────────────────────────────────────────

/**
 * Push desired state to every attached agent, computed for each one.
 *
 * A builder rather than a state, because two agents no longer want the same thing: the hosts
 * pinned to each decide its ports, and its own module selection decides its build. Returning null
 * skips that agent - a state that could not be computed must leave the agent on the last one it
 * had rather than replacing it with a guess.
 *
 * Sequential on purpose. Each build runs several queries, and a fleet of twenty agents all
 * recomputing at once on every host save is a thundering herd against the controller's own
 * database for work nothing is waiting on.
 */
export async function broadcastDesiredState(
  build: (agent: ConnectedAgent) => Promise<AgentDesiredState | null>,
): Promise<void> {
  for (const agent of connectedAgents()) {
    const state = await build(agent);
    if (state === null) continue;
    const connection = connections.get(agent.agentId);
    // It may have hung up while its state was being computed.
    if (!connection) continue;
    if (!connection.send({ type: "desired-state", state })) detach(connection.agentId);
  }
}

// ─── Commands ────────────────────────────────────────────────────────────────

/**
 * Send a Caddy admin call to one agent and wait for its answer.
 *
 * This is the only request/response left in a protocol that is otherwise desired state, and the
 * only place the controller blocks on an agent. The timeout is what keeps a wedged agent from
 * holding a page render open forever.
 */
export function dispatchCaddyAdmin(
  agentId: string,
  request: CaddyAdminProxyRequest,
): Promise<CaddyAdminProxyResponse> {
  const connection = connections.get(agentId);
  if (!connection) {
    return Promise.reject(new AgentNotConnectedError("That agent is not connected."));
  }

  const commandId = `${agentId}:${randomUUID()}`;
  const command: AgentCommand = { id: commandId, kind: "caddy-admin", request };

  return new Promise<CaddyAdminProxyResponse>((resolve, reject) => {
    const timer = setTimeout(() => {
      waiters.delete(commandId);
      reject(new AgentCommandError(`${connection.name} did not answer in time.`, 504));
    }, AGENT_COMMAND_TIMEOUT_MS);

    waiters.set(commandId, { resolve, reject, timer });

    if (!connection.send({ type: "command", command })) {
      clearTimeout(timer);
      waiters.delete(commandId);
      detach(agentId);
      reject(new AgentNotConnectedError(`${connection.name} disconnected.`));
    }
  });
}

/** Resolve whatever is waiting on these results. Unknown ids are stale and dropped. */
export function settleResults(agentId: string, results: AgentCommandResult[]): void {
  for (const result of results) {
    const waiter = waiters.get(result.id);
    if (!waiter) continue;
    // An agent may only settle its own commands; the id carries the agent it was issued to.
    if (!result.id.startsWith(`${agentId}:`)) continue;

    clearTimeout(waiter.timer);
    waiters.delete(result.id);
    if (result.ok) waiter.resolve(result.response);
    else waiter.reject(new AgentCommandError(result.error, 502));
  }

  const connection = connections.get(agentId);
  if (connection) connection.lastSeenAt = Date.now();
}

/** Test seam: drop all state so one suite's connections cannot leak into the next. */
export function resetRegistry(): void {
  for (const connection of connections.values()) connection.close();
  connections.clear();
  for (const waiter of waiters.values()) clearTimeout(waiter.timer);
  waiters.clear();
}
