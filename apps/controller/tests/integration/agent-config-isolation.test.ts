/**
 * One agent's answers may only ever shape its own config.
 *
 * A paired agent is less trusted than the controller. Before this, every Caddyfile snippet was
 * adapted by whichever agent attached first and its answer nested, unmodified, into the document
 * loaded onto every agent - so one rogue agent could route traffic on every host in the fleet. The
 * health monitor had the same shape: one agent's `/config/` decided when the whole fleet reloaded.
 *
 * These run on the production transport, so a request reaches the fake agent it is routed to
 * exactly as it would reach a real one.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { vi } from '@/tests/helpers/vi';
import type { TestDb } from '../helpers/db';

const ctx = vi.hoisted(() => ({ db: null as unknown as TestDb }));

const { createTestDb } = await import('../helpers/db');
const schemaModule = await import('../../src/lib/db/schema');

// Hoisted out of the factory below: createTestDb is async, and a Bun mock factory must be
// synchronous - an async one never resolves and the file hangs.
ctx.db = await createTestDb();

vi.mock('../../src/lib/db', () => {
  return {
    default: ctx.db,
    sqlite: undefined,
    schema: schemaModule,
    nowIso: () => new Date().toISOString(),
    toIso: (value: string | Date | null | undefined): string | null => {
      if (!value) return null;
      return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
    },
  };
});

vi.mock('../../src/lib/audit', () => ({ logAuditEvent: vi.fn() }));

import { agentCaddyAdminTransport, setCaddyAdminTransport } from '../../src/lib/caddy-admin';
import { checkCaddyHealth, getMonitorState, resetCaddyMonitor } from '../../src/lib/caddy-monitor';
import { validateCaddyfileSnippet } from '../../src/lib/caddy-caddyfile';
import { createProxyHost } from '../../src/lib/models/proxy-hosts';
import { clearAgentEnv, startFakeAgent, type FakeAgent } from '../helpers/fake-agent';
import * as schema from '../../src/lib/db/schema';

/** What Caddy's /adapt answers for a snippet, carrying these routes. */
function adapted(routes: unknown[]): string {
  return JSON.stringify({ result: { apps: { http: { servers: { srv0: { routes } } } } } });
}

const EVIL = adapted([
  { handle: [{ handler: 'reverse_proxy', upstreams: [{ dial: 'evil.example:443' }] }] },
]);
const BENIGN = adapted([{ handle: [{ handler: 'static_response', body: 'benign-snippet' }] }]);

function loadsOn(agent: FakeAgent): string[] {
  return agent.requests
    .filter((entry) => entry.kind === 'command' && entry.command?.request.path === '/load')
    .map((entry) => entry.command?.request.body ?? '');
}

async function waitFor(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for the condition.');
    await Bun.sleep(10);
  }
}

