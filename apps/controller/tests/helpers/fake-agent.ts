/**
 * A stand-in agent for the controller's tests.
 *
 * It is deliberately not a mock of the client: it is a real HTTP server speaking the real wire
 * protocol and verifying the real signature, so a test that passes here proves the controller signs
 * correctly and sends what it claims. Mocking `agent/client` would have left the signing path — the
 * only part of this seam that can fail silently — untested on both sides.
 *
 * The agent's own behaviour (Docker, compose, health) is covered by `apps/agent/tests`.
 */

import { createHmac, randomBytes } from 'node:crypto';
import {
  AGENT_CONTROLLER_HEADER,
  AGENT_ROUTES,
  AGENT_SIGNATURE_HEADER,
  AGENT_TIMESTAMP_HEADER,
  signatureBase,
  type AgentStatus,
  type CaddyBuildStatus,
  type L4PortsStatus,
} from '@cpm/shared';

export type AgentRequestLog = {
  method: string;
  path: string;
  body: unknown;
  /** Whether the signature the controller sent verified against the shared secret. */
  signed: boolean;
};

export type FakeAgent = {
  url: string;
  secret: string;
  requests: AgentRequestLog[];
  state: {
    appliedPorts: string[];
    appliedModules: string[] | null;
    l4Status: L4PortsStatus;
    buildStatus: CaddyBuildStatus;
  };
  /** Finish the port apply the controller last asked for, as the real agent does once Caddy is up. */
  completeL4Ports: () => void;
  /** Finish the rebuild the controller last asked for, as the real agent does once Caddy is healthy. */
  completeBuild: () => void;
  stop: () => Promise<void>;
};

/**
 * Start a fake agent on a loopback port and return the environment the controller needs.
 *
 * TCP rather than a Unix socket: the socket is the production transport, but binding one is not
 * portable across the platforms this suite runs on, and the transport is not what these tests are
 * about — the protocol is. The client treats both identically once a transport is resolved.
 */
export async function startFakeAgent(
  overrides: Partial<FakeAgent['state']> = {},
): Promise<FakeAgent> {
  const secret = randomBytes(32).toString('hex');
  const requests: AgentRequestLog[] = [];
  let pendingPorts: string[] | null = null;
  let pendingModules: string[] | null = null;
  const state: FakeAgent['state'] = {
    appliedPorts: [],
    appliedModules: null,
    l4Status: { state: 'idle' },
    buildStatus: { state: 'idle' },
    ...overrides,
  };

  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    async fetch(request) {
      const url = new URL(request.url);
      const raw = await request.arrayBuffer();
      const bodyText = new TextDecoder().decode(raw);

      const timestamp = Number(request.headers.get(AGENT_TIMESTAMP_HEADER) ?? '0');
      const hasher = new Bun.CryptoHasher('sha256');
      hasher.update(bodyText);
      const expected = createHmac('sha256', secret)
        .update(signatureBase(request.method, url.pathname, timestamp, hasher.digest('hex')))
        .digest('hex');
      const signed =
        request.headers.get(AGENT_SIGNATURE_HEADER) === expected &&
        request.headers.get(AGENT_CONTROLLER_HEADER) === 'local';

      requests.push({
        method: request.method,
        path: url.pathname,
        body: bodyText.length > 0 ? JSON.parse(bodyText) : null,
        signed,
      });

      if (!signed) {
        return Response.json(
          { error: 'The request is not signed by a paired controller.', code: 'UNAUTHENTICATED' },
          { status: 401 },
        );
      }

      if (url.pathname === AGENT_ROUTES.status) {
        return Response.json({
          agentId: 'fake-agent',
          version: 'test',
          mode: 'standalone',
          composeProject: 'caddy-proxy-manager',
          l4Ports: { applied: state.appliedPorts, status: state.l4Status },
          caddyBuild: { applied: state.appliedModules, status: state.buildStatus },
        } satisfies AgentStatus);
      }

      // Both writes are accepted, not completed. The real agent recreates a container or compiles
      // Caddy from source, so it answers 202 with an in-progress status and updates the applied
      // set only once that work has finished — which is exactly the window in which the controller
      // must not claim the change has landed. Use completeL4Ports/completeBuild to close it.
      if (url.pathname === AGENT_ROUTES.l4Ports && request.method === 'POST') {
        const ports = (JSON.parse(bodyText) as { ports: string[] }).ports;
        pendingPorts = ports;
        state.l4Status = {
          state: 'applying',
          message: `Recreating Caddy with ${ports.length} published port(s).`,
          triggeredAt: new Date().toISOString(),
        };
        return Response.json({ accepted: true, status: state.l4Status }, { status: 202 });
      }

      if (url.pathname === AGENT_ROUTES.caddyBuild && request.method === 'POST') {
        pendingModules = (JSON.parse(bodyText) as { modules: string[] }).modules;
        state.buildStatus = {
          state: 'building',
          message: 'Rebuilding the Caddy image with the selected modules.',
          triggeredAt: new Date().toISOString(),
        };
        return Response.json({ accepted: true, status: state.buildStatus }, { status: 202 });
      }

      return Response.json({ error: 'No such endpoint.', code: 'BAD_REQUEST' }, { status: 404 });
    },
  });

  const url = `http://127.0.0.1:${server.port}`;
  process.env.AGENT_URL = url;
  process.env.AGENT_SECRET = secret;

  return {
    url,
    secret,
    requests,
    state,
    completeL4Ports: () => {
      if (pendingPorts === null) throw new Error('No port apply is in flight.');
      state.appliedPorts = pendingPorts;
      state.l4Status = {
        state: 'applied',
        message: `Caddy recreated with ${pendingPorts.length} published port(s).`,
        appliedAt: new Date().toISOString(),
      };
      pendingPorts = null;
    },
    completeBuild: () => {
      if (pendingModules === null) throw new Error('No rebuild is in flight.');
      state.appliedModules = pendingModules;
      state.buildStatus = {
        state: 'applied',
        message: 'Caddy was rebuilt with the selected modules and is healthy.',
        appliedAt: new Date().toISOString(),
      };
      pendingModules = null;
    },
    stop: async () => {
      delete process.env.AGENT_URL;
      delete process.env.AGENT_SECRET;
      await server.stop(true);
    },
  };
}

/** Point the controller at nothing, for the "no agent is running" cases. */
export function clearAgentEnv(): void {
  delete process.env.AGENT_URL;
  delete process.env.AGENT_SECRET;
}
