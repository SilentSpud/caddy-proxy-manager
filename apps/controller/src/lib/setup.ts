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
import { eq } from "drizzle-orm";
import db, { nowIso } from "./db";
import { settings } from "./db/schema";
import { getUserCount } from "./models/user";
import { listEnabledOAuthProviders } from "./models/oauth-providers";
import { scanForLegacyDatabases } from "./migration/legacy-database";

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
 * backup and name it in the instructions — and so that screen is only reachable by a deployment
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

/** Record that the operator chose not to migrate, so the offer is not made again. */
export async function declineMigration(): Promise<void> {
  await setFlag(MIGRATION_DECLINED_KEY);
}

export async function isMigrationDeclined(): Promise<boolean> {
  return isFlagSet(MIGRATION_DECLINED_KEY);
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
    if (!(await isMigrationDeclined()) && (await hasLegacyDatabase())) {
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
 * True when the environment still configures a way in — which is what "this deployment predates
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
  console.log("Sign-in is configured from the environment — first-run setup marked complete");
}
