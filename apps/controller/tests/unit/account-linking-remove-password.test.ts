/**
 * Linking an OAuth identity from /link-account can drop the password in the same step, leaving the
 * provider as the only sign-in. The safeguard is ordering: nothing is removed unless the password
 * checked out and the link was written, so no path leaves an account with no way in.
 */
import { describe, it, expect } from 'bun:test';
import { vi } from '@/tests/helpers/vi';
import type { TestDb } from '../helpers/db';

const ctx = vi.hoisted(() => ({ db: null as unknown as TestDb }));

const { createTestDb } = await import('../helpers/db');
const schemaModule = await import('../../src/lib/db/schema');

// Hoisted out of the factory below: createTestDb is async, and a Bun mock factory must be
// synchronous - an async one never resolves and the file hangs.
ctx.db = await createTestDb();

vi.mock('../../src/lib/db', () => ({
  default: ctx.db,
  schema: schemaModule,
  nowIso: () => new Date().toISOString(),
  toIso: (value: string | Date | null | undefined): string | null =>
    !value ? null : value instanceof Date ? value.toISOString() : new Date(value).toISOString(),
}));

import { verifyAndLinkOAuth } from '../../src/lib/services/account-linking';
import { createUser, getUserById } from '../../src/lib/models/user';
import { hashPassword } from '../../src/lib/password';
import { accounts } from '../../src/lib/db/schema';
import { eq } from 'drizzle-orm';

const PASSWORD = 'CorrectHorse2026!';

async function seedPasswordUser(email: string) {
  return createUser({
    email,
    provider: 'credential',
    subject: email,
    passwordHash: await hashPassword(PASSWORD),
  });
}

async function providersOf(userId: number) {
  const rows = await ctx.db.select().from(accounts).where(eq(accounts.userId, userId));
  return rows.map((row) => row.providerId).sort();
}

describe('verifyAndLinkOAuth with removePassword', () => {
  it('links the provider and drops the password and its credential account', async () => {
    const user = await seedPasswordUser('drop@example.com');

    const linked = await verifyAndLinkOAuth(user.id, PASSWORD, 'authentik', 'sub-drop', {
      removePassword: true,
    });

    expect(linked).toBe(true);
    expect(await providersOf(user.id)).toEqual(['authentik']);
    const after = await getUserById(user.id);
    expect(after?.passwordHash).toBeNull();
    // The cached projection follows the accounts table rather than still claiming "credentials".
    expect(after?.provider).toBe('authentik');
  });

  it('keeps the password when the option is not set', async () => {
    const user = await seedPasswordUser('keep@example.com');

    const linked = await verifyAndLinkOAuth(user.id, PASSWORD, 'authentik', 'sub-keep');

    expect(linked).toBe(true);
    expect(await providersOf(user.id)).toEqual(['authentik', 'credential']);
    expect((await getUserById(user.id))?.passwordHash).not.toBeNull();
  });

  it('changes nothing when the password is wrong', async () => {
    const user = await seedPasswordUser('wrong@example.com');

    const linked = await verifyAndLinkOAuth(user.id, 'NotThePassword1!', 'authentik', 'sub-wrong', {
      removePassword: true,
    });

    expect(linked).toBe(false);
    expect(await providersOf(user.id)).toEqual(['credential']);
    expect((await getUserById(user.id))?.passwordHash).not.toBeNull();
  });
});
