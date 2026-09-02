import type { Database } from 'bun:sqlite';
import { afterEach, describe, expect, it } from 'bun:test';
import { reloadDbModule } from '@/tests/helpers/fresh-db';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function resetDbModuleState() {
  delete (globalThis as typeof globalThis & { __DRIZZLE_DB__?: unknown }).__DRIZZLE_DB__;
  delete (globalThis as typeof globalThis & { __DB_CLIENT__?: unknown }).__DB_CLIENT__;
  delete (globalThis as typeof globalThis & { __MIGRATIONS_RAN__?: boolean }).__MIGRATIONS_RAN__;
}

afterEach(() => {
  process.env.DATABASE_URL = ':memory:';
  resetDbModuleState();
});

describe('API token deletion authorization', () => {
  it("makes another user's token indistinguishable from a nonexistent ID", async () => {
    const directory = mkdtempSync(join(tmpdir(), 'cpm-api-token-auth-'));
    const databasePath = join(directory, 'tokens.db');

    try {
      process.env.DATABASE_URL = `file:${databasePath}`;
      resetDbModuleState();

      // Bun cannot drop a module from its registry, so a unique specifier re-evaluates db
      // against this temp file; pointing the plain specifier at it rewrites the live bindings
      // every consumer already reads through.
      // The template-literal specifier loses the module's type, so restore it explicitly.
      const { dbModule: freshDb } = await reloadDbModule();
      const { default: db, nowIso } = freshDb;
      const [{ apiTokens, users }, { deleteApiToken }] = await Promise.all([
        import('@/src/lib/db/schema'),
        import('@/src/lib/models/api-tokens'),
      ]);
      const now = nowIso();
      const [owner, otherUser, admin] = await db
        .insert(users)
        .values([
          {
            email: 'owner@example.com',
            name: 'Owner',
            role: 'user',
            provider: 'credentials',
            subject: 'owner',
            status: 'active',
            createdAt: now,
            updatedAt: now,
          },
          {
            email: 'other@example.com',
            name: 'Other',
            role: 'user',
            provider: 'credentials',
            subject: 'other',
            status: 'active',
            createdAt: now,
            updatedAt: now,
          },
          {
            email: 'admin@example.com',
            name: 'Admin',
            role: 'admin',
            provider: 'credentials',
            subject: 'admin',
            status: 'active',
            createdAt: now,
            updatedAt: now,
          },
        ])
        .returning();
      const [token] = await db
        .insert(apiTokens)
        .values({
          name: 'Owner token',
          tokenHash: 'a'.repeat(64),
          createdBy: owner.id,
          createdAt: now,
        })
        .returning();

      await expect(deleteApiToken(token.id, otherUser.id, false)).rejects.toMatchObject({
        name: 'NotFoundError',
        message: 'Token not found',
      });
      await expect(deleteApiToken(token.id + 10_000, otherUser.id, false)).rejects.toMatchObject({
        name: 'NotFoundError',
        message: 'Token not found',
      });
      expect(
        await db.query.apiTokens.findFirst({
          where: (table, { eq }) => eq(table.id, token.id),
        }),
      ).toBeDefined();

      await deleteApiToken(token.id, admin.id, true);
      expect(
        await db.query.apiTokens.findFirst({
          where: (table, { eq }) => eq(table.id, token.id),
        }),
      ).toBeUndefined();

      // $client is the raw driver handle, `unknown` on the shared type because it differs per
      // backend. This test only ever runs against SQLite.
      (db.$client as Database).close();
    } finally {
      // bun:sqlite releases the file only once drizzle's prepared statements are finalized,
      // which happens on collection — Windows refuses the removal until then.
      Bun.gc(true);
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
