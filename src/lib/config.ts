import { assertValidInstanceSyncToken } from "./instance-sync-token";
import { passwordPolicyFailures } from "./password-policy";

const DEV_SECRET = "dev-secret-change-in-production-12345678901234567890123456789012";
const DEFAULT_ADMIN_USERNAME = "admin";
const DEFAULT_ADMIN_PASSWORD = "admin";
const DISALLOWED_SESSION_SECRETS = new Set([
  "change-me-in-production",
  "dev-secret-change-in-production-12345678901234567890123456789012",
]);
const DEFAULT_CADDY_URL =
  process.env.NODE_ENV === "development" ? "http://localhost:2019" : "http://caddy:2019";
const MIN_SESSION_SECRET_LENGTH = 32;
const DEFAULT_APP_NAME = "Caddy Proxy Manager";

/**
 * Display name in the sidebar, on the login card, and as the page-title suffix. A page opts out
 * with `title: { absolute: ... }` — see app/layout.tsx.
 */
const APP_NAME = process.env.APP_NAME?.trim() || DEFAULT_APP_NAME;

/**
 * Gravatar fallback for users with no icon. `null` leaves the choice to the Settings toggle;
 * AVATAR_GRAVATAR pins it and locks the toggle, so an air-gapped deployment can guarantee no
 * browser reaches gravatar.com.
 */
function resolveLegacyPasswordChangeEnv(): boolean | null {
  const raw = process.env.AUTH_REQUIRE_PASSWORD_CHANGE_ON_LEGACY_HASH?.trim().toLowerCase();
  if (raw === undefined || raw === "") return null;
  return raw !== "false" && raw !== "0" && raw !== "no";
}

function resolveGravatarEnv(): boolean | null {
  const raw = process.env.AVATAR_GRAVATAR?.trim().toLowerCase();
  if (raw === undefined || raw === "") return null;
  return raw !== "false" && raw !== "0" && raw !== "no";
}

/**
 * OIDC-only mode: no local accounts at all. No bootstrap admin, no credential sign-in; every
 * identity comes from an OAuth/OIDC provider.
 */
const LOCAL_USERS_DISABLED = process.env.AUTH_DISABLE_LOCAL_USERS === "true";

const isProduction = process.env.NODE_ENV === "production";
const isNodeRuntime = process.env.NEXT_RUNTIME === "nodejs";
const isDevelopment = process.env.NODE_ENV === "development";
// Only enforce strict validation in actual production runtime, not during build
const isBuildPhase =
  process.env.NEXT_PHASE === "phase-production-build" || !process.env.NEXT_RUNTIME;
const isRuntimeProduction = isProduction && isNodeRuntime && !isBuildPhase;

function resolveSessionSecret(): string {
  const rawSecret = process.env.SESSION_SECRET ?? null;
  const secret = rawSecret?.trim();

  // In development, allow missing secret
  if (isDevelopment && !secret) {
    return DEV_SECRET;
  }

  // In production build phase, allow temporary value
  if (isProduction && !isNodeRuntime && !secret) {
    return DEV_SECRET;
  }

  // Fail-closed on unrecognized NODE_ENV to prevent silent DEV_SECRET usage
  if (!isDevelopment && !isProduction && !secret) {
    throw new Error(
      `SESSION_SECRET is required when NODE_ENV="${process.env.NODE_ENV ?? ""}" ` +
        `(not "development" or "production"). ` +
        "Generate a secure secret with: openssl rand -base64 32",
    );
  }

  // Use provided secret or dev secret (only reachable in development)
  const finalSecret = secret || DEV_SECRET;

  // Strict validation in production runtime
  if (isRuntimeProduction) {
    if (!secret) {
      throw new Error(
        "SESSION_SECRET environment variable is required in production. " +
          "Generate a secure secret with: openssl rand -base64 32",
      );
    }
    if (DISALLOWED_SESSION_SECRETS.has(secret)) {
      throw new Error(
        "SESSION_SECRET is using a known insecure placeholder value. " +
          "Generate a secure secret with: openssl rand -base64 32",
      );
    }
    if (secret.length < MIN_SESSION_SECRET_LENGTH) {
      throw new Error(
        `SESSION_SECRET must be at least ${MIN_SESSION_SECRET_LENGTH} characters long in production. ` +
          "Generate a secure secret with: openssl rand -base64 32",
      );
    }
  }

  return finalSecret;
}

function resolveAdminCredentials(): { username: string | null; password: string | null } {
  // With local users disabled there is no bootstrap admin to seed, so demanding these
  // credentials would block startup for a deployment that handed identity to its IdP.
  if (LOCAL_USERS_DISABLED) {
    return { username: null, password: null };
  }

  const rawUsername = process.env.ADMIN_USERNAME ?? null;
  const rawPassword = process.env.ADMIN_PASSWORD ?? null;
  const username = rawUsername?.trim() || DEFAULT_ADMIN_USERNAME;
  const password = rawPassword?.trim() || DEFAULT_ADMIN_PASSWORD;

  // In development, allow defaults
  if (isDevelopment) {
    if (username === DEFAULT_ADMIN_USERNAME || password === DEFAULT_ADMIN_PASSWORD) {
      console.log("Using default admin credentials for development (admin/admin)");
    }
    return { username, password };
  }

  // In production build phase, allow defaults temporarily
  if (isProduction && !isNodeRuntime) {
    return { username, password };
  }

  // Strict validation in production runtime
  if (isRuntimeProduction) {
    const errors: string[] = [];

    // Username validation - just ensure it's set
    if (!rawUsername || !username) {
      errors.push("ADMIN_USERNAME must be set");
    }

    // Password validation - strict requirements
    if (!rawPassword || password === DEFAULT_ADMIN_PASSWORD) {
      errors.push("ADMIN_PASSWORD must be set to a custom value in production (not 'admin')");
    } else {
      for (const failure of passwordPolicyFailures(password)) {
        errors.push(`ADMIN_PASSWORD ${failure}`);
      }
    }

    if (errors.length > 0) {
      throw new Error(
        "Admin credentials validation failed:\n" +
          errors.map((e) => `  - ${e}`).join("\n") +
          "\n\nSet secure credentials using ADMIN_USERNAME and ADMIN_PASSWORD environment variables.",
      );
    }
  }

  return { username, password };
}

