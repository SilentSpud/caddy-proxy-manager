/**
 * Who may sign in and sign up, and how hard the door is to knock on.
 *
 * The same answers `config.auth` and the `AUTH_*` variables used to give, resolved through the
 * settings registry so a value saved in Settings decides them. `config` reads `process.env` once
 * when the module loads, which is fine for a variable and useless for a setting: nothing saved
 * would reach a reader until the container restarted.
 *
 * The derivations that were written into `config` are kept here, because they are policy rather
 * than plumbing: OIDC-only mode has no local accounts to register, and it leaves OAuth
 * registration open unless the operator has said otherwise, since the IdP is then the only way an
 * account can come to exist.
 *
 * The settings modules are imported lazily, as public-url.ts does, and their values are cached for
 * the process, so this is a map lookup after the first call rather than a query.
 */
import { config } from "./config";

export type AuthPolicy = {
  disableLocalUsers: boolean;
  allowSelfRegistration: boolean;
  allowOauthRegistration: boolean;
  allowOauthRoleFromClaims: boolean;
  /** Build URLs from the request's Host header. */
  trustHost: boolean;
  rateLimit: { enabled: boolean; window: number; max: number };
};

/** What `config` alone can say, for the paths that run before a database is reachable. */
function fromEnvironment(): AuthPolicy {
  return {
    disableLocalUsers: config.auth.disableLocalUsers,
    allowSelfRegistration: config.auth.allowSelfRegistration,
    allowOauthRegistration: config.auth.allowOauthRegistration,
    allowOauthRoleFromClaims: config.auth.allowOauthRoleFromClaims,
    trustHost: process.env.AUTH_TRUST_HOST === "true",
    rateLimit: {
      enabled: process.env.AUTH_RATE_LIMIT_ENABLED !== "false",
      window: Number(process.env.AUTH_RATE_LIMIT_WINDOW ?? 60),
      max: Number(process.env.AUTH_RATE_LIMIT_MAX ?? 5),
    },
  };
}

export async function authPolicy(): Promise<AuthPolicy> {
  try {
    const [registry, { resolveSetting }] = await Promise.all([
      import("./settings/registry"),
      import("./settings/resolve"),
    ]);

    const [
      disabled,
      selfRegistration,
      oauthRegistration,
      roleFromClaims,
      trustHost,
      rateLimitEnabled,
      rateLimitWindow,
      rateLimitMax,
    ] = await Promise.all([
      resolveSetting(registry.disableLocalUsers),
      resolveSetting(registry.allowSelfRegistration),
      resolveSetting(registry.allowOauthRegistration),
      resolveSetting(registry.allowOauthRoleFromClaims),
      resolveSetting(registry.trustHost),
      resolveSetting(registry.authRateLimitEnabled),
      resolveSetting(registry.authRateLimitWindow),
      resolveSetting(registry.authRateLimitMax),
    ]);

    return {
      disableLocalUsers: disabled.value,
      // Nothing to self-register into without local accounts, whatever the setting says.
      allowSelfRegistration: !disabled.value && selfRegistration.value,
      // Open by default in OIDC-only mode, where the IdP is the only way in - but only while
      // nobody has answered the question, so an explicit "no" is still honoured.
      allowOauthRegistration:
        disabled.value && oauthRegistration.source === "default" ? true : oauthRegistration.value,
      allowOauthRoleFromClaims: roleFromClaims.value,
      trustHost: trustHost.value,
      rateLimit: {
        enabled: rateLimitEnabled.value,
        window: rateLimitWindow.value,
        max: rateLimitMax.value,
      },
    };
  } catch {
    return fromEnvironment();
  }
}

/** The one question most callers ask, on its own. */
export async function localUsersDisabled(): Promise<boolean> {
  return (await authPolicy()).disableLocalUsers;
}
