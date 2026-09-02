/**
 * Instance role vocabulary and the setting keys it is stored under, kept in its own leaf module so
 * settings.ts, instance-sync.ts, config.ts and db.ts can all share it without an import cycle
 * (instance-sync.ts already imports settings.ts, which imports db.ts).
 */

export type InstanceMode = "standalone" | "controller" | "agent";

/** Setting key holding this instance's role. */
export const INSTANCE_MODE_KEY = "instance_mode";

/** Setting key holding an agent's bearer token for its controller. */
export const CONTROLLER_TOKEN_KEY = "instance_controller_token";

/** Pre-rename spelling of CONTROLLER_TOKEN_KEY, migrated away by runInstanceRoleRename(). */
export const LEGACY_CONTROLLER_TOKEN_KEY = "instance_master_token";

/**
 * The roles were called master/slave before 2.0. Nothing translates those words any more — this
 * map exists so the old spellings can be *recognized in order to be rejected*, and so the
 * migration knows what to rewrite stored values to.
 */
export const LEGACY_INSTANCE_MODES: Readonly<Record<string, InstanceMode>> = {
  master: "controller",
  slave: "agent",
};

/** Pre-rename name for INSTANCE_AGENTS. Recognized only to reject it. */
export const LEGACY_ENV_INSTANCE_AGENTS = "INSTANCE_SLAVES";

/**
 * The role a value names, or null if it names none. Callers supply their own fallback for null.
 *
 * Deliberately strict: "master" and "slave" are not roles. Accepting them was a compatibility
 * shim, and translating silently is what the shim existed to avoid — see
 * assertNoLegacyInstanceRoleEnv for how the old spellings surface now.
 */
export function normalizeInstanceMode(value: unknown): InstanceMode | null {
  if (value === "standalone" || value === "controller" || value === "agent") {
    return value;
  }
  return null;
}

/**
 * Reject the pre-rename environment variables.
 *
 * Stored settings are rewritten on startup by runInstanceRoleRename(), but a deployer's .env is
 * outside this process's reach, so the old names have to be refused rather than migrated. Refusing
 * loudly is the point: an unrecognized INSTANCE_MODE falls back to "standalone", which would turn
 * an agent into an instance serving its own configuration instead of the controller's, and leave a
 * controller pushing to nobody — both silent, both wrong. A failed startup naming the variable and
 * its replacement is recoverable in seconds; silent divergence is not.
 */
export function assertNoLegacyInstanceRoleEnv(
  // Widened from NodeJS.ProcessEnv, which this project types as requiring NODE_ENV. Only three
  // keys are read, so demanding a whole environment from callers buys nothing.
  env: Record<string, string | undefined> = process.env,
): void {
  const mode = env.INSTANCE_MODE;
  const replacement = typeof mode === "string" ? LEGACY_INSTANCE_MODES[mode] : undefined;
  if (replacement) {
    throw new Error(
      `INSTANCE_MODE="${mode}" is no longer a valid instance role — the roles are now ` +
        `"standalone", "controller" and "agent". Set INSTANCE_MODE=${replacement}. ` +
        `Startup fails rather than continuing because an unrecognized role falls back to ` +
        `"standalone", which would stop this instance from syncing without reporting anything.`,
    );
  }

  const legacyAgents = env[LEGACY_ENV_INSTANCE_AGENTS];
  const hasLegacyAgents = typeof legacyAgents === "string" && legacyAgents.trim().length > 0;
  const currentAgents = env.INSTANCE_AGENTS;
  const hasCurrentAgents = typeof currentAgents === "string" && currentAgents.trim().length > 0;

  if (hasLegacyAgents && !hasCurrentAgents) {
    throw new Error(
      `${LEGACY_ENV_INSTANCE_AGENTS} is no longer read — rename it to INSTANCE_AGENTS. ` +
        `Startup fails rather than continuing because this controller would otherwise come up ` +
        `with no agents configured and silently push to nobody.`,
    );
  }

  if (hasLegacyAgents && hasCurrentAgents) {
    // Both set and INSTANCE_AGENTS wins, so behaviour is already correct. Say so once instead of
    // failing a deployment over a leftover line.
    console.warn(
      `[instance-sync] ${LEGACY_ENV_INSTANCE_AGENTS} is set but no longer read; INSTANCE_AGENTS ` +
        `is being used. Remove ${LEGACY_ENV_INSTANCE_AGENTS} from the environment.`,
    );
  }
}
