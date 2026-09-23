import { Database } from 'bun:sqlite';
import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { drizzle as drizzleSqlite } from 'drizzle-orm/bun-sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Db } from '../../src/lib/db/connection';
import * as schema from '../../src/lib/db/schema.pg';
import * as sqliteSchema from '../../src/lib/db/schema.sqlite';

/**
 * `TEST_DB=sqlite` runs the suite against SQLite instead: an in-memory database per test, and no
 * server. Set by `bun run test:sqlite`.
 */
export const testDialect = process.env.TEST_DB === 'sqlite' ? 'sqlite' : 'postgres';

/**
 * Per-test isolation is a PostgreSQL *schema*, not a database. Both were measured: creating a
 * database from a migrated template costs about the same as creating a schema and replaying the
 * DDL (~25ms either way, 32-way concurrent), but `DROP DATABASE` forces a checkpoint and fsyncs
 * the file deletions - 14.5s to drop 32, against 0.4s for 32 `DROP SCHEMA`s. Dropping is not
 * optional: a test file creates a database per test, and leaking them exhausts max_connections
 * long before the suite ends.
 */
const MIGRATIONS_DIR = resolve(import.meta.dir, '../../drizzle', testDialect);

/**
 * Set by scripts/with-test-db.ts, which starts the throwaway server. Absent means the suite was
 * invoked as bare `bun test`, which cannot work without one.
 */
function adminUrl(): string {
  const url = process.env.TEST_POSTGRES_URL;
  if (!url) {
    throw new Error(
      'TEST_POSTGRES_URL is not set. Run the suite with `bun run test`, which starts a throwaway ' +
        'PostgreSQL container, or set TEST_POSTGRES_URL to a server of your own.',
    );
  }
  return url;
}

/**
 * Every migration, in the order drizzle's journal records - not just the initial one. The journal
 * is the source of truth rather than a directory glob, so a test schema is built exactly the way a
 * deployment is. Reading the one file was correct while `0000_initial` was the only migration, and
 * silently wrong the moment a second one existed.
 */
function migrationSql(): string {
  const journal = JSON.parse(
    readFileSync(resolve(MIGRATIONS_DIR, 'meta/_journal.json'), 'utf8'),
  ) as { entries: Array<{ idx: number; tag: string }> };
  return [...journal.entries]
    .sort((left, right) => left.idx - right.idx)
    .map((entry) => readFileSync(resolve(MIGRATIONS_DIR, `${entry.tag}.sql`), 'utf8'))
    .join('\n');
}

/**
 * The DDL, rewritten to build inside one schema. drizzle-kit emits its foreign keys as
 * `REFERENCES "public"."users"`, which would point every schema's tables back at public.
 */
function ddlFor(schemaName: string): string {
  const raw = migrationSql().split('--> statement-breakpoint').join('\n');
  const scoped = raw.replaceAll('"public".', `"${schemaName}".`);
  // Guard against drizzle changing how it qualifies names: an unrewritten reference would silently
  // wire this schema's foreign keys to another test's tables.
  if (scoped.includes('"public"')) {
    throw new Error('Migration SQL still references "public" after rewriting; update ddlFor().');
  }
  return scoped;
}

/**
 * Typed as the app's `Db` so tests can call tables imported from src/lib/db/schema on the handle.
 */
export type TestDb = Db;

type Live = { sql: SQL; schemaName: string } | { sqlite: Database };

const live: Live[] = [];
let adminPool: SQL | undefined;

/**
 * Where the current test's schemas start in `live`. Everything before it was created while the
 * test file was being imported - the `vi.mock('src/lib/db')` files build one database for the
 * whole file and clear tables between tests - and dropping those after the first test would take
 * the rest of the file down with it.
 */
let testBoundary = 0;

function admin(): SQL {
  adminPool ??= new SQL({ url: adminUrl(), max: 4 });
  return adminPool;
}

