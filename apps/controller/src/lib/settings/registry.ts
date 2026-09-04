/**
 * Every setting that is moving out of `.env` and into the database, described once.
 *
 * One definition carries the storage key, the environment variable it is migrated from, how to
 * read that variable, how to validate a value arriving from the API or the setup form, its
 * default, and where it belongs on screen. The setup page (phase 3) and the migration flow
 * (phase 4) both render themselves from this list rather than repeating it.
 *
 * Deliberately not here:
 *
 * - `OAUTH_*`. Those already have a home — the `oauth_providers` table, which `runEnvProviderSync`
 *   writes them into at startup. Adding them would create a second source of truth for the same
 *   provider.
 * - `CERTS_DIRECTORY`, `ACME_CA_ROOT_DIR`, `L4_PORTS_DIR`. Container paths describing where Caddy's
 *   files live on a particular host. They belong to the agent, and phase 5 moves them there.
 * - `INSTANCE_*`. The sync feature they configure is removed in phase 5.
 * - Anything that has to be read before the database can be: the connection string and pool size,
 *   `SESSION_SECRET` (it encrypts the database's own secrets), `NODE_ENV`, `PORT`/`HOST`, the
 *   standalone-binary bootstrap paths, whatever Compose reads on the host, and the agent's own
 *   pre-database configuration.
 */

import { hasForbiddenControlCharacter } from "../settings-validation";

export type SettingGroup = "application" | "authentication" | "analytics" | "geoip";

/** A value as stored, before it is parsed. Settings are held as JSON in the `settings` table. */
export type SettingValue = string | number | boolean | null;

export type SettingDefinition<T extends SettingValue = SettingValue> = {
  /** Storage key, namespaced so these never collide with the JSON blobs already in the table. */
  key: string;
  /** The variable this was configured by, still honored as an override until it is removed. */
  env: string;
  group: SettingGroup;
  label: string;
  /** Shown under the field. Say what changes when it changes, not what the type is. */
  description: string;
  default: T;
  /** Encrypted at rest, and never sent to the browser in full. */
  secret?: boolean;
  /** Read the environment variable's raw string. Throws through `parse` on a bad value. */
  fromEnv: (raw: string) => T;
  /** Validate a value from the API or the setup form. Throws `SettingValidationError`. */
  parse: (value: unknown) => T;
};

export class SettingValidationError extends Error {
  constructor(
    readonly settingKey: string,
    message: string,
  ) {
    super(message);
    this.name = "SettingValidationError";
  }
}

const KEY_PREFIX = "config:";

type Common<T extends SettingValue> = {
  name: string;
  env: string;
  group: SettingGroup;
  label: string;
  description: string;
  default: T;
};

function reject(key: string, message: string): never {
  throw new SettingValidationError(key, message);
}

export function booleanSetting(spec: Common<boolean>): SettingDefinition<boolean> {
  const key = `${KEY_PREFIX}${spec.name}`;
  const parse = (value: unknown): boolean => {
    if (typeof value === "boolean") return value;
    // The form posts checkboxes as strings, and the environment has nothing else to offer.
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (["true", "1", "yes", "on"].includes(normalized)) return true;
      if (["false", "0", "no", "off", ""].includes(normalized)) return false;
    }
    return reject(key, `${spec.label} must be true or false`);
  };
  return { ...spec, key, parse, fromEnv: parse };
}

export function stringSetting(
  spec: Common<string> & { maxLength?: number; pattern?: RegExp; patternHint?: string },
): SettingDefinition<string> {
  const key = `${KEY_PREFIX}${spec.name}`;
  const maxLength = spec.maxLength ?? 2048;
  const parse = (value: unknown): string => {
    if (value === null || value === undefined) return spec.default;
    if (typeof value !== "string") return reject(key, `${spec.label} must be text`);
    const trimmed = value.trim();
    if (trimmed.length > maxLength) {
      return reject(key, `${spec.label} must be ${maxLength} characters or fewer`);
    }
    // A control character reaches a Caddy config or an HTTP header intact, so it is refused here
    // rather than wherever it lands.
    if (hasForbiddenControlCharacter(trimmed)) {
      return reject(key, `${spec.label} contains a control character`);
    }
    if (trimmed !== "" && spec.pattern && !spec.pattern.test(trimmed)) {
      return reject(key, `${spec.label} ${spec.patternHint ?? "is not valid"}`);
    }
    return trimmed;
  };
  return { ...spec, key, parse, fromEnv: parse };
}

