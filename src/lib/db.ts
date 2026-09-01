/**
 * The application's database handle, plus the one-time data migrations that run on startup.
 *
 * The backend comes from DATABASE_URL: a path or `file:` URL selects SQLite (the default, and what
 * every existing deployment runs), a `postgres://` URL selects PostgreSQL. Both use Bun's own
 * drivers — `bun:sqlite` and `Bun.SQL` — through drizzle. Driver selection lives in
 * ./db/connection.ts; nothing below this line may branch on the dialect.
 *
 * This module top-level-awaits its startup work. PostgreSQL migrations are asynchronous, and an
 * async ESM module makes the import graph wait for them, so no route handler can observe a
 * half-migrated database.
 */
import { eq, ne, and, isNull } from "drizzle-orm";
import * as schema from "./db/schema";
import { CREDENTIAL_ISSUER, accountIssuerFor } from "./account-issuer";
import {
  CONTROLLER_TOKEN_KEY,
  INSTANCE_MODE_KEY,
  LEGACY_CONTROLLER_TOKEN_KEY,
  LEGACY_INSTANCE_MODES,
} from "./instance-mode";
import { db, isEphemeral, runSchemaMigrations } from "./db/connection";

/** Idempotency flag for runInstanceRoleRename(). */
const INSTANCE_ROLES_RENAMED_KEY = "instance_roles_renamed";

export { stripLeadingSlashBeforeDriveLetter } from "./db/dialect";
export { db, dialect, client, runInTransaction } from "./db/connection";
export type { Db } from "./db/connection";

try {
  await runSchemaMigrations();
} catch (error) {
  console.error("Failed to run database migrations:", error);
  // Next's production build can import this module from parallel workers that share the temporary
  // build database. Runtime, development, and tests must fail closed on migration errors so
  // identity collisions are never ignored.
  if (process.env.NEXT_PHASE === "phase-production-build") {
    console.warn("Continuing despite migration error during build phase");
  } else {
    throw error;
  }
}

/**
 * One-time migration: populate `accounts` from users' provider/subject fields, add credential
 * accounts for password users, sync env OAuth providers. Idempotent via a settings flag.
 */
async function runBetterAuthDataMigration() {
  if (isEphemeral) return;

  const { settings, users, accounts, oauthProviders } = schema;

  const [flag] = await db
    .select()
    .from(settings)
    .where(eq(settings.key, "better_auth_migrated"))
    .limit(1);
  if (flag) return;

  const now = new Date().toISOString();
  // Providers declaring an issuer key their accounts by it; the rest use the synthetic local
  // namespace. Read once rather than per user.
  const providerIssuers = new Map(
    (
      await db.select({ id: oauthProviders.id, issuer: oauthProviders.issuer }).from(oauthProviders)
    ).map((row) => [row.id, row.issuer] as const),
  );

  // Migrate OAuth users: create account rows from users.provider/subject
  const oauthUsers = await db.select().from(users).where(ne(users.provider, "credentials"));
  for (const user of oauthUsers) {
    if (!user.provider || !user.subject) continue;
    const [existing] = await db
      .select()
      .from(accounts)
      .where(
        and(
          eq(accounts.userId, user.id),
          eq(accounts.providerId, user.provider),
          eq(accounts.accountId, user.subject),
        ),
      )
      .limit(1);
    if (!existing) {
      await db.insert(accounts).values({
        userId: user.id,
        accountId: user.subject,
        providerId: user.provider,
        issuer: accountIssuerFor(user.provider, providerIssuers.get(user.provider)),
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      });
    }
  }

  // Migrate credentials users: create credential account rows
  const credentialUsers = await db.select().from(users).where(eq(users.provider, "credentials"));
  for (const user of credentialUsers) {
    const [existing] = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.userId, user.id), eq(accounts.providerId, "credential")))
      .limit(1);
    if (!existing) {
      await db.insert(accounts).values({
        userId: user.id,
        accountId: user.id.toString(),
        providerId: "credential",
        issuer: CREDENTIAL_ISSUER,
        password: user.passwordHash,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      });
    }
  }

  // Populate username field for all users (derived from email prefix)
  const usersWithoutUsername = await db.select().from(users).where(isNull(users.username));
  for (const user of usersWithoutUsername) {
    const usernameFromEmail = user.email.toLowerCase();
    const displayUsername = user.email.split("@")[0] || user.email;
    await db
      .update(users)
      .set({
        username: usernameFromEmail,
        displayUsername,
      })
      .where(eq(users.id, user.id));
  }

  await db.insert(settings).values({ key: "better_auth_migrated", value: "true", updatedAt: now });
  console.log("Better Auth data migration complete: populated accounts table");
}

