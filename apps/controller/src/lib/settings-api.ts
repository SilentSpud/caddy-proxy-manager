/**
 * Settings groups as the operator APIs see them: `/api/v1/settings/[group]` and GraphQL's
 * `settings` / `saveSettings`.
 *
 * One implementation, because the two used to disagree. GraphQL read the group name as a storage
 * key - so it could read any row, secrets included - and saved the same way, which wrote orphan
 * rows for hyphenated groups, skipped each group's own saver (and the encryption inside it) and
 * never applied the result to Caddy.
 */

import { applyCaddyConfig } from "./caddy";
import { logUnexpectedApiError } from "./api-auth";
import { redactTailscaleSettingsForApi } from "./caddy-tailscale";
import {
  redactDnsProviderSettingsForApi,
  redactLegacyCloudflareSettingsForApi,
} from "./dns-providers";
import {
  getGeneralSettings,
  saveGeneralSettings,
  getAcmeSettings,
  saveAcmeSettings,
  getCloudflareSettings,
  saveCloudflareSettings,
  getAuthentikSettings,
  saveAuthentikSettings,
  getForwardAuthSettings,
  saveForwardAuthSettings,
  getMetricsSettings,
  saveMetricsSettings,
  getLoggingSettings,
  saveLoggingSettings,
  getDnsSettings,
  saveDnsSettings,
  getDnsProviderSettings,
  saveDnsProviderSettings,
  getUpstreamDnsResolutionSettings,
  saveUpstreamDnsResolutionSettings,
  getGeoBlockSettings,
  saveGeoBlockSettings,
  getWafSettings,
  saveWafSettings,
  getErrorPagesSettings,
  saveErrorPagesSettings,
  getDefaultResponseSettings,
  saveDefaultResponseSettings,
  getTrustedProxiesSettings,
  getHttpProtocolsSettings,
  saveTrustedProxiesSettings,
  saveHttpProtocolsSettings,
  getTailscaleSettings,
  saveTailscaleSettings,
  defaultTailscaleSettings,
  getSetting,
  setSetting,
  clearSetting,
  type CloudflareSettings,
  type DnsProviderSettings,
  type TailscaleSettings,
} from "./settings";
import { SettingsValidationError, validateSettingsGroup } from "./settings-validation";
import { withSettingsUpdateLock } from "./settings-update-lock";

type SettingsHandler = {
  get: () => Promise<unknown>;
  save: (data: never) => Promise<void>;
  storageKey: string;
  applyCaddy?: boolean;
  /** Present for a group holding credentials; its output is what a client sees instead. */
  redact?: (value: never) => unknown;
};

const SETTINGS_HANDLERS: Record<string, SettingsHandler> = {
  general: {
    get: getGeneralSettings,
    save: saveGeneralSettings as (data: never) => Promise<void>,
    storageKey: "general",
    applyCaddy: true,
  },
  acme: {
    get: getAcmeSettings,
    save: saveAcmeSettings as (data: never) => Promise<void>,
    storageKey: "acme",
    applyCaddy: true,
  },
  cloudflare: {
    get: getCloudflareSettings,
    save: saveCloudflareSettings as (data: never) => Promise<void>,
    storageKey: "cloudflare",
    applyCaddy: true,
    redact: (value: CloudflareSettings) => redactLegacyCloudflareSettingsForApi(value),
  },
  authentik: {
    get: getAuthentikSettings,
    save: saveAuthentikSettings as (data: never) => Promise<void>,
    storageKey: "authentik",
    applyCaddy: true,
  },
  "forward-auth": {
    get: getForwardAuthSettings,
    save: saveForwardAuthSettings as (data: never) => Promise<void>,
    storageKey: "forward_auth",
    // Nothing in the generated config reads it - it only seeds the host form - but the apply is
    // what pushes the new value to the agents, and every other group here does the same.
    applyCaddy: true,
  },
  metrics: {
    get: getMetricsSettings,
    save: saveMetricsSettings as (data: never) => Promise<void>,
    storageKey: "metrics",
    applyCaddy: true,
  },
  logging: {
    get: getLoggingSettings,
    save: saveLoggingSettings as (data: never) => Promise<void>,
    storageKey: "logging",
    applyCaddy: true,
  },
  dns: {
    get: getDnsSettings,
    save: saveDnsSettings as (data: never) => Promise<void>,
    storageKey: "dns",
    applyCaddy: true,
  },
  "dns-provider": {
    get: getDnsProviderSettings,
    save: saveDnsProviderSettings as (data: never) => Promise<void>,
    storageKey: "dns_provider",
    applyCaddy: true,
    redact: (value: DnsProviderSettings) => redactDnsProviderSettingsForApi(value),
  },
  "upstream-dns": {
    get: getUpstreamDnsResolutionSettings,
    save: saveUpstreamDnsResolutionSettings as (data: never) => Promise<void>,
    storageKey: "upstream_dns_resolution",
    applyCaddy: true,
  },
  geoblock: {
    get: getGeoBlockSettings,
    save: saveGeoBlockSettings as (data: never) => Promise<void>,
    storageKey: "geoblock",
    applyCaddy: true,
  },
  waf: {
    get: getWafSettings,
    save: saveWafSettings as (data: never) => Promise<void>,
    storageKey: "waf",
    applyCaddy: true,
  },
  "error-pages": {
    get: getErrorPagesSettings,
    save: saveErrorPagesSettings as (data: never) => Promise<void>,
    storageKey: "error_pages",
    applyCaddy: true,
  },
  "default-response": {
    get: async () => (await getDefaultResponseSettings()) ?? { mode: "caddy" },
    save: saveDefaultResponseSettings as (data: never) => Promise<void>,
    storageKey: "default_response",
    applyCaddy: true,
  },
  "trusted-proxies": {
    get: getTrustedProxiesSettings,
    save: saveTrustedProxiesSettings as (data: never) => Promise<void>,
    storageKey: "trusted_proxies",
    applyCaddy: true,
  },
  "http-protocols": {
    get: getHttpProtocolsSettings,
    save: saveHttpProtocolsSettings as (data: never) => Promise<void>,
    storageKey: "http_protocols",
    applyCaddy: true,
  },
  tailscale: {
    // Defaulted rather than null, so a GET before anything is saved still describes the shape a
    // PUT has to send - the node name in particular, which hosts inherit.
    get: async () => (await getTailscaleSettings()) ?? defaultTailscaleSettings(),
    save: saveTailscaleSettings as (data: never) => Promise<void>,
    storageKey: "tailscale",
    applyCaddy: true,
    redact: (value: TailscaleSettings) => redactTailscaleSettingsForApi(value),
  },
};

