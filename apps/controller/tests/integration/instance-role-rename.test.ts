/**
 * runInstanceRoleRename() rewrites stored master/slave values on startup.
 *
 * This is the half of the rename that *can* be migrated. Nothing reads "master"/"slave" any more,
 * so an agent whose stored instance_mode is not rewritten normalizes to null, falls back to
 * "standalone", and starts serving its own settings instead of the controller's — no error, no log
 * line, just a silently diverged instance. The token key move matters for the same reason: an
 * orphaned instance_master_token row means the agent authenticates with nothing.
 *
 * Runs against a real database rather than mocks: the migration is raw drizzle against the
 * settings table, so a mock would only be testing itself. A database of its own, not one of the
 * per-test schemas — the db module reads DATABASE_URL and opens its own connection.
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { resolve } from 'node:path';
import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { migrate } from 'drizzle-orm/bun-sql/migrator';
import * as pgSchema from '@/src/lib/db/schema.pg';
import { createTestDatabase } from '@/tests/helpers/db';
import { TEST_ENV } from '@/tests/helpers/env';
import { reloadDbModule } from '@/tests/helpers/fresh-db';

function resetDbModuleState() {
  delete (globalThis as typeof globalThis & { __DRIZZLE_DB__?: unknown }).__DRIZZLE_DB__;
  delete (globalThis as typeof globalThis & { __DB_CLIENT__?: unknown }).__DB_CLIENT__;
  delete (globalThis as typeof globalThis & { __MIGRATIONS_RAN__?: boolean }).__MIGRATIONS_RAN__;
}

afterEach(() => {
  // Back to the suite-wide database, not deleted: connection.ts throws at import without one.
  process.env.DATABASE_URL = TEST_ENV.DATABASE_URL;
  process.env.CPM_EPHEMERAL_DB = TEST_ENV.CPM_EPHEMERAL_DB;
  resetDbModuleState();
});

/**
 * Boot the db module against a fresh file whose settings table has been pre-seeded with `rows`,
 * then read the settings back. Seeding happens before the module loads so the migration sees the
 * pre-rename state exactly as an upgrading deployment would.
 */
async function migrateWithSettings(
  rows: Array<{ key: string; value: string }>,
): Promise<{ settings: Map<string, string>; cleanup: () => Promise<void> }> {
  const database = await createTestDatabase();

  // Apply the real schema migrations first, then seed — the same order an upgrading deployment
  // sees. Through drizzle's migrator rather than raw DDL, so the journal is written and the db
  // module's own startup migration finds nothing left to do.
  const seed = new SQL({ url: database.url, max: 1 });
  await migrate(drizzle(seed, { schema: pgSchema }) as never, {
    migrationsFolder: resolve(process.cwd(), 'drizzle', 'postgres'),
  });
  for (const row of rows) {
    await seed`INSERT INTO "settings" ("key", "value", "updatedAt")
               VALUES (${row.key}, ${row.value}, '2026-01-01T00:00:00.000Z')`;
  }
  await seed.close();

  process.env.DATABASE_URL = database.url;
  // The suite marks its databases ephemeral so the one-time data migrations are skipped. This one
  // is the migration under test, so it has to look like a real deployment's database.
  delete process.env.CPM_EPHEMERAL_DB;
  resetDbModuleState();
  const { dbModule, schema } = await reloadDbModule();

  const stored = await dbModule.default.select().from(schema.settings);
  const settings = new Map(stored.map((row) => [row.key, row.value]));

  return {
    settings,
    cleanup: async () => {
      await (dbModule.client as { close?: () => Promise<void> })?.close?.();
      await database.drop();
    },
  };
}

describe('runInstanceRoleRename', () => {
  it('rewrites a stored "slave" mode to "agent"', async () => {
    const { settings, cleanup } = await migrateWithSettings([
      { key: 'instance_mode', value: JSON.stringify('slave') },
    ]);
    try {
      expect(settings.get('instance_mode')).toBe(JSON.stringify('agent'));
    } finally {
      await cleanup();
    }
  });

  it('rewrites a stored "master" mode to "controller"', async () => {
    const { settings, cleanup } = await migrateWithSettings([
      { key: 'instance_mode', value: JSON.stringify('master') },
    ]);
    try {
      expect(settings.get('instance_mode')).toBe(JSON.stringify('controller'));
    } finally {
      await cleanup();
    }
  });

  it('moves instance_master_token to instance_controller_token, value intact', async () => {
    const token = JSON.stringify('enc:v1:a-stored-controller-token');
    const { settings, cleanup } = await migrateWithSettings([
      { key: 'instance_master_token', value: token },
    ]);
    try {
      expect(settings.get('instance_controller_token')).toBe(token);
      expect(settings.has('instance_master_token')).toBe(false);
    } finally {
      await cleanup();
    }
  });

  it('keeps an already-migrated token and drops the stale one', async () => {
    // Only a build that had already migrated could have written the new key, so it is the newer
    // value; the leftover old row must not clobber it.
    const { settings, cleanup } = await migrateWithSettings([
      { key: 'instance_master_token', value: JSON.stringify('stale') },
      { key: 'instance_controller_token', value: JSON.stringify('current') },
    ]);
    try {
      expect(settings.get('instance_controller_token')).toBe(JSON.stringify('current'));
      expect(settings.has('instance_master_token')).toBe(false);
    } finally {
      await cleanup();
    }
  });

  it('leaves current values alone', async () => {
    const { settings, cleanup } = await migrateWithSettings([
      { key: 'instance_mode', value: JSON.stringify('agent') },
      { key: 'instance_controller_token', value: JSON.stringify('already-correct') },
    ]);
    try {
      expect(settings.get('instance_mode')).toBe(JSON.stringify('agent'));
      expect(settings.get('instance_controller_token')).toBe(JSON.stringify('already-correct'));
    } finally {
      await cleanup();
    }
  });

  it('leaves an unrelated mode value untouched', async () => {
    const { settings, cleanup } = await migrateWithSettings([
      { key: 'instance_mode', value: JSON.stringify('standalone') },
    ]);
    try {
      expect(settings.get('instance_mode')).toBe(JSON.stringify('standalone'));
    } finally {
      await cleanup();
    }
  });

  it('records its flag so it does not run twice', async () => {
    const { settings, cleanup } = await migrateWithSettings([
      { key: 'instance_mode', value: JSON.stringify('slave') },
    ]);
    try {
      expect(settings.get('instance_roles_renamed')).toBe('true');
    } finally {
      await cleanup();
    }
  });

  it('does not re-migrate a value legitimately set back after the flag exists', async () => {
    // "master" is not a valid role any more, so if it somehow reappears after the migration has
    // run, the flag means it stays as-is rather than being rewritten a second time. It then
    // normalizes to null and the caller falls back to standalone — visible, not silently renamed.
    const { settings, cleanup } = await migrateWithSettings([
      { key: 'instance_roles_renamed', value: 'true' },
      { key: 'instance_mode', value: JSON.stringify('master') },
    ]);
    try {
      expect(settings.get('instance_mode')).toBe(JSON.stringify('master'));
    } finally {
      await cleanup();
    }
  });

  it('runs cleanly on a database with no instance settings at all', async () => {
    const { settings, cleanup } = await migrateWithSettings([]);
    try {
      expect(settings.get('instance_roles_renamed')).toBe('true');
      expect(settings.has('instance_mode')).toBe(false);
    } finally {
      await cleanup();
    }
  });
});
