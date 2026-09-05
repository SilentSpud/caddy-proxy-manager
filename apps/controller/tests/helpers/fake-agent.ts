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
  type ManagedServiceName,
  type ManagedServicesRequest,
  type ManagedServicesStatus,
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
  /** The code `POST /v1/pair` will accept, and the secret it hands back. Null refuses to pair. */
  pairing: { code: string | null; issued: string };
  requests: AgentRequestLog[];
  state: {
    appliedPorts: string[];
    appliedModules: string[] | null;
    l4Status: L4PortsStatus;
    buildStatus: CaddyBuildStatus;
    /** What this agent's Caddy answers a /v1/caddy-admin request with. */
    caddyAdmin: { status: number; text: string };
    analytics: { enabled: boolean; accessLogPresent: boolean };
    appliedServices: Record<ManagedServiceName, boolean> | null;
    servicesStatus: ManagedServicesStatus;
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
  const pairing = { code: null as string | null, issued: randomBytes(32).toString('hex') };
  // Which secret belongs to which controller, exactly as the real agent stores it. `local` is the
  // one AGENT_URL/AGENT_SECRET uses; pairing adds a row under whatever id the controller sent.
  const secrets = new Map<string, string>([['local', secret]]);
  const requests: AgentRequestLog[] = [];
  let pendingPorts: string[] | null = null;
  let pendingModules: string[] | null = null;
  const state: FakeAgent['state'] = {
    appliedPorts: [],
    appliedModules: null,
    l4Status: { state: 'idle' },
    buildStatus: { state: 'idle' },
    caddyAdmin: { status: 200, text: '{}' },
    analytics: { enabled: false, accessLogPresent: true },
    appliedServices: null,
    servicesStatus: { state: 'idle' },
    ...overrides,
  };

  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    async fetch(request) {
      const url = new URL(request.url);
      const raw = await request.arrayBuffer();
      const bodyText = new TextDecoder().decode(raw);

      // Pairing is the one unauthenticated route, since it is what establishes the secret.
      if (url.pathname === AGENT_ROUTES.pair) {
        const body = bodyText.length > 0 ? (JSON.parse(bodyText) as Record<string, unknown>) : {};
        requests.push({ method: request.method, path: url.pathname, body, signed: false });
        if (pairing.code === null) {
          return Response.json(
            { error: 'This agent runs in standalone mode.', code: 'PAIRING_DISABLED' },
            { status: 403 },
          );
        }
        if (body.code !== pairing.code) {
          return Response.json(
            { error: 'That pairing code is not valid.', code: 'PAIRING_CODE_INVALID' },
            { status: 401 },
          );
        }
        // One-time, exactly as the real agent treats it.
        pairing.code = null;
        secrets.set(String(body.controllerId), pairing.issued);
        return Response.json({
          secret: pairing.issued,
          agentId: 'fake-agent',
          agentVersion: 'test',
        });
      }

      const controllerId = request.headers.get(AGENT_CONTROLLER_HEADER) ?? '';
      const controllerSecret = secrets.get(controllerId);
      const timestamp = Number(request.headers.get(AGENT_TIMESTAMP_HEADER) ?? '0');
      const hasher = new Bun.CryptoHasher('sha256');
      hasher.update(bodyText);
      const expected = controllerSecret
        ? createHmac('sha256', controllerSecret)
            .update(signatureBase(request.method, url.pathname, timestamp, hasher.digest('hex')))
            .digest('hex')
        : null;
      const signed = expected !== null && request.headers.get(AGENT_SIGNATURE_HEADER) === expected;

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
          services: { applied: state.appliedServices, status: state.servicesStatus },
          analytics: state.analytics,
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

      if (url.pathname === AGENT_ROUTES.fleetConfig && request.method === 'POST') {
        const pushed = JSON.parse(bodyText) as { clickhouse: unknown };
        state.analytics = { ...state.analytics, enabled: pushed.clickhouse !== null };
        return Response.json({ ok: true });
      }

      if (url.pathname === AGENT_ROUTES.services && request.method === 'POST') {
        // Applied straight away, unlike ports and builds: the real agent answers 202 and reconciles
        // in the background, but nothing in the controller waits on the result, so a test asserting
        // on what was requested reads the logged body rather than this.
        const pushed = JSON.parse(bodyText) as ManagedServicesRequest;
        state.appliedServices = pushed.services;
        state.servicesStatus = { state: 'applying', triggeredAt: new Date().toISOString() };
        return Response.json({ accepted: true, status: state.servicesStatus }, { status: 202 });
      }

      if (url.pathname === AGENT_ROUTES.caddyAdmin && request.method === 'POST') {
        return Response.json({ ...state.caddyAdmin, headers: {} });
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
    pairing,
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
