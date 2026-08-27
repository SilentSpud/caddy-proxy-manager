/**
 * Migration 0024 adds better-auth 1.7's required `accounts.issuer` column and
 * backfills existing rows.
 *
 * The backfill is the risky half of that upgrade: if a row is given an issuer
 * that differs from the one better-auth computes for the same identity, nothing
 * errors — the account just stops matching at sign-in and the user is locked out
 * of an account they still nominally have. So the values are asserted against
 * better-auth's own helpers, not against literals copied from the SQL.
 */
import { Database } from 'bun:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createLocalAccountIssuer, createOAuthAccountIssuer } from '@better-auth/core/db';

const migrationSql = readFileSync(
  resolve(process.cwd(), 'drizzle', '0024_account_issuer.sql'),
  'utf8',
);

/** The accounts table exactly as migration 0023 leaves it — no issuer column. */
const PRE_0024_SCHEMA = `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL
  );
  CREATE TABLE oauth_providers (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    issuer TEXT
  );
  -- Only here because 0024 carries an unrelated settings cleanup (the orphaned
  -- caddy_config_hash row); the backfill itself never touches this table.
  CREATE TABLE settings (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );
  CREATE TABLE accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  CREATE UNIQUE INDEX accounts_provider_account_idx ON accounts (providerId, accountId);
  CREATE INDEX accounts_user_idx ON accounts (userId);
`;

function applyMigration(sqlite: InstanceType<typeof Database>) {
  for (const statement of migrationSql.split('--> statement-breakpoint')) {
    const trimmed = statement.trim();
    if (trimmed) sqlite.exec(trimmed);
  }
}

describe('migration 0024 — account issuer backfill', () => {
  let sqlite: InstanceType<typeof Database>;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(PRE_0024_SCHEMA);
    sqlite.exec(`
      INSERT INTO users (id, email) VALUES (1, 'admin@example.com'), (2, 'dev@example.com');
      INSERT INTO oauth_providers (id, name, issuer) VALUES
        ('authentik', 'Authentik', 'https://idp.example/'),
        ('plain-oauth', 'Plain OAuth2', NULL),
        ('blank-issuer', 'Blank', '');
    `);
  });

  afterEach(() => {
    sqlite.close();
  });

  function insertAccount(id: number, userId: number, providerId: string, accountId: string) {
    sqlite
      .prepare(
        `INSERT INTO accounts (id, userId, accountId, providerId, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
      )
      .run(id, userId, accountId, providerId);
  }

  function issuerOf(id: number): string {
    return (
      sqlite.prepare('SELECT issuer FROM accounts WHERE id = ?').get(id) as { issuer: string }
    ).issuer;
  }

  it("gives password accounts better-auth's local credential issuer", () => {
    insertAccount(1, 1, 'credential', '1');
    applyMigration(sqlite);
    expect(issuerOf(1)).toBe(createLocalAccountIssuer('credential'));
  });

  it("gives an OIDC provider account the provider's own issuer, verbatim", () => {
    insertAccount(1, 2, 'authentik', 'sub-1');
    applyMigration(sqlite);
    // Trailing slash preserved: mapOAuthProvider hands the stored value to
    // better-auth as accountIssuer unchanged, so the row has to match it exactly.
    expect(issuerOf(1)).toBe('https://idp.example/');
  });

  it('gives a provider with no issuer the synthetic OAuth namespace', () => {
    insertAccount(1, 2, 'plain-oauth', 'sub-2');
    applyMigration(sqlite);
    expect(issuerOf(1)).toBe(createOAuthAccountIssuer('plain-oauth'));
  });

  it('treats a blank issuer as no issuer rather than writing an empty string', () => {
    insertAccount(1, 2, 'blank-issuer', 'sub-3');
    applyMigration(sqlite);
    expect(issuerOf(1)).toBe(createOAuthAccountIssuer('blank-issuer'));
  });

  it('falls back to the local namespace for a provider row that no longer exists', () => {
    // A provider deleted from the UI leaves its account rows behind; they still
    // need a non-null issuer for the column to be NOT NULL.
    insertAccount(1, 2, 'deleted-provider', 'sub-4');
    applyMigration(sqlite);
    expect(issuerOf(1)).toBe(createOAuthAccountIssuer('deleted-provider'));
  });

  it('preserves every other column and the row ids', () => {
    sqlite
      .prepare(
        `INSERT INTO accounts (id, userId, accountId, providerId, accessToken, scope, password, createdAt, updatedAt)
       VALUES (7, 2, 'sub-5', 'authentik', 'tok', 'openid email', 'hash', 'created', 'updated')`,
      )
      .run();
    applyMigration(sqlite);

    const row = sqlite.prepare('SELECT * FROM accounts WHERE id = 7').get() as Record<
      string,
      unknown
    >;
    expect(row).toMatchObject({
      id: 7,
      userId: 2,
      accountId: 'sub-5',
      providerId: 'authentik',
      accessToken: 'tok',
      scope: 'openid email',
      password: 'hash',
      createdAt: 'created',
      updatedAt: 'updated',
    });
  });

  it('leaves the table keyed by issuer and accountId', () => {
    insertAccount(1, 2, 'authentik', 'sub-1');
    applyMigration(sqlite);

    const indexes = sqlite.prepare('PRAGMA index_list("accounts")').all() as Array<{
      name: string;
      unique: number;
    }>;
    const issuerIdx = indexes.find((i) => i.name === 'accounts_issuer_account_idx');
    expect(issuerIdx).toBeDefined();
    expect(issuerIdx!.unique).toBe(1);

    // Under 1.7 the identity is the (issuer, subject) pair, so a *different*
    // provider resolving to the same issuer and subject is the same account and
    // must be rejected — something the old (providerId, accountId) index would
    // have happily allowed through.
    expect(() =>
      sqlite
        .prepare(
          `INSERT INTO accounts (userId, accountId, providerId, issuer, createdAt, updatedAt)
         VALUES (1, 'sub-1', 'authentik-alias', 'https://idp.example/', 'c', 'u')`,
        )
        .run(),
    ).toThrow(/UNIQUE/i);
  });

  it('makes the new column NOT NULL', () => {
    applyMigration(sqlite);
    const columns = sqlite.prepare('PRAGMA table_info("accounts")').all() as Array<{
      name: string;
      notnull: number;
    }>;
    const issuer = columns.find((c) => c.name === 'issuer');
    expect(issuer).toBeDefined();
    expect(issuer!.notnull).toBe(1);
  });
});
