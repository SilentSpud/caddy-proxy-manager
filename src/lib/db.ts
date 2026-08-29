import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { eq, ne, and, isNull } from "drizzle-orm";
import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve as resolvePath } from "node:path";
import * as schema from "./db/schema";
import { accountIssuerFor } from "./account-issuer";

const DEFAULT_SQLITE_URL = "file:./data/caddy-proxy-manager.db";

type GlobalForDrizzle = typeof globalThis & {
  __DRIZZLE_DB__?: ReturnType<typeof drizzle<typeof schema>>;
  __SQLITE_CLIENT__?: InstanceType<typeof Database>;
  __MIGRATIONS_RAN__?: boolean;
};

/**
 * A `file:` URL exposes its path with a leading slash, so a Windows absolute path round-trips as
 * "/C:/data/app.db" and resolves against the drive root. Drop the slash when a drive letter
 * follows. Not `fileURLToPath`: on Windows it rejects POSIX-style file URLs, and
 * `file:/app/data/app.db` is the documented Docker default. Windows-only — on POSIX "/C:/x" is a
 * real path. `platform` is a parameter so tests can cover both.
 */
export function stripLeadingSlashBeforeDriveLetter(
  pathname: string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform !== "win32") return pathname;
  return /^\/[A-Za-z]:[/\\]/.test(pathname) ? pathname.slice(1) : pathname;
}

function resolveSqlitePath(rawUrl: string): string {
  if (!rawUrl) {
    return ":memory:";
  }
  if (rawUrl === ":memory:" || rawUrl === "file::memory:") {
    return ":memory:";
  }

  if (rawUrl.startsWith("file:./") || rawUrl.startsWith("file:../")) {
    const relative = rawUrl.slice("file:".length);
    return resolvePath(process.cwd(), relative);
  }

  if (rawUrl.startsWith("file:")) {
    try {
      const fileUrl = new URL(rawUrl);
      if (fileUrl.host && fileUrl.host !== "localhost") {
        throw new Error("Remote SQLite hosts are not supported.");
      }
      return stripLeadingSlashBeforeDriveLetter(decodeURIComponent(fileUrl.pathname));
    } catch {
      const remainder = rawUrl.slice("file:".length);
      if (!remainder) {
        return ":memory:";
      }
      return isAbsolute(remainder) ? remainder : resolvePath(process.cwd(), remainder);
    }
  }

  return isAbsolute(rawUrl) ? rawUrl : resolvePath(process.cwd(), rawUrl);
}

const databaseUrl = process.env.DATABASE_URL ?? DEFAULT_SQLITE_URL;
const sqlitePath = resolveSqlitePath(databaseUrl);

function ensureDirectoryFor(pathname: string) {
  if (pathname === ":memory:") {
    return;
  }
  const dir = dirname(pathname);
  mkdirSync(dir, { recursive: true });
}

const globalForDrizzle = globalThis as GlobalForDrizzle;

export const sqlite =
  globalForDrizzle.__SQLITE_CLIENT__ ??
  (() => {
    ensureDirectoryFor(sqlitePath);
    return new Database(sqlitePath);
  })();

if (process.env.NODE_ENV !== "production") {
  globalForDrizzle.__SQLITE_CLIENT__ = sqlite;
}

export const db = globalForDrizzle.__DRIZZLE_DB__ ?? drizzle(sqlite, { schema });

if (process.env.NODE_ENV !== "production") {
  globalForDrizzle.__DRIZZLE_DB__ = db;
}

const migrationsFolder = resolvePath(process.cwd(), "drizzle");

/**
 * Rename a column when the snake_case form exists and the camelCase form does not. No-ops if
 * the table is missing or the column is already correct.
 */
function renameColumnIfNeeded(table: string, from: string, to: string) {
  try {
    const cols = db.$client.prepare(`PRAGMA table_info("${table}")`).all() as Array<{
      name: string;
    }>;
    const names = new Set(cols.map((c) => c.name));
    if (names.has(from) && !names.has(to)) {
      db.$client.prepare(`ALTER TABLE "${table}" RENAME COLUMN "${from}" TO "${to}"`).run();
    }
  } catch {
    // ignore
  }
}

/**
 * Add a column if absent. Checks both snake_case and camelCase forms so a column already
 * renamed by a later migration isn't re-added.
 */
