/**
 * Everything that still knows what a SQLite database is.
 *
 * Nothing here runs during normal operation: SQLite stopped being an application backend in 3.1.
 * It is staged for the migration flow, which opens an upgrading deployment's old file, reads it,
 * and copies what it finds into PostgreSQL. Kept rather than deleted because the quirks it encodes
 * — which releases wrote which column names — are not recoverable from the current schema.
 *
 * Schema repairs for SQLite deployments that upgraded through an older release:
 *
 * All of this is SQLite-only by construction: it drives `PRAGMA table_info`, reads `sqlite_master`,
 * and works around SQLite's inability to alter a column in place by rebuilding tables. It runs
 * before `migrate()` so the migration files meet the column names they expect.
 *
 * PostgreSQL deployments never call any of it. A PostgreSQL database can only have been created by
 * drizzle/postgres/0000_initial.sql, which already has the post-repair shape, so there is no
 * pre-rename history to fix up.
 */
import type { Database } from "bun:sqlite";
import { CREDENTIAL_ISSUER, accountIssuerFor } from "../account-issuer";

/**
 * A `file:` URL exposes its path with a leading slash, so a Windows absolute path arrives as
 * "/C:/data/app.db" and resolves against the drive root — drop the slash when a drive letter
 * follows. Not `fileURLToPath`, which rejects POSIX-style file URLs on Windows. Windows-only; on
 * POSIX "/C:/x" is a real path. `platform` is a parameter so tests can cover both.
 */
export function stripLeadingSlashBeforeDriveLetter(
  pathname: string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform !== "win32") return pathname;
  return /^\/[A-Za-z]:[/\\]/.test(pathname) ? pathname.slice(1) : pathname;
}

/** Rename a column when only the snake_case form exists. No-op if missing or already correct. */
function renameColumnIfNeeded(client: Database, table: string, from: string, to: string) {
  try {
    const cols = client.prepare(`PRAGMA table_info("${table}")`).all() as Array<{
      name: string;
    }>;
    const names = new Set(cols.map((c) => c.name));
    if (names.has(from) && !names.has(to)) {
      client.prepare(`ALTER TABLE "${table}" RENAME COLUMN "${from}" TO "${to}"`).run();
    }
  } catch {
    // ignore
  }
}

/** Add a column if absent, checking both snake_case and camelCase so a rename isn't undone. */
function addColumnIfMissing(
  client: Database,
  table: string,
  snake: string,
  camel: string,
  definition: string,
) {
  try {
    const cols = client.prepare(`PRAGMA table_info("${table}")`).all() as Array<{
      name: string;
    }>;
    if (cols.length === 0) return; // table doesn't exist yet
    const names = new Set(cols.map((c) => c.name));
    if (!names.has(snake) && !names.has(camel)) {
      client.prepare(`ALTER TABLE "${table}" ADD COLUMN "${snake}" ${definition}`).run();
    }
  } catch {
    // ignore
  }
}

/**
 * Ensure `sessions.id` is INTEGER PRIMARY KEY AUTOINCREMENT. Better Auth uses generateId:"serial"
 * and omits `id` from INSERT, which an older `id TEXT NOT NULL` schema rejects. Sessions are
 * ephemeral, so just recreate the table.
 */
function fixSessionsSchema(client: Database) {
  try {
    const cols = client.prepare('PRAGMA table_info("sessions")').all() as Array<{
      name: string;
      type: string;
      pk: number;
    }>;
    if (cols.length === 0) return; // table doesn't exist yet
    const idCol = cols.find((c) => c.name === "id");
    if (!idCol) return;
    // INTEGER PRIMARY KEY is an alias for rowid — auto-generates on insert
    if (idCol.type.toUpperCase() === "INTEGER" && idCol.pk === 1) return;
    // Wrong type (e.g. TEXT NOT NULL) — recreate as autoincrement
    client
      .prepare(`CREATE TABLE "sessions_patch" (
      "id"        INTEGER PRIMARY KEY AUTOINCREMENT,
      "userId"    INTEGER NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "token"     TEXT NOT NULL,
      "expiresAt" TEXT NOT NULL,
      "ipAddress" TEXT,
      "userAgent" TEXT,
      "createdAt" TEXT NOT NULL,
      "updatedAt" TEXT NOT NULL
    )`)
      .run();
    // Sessions are short-lived — skip copying stale rows
    client.prepare('DROP TABLE "sessions"').run();
    client.prepare('ALTER TABLE "sessions_patch" RENAME TO "sessions"').run();
    client
      .prepare('CREATE UNIQUE INDEX IF NOT EXISTS "sessions_token_unique" ON "sessions" ("token")')
      .run();
    client.prepare('CREATE INDEX IF NOT EXISTS "sessions_user_idx" ON "sessions" ("userId")').run();
  } catch {
    // ignore
  }
}