export function secretSetting(spec: Common<string> & { maxLength?: number }) {
  return { ...stringSetting({ ...spec, maxLength: spec.maxLength ?? 16 * 1024 }), secret: true };
}

export function numberSetting(
  spec: Common<number> & { min: number; max: number },
): SettingDefinition<number> {
  const key = `${KEY_PREFIX}${spec.name}`;
  const parse = (value: unknown): number => {
    const numeric = typeof value === "string" ? Number(value.trim()) : value;
    if (typeof numeric !== "number" || !Number.isFinite(numeric) || !Number.isInteger(numeric)) {
      return reject(key, `${spec.label} must be a whole number`);
    }
    if (numeric < spec.min || numeric > spec.max) {
      return reject(key, `${spec.label} must be between ${spec.min} and ${spec.max}`);
    }
    return numeric;
  };
  return { ...spec, key, parse, fromEnv: parse };
}

/**
 * A tri-state toggle: true, false, or null meaning "no opinion, let the stored policy decide".
 *
 * Several `AUTH_*` variables work this way today — unset defers to a Settings toggle, and setting
 * them pins the policy and locks it. Migrating them into the database is what finally removes the
 * distinction, but until then the shape has to survive the move.
 */
export function optionalBooleanSetting(
  spec: Omit<Common<boolean | null>, "default">,
): SettingDefinition<boolean | null> {
  const key = `${KEY_PREFIX}${spec.name}`;
  const parse = (value: unknown): boolean | null => {
    if (value === null || value === undefined || value === "") return null;
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (normalized === "") return null;
      if (["true", "1", "yes", "on"].includes(normalized)) return true;
      if (["false", "0", "no", "off"].includes(normalized)) return false;
    }
    return reject(key, `${spec.label} must be true, false, or left unset`);
  };
  return { ...spec, key, default: null, parse, fromEnv: parse };
}

const URL_PATTERN = /^https?:\/\/[^\s]+$/;

// ── Application ──────────────────────────────────────────────────────────────

export const appName = stringSetting({
  name: "app_name",
  env: "APP_NAME",
  group: "application",
  label: "Application name",
  description: "Shown in the sidebar, on the login card, and as the suffix on every page title.",
  default: "Caddy Proxy Manager",
  maxLength: 128,
});

export const baseUrl = stringSetting({
  name: "base_url",
  env: "BASE_URL",
  group: "application",
  label: "Public URL",
  description:
    "The address users reach this instance at. OAuth redirect URIs are built from it, so it must " +
    "match what the provider has registered.",
  default: "http://localhost:3000",
  pattern: URL_PATTERN,
  patternHint: "must start with http:// or https://",
  maxLength: 512,
});

export const caddyApiUrl = stringSetting({
  name: "caddy_api_url",
  env: "CADDY_API_URL",
  group: "application",
  label: "Caddy admin API",
  description:
    "Where Caddy's admin API is reachable, for a deployment running Caddy with no agent. " +
    "With an agent, every admin call is proxied through it and this is not used.",
  default: "http://caddy:2019",
  pattern: URL_PATTERN,
  patternHint: "must start with http:// or https://",
  maxLength: 512,
});

export const gravatarEnabled = booleanSetting({
  name: "avatar_gravatar",
  env: "AVATAR_GRAVATAR",
  group: "application",
  label: "Gravatar fallback",
  description:
    "Let user icons fall back to gravatar.com, which the browser fetches directly. Turn off to " +
    "keep every avatar lookup off the network.",
  default: true,
});

export const forwardAuthInternalUrl = stringSetting({
  name: "forward_auth_internal_url",
  env: "FORWARD_AUTH_INTERNAL_URL",
  group: "application",
  label: "Internal forward-auth address",
  description:
    "The address Caddy uses to reach this app for forward_auth. Derived from the container " +
    "network when empty; set it only if that derivation is wrong.",
  default: "",
  pattern: URL_PATTERN,
  patternHint: "must start with http:// or https://",
  maxLength: 512,
});