// Lazy initialization to avoid executing during build time
let _adminCredentials: { username: string | null; password: string | null } | null = null;
let _sessionSecret: string | null = null;

function getAdminCredentials() {
  if (!_adminCredentials) {
    _adminCredentials = resolveAdminCredentials();
  }
  return _adminCredentials;
}

function getSessionSecret() {
  if (!_sessionSecret) {
    _sessionSecret = resolveSessionSecret();
  }
  return _sessionSecret;
}

export const config = {
  get sessionSecret() {
    return getSessionSecret();
  },
  caddyApiUrl: process.env.CADDY_API_URL ?? DEFAULT_CADDY_URL,
  baseUrl: process.env.BASE_URL ?? "http://localhost:3000",
  appName: APP_NAME,
  avatars: {
    /** true/false when AVATAR_GRAVATAR pins it, null when the setting decides. */
    gravatarFromEnv: resolveGravatarEnv(),
  },
  get adminUsername() {
    return getAdminCredentials().username;
  },
  get adminPassword() {
    return getAdminCredentials().password;
  },
  auth: {
    // OIDC-only mode. Disables credential sign-in, local account creation, password management,
    // and the bootstrap admin seed.
    disableLocalUsers: LOCAL_USERS_DISABLED,
    allowSelfRegistration:
      !LOCAL_USERS_DISABLED && process.env.AUTH_ALLOW_SELF_REGISTRATION === "true",
    // Separate from credential self-registration: gates whether an OAuth sign-in may implicitly
    // create a brand-new account. Defaults closed — except in OIDC-only mode, where the IdP is
    // the only way an account can exist, so it defaults open unless explicitly refused.
    allowOauthRegistration: LOCAL_USERS_DISABLED
      ? process.env.AUTH_ALLOW_OAUTH_REGISTRATION !== "false"
      : process.env.AUTH_ALLOW_OAUTH_REGISTRATION === "true",
    // When true, an OAuth IdP's profile claims may set a new user's role/status. Defaults to
    // false, forcing safe defaults regardless of claims. Enable only if you control the IdP.
    allowOauthRoleFromClaims: process.env.AUTH_ALLOW_OAUTH_ROLE_FROM_CLAIMS === "true",
    // Force a password reset for anyone still on a pre-argon2id bcrypt hash. true/false when
    // AUTH_REQUIRE_PASSWORD_CHANGE_ON_LEGACY_HASH pins it, null when the stored setting decides.
    requirePasswordChangeOnLegacyHashFromEnv: resolveLegacyPasswordChangeEnv(),
  },
  oauth: {
    enabled: process.env.OAUTH_ENABLED === "true",
    providerName: process.env.OAUTH_PROVIDER_NAME ?? "OAuth2",
    clientId: process.env.OAUTH_CLIENT_ID ?? null,
    clientSecret: process.env.OAUTH_CLIENT_SECRET ?? null,
    issuer: process.env.OAUTH_ISSUER ?? null,
    authorizationUrl: process.env.OAUTH_AUTHORIZATION_URL ?? null,
    tokenUrl: process.env.OAUTH_TOKEN_URL ?? null,
    userinfoUrl: process.env.OAUTH_USERINFO_URL ?? null,
    allowAutoLinking: process.env.OAUTH_ALLOW_AUTO_LINKING === "true",
    // Scopes for the env-configured provider. Group claims usually need an extra scope (e.g.
    // "openid email profile groups").
    scopes: process.env.OAUTH_SCOPES?.trim() || null,
    // ── Group-based roles (env-configured provider) ─────────────────────────
    groupsClaim: process.env.OAUTH_GROUPS_CLAIM?.trim() || null,
    groupPrefix: process.env.OAUTH_GROUP_PREFIX?.trim() || null,
    roleMappingEnabled: process.env.OAUTH_ROLE_MAPPING === "true",
    adminGroup: process.env.OAUTH_ADMIN_GROUP?.trim() || null,
    userGroup: process.env.OAUTH_USER_GROUP?.trim() || null,
    viewerGroup: process.env.OAUTH_VIEWER_GROUP?.trim() || null,
    defaultRole: process.env.OAUTH_DEFAULT_ROLE?.trim() || null,
    syncGroups: process.env.OAUTH_SYNC_GROUPS === "true",
  },
  forwardAuthInternalUrl: process.env.FORWARD_AUTH_INTERNAL_URL ?? null,
};

/** Validates config at production startup, throwing on insecure defaults. Safe during build. */
export function validateProductionConfig() {
  if (isRuntimeProduction) {
    // Access the config values to force validation; throws if defaults are used in production
    void config.sessionSecret;
    // Admin credentials are validated only when local users exist at all —
    // resolveAdminCredentials() short-circuits in OIDC-only mode.
    void config.adminUsername;
    void config.adminPassword;

    // An environment-configured slave cannot safely fall back to a short or
    // missing bearer credential. Validate this synchronously during startup.
    if (process.env.INSTANCE_MODE === "slave") {
      assertValidInstanceSyncToken(
        process.env.INSTANCE_SYNC_TOKEN,
        "INSTANCE_SYNC_TOKEN for slave mode",
      );
    }
  }
}
