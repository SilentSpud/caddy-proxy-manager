import db, { nowIso } from "./db";
import { settings } from "./db/schema";
import { eq } from "drizzle-orm";
import { sanitizeErrorPageRules, type ErrorPageRule } from "./models/proxy-hosts";
import type { CaddyCustomModule } from "./caddy-modules";
import {
  normalizeDefaultResponseSettings,
  type DefaultResponseSettings,
} from "./caddy-default-response";

export type { DefaultResponseSettings } from "./caddy-default-response";

export type SettingValue<T> = T | null;

export type CloudflareSettings = {
  apiToken: string;
  zoneId?: string;
  accountId?: string;
};

export type GeneralSettings = {
  primaryDomain: string;
  acmeEmail?: string;
};

export type AvatarSettings = {
  /** Fall back to Gravatar for users who have no icon of their own. */
  gravatarEnabled: boolean;
};

export type PasswordPolicySettings = {
  /** Force a password reset for anyone still on bcrypt; changing it rehashes with argon2id. */
  requireChangeOnLegacyHash: boolean;
};

export type AcmeSettings = {
  /** Custom ACME directory URL (e.g. an internal CA). Empty = Let's Encrypt default. */
  caUrl?: string;
  /** PEM-encoded trusted root for the ACME CA's HTTPS endpoint, if not in the system trust store. */
  caRootPem?: string;
};

export type AuthentikSettings = {
  outpostDomain: string;
  outpostUpstream: string;
  authEndpoint?: string;
};

export type MetricsSettings = {
  enabled: boolean;
  port?: number; // Port to expose metrics on (default: 9090, separate from admin API)
};

export type LoggingSettings = {
  enabled: boolean;
  format?: "json" | "console"; // Log format (default: json)
};

export type TrustedProxiesSettings = {
  // Proxy ranges to trust for X-Forwarded-For / client IP resolution at the server level
  // (Caddy `trusted_proxies`). Accepts CIDRs, bare IPs, and the "private_ranges" shorthand.
  // Empty = disabled (current behaviour).
  ranges: string[];
  // Headers Caddy reads the real client IP from (Caddy `client_ip_headers`). Empty = Caddy's
  // X-Forwarded-For default; useful for e.g. Cf-Connecting-Ip.
  client_ip_headers?: string[];
  // Only trust client_ip_headers from the configured proxies, rejecting spoofed values from
  // untrusted peers (Caddy `trusted_proxies_strict`).
  strict?: boolean;
  // When true, use `ranges` as the default trusted-proxy list for global geoblocking so the
  // two settings can't silently disagree.
  default_geoblock?: boolean;
};

export type DnsSettings = {
  enabled: boolean;
  resolvers: string[]; // Primary DNS resolvers (e.g., "1.1.1.1", "9.9.9.9")
  fallbacks?: string[]; // Fallback DNS resolvers if primary fails
  timeout?: string; // DNS query timeout (e.g., "5s")
};

export type DnsProviderSettings = {
  /** Configured providers: keyed by provider name, value is credential map */
  providers: Record<string, Record<string, string>>;
  /** Name of the default provider (null = no DNS-01 challenges) */
  default: string | null;
};

export type UpstreamDnsAddressFamily = "ipv6" | "ipv4" | "both";

export type UpstreamDnsResolutionSettings = {
  enabled: boolean;
  family: UpstreamDnsAddressFamily;
};

export type GeoBlockSettings = {
  enabled: boolean;

  // Block rules
  block_countries: string[]; // ISO 3166-1 alpha-2, e.g. ["CN", "RU"]
  block_continents: string[]; // AF, AN, AS, EU, NA, OC, SA
  block_asns: number[];
  block_cidrs: string[];
  block_ips: string[];

  // Allow rules (win over block rules)
  allow_countries: string[];
  allow_continents: string[];
  allow_asns: number[];
  allow_cidrs: string[];
  allow_ips: string[];

  // Trusted proxies for X-Forwarded-For parsing
  trusted_proxies: string[];
  // When true, block requests whose real client IP cannot be determined (e.g. from a trusted
  // proxy with no usable XFF entry). Default: false (fail-open).
  fail_closed: boolean;

  // Block response customization
  response_status: number; // default 403
  response_body: string; // default "Forbidden"
  response_headers: Record<string, string>;
  redirect_url: string; // if set, 302 redirect instead of status/body
};

export async function getSetting<T>(key: string): Promise<SettingValue<T>> {
  const setting = await db.query.settings.findFirst({
    where: (table, { eq }) => eq(table.key, key),
  });

  if (!setting) {
    return null;
  }

  try {
    return JSON.parse(setting.value) as T;
  } catch (error) {
    console.warn(`Failed to parse setting ${key}`, error);
    return null;
  }
}

