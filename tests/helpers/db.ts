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
