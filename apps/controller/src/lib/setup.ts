/**
 * First-run setup: what stage a deployment is at, and how it advances.
 *
 * Setup exists because a fresh database no longer has an `ADMIN_USERNAME`/`ADMIN_PASSWORD` to seed
 * an admin from, so there is no way to sign in until someone is asked to make one. It insists on a
 * real sign-in before collecting any other configuration: a wrong OAuth client secret or a
 * mistyped password is otherwise only discovered after everything else has been entered, and the
 * only way out is deleting the database.
 *
 * The stage is derived from what exists rather than tracked as a counter, so a half-finished setup
 * resumes where it left off and the back button cannot desynchronise it. The one piece of stored
 * state is the completion flag, because "signed in, settings not saved yet" and "signed in,
 * finished" are otherwise identical.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, lt } from "drizzle-orm";
import db, { nowIso } from "./db";
import { accounts, settings, users } from "./db/schema";
import { getUserCount } from "./models/user";
import { listEnabledOAuthProviders } from "./models/oauth-providers";
import { scanForLegacyDatabases } from "./migration/legacy-database";
import { logAuditEvent } from "./audit";

/** Whether anything on this host looks like a database from before the PostgreSQL move. */
export function hasLegacyDatabase(): boolean {
  return scanForLegacyDatabases().candidates.length > 0;
}

/**
 * Not a registry setting: this is the flow's own bookkeeping, not something an operator configures,
 * so it is neither rendered on the settings page nor migrated from an environment variable.
 */
const SETUP_COMPLETED_KEY = "setup:completed";

/**
 * Set when the operator was offered a legacy database and said no. Without it the offer reappears
 * on every request, and there is no way to reach account creation on a host that still has an old
 * file lying about.
 */
const MIGRATION_DECLINED_KEY = "setup:migration_declined";

/**
 * The legacy file a completed migration read from. Recorded so the final screen can offer it as a
 * backup and name it in the instructions - and so that screen is only reachable by a deployment
 * that actually migrated.
 */
const MIGRATION_SOURCE_KEY = "setup:migrated_from";

export type SetupStage =
  /** A previous version's database is on this host and has not been dealt with. */
  | "migrate"
  /** Nothing to sign in with. Choose controller or agent, then create an account. */
  | "account"
  /** An account exists but this browser has not proved it works. */
  | "verify"
  /** Signed in, and the rest of the configuration has not been saved yet. */
  | "settings"
  /** Setup is finished; the app runs normally. */
  | "complete";

export type SetupState = {
  stage: SetupStage;
  /** True while the app should serve nothing but the setup flow. */
  required: boolean;
};

async function isFlagSet(key: string): Promise<boolean> {
  const [row] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, key))
    .limit(1);
  return row?.value === "true";
}

async function setFlag(key: string): Promise<void> {
  const now = nowIso();
  await db
    .insert(settings)
    .values({ key, value: "true", updatedAt: now })
    .onConflictDoUpdate({ target: settings.key, set: { value: "true", updatedAt: now } });
}

/** Remember which file was migrated, for the summary and the backup download. */
export async function recordMigrationSource(path: string): Promise<void> {
  const now = nowIso();
  await db
    .insert(settings)
    .values({ key: MIGRATION_SOURCE_KEY, value: path, updatedAt: now })
    .onConflictDoUpdate({ target: settings.key, set: { value: path, updatedAt: now } });
}

/** The migrated file's path, or null when this deployment did not migrate. */
export async function getMigrationSource(): Promise<string | null> {
  const [row] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, MIGRATION_SOURCE_KEY))
    .limit(1);
  return row?.value ?? null;
}

/**
 * The restart the migration screen asks for. Once an import brings accounts, restarting is no
 * longer open to anyone, so the browser that ran the import is handed this single-use token for
 * that one request. Stored hashed; the plaintext exists only in the migrate response.
 */
const RESTART_TOKEN_KEY = "setup:restart_token";
const RESTART_TOKEN_TTL_MS = 15 * 60 * 1000;

/** When a restart was last accepted. In the database because it has to outlive the exit it allows. */
const RESTART_REQUESTED_KEY = "setup:restart_requested_at";
export const RESTART_COOLDOWN_MS = 60 * 1000;

function hashRestartToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function issueRestartToken(): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const value = JSON.stringify({
    hash: hashRestartToken(token),
    expiresAt: Date.now() + RESTART_TOKEN_TTL_MS,
  });
  const now = nowIso();
  await db
    .insert(settings)
    .values({ key: RESTART_TOKEN_KEY, value, updatedAt: now })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: now } });
  return token;
}

/** Whether `token` is the unexpired one issued, spending it if so. */
export async function consumeRestartToken(token: string | null): Promise<boolean> {
  if (!token) return false;
  const [row] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, RESTART_TOKEN_KEY))
    .limit(1);
  if (!row) return false;

  let stored: { hash?: unknown; expiresAt?: unknown };
  try {
    stored = JSON.parse(row.value);
  } catch {
    return false;
  }
  if (typeof stored.hash !== "string" || typeof stored.expiresAt !== "number") return false;
  if (stored.expiresAt <= Date.now()) return false;

  const presented = Buffer.from(hashRestartToken(token), "hex");
  const expected = Buffer.from(stored.hash, "hex");
  if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) return false;

  // Deleted by value, so two requests racing with the same token cannot both spend it.
  const spent = await db
    .delete(settings)
    .where(and(eq(settings.key, RESTART_TOKEN_KEY), eq(settings.value, row.value)))
    .returning({ key: settings.key });
  return spent.length > 0;
}

/**
 * Claim the one restart allowed per cooldown, atomically: the stamp only moves when the previous
 * one is older than the cooldown. ISO timestamps compare correctly as text.
 */
export async function claimRestartSlot(
  now = Date.now(),
): Promise<{ ok: true } | { ok: false; retryAfterMs: number }> {
  const stamp = new Date(now).toISOString();
  const cutoff = new Date(now - RESTART_COOLDOWN_MS).toISOString();
  const claimed = await db
    .insert(settings)
    .values({ key: RESTART_REQUESTED_KEY, value: stamp, updatedAt: stamp })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: stamp, updatedAt: stamp },
      setWhere: lt(settings.value, cutoff),
    })
    .returning({ key: settings.key });
  if (claimed.length > 0) return { ok: true };

  const [row] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, RESTART_REQUESTED_KEY))
    .limit(1);
  const parsed = row ? Date.parse(row.value) : Number.NaN;
  if (row && !Number.isFinite(parsed)) {
    // A corrupt stamp never compares older than the cutoff, so it would refuse every restart - and
    // its Retry-After would be NaN. Replace it, still atomically: only if nobody else just did.
    const repaired = await db
      .update(settings)
      .set({ value: stamp, updatedAt: stamp })
      .where(and(eq(settings.key, RESTART_REQUESTED_KEY), eq(settings.value, row.value)))
      .returning({ key: settings.key });
    if (repaired.length > 0) return { ok: true };
  }
  const last = Number.isFinite(parsed) ? parsed : now;
  return { ok: false, retryAfterMs: Math.max(0, last + RESTART_COOLDOWN_MS - now) };
}

/** Record that the operator chose not to migrate, so the offer is not made again. */
export async function declineMigration(): Promise<void> {
  await setFlag(MIGRATION_DECLINED_KEY);
}

export async function isMigrationDeclined(): Promise<boolean> {
  return isFlagSet(MIGRATION_DECLINED_KEY);
}

/**
 * Whether the legacy database on this host has already been dealt with, either way.
 *
 * Declining is one way. Having migrated is the other, and it has to be checked separately now that
 * a migration can leave the old accounts behind: the old test was "can anything sign in yet",
 * which such a migration does not satisfy - so the operator would be offered the same file again
 * on their way to creating an account, and importing it twice is not something the flow supports.
 */
export async function isMigrationSettled(): Promise<boolean> {
  if (await isMigrationDeclined()) return true;
  return (await getMigrationSource()) !== null;
}

export async function isSetupCompleted(): Promise<boolean> {
  return isFlagSet(SETUP_COMPLETED_KEY);
}

export async function markSetupCompleted(): Promise<void> {
  await setFlag(SETUP_COMPLETED_KEY);
}

/**
 * Whether anything can sign in at all: a local account, or an enabled OAuth provider.
 *
 * Both are checked regardless of mode. A deployment that configured OAuth and later re-enabled
 * local users still has a way in, and sending it back to account creation would be wrong.
 */
export async function hasAnySignIn(): Promise<boolean> {
  if ((await getUserCount()) > 0) return true;
  return (await listEnabledOAuthProviders()).length > 0;
}

