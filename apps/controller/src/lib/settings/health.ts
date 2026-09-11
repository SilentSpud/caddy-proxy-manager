/**
 * What each settings section is actually doing, for the tiles on the settings home.
 *
 * A tile that only repeated its section's description would be decoration. Every status here is
 * derived from a value this deployment holds - a provider that is set, a database that is on disk,
 * an agent that is connected - so "needs attention" means something checkable went wrong rather
 * than something being merely unconfigured.
 *
 * Nothing in here reads Caddy or the network. The page already gathers agent statuses, and a tile
 * grid that waited on a round trip per section would be slower than the page it replaced.
 */

import type { AnalyticsView, GeoipView } from "./optional-features";
import { storageKeysForSection } from "./section-keys";
import type {
  DnsProviderSettings,
  GeoBlockSettings,
  MetricsSettings,
  TrustedProxiesSettings,
  CaddyBuildSettings,
  DefaultResponseSettings,
} from "../settings";

export type SectionStatus = "ok" | "attention" | "unset" | "env";

export type SectionHealth = {
  /** Matches the section ids the settings navigation uses, so a tile links straight to it. */
  id: string;
  /** Display name, matching what the settings navigation calls the same section. */
  name: string;
  group: "traffic" | "access" | "runtime";
  status: SectionStatus;
  /** One line of current state. Rendered as-is; already translated by the caller where needed. */
  value: string;
  /** Why it needs attention, when it does. */
  detail?: string;
  /** True when this section holds part of the viewer's staged change set. */
  staged?: boolean;
};

export type HealthInput = {
  dnsProvider: DnsProviderSettings | null;
  acmeConfigured: boolean;
  certificateCount: number;
  trustedProxies: TrustedProxiesSettings | null;
  defaultResponse: DefaultResponseSettings | null;
  geoBlock: GeoBlockSettings | null;
  geoip: GeoipView;
  analytics: AnalyticsView;
  metrics: MetricsSettings | null;
  caddyBuild: CaddyBuildSettings | null;
  oauthProviderCount: number;
  agentsConnected: number;
  agentsPaired: number;
  stagedKeys: ReadonlySet<string>;
  /** Injected so staleness is a pure function of its input rather than of the wall clock. */
  now?: number;
};