/** Sync OAUTH_* env vars into oauthProviders. Raw Drizzle — this runs at module load. */
async function runEnvProviderSync() {
  if (isEphemeral) return;

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
  const [existing] = await db
    .select()
    .from(oauthProviders)
    .where(eq(oauthProviders.name, name))
    .limit(1);

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
    await db
      .update(oauthProviders)
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
      .where(eq(oauthProviders.id, existing.id));
  } else if (!existing) {
    await db.insert(oauthProviders).values({
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
    });
    console.log(`Synced OAuth provider from env: ${name}`);
  }
}

/** One-time migration: legacy Cloudflare DNS settings → the generic dns_provider format. */
async function runCloudflareToProviderMigration() {
  if (isEphemeral) return;

  const { settings: settingsTable } = schema;

  // Skip if migration already ran
  const [flag] = await db
    .select()
    .from(settingsTable)
    .where(eq(settingsTable.key, "dns_provider_migrated"))
    .limit(1);
  if (flag) return;

  // Skip if new dns_provider setting already exists (user already configured it)
  const [existing] = await db
    .select()
    .from(settingsTable)
    .where(eq(settingsTable.key, "dns_provider"))
    .limit(1);
  if (existing) {
    const now = new Date().toISOString();
    await db
      .insert(settingsTable)
      .values({ key: "dns_provider_migrated", value: "true", updatedAt: now });
    return;
  }

  // Check for legacy cloudflare setting
  const [cfRow] = await db
    .select()
    .from(settingsTable)
    .where(eq(settingsTable.key, "cloudflare"))
    .limit(1);
  if (!cfRow) {
    const now = new Date().toISOString();
    await db
      .insert(settingsTable)
      .values({ key: "dns_provider_migrated", value: "true", updatedAt: now });
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
      await db
        .insert(settingsTable)
        .values({ key: "dns_provider", value: JSON.stringify(newSetting), updatedAt: now });
      console.log("Migrated legacy Cloudflare DNS settings to dns_provider format");
    }
  } catch (e) {
    console.warn("Failed to parse legacy cloudflare setting during migration:", e);
  }

  const now = new Date().toISOString();
  await db
    .insert(settingsTable)
    .values({ key: "dns_provider_migrated", value: "true", updatedAt: now });
}

/**
 * One-time migration: the instance roles were renamed from master/slave to controller/agent, and
 * the agent's controller-token setting key along with them.
 *
 * Nothing reads the old spellings any more, so this has to complete before the first read of
 * `instance_mode` — an unmigrated "slave" now normalizes to null, and the caller's fallback is
 * "standalone", which would quietly make an agent serve its own settings instead of the
 * controller's. Ordered before the other data migrations and outside their warn-and-continue
 * handler for the same reason: failing here must stop startup, not be logged past.
 */
export async function runInstanceRoleRename() {
  if (isEphemeral) return;

  const { settings } = schema;
  const [flag] = await db
    .select()
    .from(settings)
    .where(eq(settings.key, INSTANCE_ROLES_RENAMED_KEY))
    .limit(1);
  if (flag) return;

  const now = new Date().toISOString();

  // ── instance_mode: "master" -> "controller", "slave" -> "agent" ────────────
  // Values are JSON-encoded by setSetting, so the stored text is `"master"`, quotes included.
  const [modeRow] = await db
    .select()
    .from(settings)
    .where(eq(settings.key, INSTANCE_MODE_KEY))
    .limit(1);
  if (modeRow) {
    let stored: unknown;
    try {
      stored = JSON.parse(modeRow.value);
    } catch {
      stored = null;
    }
    const renamed = typeof stored === "string" ? LEGACY_INSTANCE_MODES[stored] : undefined;
    if (renamed) {
      await db
        .update(settings)
        .set({ value: JSON.stringify(renamed), updatedAt: now })
        .where(eq(settings.key, INSTANCE_MODE_KEY));
      console.log(`Instance role migrated: ${stored} -> ${renamed}`);
    }
  }

  // ── instance_master_token -> instance_controller_token ────────────────────
  const [legacyToken] = await db
    .select()
    .from(settings)
    .where(eq(settings.key, LEGACY_CONTROLLER_TOKEN_KEY))
    .limit(1);
  if (legacyToken) {
    const [currentToken] = await db
      .select()
      .from(settings)
      .where(eq(settings.key, CONTROLLER_TOKEN_KEY))
      .limit(1);
    // A value already under the new key wins: it can only have been written by a build that had
    // already migrated, so it is the newer of the two.
    if (!currentToken) {
      await db
        .insert(settings)
        .values({ key: CONTROLLER_TOKEN_KEY, value: legacyToken.value, updatedAt: now });
      console.log("Instance sync token moved to instance_controller_token");
    }
    await db.delete(settings).where(eq(settings.key, LEGACY_CONTROLLER_TOKEN_KEY));
  }

  await db
    .insert(settings)
    .values({ key: INSTANCE_ROLES_RENAMED_KEY, value: "true", updatedAt: now });
}

await runInstanceRoleRename();

try {
  await runBetterAuthDataMigration();
  await runEnvProviderSync();
  await runCloudflareToProviderMigration();
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
