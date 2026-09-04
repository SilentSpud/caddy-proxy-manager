/**
 * What happens with more than one agent.
 *
 * The controller's database is the single source of truth for the whole fleet: every agent's Caddy
 * runs the identical document, publishes the identical ports, and is built with the identical
 * modules. So the properties here are all about *not* letting the hosts drift apart — a partial
 * apply is a state to report, never one to succeed at — and about naming which host went wrong,
 * since with a fleet "it failed" leaves an operator nowhere to look.
 *
 * The agents are real HTTP servers speaking the real protocol; see tests/helpers/fake-agent.ts.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { vi } from '@/tests/helpers/vi';
import type { TestDb } from '../helpers/db';

const ctx = vi.hoisted(() => ({ db: null as unknown as TestDb }));

const { createTestDb } = await import('../helpers/db');
const schemaModule = await import('../../src/lib/db/schema');

// Hoisted out of the factory below: createTestDb is async, and a Bun mock factory must be
// synchronous — an async one never resolves and the file hangs.
ctx.db = await createTestDb();

vi.mock('../../src/lib/db', () => ({
  default: ctx.db,
  schema: schemaModule,
  nowIso: () => new Date().toISOString(),
  toIso: (value: string | Date | null | undefined): string | null => {
    if (!value) return null;
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  },
}));

vi.mock('../../src/lib/audit', () => ({ logAuditEvent: vi.fn() }));

import * as schema from '../../src/lib/db/schema';
const { pairWithAgent } = await import('../../src/lib/agent/pairing');
const { broadcastCaddyAdmin, getAllAgentStatuses, listAgentTargets, requestL4Ports } = await import(
  '../../src/lib/agent/client'
);
const { getAppliedModuleSpecs, defaultModuleSpecs } = await import('../../src/lib/caddy-build');
const { applyCaddyConfig } = await import('../../src/lib/caddy');
const { startFakeAgent, clearAgentEnv } = await import('../helpers/fake-agent');

type FakeAgent = Awaited<ReturnType<typeof startFakeAgent>>;
let first: FakeAgent;
let second: FakeAgent;

const L4 = 'github.com/mholt/caddy-l4';
const CORAZA = 'github.com/corazawaf/coraza-caddy/v2';

/** Stand up two paired agents, as a two-host deployment would have. */
async function pairBoth() {
  for (const [agent, name] of [
    [first, 'first'],
    [second, 'second'],
  ] as const) {
    agent.pairing.code = 'ABCDEF';
    await pairWithAgent({ address: agent.url, code: 'ABCDEF', name });
  }
}

beforeEach(async () => {
  await ctx.db.delete(schema.agents);
  await ctx.db.delete(schema.settings);
  await ctx.db.delete(schema.proxyHosts);
  first = await startFakeAgent();
  second = await startFakeAgent();
  // startFakeAgent points AGENT_URL at whichever ran last; the fleet has to come from the table.
  clearAgentEnv();
});

afterEach(async () => {
  await first.stop();
  await second.stop();
  clearAgentEnv();
});

describe('addressing the fleet', () => {
  it('targets every paired agent', async () => {
    await pairBoth();
    expect((await listAgentTargets()).map((t) => t.name).sort()).toEqual(['first', 'second']);
  });

  it('leaves a disabled agent out', async () => {
    await pairBoth();
    const rows = await ctx.db.select().from(schema.agents);
    const target = rows.find((row) => row.name === 'second');
    const { setAgentEnabled } = await import('../../src/lib/models/agents');
    await setAgentEnabled(target?.id as number, false);

    expect((await listAgentTargets()).map((t) => t.name)).toEqual(['first']);
  });

  it('reports each agent separately', async () => {
    await pairBoth();
    const statuses = await getAllAgentStatuses();
    expect(statuses).toHaveLength(2);
    expect(statuses.every((s) => s.ok)).toBe(true);
  });

  it('reports one unreachable agent without losing the other', async () => {
    await pairBoth();
    await second.stop();

    const statuses = await getAllAgentStatuses();
    expect(statuses.find((s) => s.agent === 'first')?.ok).toBe(true);
    expect(statuses.find((s) => s.agent === 'second')?.ok).toBe(false);
  });
});

