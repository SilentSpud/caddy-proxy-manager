/**
 * The two optional features, as the Settings page reads and writes them.
 *
 * Analytics and GeoIP are the only settings whose value decides whether a *container* runs, so they
 * need more than the registry's read/write: saving one has to drop the ClickHouse client's cached
 * configuration, re-push the fleet credentials, and ask the agents to start or stop the service.
 * That sequence is here rather than in the server action so the ordering is stated once.
 */

import { geoipEnabled, installedGeoipEditions } from "../agent/geoip";
import { isAnalyticsEnabled } from "../clickhouse/client";
import * as registry from "./registry";
import { resolveSetting, saveSettings, type SettingSource } from "./resolve";

export type AnalyticsView = {
  enabled: boolean;
  /** True while nothing is stored, so `enabled` was inferred from whether a password is set. */
  inferred: boolean;
  /** Where the toggle's value came from, so the page can say a variable is still overriding it. */
  source: SettingSource;
  url: string;
  user: string;
  database: string;
  retentionDays: number;
  /** Whether a password exists. The value itself never reaches the browser. */
  hasPassword: boolean;
};

export type GeoipView = {
  enabled: boolean;
  inferred: boolean;
  source: SettingSource;
  accountId: string;
  hasLicenseKey: boolean;
  /** Which MaxMind databases are on disk right now. Empty before geoipupdate's first run. */
  installedEditions: string[];
};

export async function analyticsView(): Promise<AnalyticsView> {
  const [toggle, enabled, url, user, database, retentionDays, password] = await Promise.all([
    resolveSetting(registry.analyticsEnabled),
    isAnalyticsEnabled(),
    resolveSetting(registry.clickhouseUrl),
    resolveSetting(registry.clickhouseUser),
    resolveSetting(registry.clickhouseDb),
    resolveSetting(registry.clickhouseRetentionDays),
    resolveSetting(registry.clickhousePassword),
  ]);

  return {
    enabled,
    inferred: toggle.value === null,
    source: toggle.source,
    url: url.value,
    user: user.value,
    database: database.value,
    retentionDays: retentionDays.value,
    hasPassword: password.value.trim().length > 0,
  };
}

export async function geoipView(): Promise<GeoipView> {
  const [toggle, enabled, accountId, licenseKey] = await Promise.all([
    resolveSetting(registry.geoipEnabled),
    geoipEnabled(),
    resolveSetting(registry.geoipAccountId),
    resolveSetting(registry.geoipLicenseKey),
  ]);

  return {
    enabled,
    inferred: toggle.value === null,
    source: toggle.source,
    accountId: accountId.value,
    hasLicenseKey: licenseKey.value.trim().length > 0,
    installedEditions: installedGeoipEditions(),
  };
}

/**
 * The effective on/off for every gated feature, keyed by setting.
 *
 * A form showing a switch needs a boolean, and the stored value for these is tri-state — unset
 * meaning "infer it". Resolving that here is what makes the setup form open with analytics already
 * on for a deployment that arrived with a ClickHouse password in its `.env`, rather than presenting
 * a switch that is off and inviting the operator to turn off something already running.
 */
export async function gateDefaults(): Promise<Record<string, boolean>> {
  const [analytics, geoip] = await Promise.all([isAnalyticsEnabled(), geoipEnabled()]);
  return {
    [registry.analyticsEnabled.key]: analytics,
    [registry.geoipEnabled.key]: geoip,
  };
}

/**
 * Push the new configuration everywhere it is cached or acted on.
 *
 * Order matters and is the reason this is one function: the ClickHouse client has to forget the old
 * credentials before anything reads them back, the agents have to be told where to write before
 * they are told to start writing, and the container has to come up last because the two steps
 * before it are what make it useful.
 *
 * Exported because the setup flow writes the same settings through `saveSettings` directly, and
 * without this it would finish with the containers still stopped and the client still holding the
 * configuration it resolved before the operator filled the form in.
 */
export async function propagateOptionalFeatureSettings(): Promise<void> {
  const [{ invalidateClickHouseConfig }, { pushFleetConfig }, { applyManagedServices }] =
    await Promise.all([
      import("../clickhouse/client"),
      import("../agent/fleet-config"),
      import("../agent/managed-services"),
    ]);

  await invalidateClickHouseConfig();
  await pushFleetConfig();
  await applyManagedServices();
}

/**
 * Save the analytics settings.
 *
 * An empty password means "leave the stored one alone", because the form never receives the current
 * value to send back — the alternative is a page that wipes the credential every time someone
 * changes the retention.
 */
export async function saveAnalyticsSettings(input: {
  enabled: boolean;
  url: string;
  user: string;
  password: string;
  database: string;
  retentionDays: number;
}): Promise<void> {
  const values: Record<string, unknown> = {
    // Written as an explicit boolean, never back to null: the tri-state exists for a deployment
    // that has never been through this page, and this is that page.
    [registry.analyticsEnabled.key]: input.enabled,
    [registry.clickhouseUrl.key]: input.url,
    [registry.clickhouseUser.key]: input.user,
    [registry.clickhouseDb.key]: input.database,
    [registry.clickhouseRetentionDays.key]: input.retentionDays,
  };
  if (input.password.trim().length > 0) {
    values[registry.clickhousePassword.key] = input.password;
  }

  await saveSettings(values);
  await propagateOptionalFeatureSettings();
}

export async function saveGeoipSettings(input: {
  enabled: boolean;
  accountId: string;
  licenseKey: string;
}): Promise<void> {
  const values: Record<string, unknown> = {
    [registry.geoipEnabled.key]: input.enabled,
    [registry.geoipAccountId.key]: input.accountId,
  };
  if (input.licenseKey.trim().length > 0) {
    values[registry.geoipLicenseKey.key] = input.licenseKey;
  }

  await saveSettings(values);
  await propagateOptionalFeatureSettings();
}