export async function setSetting<T>(key: string, value: T): Promise<void> {
  const payload = JSON.stringify(value);
  const now = nowIso();

  await db
    .insert(settings)
    .values({
      key,
      value: payload,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: settings.key,
      set: {
        value: payload,
        updatedAt: now,
      },
    });
}

export async function clearSetting(key: string): Promise<void> {
  await db.delete(settings).where(eq(settings.key, key));
}

export async function getCloudflareSettings(): Promise<CloudflareSettings | null> {
  return await getSetting<CloudflareSettings>("cloudflare");
}

export async function saveCloudflareSettings(settings: CloudflareSettings): Promise<void> {
  await setSetting("cloudflare", settings);
}

export async function getGeneralSettings(): Promise<GeneralSettings | null> {
  return await getSetting<GeneralSettings>("general");
}

export async function saveGeneralSettings(settings: GeneralSettings): Promise<void> {
  await setSetting("general", settings);
}

export async function getAvatarSettings(): Promise<AvatarSettings | null> {
  // Effective, so an agent inherits its controller's choice unless it stored a local override.
  return await getSetting<AvatarSettings>("avatars");
}

export async function saveAvatarSettings(settings: AvatarSettings): Promise<void> {
  await setSetting("avatars", settings);
}

/**
 * Whether icons may fall back to Gravatar.
 *
 * Resolution is the registry first — a stored value, then AVATAR_GRAVATAR — and only then the
 * older JSON blob the Settings page used to write. The blob stays in the chain for deployments
 * that have not been through the migration, which is what lifts it into the registry key; without
 * that fallback, upgrading would silently reset the toggle.
 */
export async function isGravatarEnabled(): Promise<boolean> {
  const [{ gravatarEnabled }, { resolveSetting }] = await Promise.all([
    import("./settings/registry"),
    import("./settings/resolve"),
  ]);
  const resolved = await resolveSetting(gravatarEnabled);
  if (resolved.source !== "default") return resolved.value;

  const stored = await getAvatarSettings();
  return stored?.gravatarEnabled ?? gravatarEnabled.default;
}

export async function getPasswordPolicySettings(): Promise<PasswordPolicySettings | null> {
  return await getSetting<PasswordPolicySettings>("password_policy");
}

export async function savePasswordPolicySettings(settings: PasswordPolicySettings): Promise<void> {
  await setSetting("password_policy", settings);
}

/**
 * Whether a bcrypt-hashed user must change their password.
 *
 * Same order as isGravatarEnabled: the registry (stored, then the environment variable), then the
 * older JSON blob for deployments that have not migrated yet. This one is tri-state — null means
 * "no opinion", which is why an unset registry value has to fall through rather than read as false.
 */
export async function isLegacyPasswordChangeRequired(): Promise<boolean> {
  const [{ requirePasswordChangeOnLegacyHash }, { resolveSetting }] = await Promise.all([
    import("./settings/registry"),
    import("./settings/resolve"),
  ]);
  const resolved = await resolveSetting(requirePasswordChangeOnLegacyHash);
  if (resolved.value !== null) return resolved.value;

  const stored = await getPasswordPolicySettings();
  return stored?.requireChangeOnLegacyHash ?? false;
}

export async function getAcmeSettings(): Promise<AcmeSettings | null> {
  return await getSetting<AcmeSettings>("acme");
}

export async function saveAcmeSettings(settings: AcmeSettings): Promise<void> {
  await setSetting("acme", settings);
}

export async function getAuthentikSettings(): Promise<AuthentikSettings | null> {
  return await getSetting<AuthentikSettings>("authentik");
}

export async function saveAuthentikSettings(settings: AuthentikSettings): Promise<void> {
  await setSetting("authentik", settings);
}

export async function getMetricsSettings(): Promise<MetricsSettings | null> {
  return await getSetting<MetricsSettings>("metrics");
}

export async function saveMetricsSettings(settings: MetricsSettings): Promise<void> {
  await setSetting("metrics", settings);
}

export async function getLoggingSettings(): Promise<LoggingSettings | null> {
  return await getSetting<LoggingSettings>("logging");
}

export async function saveLoggingSettings(settings: LoggingSettings): Promise<void> {
  await setSetting("logging", settings);
}

export async function getTrustedProxiesSettings(): Promise<TrustedProxiesSettings | null> {
  return await getSetting<TrustedProxiesSettings>("trusted_proxies");
}

export async function saveTrustedProxiesSettings(settings: TrustedProxiesSettings): Promise<void> {
  await setSetting("trusted_proxies", settings);
}

