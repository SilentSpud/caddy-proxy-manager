/**
 * The readiness check in fixAccountsSchema decides whether a legacy `accounts` table is rebuilt.
 * It is the only thing standing between an upgraded deployment and a table with no unique index
 * on (providerId, accountId) — which is what stops two rows claiming one identity — so the cases
 * below pin both directions: a wrong shape is repaired, and a correct one is left alone.
 */
import { Database } from 'bun:sqlite';
import { describe, expect, it } from 'bun:test';
import { repairLegacySqliteSchema } from '@/src/lib/db/legacy-sqlite';

const NOW = '2026-01-01T00:00:00.000Z';

const CORRECT_ACCOUNTS = `CREATE TABLE "accounts" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "userId" INTEGER NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "accountId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "accessToken" TEXT,
  "refreshToken" TEXT,
  "idToken" TEXT,
  "accessTokenExpiresAt" TEXT,
  "refreshTokenExpiresAt" TEXT,
  "scope" TEXT,
  "password" TEXT,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
)`;

const PROVIDER_IDX =
  'CREATE UNIQUE INDEX "accounts_provider_account_idx" ON "accounts" ("providerId", "accountId")';
const USER_IDX = 'CREATE INDEX "accounts_user_idx" ON "accounts" ("userId")';

/** A legacy database with `users` and an `accounts` table built from the given DDL. */
function legacyDb(accountsDdl: string, indexes: string[] = [PROVIDER_IDX, USER_IDX]): Database {
  const db = new Database(':memory:');
  db.prepare(
    `CREATE TABLE "users" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "email" TEXT NOT NULL)`,
  ).run();
  db.prepare(`INSERT INTO "users" ("id", "email") VALUES (1, 'a@localhost')`).run();
  db.prepare(accountsDdl).run();
  for (const index of indexes) db.prepare(index).run();
  return db;
}

function seedAccount(db: Database, accountId: string, providerId: string) {
  db.prepare(
    `INSERT INTO "accounts" ("userId", "accountId", "providerId", "createdAt", "updatedAt")
     VALUES (1, ?, ?, ?, ?)`,
  ).run(accountId, providerId, NOW, NOW);
}

function tableSql(db: Database): string {
  const [row] = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'accounts'`)
    .all() as Array<{ sql: string }>;
  return row.sql;
}

function indexNames(db: Database): string[] {
  return (db.prepare('PRAGMA index_list("accounts")').all() as Array<{ name: string }>)
    .map((index) => index.name)
    .sort();
}

function accountRows(db: Database) {
  return db.prepare(`SELECT "accountId", "providerId" FROM "accounts" ORDER BY "id"`).all();
}

describe('fixAccountsSchema readiness check', () => {
  it('leaves a fully correct table alone', () => {
    // The table object itself must survive: a needless rebuild reassigns ids and drops any column
    // this repair does not know about, so "correct" has to mean "not touched".
    const db = legacyDb(CORRECT_ACCOUNTS);
    seedAccount(db, 'sub-a', 'dex');
    const before = tableSql(db);

    repairLegacySqliteSchema(db);

    expect(tableSql(db)).toBe(before);
    expect(accountRows(db)).toEqual([{ accountId: 'sub-a', providerId: 'dex' }]);
  });

  it('repairs a table whose id is right but has no unique identity index', () => {
    // The case the weaker check missed. Without this index nothing stops two rows sharing one
    // (providerId, accountId), which is the collision the importer refuses to merge.
    const db = legacyDb(CORRECT_ACCOUNTS, [USER_IDX]);
    seedAccount(db, 'sub-a', 'dex');

    repairLegacySqliteSchema(db);

    expect(indexNames(db)).toContain('accounts_provider_account_idx');
    const [index] = db
      .prepare(`SELECT sql FROM sqlite_master WHERE name = 'accounts_provider_account_idx'`)
      .all() as Array<{ sql: string }>;
    expect(index.sql).toContain('UNIQUE');
    expect(accountRows(db)).toEqual([{ accountId: 'sub-a', providerId: 'dex' }]);
  });

  it('repairs a table whose identity index exists but is not unique', () => {
    // A non-unique index of the right name and columns is the subtler version of the same hole.
    const db = legacyDb(CORRECT_ACCOUNTS, [
      'CREATE INDEX "accounts_provider_account_idx" ON "accounts" ("providerId", "accountId")',
      USER_IDX,
    ]);
    seedAccount(db, 'sub-a', 'dex');

    repairLegacySqliteSchema(db);

    const [index] = db
      .prepare(`SELECT sql FROM sqlite_master WHERE name = 'accounts_provider_account_idx'`)
      .all() as Array<{ sql: string }>;
    expect(index.sql).toContain('UNIQUE');
  });

  it('repairs a table missing accounts_user_idx', () => {
    const db = legacyDb(CORRECT_ACCOUNTS, [PROVIDER_IDX]);
    seedAccount(db, 'sub-a', 'dex');

    repairLegacySqliteSchema(db);

    expect(indexNames(db)).toContain('accounts_user_idx');
  });

  it('repairs a table missing a column the current schema needs', () => {
    const db = legacyDb(
      `CREATE TABLE "accounts" (
        "id" INTEGER PRIMARY KEY AUTOINCREMENT,
        "userId" INTEGER NOT NULL,
        "accountId" TEXT NOT NULL,
        "providerId" TEXT NOT NULL,
        "createdAt" TEXT NOT NULL,
        "updatedAt" TEXT NOT NULL
      )`,
    );
    seedAccount(db, 'sub-a', 'dex');

    repairLegacySqliteSchema(db);

    const columns = (
      db.prepare('PRAGMA table_info("accounts")').all() as Array<{ name: string }>
    ).map((column) => column.name);
    expect(columns).toContain('password');
    expect(columns).toContain('scope');
    // Absent columns arrive as NULL rather than failing the rebuild, so the row is still here.
    expect(accountRows(db)).toEqual([{ accountId: 'sub-a', providerId: 'dex' }]);
  });

  it('still refuses to merge an identity collision while repairing', () => {
    // Preserved from before the readiness check was widened: two rows may belong to different
    // users, so picking either one would turn a migration into an account takeover.
    const db = legacyDb(CORRECT_ACCOUNTS, [USER_IDX]);
    seedAccount(db, 'sub-a', 'dex');
    seedAccount(db, 'sub-a', 'dex');

    expect(() => repairLegacySqliteSchema(db)).toThrow(/identity collision/);
  });
});
