import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { resolve } from 'node:path';
import type { Db } from '../../src/lib/db/connection';
import * as schema from '../../src/lib/db/schema.sqlite';

const migrationsFolder = resolve(process.cwd(), 'drizzle');

/**
 * Typed as the app's `Db`, which is the PostgreSQL drizzle type even when SQLite is connected —
 * see src/lib/db/schema.ts. Tests import tables from src/lib/db/schema, so the handle they call
 * them on has to agree with those types or every query is a type error.
 */
export type TestDb = Db;

/**
 * A fresh in-memory SQLite database with all migrations applied. Each call returns a completely
 * isolated instance.
 */
export function createTestDb(): TestDb {
  const sqlite = new Database(':memory:');
  // bun:sqlite follows SQLite's default and leaves foreign keys OFF, where better-sqlite3 turned
  // them on — without this every `ON DELETE CASCADE` assertion below would pass vacuously. A *test*
  // setting only: src/lib/db.ts does not set it, so models cascade by hand (deleteCaCertificate).
  sqlite.exec('PRAGMA foreign_keys = ON');
  const db = drizzle(sqlite, { schema, casing: 'snake_case' });
  migrate(db, { migrationsFolder });
  return db as unknown as TestDb;
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
