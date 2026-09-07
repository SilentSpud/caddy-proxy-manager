/**
 * Pairing, and the standing grant it creates — now minted here rather than by the agent.
 *
 * A row in `agents` lets whoever holds its secret run Caddy admin calls on another host, so the
 * properties worth pinning are about what the exchange refuses and what it never lets out: the
 * secret must not be stored in the clear, the code must work exactly once, and guessing must be
 * bounded.
 *
 * The route is exercised directly. There is no agent to stand up any more — the agent's side of
 * pairing is one unsigned POST — which is most of why this file is a third of its old length.
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
const { ensurePairingCode, redeemPairingCode, resetPairingCodes } = await import(
  '../../src/lib/agent/pairing-codes'
);
const { listAgents, findAgentByAgentId } = await import('../../src/lib/models/agents');
const { POST } = await import('../../src/app/api/agent/v1/pair/route');

const AGENT_ID = 'a'.repeat(32);

function pairRequest(body: unknown): Request {
  return new Request('http://controller.test/api/agent/v1/pair', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  resetPairingCodes();
  await ctx.db.delete(schema.agents);
});

afterEach(() => {
  resetPairingCodes();
});

describe('pairing codes', () => {
  it('mints a six-letter code and keeps returning the same one until it expires', () => {
    const first = ensurePairingCode();
    expect(first.code).toMatch(/^[A-Z]{6}$/);
    expect(ensurePairingCode().code).toBe(first.code);
  });

  it('draws only from an alphabet with no I or O, so a code can be read aloud', () => {
    for (let i = 0; i < 50; i += 1) {
      resetPairingCodes();
      expect(ensurePairingCode().code).not.toMatch(/[IO]/);
    }
  });

  it('burns the code on success, so it cannot be used twice', () => {
    const { code } = ensurePairingCode();
    expect(redeemPairingCode(code).ok).toBe(true);
    expect(redeemPairingCode(code).ok).toBe(false);
  });

  it('refuses an expired code and does not resurrect it', () => {
    const { code } = ensurePairingCode();
    const later = Date.now() + 6 * 60_000;
    expect(redeemPairingCode(code, later).ok).toBe(false);
    expect(redeemPairingCode(code).ok).toBe(false);
  });

  it('burns the code after ten wrong guesses, bounding a five-minute guessing window', () => {
    const { code } = ensurePairingCode();
    for (let i = 0; i < 10; i += 1) expect(redeemPairingCode('ZZZZZZ').ok).toBe(false);
    expect(redeemPairingCode(code).ok).toBe(false);
  });

  it('accepts a code typed in lower case with stray spaces', () => {
    const { code } = ensurePairingCode();
    expect(redeemPairingCode(`  ${code.toLowerCase()} `).ok).toBe(true);
  });
});

describe('POST /api/agent/v1/pair', () => {
  it('stores the agent and returns a secret it did not receive', async () => {
    const { code } = ensurePairingCode();
    const response = await POST(
      pairRequest({ code, agentId: AGENT_ID, agentName: 'edge', agentVersion: '3.0.0' }),
    );
    expect(response.status).toBe(200);

    const body = (await response.json()) as { secret: string; controllerId: string };
    expect(body.secret).toMatch(/^[0-9a-f]{64}$/);
    expect(body.controllerId).toBeTruthy();

    const agents = await listAgents();
    expect(agents).toHaveLength(1);
    expect(agents[0].agentId).toBe(AGENT_ID);
    expect(agents[0].name).toBe('edge');
  });

  it('never stores the secret in the clear', async () => {
    const { code } = ensurePairingCode();
    const response = await POST(pairRequest({ code, agentId: AGENT_ID, agentVersion: '3.0.0' }));
    const { secret } = (await response.json()) as { secret: string };

    const [row] = await ctx.db.select().from(schema.agents);
    expect(row.secret).not.toBe(secret);
    // …and it must still decrypt back to what the agent was given, or the agent can never sign.
    expect((await findAgentByAgentId(AGENT_ID))?.secret).toBe(secret);
  });

  it('refuses a wrong code with 401 and stores nothing', async () => {
    ensurePairingCode();
    const response = await POST(
      pairRequest({ code: 'ZZZZZZ', agentId: AGENT_ID, agentVersion: '3.0.0' }),
    );
    expect(response.status).toBe(401);
    expect(await listAgents()).toHaveLength(0);
  });

  it('refuses a code that was already redeemed', async () => {
    const { code } = ensurePairingCode();
    await POST(pairRequest({ code, agentId: AGENT_ID, agentVersion: '3.0.0' }));
    const second = await POST(
      pairRequest({ code, agentId: 'b'.repeat(32), agentVersion: '3.0.0' }),
    );
    expect(second.status).toBe(401);
    expect(await listAgents()).toHaveLength(1);
  });

  it('rejects an agent id that is not one, before touching the code', async () => {
    const { code } = ensurePairingCode();
    const response = await POST(pairRequest({ code, agentId: '../etc', agentVersion: '3.0.0' }));
    expect(response.status).toBe(400);
    // The code survives: a malformed request must not burn the operator's code for them.
    expect(redeemPairingCode(code).ok).toBe(true);
  });

  it('re-pairing the same host replaces its secret rather than adding a row', async () => {
    const first = ensurePairingCode();
    const a = await POST(
      pairRequest({ code: first.code, agentId: AGENT_ID, agentVersion: '3.0.0' }),
    );
    const secretA = ((await a.json()) as { secret: string }).secret;

    resetPairingCodes();
    const second = ensurePairingCode();
    const b = await POST(
      pairRequest({ code: second.code, agentId: AGENT_ID, agentVersion: '3.0.0' }),
    );
    const secretB = ((await b.json()) as { secret: string }).secret;

    expect(secretB).not.toBe(secretA);
    expect(await listAgents()).toHaveLength(1);
    expect((await findAgentByAgentId(AGENT_ID))?.secret).toBe(secretB);
  });

  it('names an agent that did not name itself', async () => {
    const { code } = ensurePairingCode();
    await POST(pairRequest({ code, agentId: AGENT_ID, agentVersion: '3.0.0' }));
    expect((await listAgents())[0].name).toBe(`Agent ${AGENT_ID.slice(0, 8)}`);
  });

  it('refuses a body that is not JSON', async () => {
    ensurePairingCode();
    const response = await POST(
      new Request('http://controller.test/api/agent/v1/pair', { method: 'POST', body: 'nonsense' }),
    );
    expect(response.status).toBe(400);
  });
});

describe('bootstrap token', () => {
  // Its own directory per test: the token is a file, and a leaked one between tests would let a
  // stale value pair when the test believed there was none.
  let dir: string;

  beforeEach(async () => {
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    dir = mkdtempSync(join(tmpdir(), 'cpm-bootstrap-'));
    process.env.L4_PORTS_DIR = dir;
  });

  afterEach(() => {
    process.env.L4_PORTS_DIR = undefined;
  });

  it('writes a token once and leaves it alone on the next start', async () => {
    const { readFileSync } = await import('node:fs');
    const { ensureBootstrapToken, bootstrapPath } = await import('../../src/lib/agent/bootstrap');

    expect(ensureBootstrapToken()).toBe(true);
    const first = readFileSync(bootstrapPath(), 'utf-8');
    expect(first).toMatch(/^[0-9a-f]{64}$/);

    // A restart must not invalidate a token an agent has already read but not yet redeemed.
    ensureBootstrapToken();
    expect(readFileSync(bootstrapPath(), 'utf-8')).toBe(first);
  });

  it('pairs an agent that presents it, and rotates it so it cannot be replayed', async () => {
    const { readFileSync } = await import('node:fs');
    const { ensureBootstrapToken, bootstrapPath } = await import('../../src/lib/agent/bootstrap');
    ensureBootstrapToken();
    const token = readFileSync(bootstrapPath(), 'utf-8').trim();

    const response = await POST(
      pairRequest({ code: token, agentId: AGENT_ID, agentVersion: '3.0.0' }),
    );
    expect(response.status).toBe(200);
    expect(await listAgents()).toHaveLength(1);

    // Rotated, not deleted: the next agent to come up needs one of its own.
    const rotated = readFileSync(bootstrapPath(), 'utf-8').trim();
    expect(rotated).toMatch(/^[0-9a-f]{64}$/);
    expect(rotated).not.toBe(token);

    // And the one just used is dead.
    const replay = await POST(
      pairRequest({ code: token, agentId: 'c'.repeat(32), agentVersion: '3.0.0' }),
    );
    expect(replay.status).toBe(401);
    expect(await listAgents()).toHaveLength(1);
  });

  it('refuses a token that is the right shape but not the stored one', async () => {
    const { ensureBootstrapToken } = await import('../../src/lib/agent/bootstrap');
    ensureBootstrapToken();

    const response = await POST(
      pairRequest({ code: 'd'.repeat(64), agentId: AGENT_ID, agentVersion: '3.0.0' }),
    );
    expect(response.status).toBe(401);
    expect(await listAgents()).toHaveLength(0);
  });

  it('does not let a bootstrap token stand in for a typed code when none was written', async () => {
    // No ensureBootstrapToken() here: a controller with no shared volume must refuse this outright
    // rather than falling through to the six-letter path and comparing against a live code.
    ensurePairingCode();
    const response = await POST(
      pairRequest({ code: 'e'.repeat(64), agentId: AGENT_ID, agentVersion: '3.0.0' }),
    );
    expect(response.status).toBe(401);
    expect(await listAgents()).toHaveLength(0);
  });

  it('leaves the typed-code path working alongside it', async () => {
    const { ensureBootstrapToken } = await import('../../src/lib/agent/bootstrap');
    ensureBootstrapToken();

    const { code } = ensurePairingCode();
    const response = await POST(pairRequest({ code, agentId: AGENT_ID, agentVersion: '3.0.0' }));
    expect(response.status).toBe(200);
  });
});
