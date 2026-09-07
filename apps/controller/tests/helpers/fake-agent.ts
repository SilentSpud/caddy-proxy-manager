/**
 * An agent, as the controller now sees one: an entry in the connection registry holding a stream.
 *
 * This used to be a real HTTP server the controller dialled. It cannot be any more — the controller
 * does not dial — so the fake attaches itself the way a real agent does, reads the frames the
 * controller pushes, and answers commands. Which makes it a smaller lie than the old one: there is
 * no transport to simulate, only the protocol.
 */

import { randomBytes } from 'node:crypto';
import type {
  AgentCommand,
  AgentDesiredState,
  AgentStatus,
  CaddyBuildStatus,
  L4PortsStatus,
  ManagedServiceName,
  ManagedServicesStatus,
} from '@cpm/shared';

const { attach, detach, recordStatus, settleResults, resetRegistry } = await import(
  '../../src/lib/agent/registry'
);

/** One thing the controller pushed to this agent. */
export type AgentRequestLog = {
  kind: 'hello' | 'desired-state' | 'command';
  state?: AgentDesiredState;
  command?: AgentCommand;
};

export type FakeAgent = {
  agentId: string;
  name: string;
  /** Everything the controller has pushed, oldest first. */
  requests: AgentRequestLog[];
  /** The desired state most recently pushed, or null before the first frame. */
  desired: AgentDesiredState | null;
  state: {
    appliedPorts: string[];
    appliedModules: string[] | null;
    l4Status: L4PortsStatus;
    buildStatus: CaddyBuildStatus;
    /** What this agent's Caddy answers a dispatched admin command with. */
    caddyAdmin: { status: number; text: string };
    analytics: { enabled: boolean; accessLogPresent: boolean };
    appliedServices: Record<ManagedServiceName, boolean> | null;
    servicesStatus: ManagedServicesStatus;
  };
  /** Re-report status from `state`. Call after mutating it, as the real agent does on change. */
  report: () => void;
  /** Finish the port apply the controller last asked for, as the real agent does once Caddy is up. */
  completeL4Ports: () => void;
  /** Finish the rebuild the controller last asked for, once Caddy is healthy. */
  completeBuild: () => void;
  stop: () => Promise<void>;
};

function defaultState(overrides: Partial<FakeAgent['state']>): FakeAgent['state'] {
  return {
    appliedPorts: [],
    appliedModules: null,
    l4Status: { state: 'idle' },
    buildStatus: { state: 'idle' },
    caddyAdmin: { status: 200, text: '{}' },
    analytics: { enabled: false, accessLogPresent: false },
    appliedServices: null,
    servicesStatus: { state: 'idle' },
    ...overrides,
  };
}

/**
 * Attach a fake agent and start reading what the controller pushes it.
 *
 * The stream is drained in the background, exactly as the real agent's reader loop does. Frames are
 * logged, and a command is answered immediately from `state.caddyAdmin` — a real agent would take a
 * network round trip, but nothing here is testing latency.
 */
export async function startFakeAgent(
  overrides: Partial<FakeAgent['state']> = {},
): Promise<FakeAgent> {
  const agentId = randomBytes(16).toString('hex');
  const name = 'fake-agent';
  const raw = defaultState(overrides);
  const requests: AgentRequestLog[] = [];

  /**
   * Mutating `state` re-reports, so a test can write `agent.state.l4Status = …` and the controller
   * sees it — which is how the old fake behaved when the controller polled it over HTTP. Status is
   * pushed now, so without this every such assignment would land in an object nothing reads again.
   */
  const state = new Proxy(raw, {
    set(target, key, value) {
      Reflect.set(target, key, value);
      recordStatus(agentId, buildStatus());
      return true;
    },
  });

  const agent: FakeAgent = {
    agentId,
    name,
    requests,
    desired: null,
    state,
    report: () => recordStatus(agentId, buildStatus()),
    completeL4Ports: () => {
      state.appliedPorts = agent.desired?.l4Ports ?? [];
      state.l4Status = { state: 'applied', appliedAt: new Date().toISOString() };
    },
    completeBuild: () => {
      state.appliedModules = agent.desired?.caddyModules ?? [];
      state.buildStatus = { state: 'applied', appliedAt: new Date().toISOString() };
    },
    stop: async () => {
      reading = false;
      detach(agentId);
    },
  };

  // Reads the raw object, never the proxy: buildStatus runs inside the proxy's own setter, and
  // going back through it would be a needless second hop on every mutation.
  function buildStatus(): AgentStatus {
    return {
      agentId,
      version: 'test',
      mode: 'standalone',
      composeProject: 'cpm-test',
      l4Ports: { applied: raw.appliedPorts, status: raw.l4Status },
      caddyBuild: { applied: raw.appliedModules, status: raw.buildStatus },
      services: { applied: raw.appliedServices, status: raw.servicesStatus },
      analytics: raw.analytics,
    };
  }

  const { stream } = attach({
    agentId,
    agentRowId: 1,
    name,
    controllerId: 'test-controller',
    controllerName: 'Test',
    initialState: {
      l4Ports: [],
      caddyModules: [],
      services: { services: { clickhouse: false, geoipupdate: false }, env: {} },
      fleetConfig: { clickhouse: null, geoip: null },
      caddyEnabled: true,
    },
  });

  let reading = true;
  const reader = stream.getReader();
  const decoder = new TextDecoder();

  void (async () => {
    let buffer = '';
    while (reading) {
      const { done, value } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });

      let split = buffer.indexOf('\n\n');
      while (split !== -1) {
        const frame = buffer.slice(0, split);
        buffer = buffer.slice(split + 2);
        handleFrame(frame);
        split = buffer.indexOf('\n\n');
      }
    }
  })().catch(() => {
    // The registry closed the stream; the test is over or the agent was detached.
  });

  function handleFrame(frame: string): void {
    const data = frame
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    // A keepalive comment carries no data lines.
    if (data.length === 0) return;

    const event = JSON.parse(data) as
      | { type: 'hello' }
      | { type: 'desired-state'; state: AgentDesiredState }
      | { type: 'command'; command: AgentCommand };

    if (event.type === 'hello') {
      requests.push({ kind: 'hello' });
      return;
    }
    if (event.type === 'desired-state') {
      agent.desired = event.state;
      requests.push({ kind: 'desired-state', state: event.state });
      return;
    }

    requests.push({ kind: 'command', command: event.command });
    settleResults(agentId, [
      {
        id: event.command.id,
        ok: true,
        response: {
          status: raw.caddyAdmin.status,
          text: raw.caddyAdmin.text,
          headers: { 'content-type': 'application/json' },
        },
      },
    ]);
  }

  // Report once immediately: the controller treats a connected agent that has never reported as
  // present-but-unusable, which is not the state most of these tests are about.
  agent.report();

  // Let the initial hello and desired-state frames land before the test asserts on them.
  await Bun.sleep(5);
  return agent;
}

/** Drop every attached agent, so one suite's registry cannot leak into the next. */
export function clearAgentEnv(): void {
  resetRegistry();
}