describe('applying config to the fleet', () => {
  it('loads the same document onto every agent', async () => {
    await pairBoth();
    await applyCaddyConfig();

    const proxiedBy = (agent: FakeAgent) =>
      agent.requests.find((r) => r.path === '/v1/caddy-admin')?.body as
        | { path: string; body: string }
        | undefined;

    for (const agent of [first, second]) {
      expect(proxiedBy(agent)?.path).toBe('/load');
    }
    // Byte-identical: the database is the single source of truth for the whole fleet, so two hosts
    // ending up with different documents is the failure this fan-out exists to prevent.
    expect(proxiedBy(first)?.body).toBe(proxiedBy(second)?.body as string);
  });

  it('fails the whole apply when one agent rejects the config', async () => {
    await pairBoth();
    second.state.caddyAdmin = { status: 400, text: 'unknown module' };

    // Half a fleet configured is not a success. Reporting it as one would leave one proxy serving
    // the new config and another serving the old, with nothing saying so.
    await expect(applyCaddyConfig()).rejects.toThrow(/rejected configuration/i);
  });

  it('names the agent that rejected it', async () => {
    await pairBoth();
    second.state.caddyAdmin = { status: 400, text: 'unknown module' };

    // With a fleet, "Caddy rejected configuration" leaves the operator with no idea which host is
    // now out of step with the others.
    await expect(applyCaddyConfig()).rejects.toThrow(/second/);
  });

  it('fails when one agent cannot be reached at all', async () => {
    await pairBoth();
    await second.stop();
    await expect(applyCaddyConfig()).rejects.toThrow(/second/);
  });

  it('does not fan out when only one agent is paired', async () => {
    // One agent goes through the ordinary transport seam, whose production adapter already routes
    // to that agent — broadcasting to it would be the same call with extra steps. Here the seam is
    // the harness's in-memory Caddy (tests/setup.bun.ts), so what is observable is that neither
    // fake agent was asked to proxy anything, and the apply still succeeded.
    first.pairing.code = 'ABCDEF';
    await pairWithAgent({ address: first.url, code: 'ABCDEF', name: 'only' });

    await applyCaddyConfig();
    for (const agent of [first, second]) {
      expect(agent.requests.some((r) => r.path === '/v1/caddy-admin')).toBe(false);
    }
  });
});

describe('publishing ports across the fleet', () => {
  it('publishes the same ports on every agent', async () => {
    await pairBoth();
    await requestL4Ports(['5432:5432']);

    for (const agent of [first, second]) {
      const posted = agent.requests.find((r) => r.path === '/v1/l4-ports' && r.method === 'POST');
      expect(posted?.body).toEqual({ ports: ['5432:5432'] });
    }
  });

  it('fails, naming the agent, when one cannot publish', async () => {
    await pairBoth();
    await second.stop();
    await expect(requestL4Ports(['5432:5432'])).rejects.toThrow(/second/);
  });
});

describe('module availability across the fleet', () => {
  it('is the intersection, not the union', async () => {
    // One document goes to every host, so a handler only one binary has makes Caddy reject the
    // whole config on all the others.
    await pairBoth();
    first.state.appliedModules = [L4, CORAZA];
    second.state.appliedModules = [L4];

    expect(await getAppliedModuleSpecs()).toEqual([L4]);
  });

  it('treats an agent that has never rebuilt as carrying the shipped catalog', async () => {
    await pairBoth();
    first.state.appliedModules = null;
    second.state.appliedModules = [L4];

    expect(await getAppliedModuleSpecs()).toEqual([L4]);
  });

  it('is the full catalog when no agent has ever rebuilt', async () => {
    await pairBoth();
    expect(await getAppliedModuleSpecs()).toEqual(defaultModuleSpecs());
  });

  it('ignores an unreachable agent rather than emptying the set', async () => {
    // An unreachable agent cannot be configured either — the apply fails on it and says so — and
    // stripping every plugin-backed handler from the hosts that *are* reachable would turn one
    // unreachable agent into a fleet-wide outage.
    await pairBoth();
    first.state.appliedModules = [L4, CORAZA];
    await second.stop();

    expect(await getAppliedModuleSpecs()).toEqual([CORAZA, L4].sort());
  });

  it('falls back to the shipped catalog when no agent answers at all', async () => {
    await pairBoth();
    await first.stop();
    await second.stop();

    expect(await getAppliedModuleSpecs()).toEqual(defaultModuleSpecs());
  });
});

describe('a Caddy admin broadcast', () => {
  it('reports each agent on its own', async () => {
    await pairBoth();
    second.state.caddyAdmin = { status: 500, text: 'boom' };

    const results = await broadcastCaddyAdmin({ path: '/config/', method: 'GET' });
    // A non-2xx from Caddy is data, not a transport failure: the agent forwarded it faithfully.
    expect(results.every((r) => r.ok)).toBe(true);
    const bad = results.find((r) => r.agent === 'second');
    expect(bad?.ok && bad.value.status).toBe(500);
  });
});