export const caddyBuildTimeout = numberSetting({
  name: "caddy_build_timeout",
  env: "CADDY_BUILD_TIMEOUT",
  group: "application",
  label: "Caddy build timeout (seconds)",
  description:
    "How long to wait for an xcaddy rebuild before giving up. Caddy compiles from source, so slow " +
    "or ARM hosts can take considerably longer than the default.",
  default: 1800,
  min: 60,
  max: 24 * 60 * 60,
});

// ── Authentication ───────────────────────────────────────────────────────────

export const allowSelfRegistration = booleanSetting({
  name: "auth_allow_self_registration",
  env: "AUTH_ALLOW_SELF_REGISTRATION",
  group: "authentication",
  label: "Allow self-registration",
  description: "Let anyone create an account with an email address and password.",
  default: false,
});

export const allowOauthRegistration = booleanSetting({
  name: "auth_allow_oauth_registration",
  env: "AUTH_ALLOW_OAUTH_REGISTRATION",
  group: "authentication",
  label: "Allow OAuth registration",
  description:
    "Let a first-time OAuth identity create an account. Separate from self-registration: with " +
    "this off, existing users can still sign in and link.",
  default: false,
});

export const allowOauthRoleFromClaims = booleanSetting({
  name: "auth_allow_oauth_role_from_claims",
  env: "AUTH_ALLOW_OAUTH_ROLE_FROM_CLAIMS",
  group: "authentication",
  label: "Trust IdP role claims",
  description:
    "Let the provider's claims set a new user's role and status. With this off they are forced to " +
    "user/active regardless of what the IdP sends. Only enable it for an IdP you control.",
  default: false,
});

export const disableLocalUsers = booleanSetting({
  name: "auth_disable_local_users",
  env: "AUTH_DISABLE_LOCAL_USERS",
  group: "authentication",
  label: "OIDC-only mode",
  description:
    "Remove local accounts entirely: no credential sign-in, no password management, no bootstrap " +
    "admin. Enable only once OAuth sign-in is confirmed working.",
  default: false,
});

export const trustHost = booleanSetting({
  name: "auth_trust_host",
  env: "AUTH_TRUST_HOST",
  group: "authentication",
  label: "Trust the Host header",
  description:
    "Build URLs from the request's Host header. Only behind a proxy that rewrites it, and only " +
    "when the public URL above cannot cover the setup.",
  default: false,
});

export const requirePasswordChangeOnLegacyHash = optionalBooleanSetting({
  name: "auth_require_password_change_on_legacy_hash",
  env: "AUTH_REQUIRE_PASSWORD_CHANGE_ON_LEGACY_HASH",
  group: "authentication",
  label: "Force a reset for legacy password hashes",
  description:
    "Require anyone still on a pre-argon2id bcrypt hash to change their password. Leave unset to " +
    "let the Security toggle decide.",
});

export const authRateLimitEnabled = booleanSetting({
  name: "auth_rate_limit_enabled",
  env: "AUTH_RATE_LIMIT_ENABLED",
  group: "authentication",
  label: "Rate-limit auth requests",
  description: "Throttle requests to the auth endpoints. Separate from the login throttle below.",
  default: true,
});

export const authRateLimitWindow = numberSetting({
  name: "auth_rate_limit_window",
  env: "AUTH_RATE_LIMIT_WINDOW",
  group: "authentication",
  label: "Auth rate-limit window (seconds)",
  description: "The period over which auth requests are counted.",
  default: 60,
  min: 1,
  max: 86_400,
});

export const authRateLimitMax = numberSetting({
  name: "auth_rate_limit_max",
  env: "AUTH_RATE_LIMIT_MAX",
  group: "authentication",
  label: "Auth requests per window",
  description: "How many auth requests one client may make before being throttled.",
  default: 5,
  min: 1,
  max: 10_000,
});

export const loginMaxAttempts = numberSetting({
  name: "login_max_attempts",
  env: "LOGIN_MAX_ATTEMPTS",
  group: "authentication",
  label: "Failed logins before lockout",
  description: "How many failed sign-ins one client may make before it is blocked.",
  default: 5,
  min: 1,
  max: 1000,
});

export const loginWindowMs = numberSetting({
  name: "login_window_ms",
  env: "LOGIN_WINDOW_MS",
  group: "authentication",
  label: "Login window (milliseconds)",
  description: "The period over which failed sign-ins are counted.",
  default: 300_000,
  min: 1000,
  max: 24 * 60 * 60 * 1000,
});