/**
 * A fresh, fully migrated PostgreSQL schema with all tables. Each call is isolated from every
 * other. `max: 1` because the handle's `search_path` is per connection - a pool would hand later
 * queries a connection still pointed at public.
 */
export async function createTestDb(): Promise<TestDb> {
  if (testDialect === 'sqlite') {
    const sqlite = new Database(':memory:');
    sqlite.run('PRAGMA foreign_keys = ON');
    sqlite.run(migrationSql().split('--> statement-breakpoint').join('\n'));
    live.push({ sqlite });
    return drizzleSqlite(sqlite, { schema: sqliteSchema }) as unknown as TestDb;
  }

  const schemaName = `t_${randomUUID().replaceAll('-', '')}`;
  await admin().unsafe(`CREATE SCHEMA "${schemaName}"`);

  const sql = new SQL({ url: adminUrl(), max: 1 });
  await sql.unsafe(`SET search_path TO "${schemaName}"; ${ddlFor(schemaName)}`);

  live.push({ sql, schemaName });
  return drizzle(sql, { schema }) as unknown as TestDb;
}

/**
 * A fresh, empty PostgreSQL *database* and the URL that reaches it, for the handful of tests that
 * boot the real src/lib/db module rather than mocking it - that module reads DATABASE_URL and
 * connects itself, so it cannot be pointed at one of the schemas above.
 *
 * Migrations are not applied: a caller booting the db module gets them from its own startup, and a
 * caller seeding a pre-migration state needs to run them itself, in order, through drizzle's
 * migrator so the journal is written.
 */
export async function createTestDatabase(): Promise<{ url: string; drop: () => Promise<void> }> {
  if (testDialect === 'sqlite') {
    const directory = mkdtempSync(join(tmpdir(), 'cpm-test-'));
    return {
      url: `file:${join(directory, 'cpm.db')}`,
      drop: async () => {
        // Windows refuses to delete a file a handle still holds; the OS reaps its temp dir anyway.
        try {
          rmSync(directory, { recursive: true, force: true });
        } catch {}
      },
    };
  }

  const name = `d_${randomUUID().replaceAll('-', '')}`;
  await admin().unsafe(`CREATE DATABASE "${name}"`);
  const url = new URL(adminUrl());
  url.pathname = `/${name}`;
  return {
    url: url.toString(),
    // Slow (DROP DATABASE fsyncs), so this is deliberately not wired into the afterEach that
    // handles schemas - the few callers drop their own, and the throwaway server dies with the run.
    drop: async () => {
      await admin().unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    },
  };
}

/** Records that anything created from here on belongs to one test. Called from a beforeEach. */
export function markTestBoundary(): void {
  testBoundary = live.length;
}

/** Closes every handle the current test opened and drops its schemas. Called from an afterEach. */
export async function cleanupTestDbs(): Promise<void> {
  const pending = live.splice(testBoundary, live.length - testBoundary);
  if (pending.length === 0) return;

  for (const entry of pending) {
    if ('sqlite' in entry) entry.sqlite.close(true);
  }
  const schemas = pending.filter((entry) => 'sql' in entry);
  await Promise.all(schemas.map(({ sql }) => sql.close()));
  await Promise.all(
    schemas.map(({ schemaName }) => admin().unsafe(`DROP SCHEMA "${schemaName}" CASCADE`)),
  );
}

/**
 * A stand-in for the `db` module's default export, forwarding to whichever database the current
 * test uses. Bun evaluates a mock factory's getters once at link time, so Vitest's
 * `get default() { return db }` would capture `undefined`. This has a stable identity, resolves
 * every read against `current()`, and binds methods so drizzle sees the right `this`.
 */
export function currentDb(current: () => TestDb): TestDb {
  return new Proxy({} as TestDb, {
    get(_target, property) {
      const db = current() as unknown as Record<string | symbol, unknown>;
      const value = db[property];
      return typeof value === 'function' ? value.bind(db) : value;
    },
    has(_target, property) {
      return property in (current() as unknown as object);
    },
  });
}