/**
 * Ensure `accounts.id` is INTEGER PRIMARY KEY AUTOINCREMENT — some upgraded deployments have a
 * NOT NULL non-rowid column, failing inserts that omit it. Accounts are durable, so preserve rows.
 */
function fixAccountsSchema(client: Database) {
  try {
    const cols = client.prepare('PRAGMA table_info("accounts")').all() as Array<{
      name: string;
      type: string;
      notnull: number;
      pk: number;
    }>;
    if (cols.length === 0) return;
    const idCol = cols.find((c) => c.name === "id");
    if (!idCol) return;
    const issuerCol = cols.find((c) => c.name === "issuer");
    const indexes = client.prepare('PRAGMA index_list("accounts")').all() as Array<{
      name: string;
      unique: number;
    }>;
    const issuerIndex = indexes.find(
      (index) => index.name === "accounts_issuer_account_idx" && index.unique === 1,
    );
    const issuerIndexColumns = issuerIndex
      ? (client.prepare('PRAGMA index_info("accounts_issuer_account_idx")').all() as Array<{
          name: string;
          seqno: number;
        }>)
      : [];
    const hasCorrectIssuerIndex =
      issuerIndexColumns
        .sort((left, right) => left.seqno - right.seqno)
        .map((column) => column.name)
        .join(",") === "issuer,accountId";
    const idIsCorrect = idCol.type.toUpperCase() === "INTEGER" && idCol.pk === 1;
    const issuerIsCorrect = issuerCol?.notnull === 1;

    if (idIsCorrect && issuerIsCorrect && hasCorrectIssuerIndex) {
      return;
    }

    type LegacyAccountRow = {
      id: number | string;
      userId: number;
      issuer?: string | null;
      accountId: string;
      providerId: string;
      accessToken: string | null;
      refreshToken: string | null;
      idToken: string | null;
      accessTokenExpiresAt: string | null;
      refreshTokenExpiresAt: string | null;
      scope: string | null;
      password: string | null;
      createdAt: string;
      updatedAt: string;
    };

    const accountRows = client
      .prepare('SELECT * FROM "accounts" ORDER BY "id"')
      .all() as LegacyAccountRow[];
    const providerIssuers = new Map<string, string | null>();
    const hasProviderTable = client
      .prepare(
        "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'oauth_providers'",
      )
      .get();
    if (hasProviderTable) {
      const providers = client
        .prepare('SELECT "id", "issuer" FROM "oauth_providers"')
        .all() as Array<{ id: string; issuer: string | null }>;
      for (const provider of providers) {
        providerIssuers.set(provider.id, provider.issuer);
      }
    }

    const normalizedRows = accountRows.map((row) => {
      const existingIssuer = row.issuer?.trim();
      const issuer =
        existingIssuer ||
        (row.providerId === "credential"
          ? CREDENTIAL_ISSUER
          : accountIssuerFor(row.providerId, providerIssuers.get(row.providerId)));
      return { ...row, issuer };
    });

    // Better Auth 1.7 keys external identities by (issuer, accountId). Never
    // merge a collision implicitly: two legacy rows may belong to different
    // users, and choosing either one could turn a migration into account takeover.
    const identityOwners = new Map<string, number | string>();
    for (const row of normalizedRows) {
      const key = JSON.stringify([row.issuer, row.accountId]);
      const existingOwner = identityOwners.get(key);
      if (existingOwner !== undefined) {
        throw new Error(
          `account identity collision for issuer "${row.issuer}" and accountId "${row.accountId}"`,
        );
      }
      identityOwners.set(key, row.id);
    }

    const repair = client.transaction(() => {
      client.prepare('DROP TABLE IF EXISTS "accounts_patch"').run();
      client
        .prepare(`CREATE TABLE "accounts_patch" (
        "id" INTEGER PRIMARY KEY AUTOINCREMENT,
        "userId" INTEGER NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "issuer" TEXT NOT NULL,
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
      )`)
        .run();
      const insert = client.prepare(`INSERT INTO "accounts_patch" (
        "id", "userId", "issuer", "accountId", "providerId", "accessToken", "refreshToken", "idToken",
        "accessTokenExpiresAt", "refreshTokenExpiresAt", "scope", "password", "createdAt", "updatedAt"
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const row of normalizedRows) {
        // A table old enough to need this repair may hold non-numeric TEXT ids, which the
        // rebuilt INTEGER PRIMARY KEY rejects. Nothing references accounts.id, so let
        // AUTOINCREMENT assign a fresh one rather than failing the repair.
        const id = Number.isInteger(Number(row.id)) ? Number(row.id) : null;
        insert.run(
          id,
          row.userId,
          row.issuer,
          row.accountId,
          row.providerId,
          row.accessToken,
          row.refreshToken,
          row.idToken,
          row.accessTokenExpiresAt,
          row.refreshTokenExpiresAt,
          row.scope,
          row.password,
          row.createdAt,
          row.updatedAt,
        );
      }
      client.prepare('DROP TABLE "accounts"').run();
      client.prepare('ALTER TABLE "accounts_patch" RENAME TO "accounts"').run();
      client
        .prepare(
          'CREATE UNIQUE INDEX "accounts_provider_account_idx" ON "accounts" ("providerId", "accountId")',
        )
        .run();
      client
        .prepare(
          'CREATE UNIQUE INDEX "accounts_issuer_account_idx" ON "accounts" ("issuer", "accountId")',
        )
        .run();
      client.prepare('CREATE INDEX "accounts_user_idx" ON "accounts" ("userId")').run();
    });
    repair();
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown error";
    throw new Error(`Failed to repair Better Auth accounts schema: ${detail}`, {
      cause: error,
    });
  }
}

/**
 * Pre-migration patch for deployments that ran an older 0020 with different column names. 0021
 * renames columns in many tables but not `accounts`, `sessions` or `verifications`, so snake_case
 * survivors break Better Auth. Runs before `migrate()`.
 */
export function repairLegacySqliteSchema(client: Database) {
  // ── users ────────────────────────────────────────────────────────────────────
  // Columns added by 0020 that older deployments may be missing
  addColumnIfMissing(
    client,
    "users",
    "email_verified",
    "emailVerified",
    "INTEGER NOT NULL DEFAULT 0",
  );
  addColumnIfMissing(client, "users", "username", "username", "TEXT");
  addColumnIfMissing(client, "users", "display_username", "displayUsername", "TEXT");

  // ── accounts ─────────────────────────────────────────────────────────────────
  // 0020 should create these camelCase; older versions used snake_case, and 0021 does not
  // rename accounts columns — fix them here.
  renameColumnIfNeeded(client, "accounts", "user_id", "userId");
  renameColumnIfNeeded(client, "accounts", "account_id", "accountId");
  renameColumnIfNeeded(client, "accounts", "provider_id", "providerId");
  renameColumnIfNeeded(client, "accounts", "access_token", "accessToken");
  renameColumnIfNeeded(client, "accounts", "refresh_token", "refreshToken");
  renameColumnIfNeeded(client, "accounts", "id_token", "idToken");
  renameColumnIfNeeded(client, "accounts", "access_token_expires_at", "accessTokenExpiresAt");
  renameColumnIfNeeded(client, "accounts", "refresh_token_expires_at", "refreshTokenExpiresAt");
  renameColumnIfNeeded(client, "accounts", "created_at", "createdAt");
  renameColumnIfNeeded(client, "accounts", "updated_at", "updatedAt");
  fixAccountsSchema(client);

  // ── sessions ─────────────────────────────────────────────────────────────────
  // Better Auth omits `id` from INSERT (generateId:"serial") and relies on AUTOINCREMENT, so an
  // older `id TEXT NOT NULL` schema fails. Recreate; sessions are ephemeral.
  fixSessionsSchema(client);
  renameColumnIfNeeded(client, "sessions", "user_id", "userId");
  renameColumnIfNeeded(client, "sessions", "expires_at", "expiresAt");
  renameColumnIfNeeded(client, "sessions", "ip_address", "ipAddress");
  renameColumnIfNeeded(client, "sessions", "user_agent", "userAgent");
  renameColumnIfNeeded(client, "sessions", "created_at", "createdAt");
  renameColumnIfNeeded(client, "sessions", "updated_at", "updatedAt");

  // ── verifications ─────────────────────────────────────────────────────────────
  renameColumnIfNeeded(client, "verifications", "expires_at", "expiresAt");
  renameColumnIfNeeded(client, "verifications", "created_at", "createdAt");
  renameColumnIfNeeded(client, "verifications", "updated_at", "updatedAt");
}