export const loginBlockMs = numberSetting({
  name: "login_block_ms",
  env: "LOGIN_BLOCK_MS",
  group: "authentication",
  label: "Lockout duration (milliseconds)",
  description: "How long a blocked client stays blocked.",
  default: 900_000,
  min: 1000,
  max: 24 * 60 * 60 * 1000,
});

// ── Analytics ────────────────────────────────────────────────────────────────

export const clickhouseUrl = stringSetting({
  name: "clickhouse_url",
  env: "CLICKHOUSE_URL",
  group: "analytics",
  label: "ClickHouse URL",
  description: "Where the analytics database is reachable.",
  default: "http://clickhouse:8123",
  pattern: URL_PATTERN,
  patternHint: "must start with http:// or https://",
  maxLength: 512,
});

export const clickhouseUser = stringSetting({
  name: "clickhouse_user",
  env: "CLICKHOUSE_USER",
  group: "analytics",
  label: "ClickHouse user",
  description: "The account traffic and WAF events are written as.",
  default: "cpm",
  maxLength: 128,
});

export const clickhousePassword = secretSetting({
  name: "clickhouse_password",
  env: "CLICKHOUSE_PASSWORD",
  group: "analytics",
  label: "ClickHouse password",
  description: "Leave empty to disable analytics entirely.",
  default: "",
});

export const clickhouseDb = stringSetting({
  name: "clickhouse_db",
  env: "CLICKHOUSE_DB",
  group: "analytics",
  label: "ClickHouse database",
  description: "The database traffic and WAF events are written to.",
  default: "analytics",
  maxLength: 128,
});

export const clickhouseRetentionDays = numberSetting({
  name: "clickhouse_retention_days",
  env: "CLICKHOUSE_RETENTION_DAYS",
  group: "analytics",
  label: "Analytics retention (days)",
  description:
    "How long traffic and WAF events are kept. Lowering it uses less disk, and migrates the " +
    "existing tables' TTL on the next start.",
  default: 30,
  min: 1,
  max: 3650,
});

// ── GeoIP ────────────────────────────────────────────────────────────────────

export const geoipAccountId = stringSetting({
  name: "geoipupdate_account_id",
  env: "GEOIPUPDATE_ACCOUNT_ID",
  group: "geoip",
  label: "MaxMind account ID",
  description: "Needed to download GeoLite2 databases, which geo blocking depends on.",
  default: "",
  maxLength: 128,
});

export const geoipLicenseKey = secretSetting({
  name: "geoipupdate_license_key",
  env: "GEOIPUPDATE_LICENSE_KEY",
  group: "geoip",
  label: "MaxMind license key",
  description: "Issued alongside the account ID at maxmind.com.",
  default: "",
});

/** Every definition, in the order the setup and settings pages render them. */
export const SETTING_DEFINITIONS = [
  appName,
  baseUrl,
  caddyApiUrl,
  gravatarEnabled,
  forwardAuthInternalUrl,
  caddyBuildTimeout,
  allowSelfRegistration,
  allowOauthRegistration,
  allowOauthRoleFromClaims,
  disableLocalUsers,
  trustHost,
  requirePasswordChangeOnLegacyHash,
  authRateLimitEnabled,
  authRateLimitWindow,
  authRateLimitMax,
  loginMaxAttempts,
  loginWindowMs,
  loginBlockMs,
  clickhouseUrl,
  clickhouseUser,
  clickhousePassword,
  clickhouseDb,
  clickhouseRetentionDays,
  geoipAccountId,
  geoipLicenseKey,
] as const satisfies readonly SettingDefinition[];

export const SETTINGS_BY_KEY: ReadonlyMap<string, SettingDefinition> = new Map(
  SETTING_DEFINITIONS.map((definition) => [definition.key, definition]),
);

export const SETTINGS_BY_ENV: ReadonlyMap<string, SettingDefinition> = new Map(
  SETTING_DEFINITIONS.map((definition) => [definition.env, definition]),
);

export const SETTING_GROUPS: readonly SettingGroup[] = [
  "application",
  "authentication",
  "analytics",
  "geoip",
];