/** Own keys only: a group named `constructor` must not find Object's. */
export function isSettingsGroup(group: string): boolean {
  return Object.hasOwn(SETTINGS_HANDLERS, group);
}

/** A save that validated and was stored, but Caddy refused. The message is safe to show. */
export class SettingsApplyError extends Error {
  constructor(
    message: string,
    readonly status: 500 | 502,
  ) {
    super(message);
    this.name = "SettingsApplyError";
  }
}

/**
 * A group's value as an API client may see it, or null for a group that does not exist.
 * `sensitive` marks a redacted credential group, which must not be cached on the way out.
 */
export async function readSettingsGroup(
  group: string,
): Promise<{ value: unknown; sensitive: boolean } | null> {
  if (!isSettingsGroup(group)) return null;
  const handler = SETTINGS_HANDLERS[group];
  const value = await handler.get();
  if (handler.redact && value) {
    return { value: handler.redact(value as never), sensitive: true };
  }
  return { value: value ?? {}, sensitive: false };
}

/**
 * Validate, save and apply one group, rolling the stored value back if Caddy refuses it.
 *
 * Throws `SettingsValidationError` or `DefaultResponseValidationError` for a payload or group it
 * refuses, and `SettingsApplyError` when the apply fails. Callers answer an unknown group first.
 */
export async function saveSettingsGroup(group: string, input: unknown): Promise<void> {
  if (!isSettingsGroup(group)) {
    throw new SettingsValidationError("Unknown settings group");
  }
  const handler = SETTINGS_HANDLERS[group];
  const validated = validateSettingsGroup(group, input);

  await withSettingsUpdateLock(async () => {
    // Preserve the exact local stored value (including encrypted credentials),
    // rather than the effective or redacted GET representation, for rollback.
    const previousValue = await getSetting<unknown>(handler.storageKey);
    await handler.save(validated as never);

    if (!handler.applyCaddy) return;
    try {
      await applyCaddyConfig();
    } catch (applyError) {
      logUnexpectedApiError("Caddy settings apply failed", applyError);
      try {
        if (previousValue === null || previousValue === undefined) {
          await clearSetting(handler.storageKey);
        } else {
          await setSetting(handler.storageKey, previousValue);
        }
      } catch (rollbackError) {
        logUnexpectedApiError("Settings rollback failed", rollbackError);
        throw new SettingsApplyError(
          "Failed to apply Caddy configuration and roll back settings",
          500,
        );
      }

      // Caddy's load is atomic, but a failure may also happen after load while
      // synchronizing instances. Best-effort reapply confirms the active
      // configuration matches the restored database state.
      try {
        await applyCaddyConfig();
      } catch (restoreApplyError) {
        logUnexpectedApiError("Previous Caddy settings reapply failed", restoreApplyError);
      }

      throw new SettingsApplyError(
        "Failed to apply Caddy configuration; settings were rolled back",
        502,
      );
    }
  });
}
