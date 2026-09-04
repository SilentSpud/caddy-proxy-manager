/**
 * Pairing, and the standing grant it creates.
 *
 * A row in `agents` lets whoever reads it recreate containers on another host, so the properties
 * worth pinning are about what the exchange refuses and what it never lets out: the secret must
 * not reach the browser, must not be stored in the clear, and must not be accepted from something
 * that is not an agent.
 *
 * The agent here is a real HTTP server speaking the real protocol — see tests/helpers/fake-agent.ts.
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

import * as schema from '../../src/lib/db/schema';
const { normalizeAgentAddress, normalizePairingCode, pairWithAgent, PairingError } = await import(
  '../../src/lib/agent/pairing'
);
const { getActiveAgent, getControllerId, listAgents, deleteAgent } = await import(
  '../../src/lib/models/agents'
);
const { getAgentStatus, tryGetAgentStatus } = await import('../../src/lib/agent/client');
const { startFakeAgent, clearAgentEnv } = await import('../helpers/fake-agent');

type FakeAgent = Awaited<ReturnType<typeof startFakeAgent>>;
let agent: FakeAgent;

beforeEach(async () => {
  await ctx.db.delete(schema.agents);
  await ctx.db.delete(schema.settings);
  agent = await startFakeAgent();
  // The fake sets AGENT_URL/AGENT_SECRET so the l4-ports tests can use it directly. Pairing has to
  // be tested without that shortcut, or the stored row would never be the thing under test.
  clearAgentEnv();
  agent.pairing.code = 'ABCDEF';
});

afterEach(async () => {
  await agent.stop();
});

// ─── Input handling ──────────────────────────────────────────────────────────

describe('normalizeAgentAddress', () => {
  it('accepts a bare host and port', () => {
    expect(normalizeAgentAddress('agent.example.com:3100')).toBe('http://agent.example.com:3100');
  });

  it('defaults to the agent port rather than 80', () => {
    // Nothing about a bare hostname suggests port 80, and silently dialling it would send a
    // pairing code to whatever is listening there.
    expect(normalizeAgentAddress('agent.example.com')).toBe('http://agent.example.com:3100');
  });

  it('keeps an explicit https scheme', () => {
    expect(normalizeAgentAddress('https://agent.example.com:9000')).toBe(
      'https://agent.example.com:9000',
    );
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeAgentAddress('  agent.example.com:3100  ')).toBe(
      'http://agent.example.com:3100',
    );
  });

  it('refuses a scheme that is not http or https', () => {
    expect(() => normalizeAgentAddress('ftp://agent.example.com')).toThrow(PairingError);
    expect(() => normalizeAgentAddress('file:///etc/passwd')).toThrow(PairingError);
  });

  it('refuses an address carrying a path or a query', () => {
    // An address with a path is a sign the operator pasted something else. Trimming it quietly
    // would send the code somewhere they did not mean.
    expect(() => normalizeAgentAddress('http://agent.example.com/admin')).toThrow(PairingError);
    expect(() => normalizeAgentAddress('http://agent.example.com?x=1')).toThrow(PairingError);
  });

  it('refuses an empty address', () => {
    expect(() => normalizeAgentAddress('   ')).toThrow(PairingError);
  });
});

describe('normalizePairingCode', () => {
  it('accepts the code as printed', () => {
    expect(normalizePairingCode('ABCDEF')).toBe('ABCDEF');
  });

  it('accepts it typed in lower case or with spaces', () => {
    expect(normalizePairingCode(' abc def ')).toBe('ABCDEF');
  });

  it('refuses anything that is not six letters', () => {
    for (const bad of ['ABCDE', 'ABCDEFG', 'ABC123', '', 'ABCD-EF']) {
      expect(() => normalizePairingCode(bad)).toThrow(PairingError);
    }
  });
});

// ─── The exchange ────────────────────────────────────────────────────────────

describe('pairWithAgent', () => {
  it('stores the agent the exchange returns', async () => {
    const paired = await pairWithAgent({ address: agent.url, code: 'ABCDEF' });

    expect(paired.address).toBe(agent.url);
    expect(paired.agentId).toBe('fake-agent');
    expect(await listAgents()).toHaveLength(1);
  });

  it('never returns the secret to its caller', async () => {
    // This value crosses a server action's boundary into the browser. The secret authenticates
    // every later request, so it must not be anywhere in what comes back.
    const paired = await pairWithAgent({ address: agent.url, code: 'ABCDEF' });
    expect(JSON.stringify(paired)).not.toContain(agent.pairing.issued);
  });

  it('never stores the secret in the clear', async () => {
    await pairWithAgent({ address: agent.url, code: 'ABCDEF' });
    const [row] = await ctx.db.select().from(schema.agents);
    expect(row.secret).not.toBe(agent.pairing.issued);
    expect(row.secret.startsWith('enc:v1:')).toBe(true);
  });

  it("sends this controller's stable id, so the agent can key the secret on it", async () => {
    await pairWithAgent({ address: agent.url, code: 'ABCDEF' });
    const request = agent.requests.find((r) => r.path === '/v1/pair');
    const body = request?.body as { controllerId: string } | undefined;
    expect(body?.controllerId).toBe(await getControllerId());
  });

  it('names the agent after its host when no name is given', async () => {
    const paired = await pairWithAgent({ address: agent.url, code: 'ABCDEF' });
    expect(paired.name).toBe('127.0.0.1');
  });

  it('uses the name it is given', async () => {
    const paired = await pairWithAgent({ address: agent.url, code: 'ABCDEF', name: '  Edge  ' });
    expect(paired.name).toBe('Edge');
  });

  it("passes the agent's own refusal through", async () => {
    // The operator has one code and five minutes. "Pairing failed" would tell them nothing about
    // whether to retype the code or check the address.
    await expect(pairWithAgent({ address: agent.url, code: 'ZZZZZZ' })).rejects.toThrow(
      /not valid/i,
    );
    expect(await listAgents()).toHaveLength(0);
  });

  it('reports an unreachable address as such', async () => {
    const dead = agent.url;
    await agent.stop();
    await expect(pairWithAgent({ address: dead, code: 'ABCDEF' })).rejects.toThrow(
      /nothing answered/i,
    );
  });

  it("refuses a reply that is not an agent's", async () => {
    // Something answered, but a short secret means either not an agent or a reply rewritten in
    // transit. Storing it would leave a pairing that looks complete and authenticates nothing.
    const impostor = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch: () => Response.json({ secret: 'short', agentId: 'x' }),
    });
    try {
      await expect(
        pairWithAgent({ address: `http://127.0.0.1:${impostor.port}`, code: 'ABCDEF' }),
      ).rejects.toThrow(/not like an agent/i);
      expect(await listAgents()).toHaveLength(0);
    } finally {
      await impostor.stop(true);
    }
  });

  it('replaces the secret when the same address pairs again', async () => {
    // The recovery path for a controller whose copy is gone. Refusing would leave the operator
    // editing the database by hand.
    await pairWithAgent({ address: agent.url, code: 'ABCDEF' });
    const first = (await getActiveAgent())?.secret;

    agent.pairing.code = 'GHJKLM';
    agent.pairing.issued = 'b'.repeat(64);
    await pairWithAgent({ address: agent.url, code: 'GHJKLM' });

    expect(await listAgents()).toHaveLength(1);
    expect((await getActiveAgent())?.secret).toBe('b'.repeat(64));
    expect((await getActiveAgent())?.secret).not.toBe(first as string);
  });

  it('cannot reuse a code the agent has already burned', async () => {
    await pairWithAgent({ address: agent.url, code: 'ABCDEF' });
    await expect(pairWithAgent({ address: agent.url, code: 'ABCDEF' })).rejects.toThrow(
      PairingError,
    );
  });
});

// ─── What the paired agent is then used for ──────────────────────────────────

describe('the paired agent', () => {
  it('is the one the client talks to', async () => {
    await pairWithAgent({ address: agent.url, code: 'ABCDEF' });
    // The fake verifies the signature against the secret it issued, so a status that comes back at
    // all proves the controller signed with the stored secret and the right controller id.
    const status = await getAgentStatus();
    expect(status.agentId).toBe('fake-agent');
  });

  it('beats AGENT_URL, which pairing is meant to replace', async () => {
    await pairWithAgent({ address: agent.url, code: 'ABCDEF' });
    // A leftover variable must not silently override an operator's explicit pairing.
    process.env.AGENT_URL = 'http://127.0.0.1:1';
    process.env.AGENT_SECRET = 'c'.repeat(64);
    try {
      expect((await getAgentStatus()).agentId).toBe('fake-agent');
    } finally {
      clearAgentEnv();
    }
  });

  it('records when it was last reached', async () => {
    await pairWithAgent({ address: agent.url, code: 'ABCDEF' });
    await getAgentStatus();
    const [row] = await ctx.db.select().from(schema.agents);
    expect(row.lastSeenAt).not.toBeNull();
    expect(row.lastError).toBeNull();
  });

  it('records why it could not be reached', async () => {
    await pairWithAgent({ address: agent.url, code: 'ABCDEF' });
    await agent.stop();

    expect(await tryGetAgentStatus()).toBeNull();
    const [row] = await ctx.db.select().from(schema.agents);
    expect(row.lastError).toBe('Unreachable');
  });

  it('stops being used once it is unpaired', async () => {
    const paired = await pairWithAgent({ address: agent.url, code: 'ABCDEF' });
    await deleteAgent(paired.id);

    expect(await getActiveAgent()).toBeNull();
    // No local socket either, so there is nothing left to fall back to.
    expect(await tryGetAgentStatus()).toBeNull();
  });
});

describe('getControllerId', () => {
  it('is stable across calls', async () => {
    // Agents key their stored secrets on it. A new id would make every paired agent refuse this
    // controller, with no way back but re-pairing each one by hand.
    const first = await getControllerId();
    expect(await getControllerId()).toBe(first);
    expect(first).toMatch(/^[0-9a-f]{32}$/);
  });
});