beforeEach(async () => {
  setCaddyAdminTransport(agentCaddyAdminTransport);
  resetCaddyMonitor();
  await ctx.db.delete(schema.proxyHosts);
  await ctx.db
    .insert(schema.users)
    .values({
      id: 1,
      email: 'admin@example.com',
      name: 'Admin',
      role: 'admin',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .onConflictDoNothing();
});

afterEach(() => {
  clearAgentEnv();
  resetCaddyMonitor();
});

describe('routing a Caddy admin request', () => {
  it('sends a pinned request to the named agent, not the first one attached', async () => {
    await startFakeAgent({ caddyAdmin: { status: 200, text: '"first"' } });
    const second = await startFakeAgent({ caddyAdmin: { status: 200, text: '"second"' } });

    const pinned = await agentCaddyAdminTransport({
      path: '/config/',
      method: 'GET',
      agentId: second.agentId,
    });
    expect(pinned.text).toBe('"second"');
  });

  it('does not fall back to a direct connection when the pinned agent is gone', async () => {
    await startFakeAgent();
    // The direct transport throws its own "used inside a test" error, so this message proves the
    // request never reached it.
    await expect(
      agentCaddyAdminTransport({ path: '/config/', method: 'GET', agentId: 'gone' }),
    ).rejects.toThrow(/No agent is connected/);
  });
});

describe('a rogue agent', () => {
  it("cannot put its adapted routes into another agent's config", async () => {
    // Attached first, so it is the one every unpinned request used to reach.
    const rogue = await startFakeAgent({ caddyAdmin: { status: 200, text: EVIL } });
    const honest = await startFakeAgent({ caddyAdmin: { status: 200, text: BENIGN } });

    // Saving applies the config to both.
    await createProxyHost(
      {
        name: 'app',
        domains: ['app.example.com'],
        upstreams: ['backend:8080'],
        customCaddyfile: 'respond "hello"',
      } as never,
      1,
    );

    const honestLoad = loadsOn(honest).at(-1) ?? '';
    expect(honestLoad).toContain('benign-snippet');
    expect(honestLoad).not.toContain('evil.example');

    // It still configures itself with its own answer: that is its own Caddy to lie to.
    expect(loadsOn(rogue).at(-1) ?? '').toContain('evil.example');
  });

  it('cannot make the monitor reload any Caddy but its own', async () => {
    const configured = { status: 200, text: '{"apps":{"http":{"servers":{}}}}' };
    const restarted = await startFakeAgent({ caddyAdmin: configured });
    const steady = await startFakeAgent({ caddyAdmin: configured });
    const settled = (agent: FakeAgent) =>
      getMonitorState()[agent.agentId]?.lastConfigId !== null &&
      !getMonitorState()[agent.agentId]?.reapplyPending;

    // The first sighting re-applies each Caddy once; let that settle before the restart.
    await checkCaddyHealth(0);
    await waitFor(() => settled(restarted) && settled(steady));
    const steadyLoads = loadsOn(steady).length;
    const restartedLoads = loadsOn(restarted).length;

    // Serving anything but the config it was given reads as "Caddy restarted", which is what
    // triggers a re-apply - here the default Caddyfile's own non-empty http app.
    restarted.state.caddyAdmin = {
      status: 200,
      text: '{"apps":{"http":{"servers":{"srv0":{"listen":[":80"]}}}}}',
    };
    await checkCaddyHealth(0);
    await waitFor(() => loadsOn(restarted).length > restartedLoads);

    expect(loadsOn(steady)).toHaveLength(steadyLoads);
  });

  it('leaves a Caddy alone while it still serves the config it was given', async () => {
    const agent = await startFakeAgent({
      caddyAdmin: { status: 200, text: '{"apps":{"http":{"servers":{}}}}' },
    });

    await checkCaddyHealth(0);
    await waitFor(
      () =>
        getMonitorState()[agent.agentId]?.lastConfigId !== null &&
        !getMonitorState()[agent.agentId]?.reapplyPending,
    );
    const loads = loadsOn(agent).length;

    await checkCaddyHealth(0);
    await checkCaddyHealth(0);
    expect(loadsOn(agent)).toHaveLength(loads);
  });

  it('re-applies each Caddy once when the monitor first sees it', async () => {
    const agent = await startFakeAgent({
      caddyAdmin: { status: 200, text: '{"apps":{"http":{"servers":{}}}}' },
    });
    await checkCaddyHealth(0);
    await waitFor(() => loadsOn(agent).length > 0);
  });
});

describe('validating a Caddyfile snippet', () => {
  it('asks every agent, so one cannot pass a snippet another rejects', async () => {
    await startFakeAgent({ caddyAdmin: { status: 200, text: BENIGN } });
    await startFakeAgent({
      caddyAdmin: { status: 400, text: '{"error":"unrecognized directive: nope"}' },
    });
    expect(await validateCaddyfileSnippet('nope')).toBe('unrecognized directive: nope');
  });
});
