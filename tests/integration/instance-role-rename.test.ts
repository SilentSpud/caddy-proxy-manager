/**
 * runInstanceRoleRename() rewrites stored master/slave values on startup.
 *
 * This is the half of the rename that *can* be migrated. Nothing reads "master"/"slave" any more,
 * so an agent whose stored instance_mode is not rewritten normalizes to null, falls back to
 * "standalone", and starts serving its own settings instead of the controller's — no error, no log
 * line, just a silently diverged instance. The token key move matters for the same reason: an
 * orphaned instance_master_token row means the agent authenticates with nothing.
 *
 * Runs against a real database file rather than mocks: the migration is raw drizzle against the
 * settings table, so a mock would only be testing itself.
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import * as sqliteSchema from '@/src/lib/db/schema.sqlite';
import { reloadDbModule } from '@/tests/helpers/fresh-db';

function resetDbModuleState() {
  delete (globalThis as typeof globalThis & { __DRIZZLE_DB__?: unknown }).__DRIZZLE_DB__;
  delete (globalThis as typeof globalThis & { __DB_CLIENT__?: unknown }).__DB_CLIENT__;
  delete (globalThis as typeof globalThis & { __MIGRATIONS_RAN__?: boolean }).__MIGRATIONS_RAN__;
}

afterEach(() => {
  process.env.DATABASE_URL = ':memory:';
  resetDbModuleState();
});

/**
 * Boot the db module against a fresh file whose settings table has been pre-seeded with `rows`,
 * then read the settings back. Seeding happens before the module loads so the migration sees the
 * pre-rename state exactly as an upgrading deployment would.
 */
async function migrateWithSettings(
  rows: Array<{ key: string; value: string }>,
): Promise<{ settings: Map<string, string>; cleanup: () => void }> {
  const directory = mkdtempSync(join(tmpdir(), 'cpm-role-rename-'));
  const databasePath = join(directory, 'roles.db');

  // Apply the real schema migrations first, then seed — the same order an upgrading deployment
  // sees. Creating the settings table by hand instead would collide with migration 0000.
  const seed = new Database(databasePath);
  migrate(drizzle(seed, { schema: sqliteSchema }), {
    migrationsFolder: resolve(process.cwd(), 'drizzle'),
  });
  const insert = seed.prepare(
    'INSERT INTO "settings" ("key", "value", "updatedAt") VALUES (?, ?, ?)',
  );
  for (const row of rows) {
    insert.run(row.key, row.value, '2026-01-01T00:00:00.000Z');
  }
  seed.close();

  process.env.DATABASE_URL = `file:${databasePath}`;
  resetDbModuleState();
  const { dbModule, schema } = await reloadDbModule();

  const stored = await dbModule.default.select().from(schema.settings);
  const settings = new Map(stored.map((row) => [row.key, row.value]));

  return {
    settings,
    cleanup: () => {
      (dbModule.client as { close?: () => void })?.close?.();
      Bun.gc(true);
      rmSync(directory, { recursive: true, force: true });
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
      cleanup();
    }
  });

  it('rewrites a stored "master" mode to "controller"', async () => {
    const { settings, cleanup } = await migrateWithSettings([
      { key: 'instance_mode', value: JSON.stringify('master') },
    ]);
    try {
      expect(settings.get('instance_mode')).toBe(JSON.stringify('controller'));
    } finally {
      cleanup();
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
      cleanup();
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
      cleanup();
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
      cleanup();
    }
  });

  it('leaves an unrelated mode value untouched', async () => {
    const { settings, cleanup } = await migrateWithSettings([
      { key: 'instance_mode', value: JSON.stringify('standalone') },
    ]);
    try {
      expect(settings.get('instance_mode')).toBe(JSON.stringify('standalone'));
    } finally {
      cleanup();
    }
  });

  it('records its flag so it does not run twice', async () => {
    const { settings, cleanup } = await migrateWithSettings([
      { key: 'instance_mode', value: JSON.stringify('slave') },
    ]);
    try {
      expect(settings.get('instance_roles_renamed')).toBe('true');
    } finally {
      cleanup();
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
      cleanup();
    }
  });

  it('runs cleanly on a database with no instance settings at all', async () => {
    const { settings, cleanup } = await migrateWithSettings([]);
    try {
      expect(settings.get('instance_roles_renamed')).toBe('true');
      expect(settings.has('instance_mode')).toBe(false);
    } finally {
      cleanup();
    }
  });
});
