/**
 * In OIDC-only mode better-auth must not accept credentials at all — hiding the
 * login form is cosmetic, the email/password endpoints have to be off. The flag
 * is read from env when config is imported, so it is set in a hoisted block
 * before any import.
 */
import { describe, it, expect, afterAll, vi } from 'vitest';
import type { TestDb } from '../helpers/db';

const ctx = vi.hoisted(() => {
  process.env.AUTH_DISABLE_LOCAL_USERS = 'true';
  return { db: null as unknown as TestDb };
});

afterAll(() => {
  delete process.env.AUTH_DISABLE_LOCAL_USERS;
});

vi.mock('../../src/lib/db', async () => {
  const { createTestDb } = await import('../helpers/db');
  const schemaModule = await import('../../src/lib/db/schema');
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
