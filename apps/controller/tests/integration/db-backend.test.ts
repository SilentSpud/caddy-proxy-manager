/**
 * The same behaviours, run against every supported backend.
 *
 * SQLite always runs. PostgreSQL runs when TEST_POSTGRES_URL points at a throwaway database:
 *
 *   docker run -d --name cpm-pg -e POSTGRES_PASSWORD=pw -e POSTGRES_USER=cpm -e POSTGRES_DB=cpm \
 *     -p 55433:5432 postgres:17-alpine
 *   TEST_POSTGRES_URL=postgres://cpm:pw@127.0.0.1:55433/cpm bun test tests/integration/db-backend.test.ts
 *
 * These are the behaviours the dialect split can silently break: migrations producing the same
 * tables, `serial`/AUTOINCREMENT assigning ids, booleans surviving a round trip (SQLite stores
 * them as 0/1), `onConflictDoUpdate` upserts, and — the one with no shared implementation —
 * runInTransaction committing and rolling back.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reloadDbModule } from '@/tests/helpers/fresh-db';

const POSTGRES_URL = process.env.TEST_POSTGRES_URL;

type Backend = { name: string; url: string; cleanup: () => void };

const backends: Backend[] = [];

const sqliteDir = mkdtempSync(join(tmpdir(), 'cpm-backend-sqlite-'));
backends.push({
  name: 'sqlite',
  url: `file:${join(sqliteDir, 'backend.db')}`,
  cleanup: () => {
    Bun.gc(true);
    rmSync(sqliteDir, { recursive: true, force: true });
  },
});

if (POSTGRES_URL) {
  backends.push({ name: 'postgres', url: POSTGRES_URL, cleanup: () => {} });
} else {
  console.log('[db-backend] TEST_POSTGRES_URL is unset — skipping the PostgreSQL backend.');
}

function resetDbModuleState() {
  delete (globalThis as typeof globalThis & { __DRIZZLE_DB__?: unknown }).__DRIZZLE_DB__;
  delete (globalThis as typeof globalThis & { __DB_CLIENT__?: unknown }).__DB_CLIENT__;
  delete (globalThis as typeof globalThis & { __MIGRATIONS_RAN__?: boolean }).__MIGRATIONS_RAN__;
}

for (const backend of backends) {
  describe(`database backend: ${backend.name}`, () => {
    let dbModule: typeof import('@/src/lib/db');
    let db: typeof import('@/src/lib/db')['default'];
    let schema: typeof import('@/src/lib/db/schema');
    const now = new Date().toISOString();
    // Namespaced so a re-run against a PostgreSQL database that already has rows still passes.
    const tag = `backend-${backend.name}-${Date.now()}`;

    beforeAll(async () => {
      process.env.DATABASE_URL = backend.url;
      resetDbModuleState();
      // Both namespaces come from the reload, never from a later plain import: this file loads
      // two backends, and the plain specifier ends up pointing at whichever reloaded last.
      ({ dbModule, schema } = await reloadDbModule());
      db = dbModule.default;
    });

    afterAll(() => {
      // Windows will not delete a file that is still open, and bun:sqlite holds the handle until
      // it is closed explicitly (Bun.gc only finalizes drizzle's prepared statements).
      (dbModule?.client as { close?: () => void } | undefined)?.close?.();
      process.env.DATABASE_URL = ':memory:';
      resetDbModuleState();
      backend.cleanup();
    });

    it('resolves the expected dialect', () => {
      expect(dbModule.dialect).toBe(backend.name as 'sqlite' | 'postgres');
    });

    it('migrated every table the schema declares', async () => {
      // Reading through drizzle rather than a catalog query keeps this dialect-neutral: a missing
      // table raises, and the schema module is the list of tables that must exist.
      for (const table of Object.values(schema)) {
        await db.select().from(table).limit(1);
      }
      expect(Object.values(schema).length).toBeGreaterThan(20);
    });

    it('assigns integer primary keys on insert and returns the row', async () => {
      const [user] = await db
        .insert(schema.users)
        .values({
          email: `${tag}-pk@example.com`,
          name: 'PK',
          role: 'user',
          provider: 'credentials',
          subject: `${tag}-pk`,
          status: 'active',
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      expect(typeof user.id).toBe('number');
      expect(user.email).toBe(`${tag}-pk@example.com`);
    });

    it('round-trips booleans as booleans, not 0/1', async () => {
      const [host] = await db
        .insert(schema.proxyHosts)
        .values({
          name: `${tag}-bool`,
          domains: JSON.stringify([`${tag}.example.com`]),
          upstreams: JSON.stringify(['backend:8080']),
          sslForced: true,
          hstsEnabled: false,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      expect(host.sslForced).toBe(true);
      expect(host.hstsEnabled).toBe(false);

      const read = await db.query.proxyHosts.findFirst({
        where: (table, { eq }) => eq(table.id, host.id),
      });
      expect(read?.sslForced).toBe(true);
      expect(read?.hstsEnabled).toBe(false);
    });

    it('upserts through onConflictDoUpdate', async () => {
      const key = `${tag}-upsert`;
      await db.insert(schema.settings).values({ key, value: '"first"', updatedAt: now });
      await db
        .insert(schema.settings)
        .values({ key, value: '"second"', updatedAt: now })
        .onConflictDoUpdate({ target: schema.settings.key, set: { value: '"second"' } });

      const rows = await db.query.settings.findMany({ where: (t, { eq }) => eq(t.key, key) });
      expect(rows).toHaveLength(1);
      expect(rows[0].value).toBe('"second"');
    });

    // Each transaction test owns its keys and sets up its own conflict. bun test randomizes the
    // order of tests within a describe, so nothing here may depend on another test having run.
    it('commits a transaction', async () => {
      const keys = [`${tag}-commit-a`, `${tag}-commit-b`];
      await dbModule.runInTransaction((tx) =>
        keys.map((key) => tx.insert(schema.settings).values({ key, value: '"v"', updatedAt: now })),
      );

      const rows = await db.query.settings.findMany({
        where: (t, { inArray }) => inArray(t.key, keys),
      });
      expect(rows).toHaveLength(2);
    });

    it('rolls the whole transaction back when a statement fails', async () => {
      const existing = `${tag}-rollback-existing`;
      const attempted = `${tag}-rollback-attempted`;
      await db
        .insert(schema.settings)
        .values({ key: existing, value: '"original"', updatedAt: now });

      // The second statement duplicates a primary key, so the first must not survive either.
      await expect(
        dbModule.runInTransaction((tx) => [
          tx.insert(schema.settings).values({ key: attempted, value: '"new"', updatedAt: now }),
          tx.insert(schema.settings).values({ key: existing, value: '"dup"', updatedAt: now }),
        ]),
      ).rejects.toThrow();

      const attemptedRows = await db.query.settings.findMany({
        where: (t, { eq }) => eq(t.key, attempted),
      });
      expect(attemptedRows).toHaveLength(0);

      const existingRow = await db.query.settings.findFirst({
        where: (t, { eq }) => eq(t.key, existing),
      });
      expect(existingRow?.value).toBe('"original"');
    });
  });
}
