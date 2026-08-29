/**
 * In OIDC-only mode better-auth must not accept credentials at all — hiding the login form is
 * cosmetic, the endpoints have to be off. The flag is read at config import, so it is hoisted.
 */
import { describe, it, expect, afterAll } from 'bun:test';
import { vi } from '@/tests/helpers/vi';
import { fresh } from '@/tests/helpers/fresh';
import type { TestDb } from '../helpers/db';

const ctx = vi.hoisted(() => {
  process.env.AUTH_DISABLE_LOCAL_USERS = 'true';
  return { db: null as unknown as TestDb };
});

afterAll(() => {
  delete process.env.AUTH_DISABLE_LOCAL_USERS;
});

const { createTestDb } = await import('../helpers/db');
const schemaModule = await import('../../src/lib/db/schema');

vi.mock('../../src/lib/db', () => {
  ctx.db = createTestDb();
  return {
    default: ctx.db,
    get sqlite() {
      return undefined;
    },
    schema: schemaModule,
    nowIso: () => new Date().toISOString(),
    toIso: (v: string | Date | null | undefined): string | null =>
      !v ? null : v instanceof Date ? v.toISOString() : new Date(v).toISOString(),
  };
});

vi.mock('better-auth', () => ({
  betterAuth: (options: any) => ({ options }),
}));
vi.mock('better-auth/plugins', () => ({
  genericOAuth: () => ({}),
  username: () => ({}),
}));

// The flag above is read through the config module, and config snapshots
// process.env when it is first evaluated — which has already happened by the
// time this file's body runs. Evaluate a second copy now that the env is set
// and point the plain specifier at it, so auth-server reads the right value.
const freshConfig = await import(`../../src/lib/config${fresh()}`);
vi.mock('../../src/lib/config', () => ({ ...freshConfig }));

import { getAuth } from '../../src/lib/auth-server';
import { ensureAdminUser } from '../../src/lib/init-db';
import { users } from '../../src/lib/db/schema';

describe('AUTH_DISABLE_LOCAL_USERS=true', () => {
  it('turns off better-auth email/password sign-in', () => {
    const auth = getAuth() as any;
    expect(auth.options.emailAndPassword.enabled).toBe(false);
  });

  it('seeds no bootstrap admin account', async () => {
    await ensureAdminUser();
    const rows = await ctx.db.select().from(users);
    expect(rows).toEqual([]);
  });
});