export async function getDnsSettings(): Promise<DnsSettings | null> {
  return await getSetting<DnsSettings>("dns");
}

export async function saveDnsSettings(settings: DnsSettings): Promise<void> {
  await setSetting("dns", settings);
}

export async function getDnsProviderSettings(): Promise<DnsProviderSettings | null> {
  const raw = await getSetting<Record<string, unknown>>("dns_provider");
  if (!raw) return null;

  // Normalize the old single-provider { provider, credentials } shape into the multi-provider
  // { providers, default } shape.
  if ("provider" in raw && "credentials" in raw && !("providers" in raw)) {
    const name = raw.provider as string;
    const creds = raw.credentials as Record<string, string>;
    return { providers: { [name]: creds }, default: name };
  }

  return raw as unknown as DnsProviderSettings;
}

export async function saveDnsProviderSettings(settings: DnsProviderSettings): Promise<void> {
  await setSetting("dns_provider", settings);
}

export async function getUpstreamDnsResolutionSettings(): Promise<UpstreamDnsResolutionSettings | null> {
  return await getSetting<UpstreamDnsResolutionSettings>("upstream_dns_resolution");
}

export async function saveUpstreamDnsResolutionSettings(
  settings: UpstreamDnsResolutionSettings,
): Promise<void> {
  await setSetting("upstream_dns_resolution", settings);
}

export async function getGeoBlockSettings(): Promise<GeoBlockSettings | null> {
  return await getSetting<GeoBlockSettings>("geoblock");
}

export async function saveGeoBlockSettings(settings: GeoBlockSettings): Promise<void> {
  await setSetting("geoblock", settings);
}

export type WafSettings = {
  enabled: boolean;
  // Coraza's SecRuleEngine values. DetectionOnly is settable through the REST API (the UI only
  // offers Off/On); buildWafHandler rejects anything else.
  mode: "Off" | "On" | "DetectionOnly";
  load_owasp_crs: boolean;
  custom_directives: string;
  excluded_rule_ids?: number[];
  // Request body limits, in bytes. Unset means Coraza's own default applies
  // (12.5 MiB from @coraza.conf-recommended when load_owasp_crs is on, else
  // 128 MiB). Coraza caps both at 1 GiB — see CORAZA_MAX_BODY_LIMIT.
  request_body_limit?: number;
  request_body_in_memory_limit?: number;
  // ProcessPartial inspects the leading bytes and forwards the rest instead of
  // rejecting oversized uploads outright.
  request_body_limit_action?: "Reject" | "ProcessPartial";
};

export async function getWafSettings(): Promise<WafSettings | null> {
  return await getSetting<WafSettings>("waf");
}

export async function saveWafSettings(s: WafSettings): Promise<void> {
  await setSetting("waf", s);
}

// Global error pages, applied as fallback error routes across every proxy host. Per-host error
// pages take precedence over these.
export type ErrorPagesSettings = {
  rules: ErrorPageRule[];
};

export async function getErrorPagesSettings(): Promise<ErrorPagesSettings | null> {
  return await getSetting<ErrorPagesSettings>("error_pages");
}

export async function saveErrorPagesSettings(s: ErrorPagesSettings): Promise<void> {
  await setSetting("error_pages", { rules: sanitizeErrorPageRules(s?.rules) });
}

// ─── Caddy build ─────────────────────────────────────────────────────────────

/** Which Caddy plugins this deployment's image is built with. */
export type CaddyBuildSettings = {
  /** Built-in module id -> enabled. Absent ids fall back to enabled. */
  modules: Record<string, boolean>;
  customModules: CaddyCustomModule[];
};

export async function getCaddyBuildSettings(): Promise<CaddyBuildSettings | null> {
  return await getSetting<CaddyBuildSettings>("caddy_build");
}

export async function saveCaddyBuildSettings(s: CaddyBuildSettings): Promise<void> {
  await setSetting("caddy_build", s);
}

// Response for requests that do not match any configured proxy host. A missing
// setting (or mode "caddy") preserves Caddy's native routing/HTTPS behavior.
export async function getDefaultResponseSettings(): Promise<DefaultResponseSettings | null> {
  const value = await getSetting<unknown>("default_response");
  if (value === null) return null;

  try {
    return normalizeDefaultResponseSettings(value);
  } catch (error) {
    console.warn("Ignoring invalid default response settings", error);
    return null;
  }
}

export async function saveDefaultResponseSettings(value: DefaultResponseSettings): Promise<void> {
  await setSetting("default_response", normalizeDefaultResponseSettings(value));
}