function addColumnIfMissing(table: string, snake: string, camel: string, definition: string) {
  try {
    const cols = db.$client.prepare(`PRAGMA table_info("${table}")`).all() as Array<{
      name: string;
    }>;
    if (cols.length === 0) return; // table doesn't exist yet
    const names = new Set(cols.map((c) => c.name));
    if (!names.has(snake) && !names.has(camel)) {
      db.$client.prepare(`ALTER TABLE "${table}" ADD COLUMN "${snake}" ${definition}`).run();
    }
  } catch {
    // ignore
  }
}

/**
 * Ensure `sessions.id` is INTEGER PRIMARY KEY AUTOINCREMENT. Better Auth uses
 * generateId:"serial" and omits `id` from INSERT, which an older `id TEXT NOT NULL` schema
 * rejects. Sessions are ephemeral, so just recreate the table.
 */
function fixSessionsSchema() {
  try {
    const cols = db.$client.prepare('PRAGMA table_info("sessions")').all() as Array<{
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
    db.$client
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
    db.$client.prepare('DROP TABLE "sessions"').run();
    db.$client.prepare('ALTER TABLE "sessions_patch" RENAME TO "sessions"').run();
    db.$client
      .prepare('CREATE UNIQUE INDEX IF NOT EXISTS "sessions_token_unique" ON "sessions" ("token")')
      .run();
    db.$client
      .prepare('CREATE INDEX IF NOT EXISTS "sessions_user_idx" ON "sessions" ("userId")')
      .run();
  } catch {
    // ignore
  }
}

/**
 * Ensure `accounts.id` is INTEGER PRIMARY KEY AUTOINCREMENT — some upgraded deployments have a
 * NOT NULL non-rowid column, failing inserts that omit it. Accounts are durable, so preserve rows.
 */
function fixAccountsSchema() {
  try {
    const cols = db.$client.prepare('PRAGMA table_info("accounts")').all() as Array<{
      name: string;
      type: string;
      pk: number;
    }>;
    if (cols.length === 0) return;
    const idCol = cols.find((c) => c.name === "id");
    if (!idCol) return;
    if (idCol.type.toUpperCase() === "INTEGER" && idCol.pk === 1) return;

    // better-auth 1.7 requires `issuer`. A table old enough to need this repair predates it, so
    // derive the value the way migration 0024 does; keep an existing column's values rather
    // than recomputing them.
    const issuerSelect = cols.some((c) => c.name === "issuer")
      ? '"issuer"'
      : `CASE WHEN "providerId" = 'credential' THEN 'local:credential' ELSE COALESCE(
           NULLIF((SELECT p."issuer" FROM "oauth_providers" p WHERE p."id" = "accounts"."providerId"), ''),
           'local:oauth:' || "providerId"
         ) END`;

    db.$client
      .prepare(`CREATE TABLE "accounts_patch" (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT,
      "userId" INTEGER NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "accountId" TEXT NOT NULL,
      "providerId" TEXT NOT NULL,
      "issuer" TEXT NOT NULL,
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
    db.$client
      .prepare(`INSERT INTO "accounts_patch" (
      "userId", "accountId", "providerId", "issuer", "accessToken", "refreshToken", "idToken",
      "accessTokenExpiresAt", "refreshTokenExpiresAt", "scope", "password", "createdAt", "updatedAt"
    ) SELECT
      "userId", "accountId", "providerId", ${issuerSelect}, "accessToken", "refreshToken", "idToken",
      "accessTokenExpiresAt", "refreshTokenExpiresAt", "scope", "password", "createdAt", "updatedAt"
    FROM "accounts"`)
      .run();
    db.$client.prepare('DROP TABLE "accounts"').run();
    db.$client.prepare('ALTER TABLE "accounts_patch" RENAME TO "accounts"').run();
    db.$client
      .prepare(
        'CREATE UNIQUE INDEX IF NOT EXISTS "accounts_provider_account_idx" ON "accounts" ("providerId", "accountId")',
      )
      .run();
    db.$client
      .prepare(
        'CREATE UNIQUE INDEX IF NOT EXISTS "accounts_issuer_account_idx" ON "accounts" ("issuer", "accountId")',
      )
      .run();
    db.$client
      .prepare('CREATE INDEX IF NOT EXISTS "accounts_user_idx" ON "accounts" ("userId")')
      .run();
  } catch {
    // ignore
  }
}

/**
 * Pre-migration patch for deployments that ran an older migration 0020 with different column
 * names. 0021 renames columns in many tables but not `accounts`, `sessions` or `verifications`, so
 * snake_case survivors break Better Auth. Runs before `migrate()` to fix them up.
 */
function patchTablesForMigration020() {
  // ── users ────────────────────────────────────────────────────────────────────
  // Columns added by 0020 that older deployments may be missing
  addColumnIfMissing("users", "email_verified", "emailVerified", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing("users", "username", "username", "TEXT");
  addColumnIfMissing("users", "display_username", "displayUsername", "TEXT");

  // ── accounts ─────────────────────────────────────────────────────────────────
  // 0020 should create these camelCase; older versions used snake_case, and 0021 does not
  // rename accounts columns — fix them here.
  renameColumnIfNeeded("accounts", "user_id", "userId");
  renameColumnIfNeeded("accounts", "account_id", "accountId");
  renameColumnIfNeeded("accounts", "provider_id", "providerId");
  renameColumnIfNeeded("accounts", "access_token", "accessToken");
  renameColumnIfNeeded("accounts", "refresh_token", "refreshToken");
  renameColumnIfNeeded("accounts", "id_token", "idToken");
  renameColumnIfNeeded("accounts", "access_token_expires_at", "accessTokenExpiresAt");
  renameColumnIfNeeded("accounts", "refresh_token_expires_at", "refreshTokenExpiresAt");
  renameColumnIfNeeded("accounts", "created_at", "createdAt");
  renameColumnIfNeeded("accounts", "updated_at", "updatedAt");
  fixAccountsSchema();

  // ── sessions ─────────────────────────────────────────────────────────────────
  // auth-server.ts uses generateId:"serial" — Better Auth omits `id` from INSERT and relies on
  // INTEGER PRIMARY KEY AUTOINCREMENT, so an older `id TEXT NOT NULL` schema fails. Recreate
  // the table when needed; sessions are ephemeral, so data loss is acceptable.
  fixSessionsSchema();
  renameColumnIfNeeded("sessions", "user_id", "userId");
  renameColumnIfNeeded("sessions", "expires_at", "expiresAt");
  renameColumnIfNeeded("sessions", "ip_address", "ipAddress");
  renameColumnIfNeeded("sessions", "user_agent", "userAgent");
  renameColumnIfNeeded("sessions", "created_at", "createdAt");
  renameColumnIfNeeded("sessions", "updated_at", "updatedAt");

  // ── verifications ─────────────────────────────────────────────────────────────
  renameColumnIfNeeded("verifications", "expires_at", "expiresAt");
  renameColumnIfNeeded("verifications", "created_at", "createdAt");
  renameColumnIfNeeded("verifications", "updated_at", "updatedAt");
}

function runMigrations() {
  if (sqlitePath === ":memory:") {
    return;
  }
  if (globalForDrizzle.__MIGRATIONS_RAN__) {
    return;
  }
  patchTablesForMigration020();
  try {
    migrate(db, { migrationsFolder });
    globalForDrizzle.__MIGRATIONS_RAN__ = true;
  } catch (error: unknown) {
    // Pages may be pre-rendered in parallel during the build, racing the migrations. If the
    // tables already exist, continue.
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      "message" in error &&
      error.code === "SQLITE_ERROR" &&
      typeof error.message === "string" &&
      error.message.includes("already exists")
    ) {
      console.log("Database tables already exist, skipping migrations");
      globalForDrizzle.__MIGRATIONS_RAN__ = true;
      return;
    }
    throw error;
  }
}

try {
  runMigrations();
} catch (error) {
  console.error("Failed to run database migrations:", error);
  // In build mode let the build continue; runtime initialization handles migrations properly.
  if (
    process.env.NODE_ENV !== "production" ||
    process.env.NEXT_PHASE === "phase-production-build"
  ) {
    console.warn("Continuing despite migration error during build phase");
  } else {
    throw error;
  }
}

/**
 * One-time migration: populate `accounts` from users' provider/subject fields, add credential
 * accounts for password users, sync env OAuth providers. Idempotent via a settings flag.
 */
function runBetterAuthDataMigration() {
  if (sqlitePath === ":memory:") return;

  const { settings, users, accounts, oauthProviders } = schema;

  const flag = db.select().from(settings).where(eq(settings.key, "better_auth_migrated")).get();
  if (flag) return;

  const now = new Date().toISOString();
  // Providers declaring an issuer key their accounts by it; the rest use the synthetic local
  // namespace. Read once rather than per user.
  const providerIssuers = new Map(
    db
      .select({ id: oauthProviders.id, issuer: oauthProviders.issuer })
      .from(oauthProviders)
      .all()
      .map((row) => [row.id, row.issuer] as const),
  );

  // Migrate OAuth users: create account rows from users.provider/subject
  const oauthUsers = db.select().from(users).where(ne(users.provider, "credentials")).all();
  for (const user of oauthUsers) {
    if (!user.provider || !user.subject) continue;
    const existing = db
      .select()
      .from(accounts)
      .where(
        and(
          eq(accounts.userId, user.id),
          eq(accounts.providerId, user.provider),
          eq(accounts.accountId, user.subject),
        ),
      )
      .get();
    if (!existing) {
      db.insert(accounts)
        .values({
          userId: user.id,
          accountId: user.subject,
          providerId: user.provider,
          issuer: accountIssuerFor(user.provider, providerIssuers.get(user.provider)),
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
        })
        .run();
    }
  }

  // Migrate credentials users: create credential account rows
  const credentialUsers = db.select().from(users).where(eq(users.provider, "credentials")).all();
  for (const user of credentialUsers) {
    const existing = db
      .select()
      .from(accounts)
      .where(and(eq(accounts.userId, user.id), eq(accounts.providerId, "credential")))
      .get();
    if (!existing) {
      db.insert(accounts)
        .values({
          userId: user.id,
          accountId: user.id.toString(),
          providerId: "credential",
          issuer: accountIssuerFor("credential"),
          password: user.passwordHash,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
        })
        .run();
    }
  }

  // Populate username field for all users (derived from email prefix)
  const usersWithoutUsername = db.select().from(users).where(isNull(users.username)).all();
  for (const user of usersWithoutUsername) {
    const usernameFromEmail = user.email.toLowerCase();
    const displayUsername = user.email.split("@")[0] || user.email;
    db.update(users)
      .set({
        username: usernameFromEmail,
        displayUsername,
      })
      .where(eq(users.id, user.id))
      .run();
  }

  db.insert(settings).values({ key: "better_auth_migrated", value: "true", updatedAt: now }).run();
  console.log("Better Auth data migration complete: populated accounts table");
}

/**
 * Sync OAUTH_* env vars into the oauthProviders table (synchronous). Raw Drizzle queries,
 * since this runs at module load time.
 */
function runEnvProviderSync() {
  if (sqlitePath === ":memory:") return;

  // Lazy import to avoid circular dependency at module load
  let config: {
    oauth: {
      enabled: boolean;
      providerName: string;
      clientId: string | null;
      clientSecret: string | null;
      issuer: string | null;
      authorizationUrl: string | null;
      tokenUrl: string | null;
      userinfoUrl: string | null;
      allowAutoLinking: boolean;
      scopes: string | null;
      groupsClaim: string | null;
      groupPrefix: string | null;
      roleMappingEnabled: boolean;
      adminGroup: string | null;
      userGroup: string | null;
      viewerGroup: string | null;
      defaultRole: string | null;
      syncGroups: boolean;
    };
  };
  try {
    config = require("./config").config;
  } catch {
    return;
  }

  if (!config.oauth.enabled || !config.oauth.clientId || !config.oauth.clientSecret) return;

  const { oauthProviders } = schema;
  let encryptSecret: (v: string) => string;
  try {
    encryptSecret = require("./secret").encryptSecret;
  } catch (e) {
    console.error(
      "CRITICAL: Failed to load encryption module, refusing to store plaintext secrets:",
      e,
    );
    return;
  }

  const name = config.oauth.providerName;
  // Use a slug-based ID so the OAuth callback URL is predictable
  const providerId =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "oauth";
  const existing = db.select().from(oauthProviders).where(eq(oauthProviders.name, name)).get();

  const validRoles = new Set(["admin", "user", "viewer"]);
  const defaultRole =
    config.oauth.defaultRole && validRoles.has(config.oauth.defaultRole)
      ? config.oauth.defaultRole
      : "user";
  const groupMapping = {
    groupsClaim: config.oauth.groupsClaim ?? "groups",
    groupPrefix: config.oauth.groupPrefix ?? null,
    roleMappingEnabled: config.oauth.roleMappingEnabled,
    adminGroup: config.oauth.adminGroup ?? null,
    userGroup: config.oauth.userGroup ?? null,
    viewerGroup: config.oauth.viewerGroup ?? null,
    defaultRole,
    syncGroups: config.oauth.syncGroups,
  };

  const now = new Date().toISOString();
  if (existing && existing.source === "env") {
    db.update(oauthProviders)
      .set({
        clientId: encryptSecret(config.oauth.clientId),
        clientSecret: encryptSecret(config.oauth.clientSecret),
        issuer: config.oauth.issuer ?? null,
        authorizationUrl: config.oauth.authorizationUrl ?? null,
        tokenUrl: config.oauth.tokenUrl ?? null,
        userinfoUrl: config.oauth.userinfoUrl ?? null,
        scopes: config.oauth.scopes ?? existing.scopes,
        autoLink: config.oauth.allowAutoLinking,
        ...groupMapping,
        updatedAt: now,
      })
      .where(eq(oauthProviders.id, existing.id))
      .run();
  } else if (!existing) {
    db.insert(oauthProviders)
      .values({
        id: providerId,
        name,
        type: "oidc",
        clientId: encryptSecret(config.oauth.clientId),
        clientSecret: encryptSecret(config.oauth.clientSecret),
        issuer: config.oauth.issuer ?? null,
        authorizationUrl: config.oauth.authorizationUrl ?? null,
        tokenUrl: config.oauth.tokenUrl ?? null,
        userinfoUrl: config.oauth.userinfoUrl ?? null,
        scopes: config.oauth.scopes ?? "openid email profile",
        autoLink: config.oauth.allowAutoLinking,
        ...groupMapping,
        enabled: true,
        source: "env",
        createdAt: now,
        updatedAt: now,
      })
      .run();
    console.log(`Synced OAuth provider from env: ${name}`);
  }
}

/**
 * One-time migration: convert legacy Cloudflare DNS settings to the generic dns_provider
 * format. Idempotent — skips if already run or if the new setting already exists.
 */
function runCloudflareToProviderMigration() {
  if (sqlitePath === ":memory:") return;

  const { settings: settingsTable } = schema;

  // Skip if migration already ran
  const flag = db
    .select()
    .from(settingsTable)
    .where(eq(settingsTable.key, "dns_provider_migrated"))
    .get();
  if (flag) return;

  // Skip if new dns_provider setting already exists (user already configured it)
  const existing = db
    .select()
    .from(settingsTable)
    .where(eq(settingsTable.key, "dns_provider"))
    .get();
  if (existing) {
    const now = new Date().toISOString();
    db.insert(settingsTable)
      .values({ key: "dns_provider_migrated", value: "true", updatedAt: now })
      .run();
    return;
  }

  // Check for legacy cloudflare setting
  const cfRow = db.select().from(settingsTable).where(eq(settingsTable.key, "cloudflare")).get();
  if (!cfRow) {
    const now = new Date().toISOString();
    db.insert(settingsTable)
      .values({ key: "dns_provider_migrated", value: "true", updatedAt: now })
      .run();
    return;
  }

  try {
    const cf = JSON.parse(cfRow.value) as {
      apiToken?: string;
      zoneId?: string;
      accountId?: string;
    };
    if (cf.apiToken) {
      const now = new Date().toISOString();
      const newSetting = {
        providers: { cloudflare: { api_token: cf.apiToken } },
        default: "cloudflare",
      };
      db.insert(settingsTable)
        .values({ key: "dns_provider", value: JSON.stringify(newSetting), updatedAt: now })
        .run();
      console.log("Migrated legacy Cloudflare DNS settings to dns_provider format");
    }
  } catch (e) {
    console.warn("Failed to parse legacy cloudflare setting during migration:", e);
  }

  const now = new Date().toISOString();
  db.insert(settingsTable)
    .values({ key: "dns_provider_migrated", value: "true", updatedAt: now })
    .run();
}

try {
  runBetterAuthDataMigration();
  runEnvProviderSync();
  runCloudflareToProviderMigration();
} catch (error) {
  console.warn("Better Auth data migration warning:", error);
}

export { schema };
export default db;

export function nowIso(): string {
  return new Date().toISOString();
}

export function toIso(value: string | Date | null | undefined): string | null {
  if (!value) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
