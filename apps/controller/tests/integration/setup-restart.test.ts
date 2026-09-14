/**
 * POST /api/setup/restart ends the process. It is reachable without signing in, so it has to stay
 * a single restart for the operator who ran the import - not a way for anyone to keep ending it.
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import { vi } from '@/tests/helpers/vi';
import { nextIntlServerMock } from '../helpers/next-intl';
import type { TestDb } from '../helpers/db';

const ctx = vi.hoisted(() => ({ db: null as unknown as TestDb }));

const { createTestDb } = await import('../helpers/db');
const schemaModule = await import('../../src/lib/db/schema');

// Hoisted out of the factory below: createTestDb is async, and a Bun mock factory must be
// synchronous - an async one never resolves and the file hangs.
ctx.db = await createTestDb();

vi.mock('../../src/lib/db', () => ({
  default: ctx.db,
  sqlite: undefined,
  schema: schemaModule,
  nowIso: () => new Date().toISOString(),
  toIso: (value: string | Date | null | undefined): string | null =>
    !value ? null : value instanceof Date ? value.toISOString() : new Date(value).toISOString(),
}));

// The real one exits the process, which would take the test runner with it.
vi.mock('../../src/lib/process-restart', () => ({ scheduleProcessRestart: vi.fn() }));
vi.mock('next-intl/server', () => nextIntlServerMock());

import type { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { POST } from '../../src/app/api/setup/restart/route';
import { auth } from '@/src/lib/auth';
import { scheduleProcessRestart } from '../../src/lib/process-restart';
import { issueRestartToken, markSetupCompleted, recordMigrationSource } from '../../src/lib/setup';
import { settings, users } from '../../src/lib/db/schema';
import { clearAgentEnv, startFakeAgent } from '../helpers/fake-agent';

const mockAuth = vi.mocked(auth);
const mockRestart = vi.mocked(scheduleProcessRestart);
const now = '2026-01-01T00:00:00.000Z';

/**
 * A same-origin POST, shaped by hand: a real Request drops the Host header, which checkSameOrigin
 * compares Origin against.
 */
function post(headers: Record<string, string> = {}) {
  const all: Record<string, string> = {
    origin: 'http://localhost:3000',
    host: 'localhost:3000',
    ...headers,
  };
  return POST({
    method: 'POST',
    headers: { get: (name: string) => all[name.toLowerCase()] ?? null },
  } as unknown as NextRequest);
}

/** What an import that brought the old accounts leaves behind. */
async function seedMigratedAccount() {
  await ctx.db.insert(users).values({
    email: 'admin@example.com',
    name: 'Admin',
    role: 'admin',
    status: 'active',
    createdAt: now,
    updatedAt: now,
  });
}

/** Forget the last accepted restart, so a test can look at one guard at a time. */
async function clearCooldown() {
  await ctx.db.delete(settings).where(eq(settings.key, 'setup:restart_requested_at'));
}

beforeEach(async () => {
  mockRestart.mockClear();
  mockAuth.mockResolvedValue(null);
  clearAgentEnv();
  await ctx.db.delete(settings);
  await ctx.db.delete(users);
  await recordMigrationSource('/data/legacy.db');
});

describe('POST /api/setup/restart once the import brought a way to sign in', () => {
  it('refuses a caller with neither the import token nor an admin session', async () => {
    await seedMigratedAccount();

    const response = await post();

    expect(response.status).toBe(401);
    expect(mockRestart).not.toHaveBeenCalled();
  });

  it('restarts for the browser holding the token, and only once per token', async () => {
    await seedMigratedAccount();
    const token = await issueRestartToken();

    const first = await post({ 'x-cpm-restart-token': token });
    expect(first.status).toBe(202);
    expect(mockRestart).toHaveBeenCalledTimes(1);

    await clearCooldown();
    const replay = await post({ 'x-cpm-restart-token': token });
    expect(replay.status).toBe(401);
    expect(mockRestart).toHaveBeenCalledTimes(1);
  });

  it('refuses a token it did not issue', async () => {
    await seedMigratedAccount();
    await issueRestartToken();

    const response = await post({ 'x-cpm-restart-token': 'guessed' });

    expect(response.status).toBe(401);
    expect(mockRestart).not.toHaveBeenCalled();
  });

  it('lets an administrator restart', async () => {
    await seedMigratedAccount();
    mockAuth.mockResolvedValue({
      user: { id: '1', email: 'admin@example.com', name: 'Admin', role: 'admin' },
    });

    const response = await post();

    expect(response.status).toBe(202);
    expect(mockRestart).toHaveBeenCalledTimes(1);
  });

  it('does not let a session without the admin role restart', async () => {
    await seedMigratedAccount();
    mockAuth.mockResolvedValue({
      user: { id: '2', email: 'user@example.com', name: 'User', role: 'user' },
    });

    const response = await post();

    expect(response.status).toBe(401);
    expect(mockRestart).not.toHaveBeenCalled();
  });
});

describe('POST /api/setup/restart in any state', () => {
  it('allows one restart a minute, so the process cannot be held in a loop', async () => {
    // Nothing can sign in yet, so the request is unauthenticated by design; the cooldown is what
    // bounds it. It lives in the database, because the restart it allows wipes process memory.
    const first = await post();
    expect(first.status).toBe(202);

    const second = await post();
    expect(second.status).toBe(429);
    expect(Number(second.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(mockRestart).toHaveBeenCalledTimes(1);
  });

  it('replaces a corrupt cooldown stamp rather than refusing forever with a NaN Retry-After', async () => {
    await ctx.db.insert(settings).values({
      key: 'setup:restart_requested_at',
      value: 'not-a-date',
      updatedAt: now,
    });

    const first = await post();
    expect(first.status).toBe(202);

    const second = await post();
    expect(second.status).toBe(429);
    expect(Number.isFinite(Number(second.headers.get('retry-after')))).toBe(true);
    expect(mockRestart).toHaveBeenCalledTimes(1);
  });

  it('refuses a cross-origin request', async () => {
    const response = await post({ origin: 'https://evil.example' });

    expect(response.status).toBe(403);
    expect(mockRestart).not.toHaveBeenCalled();
  });

  it('asks every attached agent to restart Caddy and itself, before its own exit', async () => {
    const agent = await startFakeAgent();

    const response = await post();
    await Bun.sleep(5);

    expect(response.status).toBe(202);
    expect(agent.requests.filter((r) => r.kind === 'restart')).toHaveLength(1);
    expect(mockRestart).toHaveBeenCalledTimes(1);
    await agent.stop();
  });

  it('does not ask the agents when the restart itself is refused', async () => {
    const agent = await startFakeAgent();
    await markSetupCompleted();

    const response = await post();
    await Bun.sleep(5);

    expect(response.status).toBe(409);
    expect(agent.requests.filter((r) => r.kind === 'restart')).toHaveLength(0);
    await agent.stop();
  });

  it('refuses once setup is complete', async () => {
    await markSetupCompleted();

    const response = await post();

    expect(response.status).toBe(409);
    expect(mockRestart).not.toHaveBeenCalled();
  });
});
