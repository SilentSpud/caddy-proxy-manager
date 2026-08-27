import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { resolve } from 'node:path';
import * as schema from '../../src/lib/db/schema';

const migrationsFolder = resolve(process.cwd(), 'drizzle');

export type TestDb = ReturnType<typeof drizzle<typeof schema>>;

/**
 * Creates a fresh in-memory SQLite database with all migrations applied.
 * Each call returns a completely isolated database instance.
 */
export function createTestDb(): TestDb {
  const sqlite = new Database(':memory:');
  // better-sqlite3, which backed these tests before the suite moved to Bun,
  // turns foreign keys on for every connection. bun:sqlite follows SQLite's own
  // default and leaves them OFF, which would silently stop every `ON DELETE
  // CASCADE` assertion below from testing anything. Set it explicitly so the
  // behaviour under test does not depend on a driver default.
  //
  // Note this is deliberately a *test* setting: src/lib/db.ts does not set the
  // pragma, so cascades do not fire in production either — models that need one
  // do it by hand (see deleteCaCertificate in src/lib/models/ca-certificates.ts).
  sqlite.exec('PRAGMA foreign_keys = ON');
  const db = drizzle(sqlite, { schema, casing: 'snake_case' });
  migrate(db, { migrationsFolder });
  return db;
}

/**
 * A stand-in for the `db` module's default export that always forwards to
 * whichever database the current test is using.
 *
 * Under Vitest a mock factory could return `get default() { return db }` and
 * the getter would re-run on every access, so a `db` reassigned in `beforeEach`
 * was picked up automatically. Bun evaluates the factory's getters once, when
 * the mocked module is linked, and stores the resulting values — so that
 * pattern captures whatever `db` held at import time, which is `undefined`.
 *
 * This returns a single object with a stable identity, safe to snapshot, whose
 * every property read is resolved against `current()` at call time. Methods are
 * bound to the real database so drizzle's internals still see the right `this`.
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