/**
 * Make a federated user an administrator if setup is unfinished and nobody else is one yet.
 *
 * Called by the settings step as it saves, so the rule is "whoever completes setup is the
 * administrator" - a deliberate act, rather than a privilege handed out by the act of signing in.
 *
 * It exists because the account step has two branches and only one of them produced an admin.
 * `createFirstAdmin` writes `role: "admin"` outright, but the OAuth branch only stores a provider
 * - the user row is then created by Better Auth's callback, where `enforceSafeUserDefaults`
 * (correctly) pins every federated sign-up to `role: "user"`. Group-to-role mapping cannot cover
 * the gap either: it is configured in the settings step, which is the very step that demanded an
 * admin session. So an instance set up against an IdP had no way to finish setup at all.
 *
 * All three guards matter. Setup being unfinished bounds this to the window the account step
 * already hands out administrator rights in. Requiring that no admin exists means it fires once -
 * a second, ordinary user reaching this step is refused rather than promoted, as is anyone at all
 * once the flow is finished. And requiring a federated account keeps it to the branch that is
 * actually broken: a credential sign-in during setup can only be the admin `createFirstAdmin`
 * just made, so a self-registered local account must never be caught by this.
 */
export async function promoteFirstSetupAdmin(userId: number): Promise<boolean> {
  if (!Number.isFinite(userId)) return false;
  if (await isSetupCompleted()) return false;

  const admins = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "admin"), eq(users.status, "active")));
  if (admins.length > 0) return false;

  const linked = await db
    .select({ providerId: accounts.providerId })
    .from(accounts)
    .where(eq(accounts.userId, userId));
  if (!linked.some((account) => account.providerId !== "credential")) return false;

  const [promoted] = await db
    .update(users)
    .set({ role: "admin", updatedAt: nowIso() })
    .where(eq(users.id, userId))
    .returning();
  if (!promoted) return false;

  await logAuditEvent({
    userId,
    action: "setup_first_admin",
    entityType: "user",
    entityId: userId,
    summary: `User ${userId} became the first administrator by signing in during setup`,
  });
  console.log(`Setup completed by user ${userId} - promoted to administrator`);
  return true;
}

/**
 * The current stage. `signedIn` is passed in because the session is read differently from the
 * proxy, a server component and a route handler, and this module should not have to know which.
 */
export async function getSetupState(signedIn: boolean): Promise<SetupState> {
  if (await isSetupCompleted()) {
    return { stage: "complete", required: false };
  }

  if (!(await hasAnySignIn())) {
    // Offered before account creation: an operator who has an old database wants its accounts,
    // not a new one alongside them. Scanning the filesystem is only worth doing in this one state.
    if (!(await isMigrationSettled()) && hasLegacyDatabase()) {
      return { stage: "migrate", required: true };
    }
    return { stage: "account", required: true };
  }

  return signedIn ? { stage: "settings", required: true } : { stage: "verify", required: true };
}

/** Where each stage lives, for the redirects the proxy and the pages perform. */
export const SETUP_PATHS: Record<SetupStage, string> = {
  migrate: "/setup/migrate",
  account: "/setup",
  verify: "/login",
  settings: "/setup/settings",
  complete: "/",
};

/**
 * True when the environment still configures a way in - which is what "this deployment predates
 * the setup flow" actually means.
 *
 * This is the whole test for the backfill below, and it has to be the environment rather than
 * "are there any users": an operator halfway through setup has created an account but not saved
 * their settings, and a restart must not mark them finished and drop them into an unconfigured
 * app. Only a deployment carrying the old variables gets skipped past the flow.
 */
function environmentConfiguresSignIn(): boolean {
  const hasAdminCredentials =
    (process.env.ADMIN_USERNAME ?? "").trim() !== "" &&
    (process.env.ADMIN_PASSWORD ?? "").trim() !== "";
  return hasAdminCredentials || process.env.OAUTH_ENABLED === "true";
}

/**
 * Mark a pre-existing installation complete so it never sees the setup flow. Called once at
 * startup, after the admin seed.
 */
export async function backfillSetupCompletion(): Promise<void> {
  if (await isSetupCompleted()) return;
  if (!environmentConfiguresSignIn()) return;
  if (!(await hasAnySignIn())) return;

  await markSetupCompleted();
  console.log("Sign-in is configured from the environment - first-run setup marked complete");
}
