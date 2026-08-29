import { Database } from 'bun:sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { afterEach, describe, expect, it } from 'bun:test';
import { vi } from '@/tests/helpers/vi';
import { fresh } from '@/tests/helpers/fresh';
import { createLocalAccountIssuer, createOAuthAccountIssuer } from '@better-auth/core/db';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const migrationsFolder = resolve(process.cwd(), 'drizzle');

function resetDbModuleState() {
  delete (globalThis as typeof globalThis & { __DRIZZLE_DB__?: unknown }).__DRIZZLE_DB__;
  delete (globalThis as typeof globalThis & { __SQLITE_CLIENT__?: unknown }).__SQLITE_CLIENT__;
  delete (globalThis as typeof globalThis & { __MIGRATIONS_RAN__?: boolean }).__MIGRATIONS_RAN__;
}

function createBrokenAccountsDatabase(dbPath: string) {
  const sqlite = new Database(dbPath);
  const db = drizzle(sqlite);
  migrate(db, { migrationsFolder });

  sqlite.exec(`
    ALTER TABLE accounts RENAME TO accounts_old;
    CREATE TABLE accounts (
      id TEXT NOT NULL,
      userId INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      accountId TEXT NOT NULL,
      providerId TEXT NOT NULL,
      accessToken TEXT,
      refreshToken TEXT,
      idToken TEXT,
      accessTokenExpiresAt TEXT,
      refreshTokenExpiresAt TEXT,
      scope TEXT,
      password TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
    INSERT INTO accounts (
      id, userId, accountId, providerId, accessToken, refreshToken, idToken,
      accessTokenExpiresAt, refreshTokenExpiresAt, scope, password, createdAt, updatedAt
    )
    SELECT
      CAST(id AS TEXT), userId, accountId, providerId, accessToken, refreshToken, idToken,
      accessTokenExpiresAt, refreshTokenExpiresAt, scope, password, createdAt, updatedAt
    FROM accounts_old;
    DROP TABLE accounts_old;
    CREATE UNIQUE INDEX accounts_provider_account_idx ON accounts (providerId, accountId);
    CREATE INDEX accounts_user_idx ON accounts (userId);

    -- Rows that predate better-auth 1.7, so they carry no issuer at all. The
    -- repair has to invent the right one for each rather than dropping them.
    INSERT INTO users (email, createdAt, updatedAt)
      VALUES ('legacy@example.com', 'created', 'updated');
    INSERT INTO accounts (id, userId, accountId, providerId, password, createdAt, updatedAt)
      VALUES ('legacy-cred', (SELECT id FROM users WHERE email = 'legacy@example.com'),
              'legacy-subject', 'credential', 'legacyhash', 'created', 'updated');
    INSERT INTO accounts (id, userId, accountId, providerId, createdAt, updatedAt)
      VALUES ('legacy-oauth', (SELECT id FROM users WHERE email = 'legacy@example.com'),
              'oauth-subject', 'gone-provider', 'created', 'updated');
  `);

  sqlite.close();
}

describe('database compatibility for accounts schema', () => {
  afterEach(() => {
    process.env.DATABASE_URL = ':memory:';
    resetDbModuleState();
  });

  it('repairs legacy accounts.id schema and allows credential account creation', async () => {
    const tempDir = mkdtempSync(join(process.cwd(), 'tmp-db-compat-'));
    const dbPath = join(tempDir, 'compat.db');

    // Both handles must be closed before the temp directory can be removed:
    // Windows refuses to delete a file that is still open, and the db module
    // keeps its connection for the lifetime of the module.
    let appSqlite: { close: () => void } | null = null;
    let reader: InstanceType<typeof Database> | null = null;

    try {
      createBrokenAccountsDatabase(dbPath);

      process.env.DATABASE_URL = `file:${dbPath}`;
      resetDbModuleState();

      // Re-evaluate the db module so it opens the broken database and runs its
      // repair on import. A query suffix makes a distinct module, but it does
      // not propagate: models/user still imports the plain specifier. So point
      // that specifier at the freshly evaluated module too, which rewrites the
      // live bindings every already-imported consumer reads through.
      const freshDb = await import(`@/src/lib/db${fresh()}`);
      vi.mock('@/src/lib/db', () => ({ ...freshDb }));
      appSqlite = freshDb.sqlite;
      const { createUser } = await import('@/src/lib/models/user');
      await createUser({
        email: 'compat-user@example.com',
        name: 'Compat User',
        role: 'user',
        provider: 'credentials',
        subject: 'compat-user',
        passwordHash: 'hash123',
      });

      reader = new Database(dbPath, { readonly: true });
      const accountColumns = reader.prepare('PRAGMA table_info("accounts")').all() as Array<{
        name: string;
        type: string;
        pk: number;
      }>;
      const idColumn = accountColumns.find((column) => column.name === 'id');
      expect(idColumn).toBeDefined();
      expect(idColumn?.type.toUpperCase()).toBe('INTEGER');
      expect(idColumn?.pk).toBe(1);

      const user = reader
        .prepare('SELECT id FROM users WHERE email = ?')
        .get('compat-user@example.com') as { id: number } | undefined;
      expect(user?.id).toBeDefined();

      const account = reader
        .prepare(
          'SELECT id, providerId, accountId, issuer, password FROM accounts WHERE userId = ? AND providerId = ?',
        )
        .get(user!.id, 'credential') as
        | {
            id: number;
            providerId: string;
            accountId: string;
            issuer: string;
            password: string | null;
          }
        | undefined;

      expect(account).toBeDefined();
      expect(account?.id).toBeGreaterThan(0);
      expect(account?.providerId).toBe('credential');
      expect(account?.accountId).toBe(String(user!.id));
      expect(account?.password).toBe('hash123');
      expect(account?.issuer).toBe(createLocalAccountIssuer('credential'));

      // The repair preserves the rows that were already there, and gives each
      // the issuer better-auth would compute for that identity — a legacy row
      // left with the wrong issuer would stop resolving at sign-in.
      const legacy = reader
        .prepare(
          'SELECT accountId, providerId, issuer, password FROM accounts WHERE accountId IN (?, ?) ORDER BY accountId',
        )
        .all('legacy-subject', 'oauth-subject') as Array<{
        accountId: string;
        providerId: string;
        issuer: string;
        password: string | null;
      }>;

      expect(legacy).toHaveLength(2);
      expect(legacy[0]).toMatchObject({
        accountId: 'legacy-subject',
        providerId: 'credential',
        issuer: createLocalAccountIssuer('credential'),
        password: 'legacyhash',
      });
      expect(legacy[1]).toMatchObject({
        accountId: 'oauth-subject',
        providerId: 'gone-provider',
        issuer: createOAuthAccountIssuer('gone-provider'),
      });
    } finally {
      reader?.close();
      appSqlite?.close();
      // close() is not enough on bun:sqlite: the handle is released only once every prepared
      // statement is finalized, and drizzle's are finalized on collection — until then Windows
      // holds compat.db open and the removal fails with EBUSY. A sync GC finalizes them.
      Bun.gc(true);
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