export function sectionHealth(input: HealthInput): SectionHealth[] {
  const staged = (id: string) => storageKeysForSection(id).some((key) => input.stagedKeys.has(key));

  const sections: SectionHealth[] = [];

  const providers = Object.keys(input.dnsProvider?.providers ?? {});
  const activeProvider = input.dnsProvider?.default ?? null;
  sections.push({
    id: "dns-providers",
    name: "DNS Providers",
    group: "traffic",
    status: activeProvider ? "ok" : "unset",
    value: activeProvider
      ? `${activeProvider}${providers.length > 1 ? ` and ${providers.length - 1} more` : ""}`
      : "No provider - DNS-01 unavailable",
    detail: activeProvider
      ? undefined
      : "Wildcard certificates and internal-only hosts need a DNS provider to solve the challenge.",
    staged: staged("dns-providers"),
  });

  sections.push({
    id: "acme",
    name: "ACME Server",
    group: "traffic",
    status: "ok",
    value: input.acmeConfigured
      ? `Custom directory - ${input.certificateCount} certificates`
      : `Let's Encrypt - ${input.certificateCount} certificates`,
    staged: staged("acme"),
  });

  const ranges = input.trustedProxies?.ranges ?? [];
  // The pairing that actually misleads people: geo-block reads the client IP, and without a
  // trusted-proxy range behind another proxy every request looks like it came from that proxy.
  const geoBlockNeedsProxies = Boolean(input.geoBlock?.enabled) && ranges.length === 0;
  sections.push({
    id: "trusted-proxies",
    name: "Trusted Proxies",
    group: "traffic",
    status: geoBlockNeedsProxies ? "attention" : ranges.length > 0 ? "ok" : "unset",
    value: ranges.length > 0 ? `${ranges.length} ranges trusted` : "No ranges trusted",
    detail: geoBlockNeedsProxies
      ? "Geo-Block is on but no proxy ranges are trusted, so every request is matched on the address Caddy sees, not the real client IP."
      : undefined,
    staged: staged("trusted-proxies"),
  });

  const hasDefaultResponse = Boolean(input.defaultResponse);
  sections.push({
    id: "default-response",
    name: "Default Response",
    group: "traffic",
    status: hasDefaultResponse ? "ok" : "unset",
    value: hasDefaultResponse ? "Configured" : "Not set",
    detail: hasDefaultResponse
      ? undefined
      : "Requests for unknown hostnames and direct IP hits fall through to the first matching host.",
    staged: staged("default-response"),
  });

  sections.push({
    id: "oauth",
    name: "OAuth Providers",
    group: "access",
    status: input.oauthProviderCount > 0 ? "ok" : "unset",
    value:
      input.oauthProviderCount > 0
        ? `${input.oauthProviderCount} providers`
        : "Local accounts only",
    staged: staged("oauth"),
  });

  // Enabled with nothing on disk is the one GeoIP state that silently does nothing: geoipupdate
  // has never completed, so every lookup misses.
  const geoipEmpty = input.geoip.enabled && input.geoip.installedEditions.length === 0;
  const ageDays = input.geoip.databaseAgeDays;

  /**
   * Behind is the definitive answer, and it needs no threshold: MaxMind has built something newer
   * than what is on disk, so the updater has demonstrably not fetched it. Age alone cannot tell
   * that apart from MaxMind simply not having published.
   */
  const behind = input.geoip.enabled ? input.geoip.editionsBehind : [];
  // A check that has not run for a day is its own problem: without it, "behind" is unknowable and
  // the tile would quietly fall back to guessing from the file's age.
  const now = input.now ?? Date.now();
  const checkAgeMs = input.geoip.lastCheckedAt
    ? now - Date.parse(input.geoip.lastCheckedAt)
    : Number.POSITIVE_INFINITY;
  const checkStalled = input.geoip.enabled && !(checkAgeMs < 24 * 60 * 60 * 1000);
  const geoipAttention = geoipEmpty || behind.length > 0 || checkStalled;

  sections.push({
    id: "geoip",
    name: "GeoIP",
    group: "access",
    status: geoipAttention ? "attention" : input.geoip.enabled ? "ok" : "unset",
    value: !input.geoip.enabled
      ? "Off"
      : geoipEmpty
        ? "No database installed"
        : behind.length > 0
          ? `${behind.length} of ${input.geoip.installedEditions.length} databases out of date`
          : ageDays === 0
            ? `${input.geoip.installedEditions.length} databases, updated today`
            : `${input.geoip.installedEditions.length} databases, ${ageDays} days old`,
    detail: geoipEmpty
      ? "GeoIP is enabled but no MaxMind database has been downloaded, so country lookups return nothing. Check the account ID and licence key."
      : behind.length > 0
        ? `MaxMind has published a newer ${behind.join(", ")} than the copy on disk, so geoipupdate is not fetching. Check its credentials and whether the container is running.`
        : checkStalled
          ? input.geoip.checkError
            ? `MaxMind could not be reached to check for updates: ${input.geoip.checkError}`
            : "MaxMind has not been asked for updates recently, so whether these databases are current is unknown."
          : undefined,
    staged: staged("geoip"),
  });

  const blockedCountries = input.geoBlock?.block_countries?.length ?? 0;
  // Blocking against a database that is not there fails open, quietly. Blocking against a stale
  // one fails the other way: ranges reassigned since it was built are matched to the wrong country.
  const blockingWithoutData = Boolean(input.geoBlock?.enabled) && geoipEmpty;
  const blockingOnStaleData = Boolean(input.geoBlock?.enabled) && behind.length > 0;
  sections.push({
    id: "geoblock",
    name: "Geo-Block",
    group: "access",
    status:
      blockingWithoutData || blockingOnStaleData
        ? "attention"
        : input.geoBlock?.enabled
          ? "ok"
          : "unset",
    value: input.geoBlock?.enabled ? `Denying ${blockedCountries} countries` : "Off",
    detail: blockingWithoutData
      ? "Country rules are configured but no GeoIP database is installed, so nothing is being blocked."
      : blockingOnStaleData
        ? "Country rules are being matched against a database MaxMind has already superseded, so recently reassigned address ranges resolve to the wrong country."
        : undefined,
    staged: staged("geoblock"),
  });

  const agentsMissing = input.agentsPaired > 0 && input.agentsConnected === 0;
  sections.push({
    id: "agent",
    name: "Agent",
    group: "runtime",
    status: input.agentsPaired === 0 ? "unset" : agentsMissing ? "attention" : "ok",
    value:
      input.agentsPaired === 0
        ? "No agent paired"
        : `${input.agentsConnected} of ${input.agentsPaired} connected`,
    detail: agentsMissing
      ? "No paired agent is holding its event stream open, so configuration changes cannot reach Caddy."
      : input.agentsPaired === 0
        ? "Without an agent nothing starts or reconfigures the Caddy container."
        : undefined,
    staged: staged("agent"),
  });

  // `modules` maps a built-in id to whether it is on, and an absent id means on, so only the
  // explicit `false` entries subtract from the stock build.
  const disabled = Object.values(input.caddyBuild?.modules ?? {}).filter(
    (enabled) => enabled === false,
  ).length;
  const custom = input.caddyBuild?.customModules?.length ?? 0;
  sections.push({
    id: "caddy-build",
    name: "Caddy Build",
    group: "runtime",
    status: "ok",
    value: custom > 0 || disabled > 0 ? `${custom} custom, ${disabled} disabled` : "Stock build",
    staged: staged("caddy-build"),
  });

  sections.push({
    id: "metrics",
    name: "Metrics",
    group: "runtime",
    status: input.metrics?.enabled ? "ok" : "unset",
    value: input.metrics?.enabled ? `Exposed on port ${input.metrics.port ?? 9090}` : "Off",
    staged: staged("metrics"),
  });

  // A variable still overriding the toggle is not a fault, but it does mean this page cannot
  // change it - which is the question an operator is about to ask.
  const analyticsFromEnv = input.analytics.source === "environment";
  sections.push({
    id: "analytics",
    name: "Analytics",
    group: "runtime",
    status: analyticsFromEnv ? "env" : input.analytics.enabled ? "ok" : "unset",
    value: input.analytics.enabled
      ? `ClickHouse - ${input.analytics.retentionDays} day retention`
      : "Off",
    detail: analyticsFromEnv
      ? "Set in the environment, so this instance cannot change it here."
      : undefined,
    staged: staged("analytics"),
  });

  return sections;
}

/** The sections a person should look at, most serious first. Drives the band above the grid. */
export function needsAttention(sections: SectionHealth[]): SectionHealth[] {
  return sections.filter((section) => section.status === "attention");
}
