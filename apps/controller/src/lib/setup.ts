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

/**
 * Not a registry setting: this is the flow's own bookkeeping, not something an operator configures,
 * so it is neither rendered on the settings page nor migrated from an environment variable.
 */
const SETUP_COMPLETED_KEY = "setup:completed";

export type SetupStage =
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

export async function isSetupCompleted(): Promise<boolean> {
  const [row] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, SETUP_COMPLETED_KEY))
    .limit(1);
  return row?.value === "true";
}

export async function markSetupCompleted(): Promise<void> {
  const now = nowIso();
  await db
    .insert(settings)
    .values({ key: SETUP_COMPLETED_KEY, value: "true", updatedAt: now })
    .onConflictDoUpdate({ target: settings.key, set: { value: "true", updatedAt: now } });
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
    return { stage: "account", required: true };
  }

  return signedIn ? { stage: "settings", required: true } : { stage: "verify", required: true };
}

/** Where each stage lives, for the redirects the proxy and the pages perform. */
export const SETUP_PATHS: Record<SetupStage, string> = {
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
