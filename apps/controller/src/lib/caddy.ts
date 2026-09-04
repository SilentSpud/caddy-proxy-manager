import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { Resolver } from "node:dns/promises";
import { join, dirname } from "node:path";
import { isIP } from "node:net";
import { isConnectionError } from "./net-errors";
import {
  expandPrivateRanges,
  isPlainObject,
  mergeDeep,
  parseJson,
  parseOptionalJson,
  parseCustomHandlers,
  formatDialAddress,
  parseUpstreamTarget,
  toDurationMs,
  canonicalHeaderName,
  upstreamHeaderPlaceholder,
  stripCaddyPlaceholders,
} from "./caddy-utils";
import {
  groupHostPatternsByPriority,
  sortAutomationPoliciesBySubjectPriority,
  sortRoutesByHostPriority,
  sortTlsPoliciesBySniPriority,
} from "./host-pattern-priority";
import db from "./db";
import { eq, isNull } from "drizzle-orm";
import { config } from "./config";
import {
  getGeneralSettings,
  getAcmeSettings,
  getMetricsSettings,
  getLoggingSettings,
  getDnsSettings,
  getDnsProviderSettings,
  getUpstreamDnsResolutionSettings,
  getGeoBlockSettings,
  getWafSettings,
  getErrorPagesSettings,
  getDefaultResponseSettings,
  getTrustedProxiesSettings,
  type AcmeSettings,
  type DnsProviderSettings,
  type DnsSettings,
  type UpstreamDnsAddressFamily,
  type UpstreamDnsResolutionSettings,
  type GeoBlockSettings,
  type WafSettings,
  type TrustedProxiesSettings,
} from "./settings";
import { buildDefaultResponseRoute } from "./caddy-default-response";
import { buildDnsChallengeConfig, type DnsProviderCredentials } from "./dns-providers";
import { caddyAdminRequest } from "./caddy-admin";
import {
  accessListEntries,
  certificates,
  caCertificates,
  issuedClientCertificates,
  proxyHosts,
  l4ProxyHosts,
} from "./db/schema";
import type {
  GeoBlockMode,
  WafHostConfig,
  MtlsConfig,
  RedirectRule,
  RewriteConfig,
  LocationRuleMeta,
  PathAllowRule,
  PathBlockRule,
  PathRewriteRule,
  ErrorPageRule,
} from "./models/proxy-hosts";
import {
  buildClientAuthentication,
  groupMtlsDomainsByCaSet,
  buildMtlsRbacSubroutes,
  buildFingerprintCelExpression,
  buildValidClientCertCelExpression,
  resolveAllowedFingerprints,
  type MtlsAccessRuleLike,
} from "./caddy-mtls";
import {
  buildRoleFingerprintMap,
  buildCertFingerprintMap,
  buildRoleCertIdMap,
} from "./models/mtls-roles";
import { getAccessRulesForHosts } from "./models/mtls-access-rules";
import { buildWafHandlerEntry, resolveEffectiveWaf } from "./caddy-waf";
import { adaptCaddyfileSnippet, buildCaddyfileSubrouteHandler } from "./caddy-caddyfile";
import {
  type CaddyModuleAvailability,
  getCaddyModuleAvailability,
  isDnsProviderUsable,
  isFeatureUsable,
} from "./caddy-build";
import { FORWARD_AUTH_PROXY_PROOF_HEADER, getForwardAuthProxyProof } from "./forward-auth-trust";
import { decryptSecret } from "./secret";
import { CaddyApplyError, describeCaddyRejection, logCaddyApplyFailure } from "./caddy-apply-error";

const CERTS_DIR = process.env.CERTS_DIRECTORY || join(process.cwd(), "data", "certs");
mkdirSync(CERTS_DIR, { recursive: true, mode: 0o700 });

// Shared with the Caddy container via a Docker volume, so a custom ACME CA root PEM written
// here is readable by Caddy at the same path for `trusted_roots_pem_files`. Read lazily so
// tests and non-Docker deployments can override ACME_CA_ROOT_DIR at runtime.
function acmeCaRootFile(): string {
  return join(process.env.ACME_CA_ROOT_DIR || "/acme-ca", "custom-ca-root.pem");
}

/**
 * Persist (or clear) the custom ACME CA root PEM and return the path Caddy should reference, or
 * null — leaving the issuer without `trusted_roots_pem_files` rather than a missing file.
 */
function syncAcmeCaRootFile(caRootPem: string | undefined): string | null {
  const file = acmeCaRootFile();
  const pem = caRootPem?.trim();
  if (!pem) {
    try {
      rmSync(file, { force: true });
    } catch {
      // best-effort cleanup
    }
    return null;
  }
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, pem.endsWith("\n") ? pem : `${pem}\n`, { mode: 0o644 });
    return file;
  } catch (error) {
    console.error(`Failed to write ACME CA root PEM to ${file}`, error);
    return null;
  }
}

const DEFAULT_AUTHENTIK_HEADERS = [
  "X-Authentik-Username",
  "X-Authentik-Groups",
  "X-Authentik-Entitlements",
  "X-Authentik-Email",
  "X-Authentik-Name",
  "X-Authentik-Uid",
  "X-Authentik-Jwt",
  "X-Authentik-Meta-Jwks",
  "X-Authentik-Meta-Outpost",
  "X-Authentik-Meta-Provider",
  "X-Authentik-Meta-App",
  "X-Authentik-Meta-Version",
];

const DEFAULT_AUTHENTIK_TRUSTED_PROXIES = ["private_ranges"];

type ProxyHostRow = {
  id: number;
  name: string;
  domains: string;
  upstreams: string;
  certificateId: number | null;
  accessListId: number | null;
  sslForced: number;
  hstsEnabled: number;
  hstsSubdomains: number;
  allowWebsocket: number;
  preserveHostHeader: number;
  skipHttpsHostnameValidation: number;
  meta: string | null;
  enabled: number;
};

type DnsResolverMeta = {
  enabled?: boolean;
  resolvers?: string[];
  fallbacks?: string[];
  timeout?: string;
};

type UpstreamDnsResolutionMeta = {
  enabled?: boolean;
  family?: UpstreamDnsAddressFamily;
};

type CpmForwardAuthMeta = {
  enabled?: boolean;
  protected_paths?: string[];
  excluded_paths?: string[];
};

type MtlsMeta = {
  enabled?: boolean;
  trusted_client_cert_ids?: number[];
  trusted_role_ids?: number[];
  protected_paths?: string[];
  excluded_paths?: string[];
  ca_certificate_ids?: number[];
};

type ProxyHostMeta = {
  custom_reverse_proxy_json?: string;
  custom_pre_handlers_json?: string;
  custom_caddyfile?: string;
  authentik?: ProxyHostAuthentikMeta;
  cpm_forward_auth?: CpmForwardAuthMeta;
  load_balancer?: LoadBalancerMeta;
  dns_resolver?: DnsResolverMeta;
  upstream_dns_resolution?: UpstreamDnsResolutionMeta;
  geoblock?: GeoBlockSettings;
  geoblock_mode?: GeoBlockMode;
  waf?: WafHostConfig;
  mtls?: MtlsMeta;
  redirects?: RedirectRule[];
  rewrite?: RewriteConfig;
  location_rules?: LocationRuleMeta[];
  path_allows?: PathAllowRule[];
  path_blocks?: PathBlockRule[];
  path_rewrites?: PathRewriteRule[];
  error_pages?: ErrorPageRule[];
};

type L4Meta = {
  load_balancer?: LoadBalancerMeta;
  dns_resolver?: DnsResolverMeta;
  upstream_dns_resolution?: UpstreamDnsResolutionMeta;
  geoblock?: GeoBlockSettings;
  geoblock_mode?: GeoBlockMode;
};

type ProxyHostAuthentikMeta = {
  enabled?: boolean;
  outpost_domain?: string;
  outpost_upstream?: string;
  auth_endpoint?: string;
  copy_headers?: string[];
  trusted_proxies?: string[];
  set_outpost_host_header?: boolean;
  protected_paths?: string[];
  excluded_paths?: string[];
};

type AuthentikRouteConfig = {
  enabled: boolean;
  outpostDomain: string;
  outpostUpstream: string;
  authEndpoint: string;
  copyHeaders: string[];
  trustedProxies: string[];
  setOutpostHostHeader: boolean;
  protectedPaths: string[] | null;
  excludedPaths: string[] | null;
};

type LoadBalancerActiveHealthCheckMeta = {
  enabled?: boolean;
  uri?: string;
  port?: number;
  interval?: string;
  timeout?: string;
  status?: number;
  body?: string;
};

type LoadBalancerPassiveHealthCheckMeta = {
  enabled?: boolean;
  fail_duration?: string;
  max_fails?: number;
  unhealthy_status?: number[];
  unhealthy_latency?: string;
};

type LoadBalancerMeta = {
  enabled?: boolean;
  policy?: string;
  policy_header_field?: string;
  policy_cookie_name?: string;
  policy_cookie_secret?: string;
  try_duration?: string;
  try_interval?: string;
  retries?: number;
  active_health_check?: LoadBalancerActiveHealthCheckMeta;
  passive_health_check?: LoadBalancerPassiveHealthCheckMeta;
};

type LoadBalancerRouteConfig = {
  enabled: boolean;
  policy: string;
  policyHeaderField: string | null;
  policyCookieName: string | null;
  policyCookieSecret: string | null;
  tryDuration: string | null;
  tryInterval: string | null;
  retries: number | null;
  activeHealthCheck: {
    enabled: boolean;
    uri: string | null;
    port: number | null;
    interval: string | null;
    timeout: string | null;
    status: number | null;
    body: string | null;
  } | null;
  passiveHealthCheck: {
    enabled: boolean;
    failDuration: string | null;
    maxFails: number | null;
    unhealthyStatus: number[] | null;
    unhealthyLatency: string | null;
  } | null;
};

type AccessListEntryRow = {
  accessListId: number;
  username: string;
  passwordHash: string;
};

type CertificateRow = {
  id: number;
  name: string;
  type: string;
  domainNames: string;
  certificatePem: string | null;
  privateKeyPem: string | null;
  autoRenew: number;
  providerOptions: string | null;
};

type CaddyHttpRoute = Record<string, unknown>;

type CertificateUsage = {
  certificate: CertificateRow;
  domains: Set<string>;
};

const VALID_UPSTREAM_DNS_FAMILIES: UpstreamDnsAddressFamily[] = ["ipv6", "ipv4", "both"];

type UpstreamDnsResolutionRouteConfig = {
  enabled: boolean | null;
  family: UpstreamDnsAddressFamily | null;
};

type EffectiveUpstreamDnsResolution = {
  enabled: boolean;
  family: UpstreamDnsAddressFamily;
};

function parseUpstreamDnsResolutionConfig(
  meta: UpstreamDnsResolutionMeta | undefined | null,
): UpstreamDnsResolutionRouteConfig | null {
  if (!meta) {
    return null;
  }

  const enabled = typeof meta.enabled === "boolean" ? meta.enabled : null;
  const family =
    meta.family && VALID_UPSTREAM_DNS_FAMILIES.includes(meta.family) ? meta.family : null;

  if (enabled === null && family === null) {
    return null;
  }

  return {
    enabled,
    family,
  };
}

function resolveEffectiveUpstreamDnsResolution(
  globalSetting: UpstreamDnsResolutionSettings | null,
  hostSetting: UpstreamDnsResolutionRouteConfig | null,
): EffectiveUpstreamDnsResolution {
  const globalFamily =
    globalSetting?.family && VALID_UPSTREAM_DNS_FAMILIES.includes(globalSetting.family)
      ? globalSetting.family
      : "both";
  const globalEnabled = Boolean(globalSetting?.enabled);

  return {
    enabled: hostSetting?.enabled ?? globalEnabled,
    family: hostSetting?.family ?? globalFamily,
  };
}

function getLookupServers(
  dnsConfig: DnsResolverRouteConfig | null,
  globalDnsSettings: DnsSettings | null,
): string[] {
  if (dnsConfig?.enabled && dnsConfig.resolvers.length > 0) {
    const servers = [...dnsConfig.resolvers];
    if (dnsConfig.fallbacks && dnsConfig.fallbacks.length > 0) {
      servers.push(...dnsConfig.fallbacks);
    }
    return servers;
  }

  if (
    globalDnsSettings?.enabled &&
    Array.isArray(globalDnsSettings.resolvers) &&
    globalDnsSettings.resolvers.length > 0
  ) {
    const servers = [...globalDnsSettings.resolvers];
    if (Array.isArray(globalDnsSettings.fallbacks) && globalDnsSettings.fallbacks.length > 0) {
      servers.push(...globalDnsSettings.fallbacks);
    }
    return servers;
  }

  return [];
}

function getLookupTimeoutMs(
  dnsConfig: DnsResolverRouteConfig | null,
  globalDnsSettings: DnsSettings | null,
): number | null {
  const hostTimeout = toDurationMs(dnsConfig?.timeout ?? null);
  if (hostTimeout !== null) {
    return hostTimeout;
  }

  if (globalDnsSettings?.enabled) {
    const globalTimeout = toDurationMs(globalDnsSettings.timeout ?? null);
    if (globalTimeout !== null) {
      return globalTimeout;
    }
  }

  return null;
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number | null,
  timeoutLabel: string,
): Promise<T> {
  if (!timeoutMs || timeoutMs <= 0) {
    return promise;
  }

  let timeoutHandle: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new Error(`${timeoutLabel} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

async function resolveHostnameAddresses(
  resolver: Resolver,
  hostname: string,
  family: UpstreamDnsAddressFamily,
  timeoutMs: number | null,
): Promise<string[]> {
  const errors: string[] = [];
  const resolved: string[] = [];
  const seen = new Set<string>();

  const resolve6 = async () => {
    try {
      return await withTimeout(
        resolver.resolve6(hostname),
        timeoutMs,
        `AAAA lookup for ${hostname}`,
      );
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
      return [];
    }
  };

  const resolve4 = async () => {
    try {
      return await withTimeout(resolver.resolve4(hostname), timeoutMs, `A lookup for ${hostname}`);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
      return [];
    }
  };

  const pushUnique = (addresses: string[]) => {
    for (const address of addresses) {
      if (!seen.has(address)) {
        seen.add(address);
        resolved.push(address);
      }
    }
  };

  if (family === "ipv6") {
    pushUnique(await resolve6());
  } else if (family === "ipv4") {
    pushUnique(await resolve4());
  } else {
    pushUnique(await resolve6());
    pushUnique(await resolve4());
  }

  if (resolved.length === 0 && errors.length > 0) {
    throw new Error(errors.join("; "));
  }

  return resolved;
}

type ResolveUpstreamsResult = {
  upstreams: Array<{ dial: string }>;
  hasHttpsUpstream: boolean;
  httpsTlsServerName: string | null;
};

async function resolveUpstreamDials(
  row: ProxyHostRow,
  upstreams: string[],
  dnsConfig: DnsResolverRouteConfig | null,
  globalDnsSettings: DnsSettings | null,
  dnsResolution: EffectiveUpstreamDnsResolution,
): Promise<ResolveUpstreamsResult> {
  const parsedTargets = upstreams.map(parseUpstreamTarget);
  const hasHttpsUpstream = parsedTargets.some((target) => target.scheme === "https");

  if (!dnsResolution.enabled) {
    return {
      upstreams: parsedTargets.map((target) => ({ dial: target.dial })),
      hasHttpsUpstream,
      httpsTlsServerName: null,
    };
  }

  const httpsHostnames = Array.from(
    new Set(
      parsedTargets
        .filter(
          (target) =>
            target.scheme === "https" && target.host && target.port && isIP(target.host) === 0,
        )
        .map((target) => target.host as string),
    ),
  );
  const canResolveHttps = httpsHostnames.length <= 1;
  if (!canResolveHttps) {
    console.warn(
      `[caddy] Skipping DNS pinning for HTTPS upstreams on host "${row.name}" because multiple TLS server names are configured.`,
    );
  }

  const resolver = new Resolver();
  const lookupServers = getLookupServers(dnsConfig, globalDnsSettings);
  if (lookupServers.length > 0) {
    try {
      resolver.setServers(lookupServers);
    } catch (error) {
      console.warn(`[caddy] Failed to set custom DNS servers for upstream pinning`, error);
    }
  }
  const timeoutMs = getLookupTimeoutMs(dnsConfig, globalDnsSettings);

  const dials: string[] = [];
  for (const target of parsedTargets) {
    if (!target.host || !target.port || isIP(target.host) !== 0) {
      dials.push(target.dial);
      continue;
    }

    if (target.scheme === "https" && !canResolveHttps) {
      dials.push(target.dial);
      continue;
    }

    try {
      const addresses = await resolveHostnameAddresses(
        resolver,
        target.host,
        dnsResolution.family,
        timeoutMs,
      );
      if (addresses.length === 0) {
        dials.push(target.dial);
        continue;
      }
      for (const address of addresses) {
        dials.push(formatDialAddress(address, target.port));
      }
    } catch (error) {
      console.warn(
        `[caddy] Failed to resolve upstream "${target.original}" for host "${row.name}", falling back to hostname dial.`,
        error,
      );
      dials.push(target.dial);
    }
  }

  const dedupedDials: Array<{ dial: string }> = [];
  const seen = new Set<string>();
  for (const dial of dials) {
    if (!seen.has(dial)) {
      seen.add(dial);
      dedupedDials.push({ dial });
    }
  }

  return {
    upstreams: dedupedDials,
    hasHttpsUpstream,
    httpsTlsServerName: canResolveHttps && httpsHostnames.length === 1 ? httpsHostnames[0] : null,
  };
}

function collectCertificateUsage(rows: ProxyHostRow[], certificates: Map<number, CertificateRow>) {
  const usage = new Map<number, CertificateUsage>();
  const autoManagedDomains = new Set<string>();

  for (const row of rows) {
    if (!row.enabled) {
      continue;
    }

    const domains = parseJson<string[]>(row.domains, []).map((domain) =>
      domain?.trim().toLowerCase(),
    );
    const filteredDomains = domains.filter((domain): domain is string => Boolean(domain));
    if (filteredDomains.length === 0) {
      continue;
    }

    // Handle auto-managed certificates (certificateId is null)
    if (!row.certificateId) {
      for (const domain of filteredDomains) {
        autoManagedDomains.add(domain);
      }
      continue;
    }

    const cert = certificates.get(row.certificateId);
    if (!cert) {
      continue;
    }

    if (!usage.has(cert.id)) {
      usage.set(cert.id, {
        certificate: cert,
        domains: new Set(),
      });
    }

    const entry = usage.get(cert.id)!;
    for (const domain of filteredDomains) {
      entry.domains.add(domain);
    }
  }

  return { usage, autoManagedDomains };
}

function mergeGeoBlockSettings(global: GeoBlockSettings, host: GeoBlockSettings): GeoBlockSettings {
  return {
    enabled: host.enabled || global.enabled,
    block_countries: [...(global.block_countries ?? []), ...(host.block_countries ?? [])],
    block_continents: [...(global.block_continents ?? []), ...(host.block_continents ?? [])],
    block_asns: [...(global.block_asns ?? []), ...(host.block_asns ?? [])],
    block_cidrs: [...(global.block_cidrs ?? []), ...(host.block_cidrs ?? [])],
    block_ips: [...(global.block_ips ?? []), ...(host.block_ips ?? [])],
    allow_countries: [...(global.allow_countries ?? []), ...(host.allow_countries ?? [])],
    allow_continents: [...(global.allow_continents ?? []), ...(host.allow_continents ?? [])],
    allow_asns: [...(global.allow_asns ?? []), ...(host.allow_asns ?? [])],
    allow_cidrs: [...(global.allow_cidrs ?? []), ...(host.allow_cidrs ?? [])],
    allow_ips: [...(global.allow_ips ?? []), ...(host.allow_ips ?? [])],
    trusted_proxies: [...(global.trusted_proxies ?? []), ...(host.trusted_proxies ?? [])],
    // Host config wins for scalar fields
    fail_closed: host.fail_closed || global.fail_closed || false,
    response_status: host.response_status ?? global.response_status ?? 403,
    response_body: host.response_body ?? global.response_body ?? "Forbidden",
    response_headers: { ...(global.response_headers ?? {}), ...(host.response_headers ?? {}) },
    redirect_url: host.redirect_url ?? global.redirect_url ?? "",
  };
}

export function resolveEffectiveGeoBlock(
  global: GeoBlockSettings | null,
  host: { geoblock: GeoBlockSettings | null; geoblock_mode: GeoBlockMode },
): GeoBlockSettings | null {
  const hostConfig = host.geoblock;
  const globalConfig = global;

  // Neither configured or enabled
  if (!hostConfig?.enabled && !globalConfig?.enabled) return null;

  // Host override mode: use host config only
  if (hostConfig && host.geoblock_mode === "override") {
    return hostConfig.enabled ? hostConfig : null;
  }

  // Host merge mode: only enabled host config alters global behavior — a disabled host
  // geoblock means "no per-host geoblock".
  if (hostConfig?.enabled && globalConfig) {
    return mergeGeoBlockSettings(globalConfig, hostConfig);
  }

  // Only one configured
  if (hostConfig?.enabled) return hostConfig;
  if (globalConfig?.enabled) return globalConfig;

  return null;
}

export function buildBlockerHandler(config: GeoBlockSettings): Record<string, unknown> {
  const handler: Record<string, unknown> = {
    handler: "blocker",
    geoip_db: "/usr/share/GeoIP/GeoLite2-Country.mmdb",
    asn_db: "/usr/share/GeoIP/GeoLite2-ASN.mmdb",
  };

  if (config.block_countries?.length) handler.block_countries = config.block_countries;
  if (config.block_continents?.length) handler.block_continents = config.block_continents;
  if (config.block_asns?.length) handler.block_asns = config.block_asns;
  if (config.block_cidrs?.length) handler.block_cidrs = config.block_cidrs;
  if (config.block_ips?.length) handler.block_ips = config.block_ips;

  if (config.allow_countries?.length) handler.allow_countries = config.allow_countries;
  if (config.allow_continents?.length) handler.allow_continents = config.allow_continents;
  if (config.allow_asns?.length) handler.allow_asns = config.allow_asns;
  if (config.allow_cidrs?.length) handler.allow_cidrs = config.allow_cidrs;
  if (config.allow_ips?.length) handler.allow_ips = config.allow_ips;

  if (config.trusted_proxies?.length)
    handler.trusted_proxies = expandPrivateRanges(config.trusted_proxies);
  if (config.fail_closed) handler.fail_closed = true;

  if (config.redirect_url) {
    handler.redirect_url = config.redirect_url;
  } else {
    if (config.response_status) handler.response_status = config.response_status;
    if (config.response_body) handler.response_body = config.response_body;
    if (config.response_headers && Object.keys(config.response_headers).length) {
      handler.response_headers = config.response_headers;
    }
  }

  return handler;
}

function buildGeoBlockMatcher(config: GeoBlockSettings): Record<string, unknown> {
  const matcher: Record<string, unknown> = {
    geoip_db: "/usr/share/GeoIP/GeoLite2-Country.mmdb",
    asn_db: "/usr/share/GeoIP/GeoLite2-ASN.mmdb",
  };

  if (config.block_countries?.length) matcher.block_countries = config.block_countries;
  if (config.block_continents?.length) matcher.block_continents = config.block_continents;
  if (config.block_asns?.length) matcher.block_asns = config.block_asns;
  if (config.block_cidrs?.length) matcher.block_cidrs = config.block_cidrs;
  if (config.block_ips?.length) matcher.block_ips = config.block_ips;

  if (config.allow_countries?.length) matcher.allow_countries = config.allow_countries;
  if (config.allow_continents?.length) matcher.allow_continents = config.allow_continents;
  if (config.allow_asns?.length) matcher.allow_asns = config.allow_asns;
  if (config.allow_cidrs?.length) matcher.allow_cidrs = config.allow_cidrs;
  if (config.allow_ips?.length) matcher.allow_ips = config.allow_ips;

  return matcher;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function attachHostToRoute(route: CaddyHttpRoute, host: string | string[]): CaddyHttpRoute {
  const routeMatches = (route.match as Array<Record<string, unknown>> | undefined) ?? [];
  return {
    ...route,
    match: routeMatches.map((match) => ({
      ...match,
      host,
    })),
  };
}

/** Normalize trusted-proxy ranges: trim, drop blanks, expand the "private_ranges" shorthand. */
export function normalizeTrustedProxyRanges(ranges: string[] | undefined | null): string[] {
  return expandPrivateRanges((ranges ?? []).map((r) => r.trim()).filter(Boolean));
}

/**
 * Server-level trusted-proxy fields for `servers.cpm`. Caddy resolves client_ip in core, before any
 * handler, so this is the only place a global list fixes IP attribution. Empty unless configured.
 */
export function buildServerTrustedProxies(settings: TrustedProxiesSettings | null | undefined): {
  trusted_proxies?: { source: string; ranges: string[] };
  client_ip_headers?: string[];
  trusted_proxies_strict?: number;
} {
  if (!settings) return {};

  const ranges = normalizeTrustedProxyRanges(settings.ranges);
  if (ranges.length === 0) return {};

  const out: {
    trusted_proxies: { source: string; ranges: string[] };
    client_ip_headers?: string[];
    trusted_proxies_strict?: number;
  } = {
    trusted_proxies: { source: "static", ranges },
  };

  const headers = (settings.client_ip_headers ?? []).map((h) => h.trim()).filter(Boolean);
  if (headers.length > 0) out.client_ip_headers = headers;

  // Caddy's trusted_proxies_strict is an int flag (1 = strict, 0 = off).
  if (settings.strict) out.trusted_proxies_strict = 1;

  return out;
}

type CaddyBuildContext = {
  rows: ProxyHostRow[];
  accessAccounts: Map<number, AccessListEntryRow[]>;
  tlsReadyCertificates: Set<number>;
  globalDnsSettings: DnsSettings | null;
  globalUpstreamDnsResolutionSettings: UpstreamDnsResolutionSettings | null;
  globalGeoBlock?: GeoBlockSettings | null;
  globalWaf?: WafSettings | null;
  /**
   * Which plugin-backed features the running binary can serve. Caddy validates a posted config as a
   * whole, so one handler naming an uncompiled module takes every host offline.
   */
  moduleAvailability: CaddyModuleAvailability;
  mtlsRbac?: {
    roleFingerprintMap: Map<number, Set<string>>;
    certFingerprintMap: Map<number, string>;
    accessRulesByHost: Map<number, MtlsAccessRuleLike[]>;
  };
};

export function buildLocationReverseProxy(
  rule: LocationRuleMeta,
  skipHttpsValidation: boolean,
  preserveHostHeader: boolean,
): { safePath: string; reverseProxyHandler: Record<string, unknown> } {
  const parsedTargets = rule.upstreams.map(parseUpstreamTarget);
  const hasHttps = parsedTargets.some((t) => t.scheme === "https");

  // Sanitize path to prevent Caddy placeholder injection
  const safePath = stripCaddyPlaceholders(rule.path);

  const reverseProxyHandler: Record<string, unknown> = {
    handler: "reverse_proxy",
    upstreams: parsedTargets.map((t) => ({ dial: t.dial })),
  };

  if (preserveHostHeader) {
    reverseProxyHandler.headers = {
      request: { set: { Host: ["{http.request.host}"] } },
    };
  }

  if (hasHttps) {
    reverseProxyHandler.transport = {
      protocol: "http",
      tls: skipHttpsValidation ? { insecure_skip_verify: true } : {},
    };
  }

  // Per-rule load balancing / health checks (mirrors the host-level config).
  const lbConfig = parseLoadBalancerConfig(rule.load_balancer);
  if (lbConfig) {
    const loadBalancing = buildLoadBalancingConfig(lbConfig);
    if (loadBalancing) {
      reverseProxyHandler.load_balancing = loadBalancing;
    }
    const healthChecks = buildHealthChecksConfig(lbConfig);
    if (healthChecks) {
      reverseProxyHandler.health_checks = healthChecks;
    }
  }

  return { safePath, reverseProxyHandler };
}

// A Caddy server-level error route (handle_errors equivalent): serves a custom static
// response while preserving the original status code. An empty `statuses` list matches every
// error; `hosts`, when set, scopes the route to a host.
export function buildErrorPageRoute(rule: ErrorPageRule, hosts?: string[]): CaddyHttpRoute {
  const matcher: Record<string, unknown> = {};
  if (hosts && hosts.length > 0) {
    matcher.host = hosts;
  }
  if (rule.statuses.length > 0) {
    // Mirrors Caddy's documented handle_errors form, e.g. {http.error.status_code} == 404
    matcher.expression = rule.statuses.map((s) => `{http.error.status_code} == ${s}`).join(" || ");
  }
  const route: CaddyHttpRoute = {
    handle: [
      {
        handler: "static_response",
        status_code: "{http.error.status_code}",
        body: rule.body,
        headers: { "Content-Type": [rule.contentType || "text/html; charset=utf-8"] },
      },
    ],
    terminal: true,
  };
  if (Object.keys(matcher).length > 0) {
    route.match = [matcher];
  }
  return route;
}

function appendLocationRoutes(options: {
  hostRoutes: CaddyHttpRoute[];
  domainGroup: string[];
  locationRules: LocationRuleMeta[];
  skipHttpsHostnameValidation: boolean;
  preserveHostHeader: boolean;
  handlers: Record<string, unknown>[];
  extraHandlers?: Record<string, unknown>[];
  expression?: string;
}) {
  const {
    hostRoutes,
    domainGroup,
    locationRules,
    skipHttpsHostnameValidation,
    preserveHostHeader,
    handlers,
    extraHandlers = [],
    expression,
  } = options;

  for (const rule of locationRules) {
    const { safePath, reverseProxyHandler: locationProxy } = buildLocationReverseProxy(
      rule,
      skipHttpsHostnameValidation,
      preserveHostHeader,
    );
    if (!safePath) continue;

    const matcher: Record<string, unknown> = {
      host: domainGroup,
      path: [safePath],
    };
    if (expression) matcher.expression = expression;

    hostRoutes.push({
      match: [matcher],
      handle: [...handlers, ...extraHandlers, locationProxy],
      terminal: true,
    });
  }
}

type PathAuthMode =
  | { type: "protected"; paths: string[] }
  | { type: "excluded"; paths: string[] }
  | { type: "full" };

type MtlsPathMode =
  | { type: "protected"; paths: string[] }
  | { type: "excluded"; paths: string[] }
  | { type: "full" };

function resolvePathAuthMode(
  protectedPaths?: string[] | null,
  excludedPaths?: string[] | null,
): PathAuthMode {
  if (protectedPaths && protectedPaths.length > 0) {
    return { type: "protected", paths: protectedPaths };
  }
  if (excludedPaths && excludedPaths.length > 0) {
    return { type: "excluded", paths: excludedPaths };
  }
  return { type: "full" };
}

function resolveMtlsPathMode(
  protectedPaths?: string[] | null,
  excludedPaths?: string[] | null,
): MtlsPathMode {
  if (protectedPaths && protectedPaths.length > 0) {
    return { type: "protected", paths: protectedPaths };
  }
  if (excludedPaths && excludedPaths.length > 0) {
    return { type: "excluded", paths: excludedPaths };
  }
  return { type: "full" };
}

function appendForwardAuthPathModeRoutes(options: {
  hostRoutes: CaddyHttpRoute[];
  domainGroups: string[][];
  authMode: PathAuthMode;
  baseHandlers: Record<string, unknown>[];
  authHandler: Record<string, unknown>;
  reverseProxyHandler: Record<string, unknown>;
  locationRules: LocationRuleMeta[];
  skipHttpsHostnameValidation: boolean;
  preserveHostHeader: boolean;
  preDomainRoute?: CaddyHttpRoute | null;
  protectedModePreRoutePlacement?: "before" | "after";
}) {
  const {
    hostRoutes,
    domainGroups,
    authMode,
    baseHandlers,
    authHandler,
    reverseProxyHandler,
    locationRules,
    skipHttpsHostnameValidation,
    preserveHostHeader,
    preDomainRoute,
    protectedModePreRoutePlacement = "before",
  } = options;

  for (const domainGroup of domainGroups) {
    const pushPreDomainRoute = () => {
      if (preDomainRoute) {
        hostRoutes.push(attachHostToRoute(preDomainRoute, domainGroup));
      }
    };

    if (authMode.type === "protected") {
      if (protectedModePreRoutePlacement === "before") pushPreDomainRoute();

      for (const protectedPath of authMode.paths) {
        hostRoutes.push({
          match: [{ host: domainGroup, path: [protectedPath] }],
          handle: [...baseHandlers, authHandler, cloneJson(reverseProxyHandler)],
          terminal: true,
        });
      }

      if (protectedModePreRoutePlacement === "after") pushPreDomainRoute();

      // In whitelist mode, location rules and catch-all stay unprotected.
      appendLocationRoutes({
        hostRoutes,
        domainGroup,
        locationRules,
        skipHttpsHostnameValidation,
        preserveHostHeader,
        handlers: baseHandlers,
      });
      hostRoutes.push({
        match: [{ host: domainGroup }],
        handle: [...baseHandlers, reverseProxyHandler],
        terminal: true,
      });
      continue;
    }

    // Excluded and full-site modes share auth-protected location/catch-all.
    pushPreDomainRoute();

    if (authMode.type === "excluded") {
      for (const excludedPath of authMode.paths) {
        hostRoutes.push({
          match: [{ host: domainGroup, path: [excludedPath] }],
          handle: [...baseHandlers, cloneJson(reverseProxyHandler)],
          terminal: true,
        });
      }
    }

    appendLocationRoutes({
      hostRoutes,
      domainGroup,
      locationRules,
      skipHttpsHostnameValidation,
      preserveHostHeader,
      handlers: baseHandlers,
      extraHandlers: [authHandler],
    });
    hostRoutes.push({
      match: [{ host: domainGroup }],
      handle: [...baseHandlers, authHandler, reverseProxyHandler],
      terminal: true,
    });
  }
}

function appendMtlsPathModeRoutes(options: {
  hostRoutes: CaddyHttpRoute[];
  domainGroups: string[][];
  authMode: MtlsPathMode;
  locationRules: LocationRuleMeta[];
  handlers: Record<string, unknown>[];
  hostTrustedFingerprintExpression: string;
  skipHttpsHostnameValidation: boolean;
  preserveHostHeader: boolean;
  buildProtectedPathRoute: (domainGroup: string[], path: string) => CaddyHttpRoute[];
  buildExcludedPathRoute: (domainGroup: string[], path: string) => CaddyHttpRoute[];
  /** Excluded-paths mode: anything not excluded needs a trusted client cert. */
  buildProtectedCatchAll: (domainGroup: string[]) => CaddyHttpRoute[];
  /** Whitelist mode: only the listed paths are gated, so the catch-all stays open. */
  buildUnprotectedCatchAll: (domainGroup: string[]) => CaddyHttpRoute[];
  /** Full-site mode: RBAC subroutes when configured, otherwise an open catch-all. */
  buildDefaultCatchAll: (domainGroup: string[]) => CaddyHttpRoute[];
}) {
  const {
    hostRoutes,
    domainGroups,
    authMode,
    locationRules,
    handlers,
    hostTrustedFingerprintExpression,
    skipHttpsHostnameValidation,
    preserveHostHeader,
    buildProtectedPathRoute,
    buildExcludedPathRoute,
    buildProtectedCatchAll,
    buildUnprotectedCatchAll,
    buildDefaultCatchAll,
  } = options;

  for (const domainGroup of domainGroups) {
    if (authMode.type === "protected") {
      for (const protectedPath of authMode.paths) {
        hostRoutes.push(...buildProtectedPathRoute(domainGroup, protectedPath));
      }

      // Whitelist mode: only the explicitly listed paths require a certificate,
      // so location rules and the catch-all are left unprotected.
      appendLocationRoutes({
        hostRoutes,
        domainGroup,
        locationRules,
        skipHttpsHostnameValidation,
        preserveHostHeader,
        handlers,
      });

      hostRoutes.push(...buildUnprotectedCatchAll(domainGroup));
      continue;
    }

    if (authMode.type === "excluded") {
      for (const excludedPath of authMode.paths) {
        hostRoutes.push(...buildExcludedPathRoute(domainGroup, excludedPath));
      }

      // Everything outside the exclusion list is protected, location rules included:
      // an allow route gated on the trusted fingerprints, then a 403 for the rest.
      for (const rule of locationRules) {
        const { safePath, reverseProxyHandler: locationProxy } = buildLocationReverseProxy(
          rule,
          skipHttpsHostnameValidation,
          preserveHostHeader,
        );
        if (!safePath) continue;
        hostRoutes.push({
          match: [
            { host: domainGroup, path: [safePath], expression: hostTrustedFingerprintExpression },
          ],
          handle: [...handlers, locationProxy],
          terminal: true,
        });
        hostRoutes.push({
          match: [{ host: domainGroup, path: [safePath] }],
          handle: [{ handler: "static_response", status_code: "403", body: "mTLS access denied" }],
          terminal: true,
        });
      }

      hostRoutes.push(...buildProtectedCatchAll(domainGroup));
      continue;
    }

    // Full-site mode: no path carve-outs to enforce. Hosts with mTLS disabled land here too,
    // so nothing may be gated ahead of the catch-all — the catch-all (or its RBAC subroutes)
    // decides the requirement.
    appendLocationRoutes({
      hostRoutes,
      domainGroup,
      locationRules,
      skipHttpsHostnameValidation,
      preserveHostHeader,
      handlers,
    });

    hostRoutes.push(...buildDefaultCatchAll(domainGroup));
  }
}

async function buildProxyRoutes(
  context: CaddyBuildContext,
): Promise<{ routes: CaddyHttpRoute[]; errorRoutes: CaddyHttpRoute[] }> {
  const { rows, accessAccounts, tlsReadyCertificates } = context;
  const routes: CaddyHttpRoute[] = [];
  const errorRoutes: CaddyHttpRoute[] = [];
  const validClientCertExpression = buildValidClientCertCelExpression();

  // Hoisted out of the per-host loop: same answer for every host, and getting it wrong costs
  // the whole config.
  const geoblockUsable = isFeatureUsable(context.moduleAvailability, "geoblock");
  const wafUsable = isFeatureUsable(context.moduleAvailability, "waf");

  // Adapt every host's snippet up front, concurrently: each adapt is an admin-API round trip on
  // every config apply, so the cost becomes the slowest rather than the sum. Not cached — a cache
  // outliving a rebuild would hand back routes for a module that is gone.
  const adaptedCaddyfiles = new Map<number, Awaited<ReturnType<typeof adaptCaddyfileSnippet>>>();
  await Promise.all(
    rows
      .filter(
        (row) => row.enabled && parseJson<ProxyHostMeta>(row.meta, {}).custom_caddyfile?.trim(),
      )
      .map(async (row) => {
        const snippet = parseJson<ProxyHostMeta>(row.meta, {}).custom_caddyfile as string;
        try {
          adaptedCaddyfiles.set(row.id, await adaptCaddyfileSnippet(snippet));
        } catch (error) {
          // Left absent in the map; the loop below reports it per host.
          console.warn(
            `Skipping the custom Caddyfile for host "${row.name}" — Caddy could not adapt it:`,
            error instanceof Error ? error.message : error,
          );
        }
      }),
  );

  for (const row of rows) {
    if (!row.enabled) {
      continue;
    }

    // Allow hosts with certificateId = null (Caddy Auto) or with valid certificate IDs
    const isAutoManaged = !row.certificateId;
    const hasValidCertificate = row.certificateId && tlsReadyCertificates.has(row.certificateId);

    if (!isAutoManaged && !hasValidCertificate) {
      continue;
    }

    const domains = parseJson<string[]>(row.domains, []);
    if (domains.length === 0) {
      continue;
    }
    const domainGroups = groupHostPatternsByPriority(domains);

    // Require upstreams
    const upstreams = parseJson<string[]>(row.upstreams, []);
    if (upstreams.length === 0) {
      continue;
    }

    const handlers: Record<string, unknown>[] = [];
    const meta = parseJson<ProxyHostMeta>(row.meta, {});
    const authentik = parseAuthentikConfig(meta.authentik);
    const cpmForwardAuth = meta.cpm_forward_auth?.enabled ? meta.cpm_forward_auth : null;
    const locationRules = meta.location_rules ?? [];
    const hostRoutes: CaddyHttpRoute[] = [];

    const effectiveGeoBlock = resolveEffectiveGeoBlock(context.globalGeoBlock ?? null, {
      geoblock: meta.geoblock ?? null,
      geoblock_mode: meta.geoblock_mode ?? "merge",
    });
    if (effectiveGeoBlock?.enabled && geoblockUsable) {
      handlers.unshift(buildBlockerHandler(effectiveGeoBlock));
    }

    const effectiveWaf = resolveEffectiveWaf(context.globalWaf ?? null, meta.waf);
    if (effectiveWaf?.enabled && effectiveWaf.mode !== "Off" && wafUsable) {
      handlers.unshift(buildWafHandlerEntry(effectiveWaf, Boolean(row.allowWebsocket)));
    }

    if (row.hstsEnabled) {
      const value = row.hstsSubdomains ? "max-age=63072000; includeSubDomains" : "max-age=63072000";
      handlers.push({
        handler: "headers",
        response: {
          set: {
            "Strict-Transport-Security": [value],
          },
        },
      });
    }

    if (row.sslForced) {
      for (const domainGroup of domainGroups) {
        hostRoutes.push({
          match: [
            {
              host: domainGroup,
              expression: '{http.request.scheme} == "http"',
            },
          ],
          handle: [
            {
              handler: "static_response",
              status_code: 308,
              headers: {
                Location: ["https://{http.request.host}{http.request.uri}"],
              },
            },
          ],
          terminal: true,
        });
      }
    }

    // Path blocks (terminal static_response) and rewrites (URI rewrite). Allows are not standalone
    // routes — a terminal match with an empty handle returns an empty 200 — so each allow pattern
    // is folded into every block's matcher as a `not` clause. Rewrites keep their own matchers.
    const pathAllows = meta.path_allows ?? [];
    const pathBlocks = meta.path_blocks ?? [];
    const pathRewrites = meta.path_rewrites ?? [];
    if (pathBlocks.length > 0 || pathRewrites.length > 0) {
      const allowPatterns = pathAllows
        .map((a) => stripCaddyPlaceholders(a.path))
        .filter((p) => p.length > 0);
      const pathRoutes: CaddyHttpRoute[] = [];
      for (const block of pathBlocks) {
        // Sanitize path to prevent Caddy placeholder injection
        const safePath = stripCaddyPlaceholders(block.path);
        if (!safePath) continue;
        const handle: Record<string, unknown> = {
          handler: "static_response",
          status_code: block.status,
        };
        if (block.body) {
          handle.body = block.body;
        }
        const matcher: Record<string, unknown> = { path: [safePath] };
        if (allowPatterns.length > 0) {
          matcher.not = [{ path: allowPatterns }];
        }
        pathRoutes.push({
          match: [matcher],
          handle: [handle],
          terminal: true,
        });
      }
      for (const rw of pathRewrites) {
        const safeFrom = stripCaddyPlaceholders(rw.from);
        const safeTo = stripCaddyPlaceholders(rw.to);
        if (!safeFrom || !safeTo) continue;
        pathRoutes.push({
          match: [{ path: [safeFrom] }],
          handle: [
            {
              handler: "rewrite",
              uri: safeTo,
            },
          ],
        });
      }
      if (pathRoutes.length > 0) {
        handlers.push({
          handler: "subroute",
          routes: pathRoutes,
        });
      }
    }

    // Structured redirects — emitted before auth so .well-known paths work without login
    if (meta.redirects && meta.redirects.length > 0) {
      const redirectRoutes = meta.redirects.map((rule) => ({
        match: [{ path: [rule.from] }],
        handle: [
          {
            handler: "static_response",
            status_code: rule.status,
            headers: { Location: [rule.to] },
          },
        ],
      }));
      handlers.push({
        handler: "subroute",
        routes: redirectRoutes,
      });
    }

    if (row.accessListId) {
      const accounts = accessAccounts.get(row.accessListId) ?? [];
      if (accounts.length > 0) {
        handlers.push({
          handler: "authentication",
          providers: {
            http_basic: {
              accounts: accounts.map((entry) => ({
                username: entry.username,
                password: entry.passwordHash,
              })),
            },
          },
        });
      }
    }

    const lbConfig = parseLoadBalancerConfig(meta.load_balancer);
    const dnsConfig = parseDnsResolverConfig(meta.dns_resolver);
    const hostDnsResolutionConfig = parseUpstreamDnsResolutionConfig(meta.upstream_dns_resolution);
    const effectiveDnsResolution = resolveEffectiveUpstreamDnsResolution(
      context.globalUpstreamDnsResolutionSettings,
      hostDnsResolutionConfig,
    );
    const resolvedUpstreams = await resolveUpstreamDials(
      row,
      upstreams,
      dnsConfig,
      context.globalDnsSettings,
      effectiveDnsResolution,
    );

    const reverseProxyHandler: Record<string, unknown> = {
      handler: "reverse_proxy",
      upstreams: resolvedUpstreams.upstreams,
    };

    // Authentik outpost handler will be added later after protected paths
    let outpostRoute: CaddyHttpRoute | null = null;
    if (authentik) {
      // Parse the outpost upstream URL to extract host:port for Caddy's dial field
      let outpostDial: string;
      try {
        const url = new URL(authentik.outpostUpstream);
        const port = url.port || (url.protocol === "https:" ? "443" : "80");
        outpostDial = `${url.hostname}:${port}`;
      } catch {
        // If URL parsing fails, try to extract host:port from string
        outpostDial = authentik.outpostUpstream.replace(/^https?:\/\//, "").replace(/\/$/, "");
      }

      const outpostHandler: Record<string, unknown> = {
        handler: "reverse_proxy",
        upstreams: [
          {
            dial: outpostDial,
          },
        ],
      };

      if (authentik.setOutpostHostHeader) {
        outpostHandler.headers = {
          request: {
            set: {
              Host: ["{http.reverse_proxy.upstream.host}"],
            },
          },
        };
      }

      // Sanitize outpostDomain to prevent path traversal and placeholder injection
      const safeOutpostPath = stripCaddyPlaceholders(
        authentik.outpostDomain.replace(/\.\./g, ""),
      ).replace(/\/+/g, "/");

      outpostRoute = {
        match: [
          {
            path: [`/${safeOutpostPath}/*`],
          },
        ],
        handle: [outpostHandler],
        terminal: true,
      };
    }

    if (row.preserveHostHeader) {
      reverseProxyHandler.headers = {
        request: {
          set: {
            Host: ["{http.request.host}"],
          },
        },
      };
    }

    // Configure TLS transport for HTTPS upstreams
    if (resolvedUpstreams.hasHttpsUpstream) {
      const tlsTransport: Record<string, unknown> = row.skipHttpsHostnameValidation
        ? {
            insecure_skip_verify: true,
          }
        : {};
      if (resolvedUpstreams.httpsTlsServerName) {
        tlsTransport.server_name = resolvedUpstreams.httpsTlsServerName;
      }

      reverseProxyHandler.transport = {
        protocol: "http",
        tls: tlsTransport,
      };
    }

    // Configure load balancing and health checks
    if (lbConfig) {
      const loadBalancing = buildLoadBalancingConfig(lbConfig);
      if (loadBalancing) {
        reverseProxyHandler.load_balancing = loadBalancing;
      }
      const healthChecks = buildHealthChecksConfig(lbConfig);
      if (healthChecks) {
        reverseProxyHandler.health_checks = healthChecks;
      }
    }

    // Add transport-level DNS resolver config if enabled
    if (dnsConfig?.enabled && dnsConfig.resolvers.length > 0) {
      const resolverConfig = buildResolverConfig(dnsConfig);
      if (resolverConfig) {
        // Merge resolver into existing transport (preserving TLS settings for HTTPS upstreams)
        if (reverseProxyHandler.transport) {
          (reverseProxyHandler.transport as Record<string, unknown>).resolver = resolverConfig;
          if (dnsConfig.timeout) {
            (reverseProxyHandler.transport as Record<string, unknown>).dial_timeout =
              dnsConfig.timeout;
          }
        } else {
          // No existing transport, create one with resolver
          reverseProxyHandler.transport = {
            protocol: "http",
            resolver: resolverConfig,
            ...(dnsConfig.timeout ? { dial_timeout: dnsConfig.timeout } : {}),
          };
        }
      }
    }

    // Security: this field lets admins inject arbitrary Caddy reverse_proxy config, which is
    // intentional — admins have full control of the proxy configuration. mergeDeep blocks
    // __proto__/constructor/prototype, so prototype pollution is not reachable.
    const customReverseProxy = parseOptionalJson(meta.custom_reverse_proxy_json);
    if (customReverseProxy) {
      if (isPlainObject(customReverseProxy)) {
        mergeDeep(reverseProxyHandler, customReverseProxy as Record<string, unknown>);
      } else {
        console.warn(
          "Ignoring custom reverse proxy JSON because it is not an object",
          customReverseProxy,
        );
      }
    }

    // Structured path prefix rewrite
    // Sanitize path_prefix to prevent Caddy placeholder injection
    if (meta.rewrite?.path_prefix) {
      const safePrefix = stripCaddyPlaceholders(meta.rewrite.path_prefix);
      if (safePrefix) {
        handlers.push({
          handler: "rewrite",
          uri: `${safePrefix}{http.request.uri}`,
        });
      }
    }

    // Security: this field lets admins inject arbitrary Caddy HTTP handlers before the
    // reverse_proxy. Intentional — admins can add any handler (file_server, rewrite, etc.).
    const customHandlers = parseCustomHandlers(meta.custom_pre_handlers_json);
    if (customHandlers.length > 0) {
      handlers.push(...customHandlers);
    }

    // Per-host Caddyfile directives, adapted by the running Caddy binary. A snippet that no longer
    // adapts (usually a plugin switched off in Settings) is skipped with a warning: failing here
    // would take every other host down, and block the edit needed to fix it.
    const adapted = adaptedCaddyfiles.get(row.id);
    if (adapted) {
      for (const warning of adapted.warnings) {
        console.warn(`Caddyfile warning for host "${row.name}": ${warning}`);
      }
      if (adapted.ignoredApps.length > 0) {
        console.warn(
          `Ignoring non-HTTP directives in the Caddyfile for host "${row.name}": ${adapted.ignoredApps.join(", ")}`,
        );
      }
      const subroute = buildCaddyfileSubrouteHandler(adapted.routes);
      if (subroute) {
        handlers.push(subroute);
      }
    }

    if (authentik) {
      // Build handle_response routes for copying headers on 2xx status
      const handleResponseRoutes: Record<string, unknown>[] = [
        {
          handle: [{ handler: "vars" }],
        },
      ];

      // Add header copying for each configured header. The name is canonicalised because the
      // placeholder that reads the value back is matched literally against Go's canonical
      // header key — see upstreamHeaderPlaceholder.
      for (const rawHeaderName of authentik.copyHeaders) {
        const headerName = canonicalHeaderName(rawHeaderName);
        const placeholder = upstreamHeaderPlaceholder(headerName);
        handleResponseRoutes.push({
          handle: [
            {
              handler: "headers",
              request: {
                set: {
                  [headerName]: [placeholder],
                },
              },
            } as Record<string, unknown>,
          ],
          match: [
            {
              not: [
                {
                  vars: {
                    [placeholder]: [""],
                  },
                },
              ],
            },
          ],
        });
      }

      // Create the forward auth reverse_proxy handler
      // Convert "private_ranges" to actual CIDR blocks for JSON config
      const trustedProxies = authentik.trustedProxies.includes("private_ranges")
        ? ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "127.0.0.0/8", "fd00::/8", "::1/128"]
        : authentik.trustedProxies;

      // Parse the outpost upstream into host:port for dial, dropping scheme and slashes
      let dialAddress = authentik.outpostUpstream.replace(/^https?:\/\//, "").replace(/\/$/, "");
      // Remove any path portion if accidentally included
      dialAddress = dialAddress.split("/")[0];

      const forwardAuthHandler: Record<string, unknown> = {
        handler: "reverse_proxy",
        upstreams: [
          {
            dial: dialAddress,
          },
        ],
        rewrite: {
          method: "GET",
          uri: authentik.authEndpoint,
        },
        headers: {
          request: {
            set: {
              "X-Forwarded-Method": ["{http.request.method}"],
              "X-Forwarded-Uri": ["{http.request.uri}"],
            },
          },
        },
        handle_response: [
          {
            match: {
              status_code: [2],
            },
            routes: handleResponseRoutes,
          },
        ],
      };

      if (trustedProxies.length > 0) {
        forwardAuthHandler.trusted_proxies = trustedProxies;
      }

      const authMode = resolvePathAuthMode(authentik.protectedPaths, authentik.excludedPaths);

      appendForwardAuthPathModeRoutes({
        hostRoutes,
        domainGroups,
        authMode,
        baseHandlers: handlers,
        authHandler: forwardAuthHandler,
        reverseProxyHandler,
        locationRules,
        skipHttpsHostnameValidation: Boolean(row.skipHttpsHostnameValidation),
        preserveHostHeader: Boolean(row.preserveHostHeader),
        preDomainRoute: outpostRoute,
        protectedModePreRoutePlacement: "after",
      });
    } else if (cpmForwardAuth) {
      // ── CPM Forward Auth ────────────────────────────────────────────
      // Uses CPM itself as the auth provider (replaces Authentik)
      const cpmDialAddress = getCpmDialAddress();
      if (cpmDialAddress) {
        const cpmProxyProof = getForwardAuthProxyProof();
        // Canonical (Go MIME) casing is required, not cosmetic: Caddy resolves
        // `{http.reverse_proxy.header.<name>}` by literal lookup in Go's canonicalised map, so
        // "X-CPM-User" resolves to nothing and every upstream sees an anonymous request.
        const CPM_COPY_HEADERS = ["X-Cpm-User", "X-Cpm-Email", "X-Cpm-Groups", "X-Cpm-User-Id"];

        // Security: strip client-supplied CPM identity headers inbound — CPM sets these only from
        // the verify response, so accepting them lets a caller spoof identity. Must run on EVERY
        // route: unauthenticated ones have nothing else to remove them, and the copy step below
        // only overwrites when the verify value is non-empty.
        const cpmStripHeadersHandler: Record<string, unknown> = {
          handler: "headers",
          request: {
            delete: [...CPM_COPY_HEADERS],
          },
        };
        // Prepend the strip handler to the shared chain for all CPM forward-auth routes.
        const cpmHandlers = [cpmStripHeadersHandler, ...handlers];

        // Build handle_response routes for copying user headers on 2xx
        const cpmHandleResponseRoutes: Record<string, unknown>[] = [
          { handle: [{ handler: "vars" }] },
        ];
        for (const headerName of CPM_COPY_HEADERS) {
          const placeholder = upstreamHeaderPlaceholder(headerName);
          cpmHandleResponseRoutes.push({
            handle: [
              {
                handler: "headers",
                request: {
                  set: { [headerName]: [placeholder] },
                },
              } as Record<string, unknown>,
            ],
            match: [
              {
                not: [{ vars: { [placeholder]: [""] } }],
              },
            ],
          });
        }

        // Forward auth handler — subrequest to CPM verify endpoint
        const cpmForwardAuthHandler: Record<string, unknown> = {
          handler: "reverse_proxy",
          upstreams: [{ dial: cpmDialAddress }],
          rewrite: {
            method: "GET",
            uri: "/api/forward-auth/verify",
          },
          headers: {
            request: {
              set: {
                "X-Forwarded-Method": ["{http.request.method}"],
                "X-Forwarded-Uri": ["{http.request.uri}"],
                "X-Forwarded-Host": ["{http.request.hostport}"],
                "X-Forwarded-Proto": ["{http.request.scheme}"],
                [FORWARD_AUTH_PROXY_PROOF_HEADER]: [cpmProxyProof],
              },
            },
          },
          handle_response: [
            {
              match: { status_code: [2] },
              routes: cpmHandleResponseRoutes,
            },
            {
              match: { status_code: [401, 403] },
              routes: [
                {
                  handle: [
                    {
                      handler: "static_response",
                      status_code: 302,
                      headers: {
                        Location: [
                          `${config.baseUrl}/portal?rd={http.request.scheme}://{http.request.hostport}{http.request.uri}`,
                        ],
                      },
                    },
                  ],
                },
              ],
            },
          ],
          trusted_proxies: [
            "10.0.0.0/8",
            "172.16.0.0/12",
            "192.168.0.0/16",
            "127.0.0.0/8",
            "fd00::/8",
            "::1/128",
          ],
        };

        // Callback route — unprotected, so it goes before forward_auth
        const cpmCallbackRoute: CaddyHttpRoute = {
          match: [{ path: ["/.cpm-auth/callback"] }],
          handle: [
            {
              handler: "reverse_proxy",
              upstreams: [{ dial: cpmDialAddress }],
              rewrite: {
                uri: "/api/forward-auth/callback?{http.request.uri.query}",
              },
              headers: {
                request: {
                  set: {
                    "X-Forwarded-Host": ["{http.request.hostport}"],
                    "X-Forwarded-Proto": ["{http.request.scheme}"],
                    [FORWARD_AUTH_PROXY_PROOF_HEADER]: [cpmProxyProof],
                  },
                },
              },
            },
          ],
          terminal: true,
        };

        const locationRules = meta.location_rules ?? [];
        const authMode = resolvePathAuthMode(
          cpmForwardAuth.protected_paths,
          cpmForwardAuth.excluded_paths,
        );

        appendForwardAuthPathModeRoutes({
          hostRoutes,
          domainGroups,
          authMode,
          baseHandlers: cpmHandlers,
          authHandler: cpmForwardAuthHandler,
          reverseProxyHandler,
          locationRules,
          skipHttpsHostnameValidation: Boolean(row.skipHttpsHostnameValidation),
          preserveHostHeader: Boolean(row.preserveHostHeader),
          preDomainRoute: cpmCallbackRoute,
          protectedModePreRoutePlacement: "before",
        });
      }
    } else {
      const mtls = meta.mtls?.enabled ? meta.mtls : null;
      const mtlsProtectedPaths = mtls?.protected_paths?.length ? mtls.protected_paths : null;
      const mtlsExcludedPaths = mtls?.excluded_paths?.length ? mtls.excluded_paths : null;
      const mtlsPathMode = resolveMtlsPathMode(mtlsProtectedPaths, mtlsExcludedPaths);

      const hostAccessRules = context.mtlsRbac?.accessRulesByHost.get(row.id);
      const hasMtlsRbac =
        hostAccessRules &&
        hostAccessRules.length > 0 &&
        context.mtlsRbac?.roleFingerprintMap &&
        context.mtlsRbac?.certFingerprintMap;
      const hostTrustedFingerprints = mtls
        ? resolveAllowedFingerprints(
            {
              pathPattern: "*",
              allowedRoleIds: mtls.trusted_role_ids ?? [],
              allowedCertIds: mtls.trusted_client_cert_ids ?? [],
              denyAll: false,
            },
            context.mtlsRbac?.roleFingerprintMap ?? new Map(),
            context.mtlsRbac?.certFingerprintMap ?? new Map(),
          )
        : new Set<string>();
      const hostTrustedFingerprintExpression =
        hostTrustedFingerprints.size > 0
          ? buildFingerprintCelExpression(hostTrustedFingerprints)
          : validClientCertExpression;

      const buildProtectedPathRoute = (domainGroup: string[], path: string) => {
        if (hasMtlsRbac) {
          const rbacSubroutes = buildMtlsRbacSubroutes(
            hostAccessRules,
            context.mtlsRbac!.roleFingerprintMap,
            context.mtlsRbac!.certFingerprintMap,
            handlers,
            reverseProxyHandler,
            true,
            hostTrustedFingerprints,
          );
          if (rbacSubroutes) {
            return [
              {
                match: [{ host: domainGroup, path: [path] }],
                handle: [{ handler: "subroute", routes: rbacSubroutes }],
                terminal: true,
              },
            ];
          }
        }

        return [
          {
            match: [
              { host: domainGroup, path: [path], expression: hostTrustedFingerprintExpression },
            ],
            handle: [...handlers, cloneJson(reverseProxyHandler)],
            terminal: true,
          },
          {
            match: [{ host: domainGroup, path: [path] }],
            handle: [
              { handler: "static_response", status_code: "403", body: "mTLS access denied" },
            ],
            terminal: true,
          },
        ];
      };

      const buildExcludedPathRoute = (domainGroup: string[], path: string) => [
        {
          match: [{ host: domainGroup, path: [path] }],
          handle: [...handlers, cloneJson(reverseProxyHandler)],
          terminal: true,
        },
      ];

      const buildProtectedCatchAll = (domainGroup: string[]) => {
        if (hasMtlsRbac) {
          const rbacSubroutes = buildMtlsRbacSubroutes(
            hostAccessRules,
            context.mtlsRbac!.roleFingerprintMap,
            context.mtlsRbac!.certFingerprintMap,
            handlers,
            reverseProxyHandler,
            true,
            hostTrustedFingerprints,
          );
          if (rbacSubroutes) {
            return [
              {
                match: [{ host: domainGroup }],
                handle: [{ handler: "subroute", routes: rbacSubroutes }],
                terminal: true,
              },
            ];
          }
        }

        return [
          {
            match: [{ host: domainGroup, expression: hostTrustedFingerprintExpression }],
            handle: [...handlers, reverseProxyHandler],
            terminal: true,
          },
          {
            match: [{ host: domainGroup }],
            handle: [
              { handler: "static_response", status_code: "403", body: "mTLS access denied" },
            ],
            terminal: true,
          },
        ];
      };

      // Open catch-all: no client certificate required. Used by whitelist mode (only listed
      // paths are gated) and as the full-site fallback.
      const buildUnprotectedCatchAll = (domainGroup: string[]): CaddyHttpRoute[] => [
        {
          match: [{ host: domainGroup }],
          handle: [...handlers, reverseProxyHandler],
          terminal: true,
        },
      ];

      // Full-site mode. RBAC rules, when present, carry their own per-path allow/deny, and
      // requireValidClientCertByDefault stays false so unruled paths are proxied rather than
      // denied. With no RBAC rules — including hosts with mTLS off entirely — the host is open.
      const buildDefaultCatchAll = (domainGroup: string[]): CaddyHttpRoute[] => {
        if (hasMtlsRbac) {
          const rbacSubroutes = buildMtlsRbacSubroutes(
            hostAccessRules,
            context.mtlsRbac!.roleFingerprintMap,
            context.mtlsRbac!.certFingerprintMap,
            handlers,
            reverseProxyHandler,
          );
          if (rbacSubroutes) {
            return [
              {
                match: [{ host: domainGroup }],
                handle: [{ handler: "subroute", routes: rbacSubroutes }],
                terminal: true,
              },
            ];
          }
        }

        return buildUnprotectedCatchAll(domainGroup);
      };

      appendMtlsPathModeRoutes({
        hostRoutes,
        domainGroups,
        authMode: mtlsPathMode,
        locationRules,
        handlers,
        hostTrustedFingerprintExpression,
        skipHttpsHostnameValidation: Boolean(row.skipHttpsHostnameValidation),
        preserveHostHeader: Boolean(row.preserveHostHeader),
        buildProtectedPathRoute,
        buildExcludedPathRoute,
        buildProtectedCatchAll,
        buildUnprotectedCatchAll,
        buildDefaultCatchAll,
      });
    }

    routes.push(...hostRoutes);

    // Per-host error pages, scoped to this host's domains. Collected separately so
    // they can be attached to the server-level `errors` block (handle_errors).
    if (meta.error_pages && meta.error_pages.length > 0) {
      for (const rule of meta.error_pages) {
        errorRoutes.push(buildErrorPageRoute(rule, domains));
      }
    }
  }

  return { routes: sortRoutesByHostPriority(routes), errorRoutes };
}

type TlsConnectionPolicyContext = {
  usage: Map<number, CertificateUsage>;
  managedCertificatesWithAutomation: Set<number>;
  autoManagedDomains: Set<string>;
  mTlsDomainMap: Map<string, number[]>;
  caCertMap: Map<number, { id: number; certificatePem: string }>;
  issuedClientCertMap: Map<number, string[]>;
  cAsWithAnyIssuedCerts: Set<number>;
  mTlsDomainLeafOverride: Map<string, string[]>;
  mTlsOptionalAuthDomains: Set<string>;
};

function buildTlsConnectionPolicies(context: TlsConnectionPolicyContext) {
  const {
    usage,
    managedCertificatesWithAutomation,
    autoManagedDomains,
    mTlsDomainMap,
    caCertMap,
    issuedClientCertMap,
    cAsWithAnyIssuedCerts,
    mTlsDomainLeafOverride,
    mTlsOptionalAuthDomains,
  } = context;
  const policies: Record<string, unknown>[] = [];
  const readyCertificates = new Set<number>();
  const importedCertPems: { certificate: string; key: string }[] = [];

  const buildAuth = (
    domains: string[],
    mode: "require_and_verify" | "verify_if_given" | "request",
  ) =>
    buildClientAuthentication(
      domains,
      mTlsDomainMap,
      caCertMap,
      issuedClientCertMap,
      cAsWithAnyIssuedCerts,
      mTlsDomainLeafOverride,
      mode,
    );

  /** One TLS policy per unique CA set, so a CA_B cert cannot authenticate against a CA_A host. */
  const pushMtlsPolicies = (mTlsDomains: string[]) => {
    const scopedDomains = mTlsDomains.filter((domain) => mTlsOptionalAuthDomains.has(domain));
    const requiredDomains = mTlsDomains.filter((domain) => !mTlsOptionalAuthDomains.has(domain));

    for (const [domains, mode] of [
      [requiredDomains, "require_and_verify"],
      [scopedDomains, "request"],
    ] as const) {
      if (domains.length === 0) continue;

      const groups = groupMtlsDomainsByCaSet(domains, mTlsDomainMap);
      for (const domainGroup of groups.values()) {
        for (const priorityGroup of groupHostPatternsByPriority(domainGroup)) {
          const mTlsAuth = buildAuth(priorityGroup, mode);
          if (mTlsAuth) {
            policies.push({ match: { sni: priorityGroup }, client_authentication: mTlsAuth });
          } else {
            // All CAs have all certs revoked — drop connections rather than allow through without mTLS
            policies.push({ match: { sni: priorityGroup }, drop: true });
          }
        }
      }
    }
  };

  // Add policy for auto-managed domains (certificateId = null)
  if (autoManagedDomains.size > 0) {
    const domains = Array.from(autoManagedDomains);
    // Split first so mTLS domains always get their own policy, regardless of auth result.
    const mTlsDomains = domains.filter((d) => mTlsDomainMap.has(d));
    const nonMTlsDomains = domains.filter((d) => !mTlsDomainMap.has(d));

    if (mTlsDomains.length > 0) {
      pushMtlsPolicies(mTlsDomains);
    }
    for (const priorityGroup of groupHostPatternsByPriority(nonMTlsDomains)) {
      policies.push({ match: { sni: priorityGroup } });
    }
  }

  for (const [id, entry] of usage.entries()) {
    const domains = Array.from(entry.domains);
    if (domains.length === 0) {
      continue;
    }

    if (entry.certificate.type === "imported") {
      if (!entry.certificate.certificatePem || !entry.certificate.privateKeyPem) {
        continue;
      }

      // Collect PEMs for tls.certificates.load_pem (inline, no shared filesystem needed)
      importedCertPems.push({
        certificate: entry.certificate.certificatePem.trim(),
        key: entry.certificate.privateKeyPem.trim(),
      });

      const mTlsDomains = domains.filter((d) => mTlsDomainMap.has(d));
      const nonMTlsDomains = domains.filter((d) => !mTlsDomainMap.has(d));

      if (mTlsDomains.length > 0) {
        pushMtlsPolicies(mTlsDomains);
      }
      for (const priorityGroup of groupHostPatternsByPriority(nonMTlsDomains)) {
        policies.push({ match: { sni: priorityGroup } });
      }

      readyCertificates.add(id);
      continue;
    }

    if (entry.certificate.type === "managed") {
      if (!managedCertificatesWithAutomation.has(id)) {
        continue;
      }

      const mTlsDomains = domains.filter((d) => mTlsDomainMap.has(d));
      const nonMTlsDomains = domains.filter((d) => !mTlsDomainMap.has(d));

      if (mTlsDomains.length > 0) {
        pushMtlsPolicies(mTlsDomains);
      }
      for (const priorityGroup of groupHostPatternsByPriority(nonMTlsDomains)) {
        policies.push({ match: { sni: priorityGroup } });
      }

      readyCertificates.add(id);
    }
  }

  return {
    policies: sortTlsPoliciesBySniPriority(policies),
    readyCertificates,
    importedCertPems,
  };
}

type TlsAutomationContext = {
  usage: Map<number, CertificateUsage>;
  autoManagedDomains: Set<string>;
  options: {
    acmeEmail?: string;
    dnsSettings?: DnsSettings | null;
    dnsProviderSettings?: DnsProviderSettings | null;
    acmeSettings?: AcmeSettings | null;
    /**
     * Omitted means "do not gate" — callers exercising only ACME policy shapes have no module
     * selection. buildCaddyDocument always passes it, so the real config path is always gated.
     */
    moduleAvailability?: CaddyModuleAvailability;
  };
};

export async function buildTlsAutomation(
  usageOrContext: Map<number, CertificateUsage> | TlsAutomationContext,
  autoManagedDomainsOrOptions?:
    | Set<string>
    | {
        acmeEmail?: string;
        dnsSettings?: DnsSettings | null;
        dnsProviderSettings?: DnsProviderSettings | null;
        acmeSettings?: AcmeSettings | null;
        moduleAvailability?: CaddyModuleAvailability;
      },
  maybeOptions?: {
    acmeEmail?: string;
    dnsSettings?: DnsSettings | null;
    dnsProviderSettings?: DnsProviderSettings | null;
    acmeSettings?: AcmeSettings | null;
    moduleAvailability?: CaddyModuleAvailability;
  },
): Promise<{
  tlsApp?: { automation: { policies: Record<string, unknown>[] } };
  managedCertificateIds: Set<number>;
}> {
  const usage = usageOrContext instanceof Map ? usageOrContext : usageOrContext.usage;
  const autoManagedDomains =
    usageOrContext instanceof Map
      ? autoManagedDomainsOrOptions instanceof Set
        ? autoManagedDomainsOrOptions
        : new Set<string>()
      : usageOrContext.autoManagedDomains;
  const options =
    usageOrContext instanceof Map
      ? autoManagedDomainsOrOptions && !(autoManagedDomainsOrOptions instanceof Set)
        ? autoManagedDomainsOrOptions
        : (maybeOptions ?? {})
      : {
          ...(usageOrContext as TlsAutomationContext).options,
          ...(maybeOptions ?? {}),
        };

  const managedEntries = Array.from(usage.values()).filter(
    (entry) => entry.certificate.type === "managed" && Boolean(entry.certificate.autoRenew),
  );

  const hasAutoManagedDomains = autoManagedDomains.size > 0;

  if (managedEntries.length === 0 && !hasAutoManagedDomains) {
    return {
      managedCertificateIds: new Set<number>(),
      tlsApp: undefined,
    };
  }

  const dnsProviderSettings = options.dnsProviderSettings;
  const globalDnsProvider: DnsProviderCredentials | null =
    dnsProviderSettings?.default && dnsProviderSettings.providers[dnsProviderSettings.default]
      ? {
          provider: dnsProviderSettings.default,
          credentials: dnsProviderSettings.providers[dnsProviderSettings.default],
        }
      : null;

  const dnsSettings = options.dnsSettings;
  // Primary resolvers first, then fallbacks, so DNS-01 validation still has somewhere to go
  // when the primary is unreachable.
  const dnsResolvers: string[] = [];
  if (
    dnsSettings?.enabled &&
    Array.isArray(dnsSettings.resolvers) &&
    dnsSettings.resolvers.length > 0
  ) {
    dnsResolvers.push(...dnsSettings.resolvers);
    if (dnsSettings.fallbacks && dnsSettings.fallbacks.length > 0) {
      dnsResolvers.push(...dnsSettings.fallbacks);
    }
  }

  /**
   * A DNS-01 challenge names its provider module, so an uncompiled caddy-dns plugin is unusable.
   * Dropping just `challenges.dns` degrades to HTTP-01 (wildcards fail) rather than having Caddy
   * reject the whole config.
   */
  const dnsProviderAllowed = (providerName: string): boolean => {
    const availability = options.moduleAvailability;
    if (!availability) return true;
    if (isDnsProviderUsable(availability, providerName)) return true;
    console.warn(
      `Skipping the ACME DNS-01 challenge for "${providerName}": its Caddy DNS module is not ` +
        "enabled in Settings → Caddy Build, or the caddy image has not been rebuilt with it yet.",
    );
    return false;
  };

  const policies: Record<string, unknown>[] = [];
  const managedCertificateIds = new Set<number>();

  // Custom ACME directory URL + trusted root for internal CAs (OpenBao, Step-CA, etc.).
  // Resolved once per build: syncAcmeCaRootFile touches the filesystem, and the result applies
  // to every issuer across every subject group.
  const customAcmeUrl = (options.acmeSettings?.caUrl ?? "").trim();
  const acmeRootPath = syncAcmeCaRootFile(options.acmeSettings?.caRootPem);

  const applyAcmeOverrides = (issuer: Record<string, unknown>) => {
    if (customAcmeUrl) {
      issuer.ca = customAcmeUrl;
    }

    if (acmeRootPath) {
      issuer.trusted_roots_pem_files = [acmeRootPath];
    }
  };

  // Add policy for auto-managed domains (certificateId = null)
  if (hasAutoManagedDomains) {
    for (const subjects of groupHostPatternsByPriority(Array.from(autoManagedDomains))) {
      const issuer: Record<string, unknown> = { module: "acme" };
      applyAcmeOverrides(issuer);

      if (options.acmeEmail) {
        issuer.email = options.acmeEmail;
      }

      if (globalDnsProvider && dnsProviderAllowed(globalDnsProvider.provider)) {
        const dnsChallenge = buildDnsChallengeConfig(
          globalDnsProvider.provider,
          globalDnsProvider.credentials,
          dnsResolvers,
        );
        if (dnsChallenge) {
          issuer.challenges = { dns: dnsChallenge };
        }
      }

      policies.push({
        subjects,
        issuers: [issuer],
      });
    }
  }

  // Add policies for explicitly managed certificates
  for (const entry of managedEntries) {
    const subjects = Array.from(entry.domains);
    if (subjects.length === 0) {
      continue;
    }

    managedCertificateIds.add(entry.certificate.id);

    let effectiveProvider = globalDnsProvider;
    const certOptions = entry.certificate.providerOptions as { provider?: string } | null;
    if (certOptions?.provider && dnsProviderSettings?.providers[certOptions.provider]) {
      effectiveProvider = {
        provider: certOptions.provider,
        credentials: dnsProviderSettings.providers[certOptions.provider],
      };
    }

    for (const subjectGroup of groupHostPatternsByPriority(subjects)) {
      const issuer: Record<string, unknown> = { module: "acme" };
      applyAcmeOverrides(issuer);

      if (options.acmeEmail) {
        issuer.email = options.acmeEmail;
      }

      if (effectiveProvider && dnsProviderAllowed(effectiveProvider.provider)) {
        const dnsChallenge = buildDnsChallengeConfig(
          effectiveProvider.provider,
          effectiveProvider.credentials,
          dnsResolvers,
        );
        if (dnsChallenge) {
          issuer.challenges = { dns: dnsChallenge };
        }
      }

      policies.push({
        subjects: subjectGroup,
        issuers: [issuer],
      });
    }
  }

  if (policies.length === 0) {
    return {
      managedCertificateIds,
      tlsApp: undefined,
    };
  }

  return {
    tlsApp: {
      automation: {
        policies: sortAutomationPoliciesBySubjectPriority(policies),
      },
    },
    managedCertificateIds,
  };
}

type L4BuildContext = Pick<
  CaddyBuildContext,
  | "globalDnsSettings"
  | "globalUpstreamDnsResolutionSettings"
  | "globalGeoBlock"
  | "moduleAvailability"
>;

async function buildL4Servers(context: L4BuildContext): Promise<Record<string, unknown> | null> {
  // The entire layer4 app comes from caddy-l4. Without it there is no `layer4` key to
  // unmarshal, so emitting one would fail the whole config — HTTP hosts included.
  if (!isFeatureUsable(context.moduleAvailability, "l4")) return null;

  const l4Hosts = await db.select().from(l4ProxyHosts).where(eq(l4ProxyHosts.enabled, true));

  if (l4Hosts.length === 0) return null;

  const geoblockUsable = isFeatureUsable(context.moduleAvailability, "geoblock");

  // Group hosts by listen address — multiple hosts on the same port share routes in one server
  const serverMap = new Map<string, typeof l4Hosts>();
  for (const host of l4Hosts) {
    const key = host.listenAddress;
    if (!serverMap.has(key)) serverMap.set(key, []);
    serverMap.get(key)!.push(host);
  }

  const servers: Record<string, unknown> = {};
  let serverIdx = 0;
  for (const [listenAddr, hosts] of serverMap) {
    const routes: Record<string, unknown>[] = [];

    for (const host of hosts) {
      const route: Record<string, unknown> = {};

      // Build matchers
      const matcherType = host.matcherType as string;
      const matcherValues = host.matcherValue ? parseJson<string[]>(host.matcherValue, []) : [];

      if (matcherType === "tls_sni" && matcherValues.length > 0) {
        route.match = [{ tls: { sni: matcherValues } }];
      } else if (matcherType === "http_host" && matcherValues.length > 0) {
        route.match = [{ http: [{ host: matcherValues }] }];
      } else if (matcherType === "proxy_protocol") {
        route.match = [{ proxy_protocol: {} }];
      }
      // "none" = no match block (catch-all)

      // Parse per-host meta for load balancing, DNS resolver, and upstream DNS resolution
      const meta = parseJson<L4Meta>(host.meta, {});

      // Load balancer config
      const lbMeta = meta.load_balancer;
      let lbConfig: LoadBalancerRouteConfig | null = null;
      if (lbMeta?.enabled) {
        lbConfig = {
          enabled: true,
          policy: lbMeta.policy ?? "random",
          policyHeaderField: null,
          policyCookieName: null,
          policyCookieSecret: null,
          tryDuration: lbMeta.try_duration ?? null,
          tryInterval: lbMeta.try_interval ?? null,
          retries: lbMeta.retries ?? null,
          activeHealthCheck: lbMeta.active_health_check?.enabled
            ? {
                enabled: true,
                uri: null,
                port: lbMeta.active_health_check.port ?? null,
                interval: lbMeta.active_health_check.interval ?? null,
                timeout: lbMeta.active_health_check.timeout ?? null,
                status: null,
                body: null,
              }
            : null,
          passiveHealthCheck: lbMeta.passive_health_check?.enabled
            ? {
                enabled: true,
                failDuration: lbMeta.passive_health_check.fail_duration ?? null,
                maxFails: lbMeta.passive_health_check.max_fails ?? null,
                unhealthyStatus: null,
                unhealthyLatency: lbMeta.passive_health_check.unhealthy_latency ?? null,
              }
            : null,
        };
      }

      // DNS resolver config
      const dnsConfig = parseDnsResolverConfig(meta.dns_resolver);

      // Upstream DNS resolution (pinning)
      const hostDnsResolution = parseUpstreamDnsResolutionConfig(meta.upstream_dns_resolution);
      const effectiveDnsResolution = resolveEffectiveUpstreamDnsResolution(
        context.globalUpstreamDnsResolutionSettings,
        hostDnsResolution,
      );

      // Build handler chain
      const handlers: Record<string, unknown>[] = [];

      // 1. Receive inbound proxy protocol
      if (host.proxyProtocolReceive) {
        handlers.push({ handler: "proxy_protocol" });
      }

      // 2. TLS termination
      if (host.tlsTermination) {
        handlers.push({ handler: "tls" });
      }

      // 3. Proxy handler
      const upstreams = parseJson<string[]>(host.upstreams, []);

      // Resolve upstream hostnames to IPs if DNS pinning is enabled
      let resolvedDials = upstreams;
      if (effectiveDnsResolution.enabled) {
        const resolver = new Resolver();
        const lookupServers = getLookupServers(dnsConfig, context.globalDnsSettings);
        if (lookupServers.length > 0) {
          try {
            resolver.setServers(lookupServers);
          } catch {
            /* ignore invalid servers */
          }
        }
        const timeoutMs = getLookupTimeoutMs(dnsConfig, context.globalDnsSettings);

        const pinned: string[] = [];
        for (const upstream of upstreams) {
          const colonIdx = upstream.lastIndexOf(":");
          if (colonIdx <= 0) {
            pinned.push(upstream);
            continue;
          }
          const hostPart = upstream.substring(0, colonIdx);
          const portPart = upstream.substring(colonIdx + 1);
          if (isIP(hostPart) !== 0) {
            pinned.push(upstream);
            continue;
          }
          try {
            const addresses = await resolveHostnameAddresses(
              resolver,
              hostPart,
              effectiveDnsResolution.family,
              timeoutMs,
            );
            for (const addr of addresses) {
              pinned.push(addr.includes(":") ? `[${addr}]:${portPart}` : `${addr}:${portPart}`);
            }
          } catch {
            pinned.push(upstream);
          }
        }
        resolvedDials = pinned;
      }

      // For UDP hosts, upstream dials must also use the udp/ prefix
      const dialPrefix = (host.protocol as string) === "udp" ? "udp/" : "";
      const proxyHandler: Record<string, unknown> = {
        handler: "proxy",
        upstreams: resolvedDials.map((u) => ({ dial: [`${dialPrefix}${u}`] })),
      };
      if (host.proxyProtocolVersion) {
        proxyHandler.proxy_protocol = host.proxyProtocolVersion;
      }
      if (lbConfig) {
        const loadBalancing = buildLoadBalancingConfig(lbConfig);
        if (loadBalancing) proxyHandler.load_balancing = loadBalancing;
        const healthChecks = buildHealthChecksConfig(lbConfig);
        if (healthChecks) proxyHandler.health_checks = healthChecks;
      }
      handlers.push(proxyHandler);

      route.handle = handlers;

      // Geo blocking: a blocking route BEFORE the proxy route. At L4 the blocker is a matcher
      // (layer4.matchers.blocker) — blocked connections match this route and are closed, the
      // rest fall through to the proxy route.
      const effectiveGeoBlock = resolveEffectiveGeoBlock(context.globalGeoBlock ?? null, {
        geoblock: meta.geoblock ?? null,
        geoblock_mode: meta.geoblock_mode ?? "merge",
      });
      if (effectiveGeoBlock && geoblockUsable) {
        const blockerMatcher = buildGeoBlockMatcher(effectiveGeoBlock);

        // Build the same route matcher as the proxy route (if any)
        const blockRoute: Record<string, unknown> = {
          match: [
            {
              blocker: blockerMatcher,
              ...(route.match ? (route.match as Record<string, unknown>[])[0] : {}),
            },
          ],
          handle: [{ handler: "close" }],
        };
        routes.push(blockRoute);
      }

      routes.push(route);
    }

    // Protocol comes from the hosts on this listen address; all of them must agree.
    const protocol = hosts[0].protocol as string;
    const listenValue = protocol === "udp" ? `udp/${listenAddr}` : listenAddr;

    servers[`l4_server_${serverIdx++}`] = {
      listen: [listenValue],
      routes,
    };
  }

  return servers;
}

export async function buildCaddyDocument() {
  const [
    proxyHostRecords,
    certRows,
    accessListEntryRecords,
    caCertRows,
    issuedClientCertRows,
    allIssuedCaCertIds,
  ] = await Promise.all([
    db
      .select({
        id: proxyHosts.id,
        name: proxyHosts.name,
        domains: proxyHosts.domains,
        upstreams: proxyHosts.upstreams,
        certificateId: proxyHosts.certificateId,
        accessListId: proxyHosts.accessListId,
        sslForced: proxyHosts.sslForced,
        hstsEnabled: proxyHosts.hstsEnabled,
        hstsSubdomains: proxyHosts.hstsSubdomains,
        allowWebsocket: proxyHosts.allowWebsocket,
        preserveHostHeader: proxyHosts.preserveHostHeader,
        skipHttpsHostnameValidation: proxyHosts.skipHttpsHostnameValidation,
        meta: proxyHosts.meta,
        enabled: proxyHosts.enabled,
      })
      .from(proxyHosts),
    db
      .select({
        id: certificates.id,
        name: certificates.name,
        type: certificates.type,
        domainNames: certificates.domainNames,
        certificatePem: certificates.certificatePem,
        privateKeyPem: certificates.privateKeyPem,
        autoRenew: certificates.autoRenew,
        providerOptions: certificates.providerOptions,
      })
      .from(certificates),
    db
      .select({
        accessListId: accessListEntries.accessListId,
        username: accessListEntries.username,
        passwordHash: accessListEntries.passwordHash,
      })
      .from(accessListEntries),
    db
      .select({
        id: caCertificates.id,
        certificatePem: caCertificates.certificatePem,
      })
      .from(caCertificates),
    db
      .select({
        id: issuedClientCertificates.id,
        caCertificateId: issuedClientCertificates.caCertificateId,
        certificatePem: issuedClientCertificates.certificatePem,
      })
      .from(issuedClientCertificates)
      .where(isNull(issuedClientCertificates.revokedAt)),
    // Distinct CA IDs that have ever had a tracked issued cert (including revoked). Tells
    // "managed" CAs (pin to leaf certs) from "unmanaged" ones (trust any cert they signed).
    db
      .selectDistinct({ caCertificateId: issuedClientCertificates.caCertificateId })
      .from(issuedClientCertificates),
  ]);

  const proxyHostRows: ProxyHostRow[] = proxyHostRecords.map((h) => ({
    id: h.id,
    name: h.name,
    domains: h.domains,
    upstreams: h.upstreams,
    certificateId: h.certificateId,
    accessListId: h.accessListId,
    sslForced: h.sslForced ? 1 : 0,
    hstsEnabled: h.hstsEnabled ? 1 : 0,
    hstsSubdomains: h.hstsSubdomains ? 1 : 0,
    allowWebsocket: h.allowWebsocket ? 1 : 0,
    preserveHostHeader: h.preserveHostHeader ? 1 : 0,
    skipHttpsHostnameValidation: h.skipHttpsHostnameValidation ? 1 : 0,
    meta: h.meta,
    enabled: h.enabled ? 1 : 0,
  }));

  const certRowsMapped: CertificateRow[] = certRows.map((c: (typeof certRows)[0]) => ({
    id: c.id,
    name: c.name,
    type: c.type as "managed" | "imported",
    domainNames: c.domainNames,
    certificatePem: c.certificatePem,
    privateKeyPem: c.privateKeyPem
      ? decryptSecret(c.privateKeyPem, `certificate "${c.name}"`)
      : null,
    autoRenew: c.autoRenew ? 1 : 0,
    providerOptions: c.providerOptions,
  }));

  const accessListEntryRows: AccessListEntryRow[] = accessListEntryRecords.map((entry) => ({
    accessListId: entry.accessListId,
    username: entry.username,
    passwordHash: entry.passwordHash,
  }));

  const certificateMap = new Map(certRowsMapped.map((cert) => [cert.id, cert]));
  const caCertMap = new Map(caCertRows.map((ca) => [ca.id, ca]));
  const issuedClientCertMap = issuedClientCertRows.reduce<Map<number, string[]>>((map, record) => {
    const current = map.get(record.caCertificateId) ?? [];
    current.push(record.certificatePem);
    map.set(record.caCertificateId, current);
    return map;
  }, new Map());
  const cAsWithAnyIssuedCerts = new Set(allIssuedCaCertIds.map((r) => r.caCertificateId));
  const accessMap = accessListEntryRows.reduce<Map<number, AccessListEntryRow[]>>((map, entry) => {
    if (!map.has(entry.accessListId)) {
      map.set(entry.accessListId, []);
    }
    map.get(entry.accessListId)!.push(entry);
    return map;
  }, new Map());

  // Build a lookup: issued cert ID → { id, caCertificateId, certificatePem } (active only)
  const issuedCertById = new Map(issuedClientCertRows.map((r) => [r.id, r]));

  // Resolve role IDs → cert IDs for trusted_role_ids in mTLS config
  const roleCertIdMap = await buildRoleCertIdMap();

  // Domain → CA cert IDs map for mTLS-enabled hosts. New model (trusted_client_cert_ids +
  // trusted_role_ids): derive CAs from the selected certs and pin to those certs. Old model
  // (ca_certificate_ids): trust entire CAs.
  const mTlsDomainMap = new Map<string, number[]>();
  // Per-domain override: which specific leaf cert PEMs to pin (new model only)
  const mTlsDomainLeafOverride = new Map<string, string[]>();
  const mTlsOptionalAuthDomains = new Set<string>();
  for (const row of proxyHostRows) {
    if (!row.enabled) continue;
    const meta = parseJson<{ mtls?: MtlsConfig }>(row.meta, {});
    if (!meta.mtls?.enabled) continue;

    const domains = parseJson<string[]>(row.domains, [])
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean);
    if (domains.length === 0) continue;

    if (meta.mtls.protected_paths?.length || meta.mtls.excluded_paths?.length) {
      for (const domain of domains) {
        mTlsOptionalAuthDomains.add(domain);
      }
    }

    // Collect all trusted cert IDs from both direct selection and roles
    const allCertIds = new Set<number>();
    if (meta.mtls.trusted_client_cert_ids) {
      for (const id of meta.mtls.trusted_client_cert_ids) allCertIds.add(id);
    }
    if (meta.mtls.trusted_role_ids) {
      for (const roleId of meta.mtls.trusted_role_ids) {
        const certIds = roleCertIdMap.get(roleId);
        if (certIds) for (const id of certIds) allCertIds.add(id);
      }
    }

    if (allCertIds.size > 0) {
      // New model: pin trust to the explicitly-selected client certs — derive their CAs for
      // chain validation and collect the leaf PEMs for pinning.
      const derivedCaIds = new Set<number>();
      const leafPems: string[] = [];
      for (const certId of allCertIds) {
        const cert = issuedCertById.get(certId);
        if (cert) {
          derivedCaIds.add(cert.caCertificateId);
          leafPems.push(cert.certificatePem);
        }
      }
      if (leafPems.length > 0) {
        const caIdArr = Array.from(derivedCaIds);
        for (const domain of domains) {
          mTlsDomainMap.set(domain, caIdArr);
          mTlsDomainLeafOverride.set(domain, leafPems);
        }
      } else {
        // Every selected cert/role resolved to ZERO active leaves. FAIL CLOSED: do NOT fall back to
        // whole-CA trust, which would admit other certs of that CA never assigned to this host.
        // require_and_verify with an empty trust set → buildClientAuthentication null → drop-all.
        for (const domain of domains) {
          mTlsDomainMap.set(domain, []);
          mTlsOptionalAuthDomains.delete(domain);
        }
      }
    } else if (meta.mtls.ca_certificate_ids?.length) {
      // Legacy model: trust entire CAs (backward compat)
      for (const domain of domains) {
        mTlsDomainMap.set(domain, meta.mtls.ca_certificate_ids);
      }
    } else {
      // mTLS enabled but nothing resolved (role-only trust fully revoked, or nothing selected) and
      // no legacy CA trust. FAIL CLOSED: keep the domain with an empty CA set (→ drop-all policy)
      // and force require_and_verify, so even protected/excluded-path hosts reject everything.
      for (const domain of domains) {
        mTlsDomainMap.set(domain, []);
        mTlsOptionalAuthDomains.delete(domain);
      }
    }
  }

  // Build mTLS RBAC data for HTTP-layer enforcement
  const enabledProxyHostIds = proxyHostRows.filter((r) => r.enabled).map((r) => r.id);
  const [roleFingerprintMap, certFingerprintMap, accessRulesByHost] = await Promise.all([
    buildRoleFingerprintMap(),
    buildCertFingerprintMap(),
    getAccessRulesForHosts(enabledProxyHostIds),
  ]);

  const { usage: certificateUsage, autoManagedDomains } = collectCertificateUsage(
    proxyHostRows,
    certificateMap,
  );
  const [
    generalSettings,
    acmeSettings,
    dnsSettings,
    dnsProviderSettings,
    upstreamDnsResolutionSettings,
    globalGeoBlock,
    globalWaf,
    trustedProxiesSettings,
    moduleAvailability,
    defaultResponseSettings,
  ] = await Promise.all([
    getGeneralSettings(),
    getAcmeSettings(),
    getDnsSettings(),
    getDnsProviderSettings(),
    getUpstreamDnsResolutionSettings(),
    getGeoBlockSettings(),
    getWafSettings(),
    getTrustedProxiesSettings(),
    getCaddyModuleAvailability(),
    getDefaultResponseSettings(),
  ]);

  // Optionally seed the global geoblock trusted-proxy list from the server-level value so the
  // two can't silently disagree (issue #222). Applied only as a default: an explicit per-scope
  // geoblock list is left untouched.
  let effectiveGlobalGeoBlock = globalGeoBlock;
  if (trustedProxiesSettings?.default_geoblock && globalGeoBlock) {
    const serverRanges = (trustedProxiesSettings.ranges ?? []).map((r) => r.trim()).filter(Boolean);
    if (serverRanges.length > 0 && !globalGeoBlock.trusted_proxies?.length) {
      effectiveGlobalGeoBlock = { ...globalGeoBlock, trusted_proxies: serverRanges };
    }
  }
  const { tlsApp, managedCertificateIds } = await buildTlsAutomation({
    usage: certificateUsage,
    autoManagedDomains,
    options: {
      acmeEmail: generalSettings?.acmeEmail,
      dnsSettings,
      dnsProviderSettings,
      acmeSettings,
      moduleAvailability,
    },
  });
  const {
    policies: tlsConnectionPolicies,
    readyCertificates,
    importedCertPems,
  } = buildTlsConnectionPolicies({
    usage: certificateUsage,
    managedCertificatesWithAutomation: managedCertificateIds,
    autoManagedDomains,
    mTlsDomainMap,
    caCertMap,
    issuedClientCertMap,
    cAsWithAnyIssuedCerts,
    mTlsDomainLeafOverride,
    mTlsOptionalAuthDomains,
  });

  const caddyBuildContext: CaddyBuildContext = {
    rows: proxyHostRows,
    accessAccounts: accessMap,
    tlsReadyCertificates: readyCertificates,
    globalDnsSettings: dnsSettings,
    globalUpstreamDnsResolutionSettings: upstreamDnsResolutionSettings,
    globalGeoBlock: effectiveGlobalGeoBlock,
    globalWaf,
    moduleAvailability,
    mtlsRbac: {
      roleFingerprintMap,
      certFingerprintMap,
      accessRulesByHost,
    },
  };

  const { routes: httpRoutes, errorRoutes: hostErrorRoutes } =
    await buildProxyRoutes(caddyBuildContext);

  // An administrator-configured matcher-less route replaces Caddy's native
  // unmatched-request behavior and must remain last so it cannot shadow any
  // managed proxy host.
  const defaultResponseRoute = buildDefaultResponseRoute(defaultResponseSettings);
  const mainRoutes = defaultResponseRoute ? [...httpRoutes, defaultResponseRoute] : httpRoutes;

  // Server-level error routes (Caddy handle_errors): per-host rules first so they
  // take precedence, then global rules act as a fallback for any unmatched host/status.
  const globalErrorPages = await getErrorPagesSettings();
  const globalErrorRoutes = (globalErrorPages?.rules ?? []).map((rule) =>
    buildErrorPageRoute(rule),
  );
  const errorRoutes: CaddyHttpRoute[] = [...hostErrorRoutes, ...globalErrorRoutes];

  const hasTls = tlsConnectionPolicies.length > 0;

  // Check if metrics should be enabled
  const metricsSettings = await getMetricsSettings();
  const metricsEnabled = metricsSettings?.enabled ?? false;
  const metricsPort = metricsSettings?.port ?? 9090;

  // Check if access logging should be enabled
  const loggingSettings = await getLoggingSettings();
  const loggingEnabled = loggingSettings?.enabled ?? false;
  const loggingFormat = loggingSettings?.format ?? "json";

  const servers: Record<string, unknown> = {};

  // Server-level trusted proxies / client-IP headers. Caddy resolves client_ip in core before
  // any handler, so this is the only place a global list fixes client-IP attribution.
  const serverTrustedProxies = buildServerTrustedProxies(trustedProxiesSettings);

  // Main HTTP/HTTPS server for proxy hosts
  if (mainRoutes.length > 0) {
    servers.cpm = {
      listen: hasTls ? [":80", ":443"] : [":80"],
      routes: mainRoutes,
      // Only disable automatic HTTPS if we have TLS automation policies
      // This allows Caddy to handle HTTP-01 challenges for managed certificates
      ...(tlsApp ? {} : { automatic_https: { disable: true } }),
      ...(hasTls ? { tls_connection_policies: tlsConnectionPolicies } : {}),
      // Custom error pages (handle_errors)
      ...(errorRoutes.length > 0 ? { errors: { routes: errorRoutes } } : {}),
      // Trusted proxies / client_ip_headers / trusted_proxies_strict (issue #222)
      ...serverTrustedProxies,
      // Enable access logging if configured
      ...(loggingEnabled ? { logs: { default_logger_name: "http_access" } } : {}),
    };
  }

  // Metrics server - exposes /metrics endpoint on separate port
  if (metricsEnabled) {
    servers.metrics = {
      listen: [`:${metricsPort}`],
      routes: [
        {
          handle: [
            {
              handler: "reverse_proxy",
              upstreams: [{ dial: "localhost:2019" }],
              rewrite: {
                uri: "/metrics",
              },
            },
          ],
        },
      ],
    };
  }

  const httpApp = Object.keys(servers).length > 0 ? { http: { servers } } : {};

  // Build logging configuration. Roll settings are spelled out rather than left to Caddy's
  // file-writer defaults — those silently stopped rotating (no compression, no cleanup of old
  // rolled files) on the deployed build and filled the host disk.
  const rollSettings = {
    roll: true,
    roll_size_mb: 100,
    roll_gzip: true,
    roll_keep: 10,
    roll_keep_days: 30,
  };
  const loggingLogs: Record<string, unknown> = {
    // WAF rule match logs. Modern Coraza puts matched rules in the audit log (part H), which
    // waf-log-parser reads; this file is a fallback for older builds plus a human-readable trail.
    // Do not make ingestion depend on it — correlating two files dropped non-blocked events (#233).
    waf_rules: {
      writer: { output: "file", filename: "/logs/waf-rules.log", mode: "0640", ...rollSettings },
      encoder: { format: "json" },
      include: ["http.handlers.waf"],
      level: "ERROR",
    },
  };
  if (loggingEnabled) {
    loggingLogs.http_access = {
      writer: { output: "file", filename: "/logs/access.log", mode: "0640", ...rollSettings },
      encoder: { format: loggingFormat },
      include: ["http.log.access", "http.handlers.blocker"],
    };
  }
  const loggingApp = { logging: { logs: loggingLogs } };

  // Build L4 (TCP/UDP) proxy servers
  const l4Servers = await buildL4Servers({
    globalDnsSettings: dnsSettings,
    globalUpstreamDnsResolutionSettings: upstreamDnsResolutionSettings,
    globalGeoBlock: effectiveGlobalGeoBlock,
    moduleAvailability,
  });
  const l4App = l4Servers ? { layer4: { servers: l4Servers } } : {};

  return {
    admin: {
      // A bare port binds every address family; "0.0.0.0:2019" bound only IPv4, so an agent
      // reaching Caddy over IPv6 found nothing listening.
      listen: ":2019",
      // Caddy matches the Host header against these literally. An IPv6 caller sends the bracketed
      // form, which is a different string from the name and has to be listed separately.
      origins: ["caddy:2019", "localhost:2019", "localhost", "[::1]:2019", "127.0.0.1:2019"],
    },
    ...loggingApp,
    apps: {
      ...httpApp,
      ...(tlsApp || importedCertPems.length > 0
        ? {
            tls: {
              ...(tlsApp ?? {}),
              ...(importedCertPems.length > 0
                ? { certificates: { load_pem: importedCertPems } }
                : {}),
            },
          }
        : {}),
      ...l4App,
    },
  };
}

/**
 * Turn one Caddy's answer into an outcome, or throw.
 *
 * `who` names the agent when there is more than one: with a fleet, "Caddy rejected configuration"
 * leaves the operator with no idea which host is now out of step with the others.
 */
function assertCaddyAccepted(response: { status: number; text: string }, who: string): void {
  if (response.status >= 200 && response.status < 300) return;

  const reason = describeCaddyRejection(response.text);
  logCaddyApplyFailure("Caddy rejected configuration", undefined, {
    status: response.status,
    responseBytes: Buffer.byteLength(response.text),
    knownReason: reason !== null,
  });
  const where = who ? ` on ${who}` : "";
  throw new CaddyApplyError(
    reason
      ? `Caddy rejected configuration${where}: ${reason}`
      : `Caddy rejected configuration${where}`,
    "CADDY_REJECTED",
  );
}

/**
 * Build the configuration and load it onto every agent's Caddy.
 *
 * One document, every host: the controller's database is the single source of truth for the whole
 * fleet, and an agent that ends up with a different config is a proxy quietly serving something
 * nobody asked for. A rejection anywhere fails the whole apply and says which host rejected it —
 * a partial apply is a state to report, not to succeed at.
 */
export async function applyCaddyConfig() {
  const document = await buildCaddyDocument();
  const payload = JSON.stringify(document);

  const { broadcastCaddyAdmin, listAgentTargets } = await import("./agent/client");

  // One agent, or none, goes through the single transport seam: its production adapter already
  // routes to that one agent, and broadcasting to it would be the same call with extra steps.
  // Keeping the common case on one seam is also what lets a test install one in-memory Caddy.
  if ((await listAgentTargets()).length <= 1) {
    let response: { status: number; text: string };
    try {
      response = await caddyAdminRequest({ path: "/load", method: "POST", body: payload });
    } catch (requestError) {
      logCaddyApplyFailure("Caddy admin request failed", requestError);
      if (isConnectionError(requestError)) {
        throw new CaddyApplyError("Unable to reach Caddy API", "CADDY_UNREACHABLE");
      }
      throw new CaddyApplyError("Failed to apply Caddy configuration", "CADDY_REQUEST_FAILED");
    }
    assertCaddyAccepted(response, "");
    return;
  }

  const results = await broadcastCaddyAdmin({ path: "/load", method: "POST", body: payload });
  const unreachable = results.filter((result) => !result.ok);
  if (unreachable.length > 0) {
    logCaddyApplyFailure("Caddy admin request failed", undefined, {
      unreachableAgents: unreachable.length,
    });
    throw new CaddyApplyError(
      `Unable to reach Caddy API on ${unreachable.map((r) => r.agent).join(", ")}`,
      "CADDY_UNREACHABLE",
    );
  }

  for (const result of results) {
    if (!result.ok) continue;
    assertCaddyAccepted(result.value, result.agent);
  }
}

/**
 * Dial address for Caddy to reach CPM internally: FORWARD_AUTH_INTERNAL_URL if set, else
 * "web:3000" when CADDY_API_URL names a Docker service, else derived from BASE_URL.
 */
function getCpmDialAddress(): string | null {
  const internalUrl = config.forwardAuthInternalUrl;
  if (internalUrl) {
    // Strip protocol, trailing slashes, and paths
    return internalUrl.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  }

  // CADDY_API_URL on a Docker service name → assume Docker networking, use the web service
  try {
    const caddyUrl = new URL(config.caddyApiUrl);
    if (
      caddyUrl.hostname !== "localhost" &&
      caddyUrl.hostname !== "127.0.0.1" &&
      caddyUrl.hostname !== "::1"
    ) {
      // Caddy is on a Docker network — CPM is the "web" service on port 3000
      return "web:3000";
    }
  } catch {
    // ignore
  }

  // Derive from BASE_URL (works for non-Docker setups)
  try {
    const url = new URL(config.baseUrl);
    const port = url.port || (url.protocol === "https:" ? "443" : "80");
    return `${url.hostname}:${port}`;
  } catch {
    return null;
  }
}

function parseAuthentikConfig(
  meta: ProxyHostAuthentikMeta | undefined | null,
): AuthentikRouteConfig | null {
  if (!meta?.enabled) {
    return null;
  }

  const outpostDomain = typeof meta.outpost_domain === "string" ? meta.outpost_domain.trim() : "";
  const outpostUpstream =
    typeof meta.outpost_upstream === "string" ? meta.outpost_upstream.trim() : "";
  if (!outpostDomain || !outpostUpstream) {
    return null;
  }

  const authEndpointRaw = typeof meta.auth_endpoint === "string" ? meta.auth_endpoint.trim() : "";
  const authEndpoint = authEndpointRaw || `/${outpostDomain}/auth/caddy`;

  const copyHeaders =
    Array.isArray(meta.copy_headers) && meta.copy_headers.length > 0
      ? meta.copy_headers
          .map((header) => header?.trim())
          .filter((header): header is string => Boolean(header))
      : DEFAULT_AUTHENTIK_HEADERS;

  const trustedProxies =
    Array.isArray(meta.trusted_proxies) && meta.trusted_proxies.length > 0
      ? meta.trusted_proxies
          .map((item) => item?.trim())
          .filter((item): item is string => Boolean(item))
      : DEFAULT_AUTHENTIK_TRUSTED_PROXIES;

  const setOutpostHostHeader =
    meta.set_outpost_host_header !== undefined ? Boolean(meta.set_outpost_host_header) : true;

  const protectedPaths =
    Array.isArray(meta.protected_paths) && meta.protected_paths.length > 0
      ? meta.protected_paths
          .map((path) => path?.trim())
          .filter((path): path is string => Boolean(path))
      : null;

  const excludedPaths =
    Array.isArray(meta.excluded_paths) && meta.excluded_paths.length > 0
      ? meta.excluded_paths
          .map((path) => path?.trim())
          .filter((path): path is string => Boolean(path))
      : null;

  return {
    enabled: true,
    outpostDomain,
    outpostUpstream,
    authEndpoint,
    copyHeaders,
    trustedProxies,
    setOutpostHostHeader,
    protectedPaths,
    excludedPaths,
  };
}

const VALID_LB_POLICIES = [
  "random",
  "round_robin",
  "least_conn",
  "ip_hash",
  "first",
  "header",
  "cookie",
  "uri_hash",
];

function parseLoadBalancerConfig(
  meta: LoadBalancerMeta | undefined | null,
): LoadBalancerRouteConfig | null {
  if (!meta?.enabled) {
    return null;
  }

  const policy = meta.policy && VALID_LB_POLICIES.includes(meta.policy) ? meta.policy : "random";
  const policyHeaderField =
    typeof meta.policy_header_field === "string" ? meta.policy_header_field.trim() || null : null;
  const policyCookieName =
    typeof meta.policy_cookie_name === "string" ? meta.policy_cookie_name.trim() || null : null;
  const policyCookieSecret =
    typeof meta.policy_cookie_secret === "string" ? meta.policy_cookie_secret.trim() || null : null;
  const tryDuration =
    typeof meta.try_duration === "string" ? meta.try_duration.trim() || null : null;
  const tryInterval =
    typeof meta.try_interval === "string" ? meta.try_interval.trim() || null : null;
  const retries =
    typeof meta.retries === "number" && Number.isFinite(meta.retries) && meta.retries >= 0
      ? meta.retries
      : null;

  let activeHealthCheck: LoadBalancerRouteConfig["activeHealthCheck"] = null;
  if (meta.active_health_check?.enabled) {
    activeHealthCheck = {
      enabled: true,
      uri:
        typeof meta.active_health_check.uri === "string"
          ? meta.active_health_check.uri.trim() || null
          : null,
      port:
        typeof meta.active_health_check.port === "number" &&
        Number.isFinite(meta.active_health_check.port) &&
        meta.active_health_check.port > 0
          ? meta.active_health_check.port
          : null,
      interval:
        typeof meta.active_health_check.interval === "string"
          ? meta.active_health_check.interval.trim() || null
          : null,
      timeout:
        typeof meta.active_health_check.timeout === "string"
          ? meta.active_health_check.timeout.trim() || null
          : null,
      status:
        typeof meta.active_health_check.status === "number" &&
        Number.isFinite(meta.active_health_check.status) &&
        meta.active_health_check.status >= 100
          ? meta.active_health_check.status
          : null,
      body:
        typeof meta.active_health_check.body === "string"
          ? meta.active_health_check.body.trim() || null
          : null,
    };
  }

  let passiveHealthCheck: LoadBalancerRouteConfig["passiveHealthCheck"] = null;
  if (meta.passive_health_check?.enabled) {
    const unhealthyStatus = Array.isArray(meta.passive_health_check.unhealthy_status)
      ? meta.passive_health_check.unhealthy_status.filter(
          (s): s is number => typeof s === "number" && Number.isFinite(s) && s >= 100,
        )
      : null;

    passiveHealthCheck = {
      enabled: true,
      failDuration:
        typeof meta.passive_health_check.fail_duration === "string"
          ? meta.passive_health_check.fail_duration.trim() || null
          : null,
      maxFails:
        typeof meta.passive_health_check.max_fails === "number" &&
        Number.isFinite(meta.passive_health_check.max_fails) &&
        meta.passive_health_check.max_fails >= 0
          ? meta.passive_health_check.max_fails
          : null,
      unhealthyStatus: unhealthyStatus && unhealthyStatus.length > 0 ? unhealthyStatus : null,
      unhealthyLatency:
        typeof meta.passive_health_check.unhealthy_latency === "string"
          ? meta.passive_health_check.unhealthy_latency.trim() || null
          : null,
    };
  }

  return {
    enabled: true,
    policy,
    policyHeaderField,
    policyCookieName,
    policyCookieSecret,
    tryDuration,
    tryInterval,
    retries,
    activeHealthCheck,
    passiveHealthCheck,
  };
}

function buildLoadBalancingConfig(config: LoadBalancerRouteConfig): Record<string, unknown> | null {
  const loadBalancing: Record<string, unknown> = {};

  // Build selection policy
  const selectionPolicy: Record<string, unknown> = { policy: config.policy };

  if (config.policy === "header" && config.policyHeaderField) {
    selectionPolicy.policy = "header";
    selectionPolicy.field = config.policyHeaderField;
  } else if (config.policy === "cookie" && config.policyCookieName) {
    selectionPolicy.policy = "cookie";
    selectionPolicy.name = config.policyCookieName;
    if (config.policyCookieSecret) {
      selectionPolicy.secret = config.policyCookieSecret;
    }
  }

  loadBalancing.selection_policy = selectionPolicy;

  // Add retry settings
  if (config.tryDuration) {
    loadBalancing.try_duration = config.tryDuration;
  }
  if (config.tryInterval) {
    loadBalancing.try_interval = config.tryInterval;
  }
  if (config.retries !== null) {
    loadBalancing.retries = config.retries;
  }

  return Object.keys(loadBalancing).length > 0 ? loadBalancing : null;
}

type DnsResolverRouteConfig = {
  enabled: boolean;
  resolvers: string[];
  fallbacks: string[] | null;
  timeout: string | null;
};

function buildHealthChecksConfig(config: LoadBalancerRouteConfig): Record<string, unknown> | null {
  const healthChecks: Record<string, unknown> = {};

  // Active health checks
  if (config.activeHealthCheck?.enabled) {
    const active: Record<string, unknown> = {};

    if (config.activeHealthCheck.uri) {
      active.uri = config.activeHealthCheck.uri;
    }
    if (config.activeHealthCheck.port !== null) {
      active.port = config.activeHealthCheck.port;
    }
    if (config.activeHealthCheck.interval) {
      active.interval = config.activeHealthCheck.interval;
    }
    if (config.activeHealthCheck.timeout) {
      active.timeout = config.activeHealthCheck.timeout;
    }
    if (config.activeHealthCheck.status !== null) {
      active.expect_status = config.activeHealthCheck.status;
    }
    if (config.activeHealthCheck.body) {
      active.expect_body = config.activeHealthCheck.body;
    }

    if (Object.keys(active).length > 0) {
      healthChecks.active = active;
    }
  }

  // Passive health checks
  if (config.passiveHealthCheck?.enabled) {
    const passive: Record<string, unknown> = {};

    if (config.passiveHealthCheck.failDuration) {
      passive.fail_duration = config.passiveHealthCheck.failDuration;
    }
    if (config.passiveHealthCheck.maxFails !== null) {
      passive.max_fails = config.passiveHealthCheck.maxFails;
    }
    if (
      config.passiveHealthCheck.unhealthyStatus &&
      config.passiveHealthCheck.unhealthyStatus.length > 0
    ) {
      passive.unhealthy_status = config.passiveHealthCheck.unhealthyStatus;
    }
    if (config.passiveHealthCheck.unhealthyLatency) {
      passive.unhealthy_latency = config.passiveHealthCheck.unhealthyLatency;
    }

    if (Object.keys(passive).length > 0) {
      healthChecks.passive = passive;
    }
  }

  return Object.keys(healthChecks).length > 0 ? healthChecks : null;
}

function parseDnsResolverConfig(
  meta: DnsResolverMeta | undefined | null,
): DnsResolverRouteConfig | null {
  if (!meta?.enabled) {
    return null;
  }

  const resolvers = Array.isArray(meta.resolvers)
    ? meta.resolvers.map((r) => (typeof r === "string" ? r.trim() : "")).filter((r) => r.length > 0)
    : [];

  if (resolvers.length === 0) {
    return null;
  }

  const fallbacks = Array.isArray(meta.fallbacks)
    ? meta.fallbacks.map((r) => (typeof r === "string" ? r.trim() : "")).filter((r) => r.length > 0)
    : null;

  const timeout = typeof meta.timeout === "string" ? meta.timeout.trim() || null : null;

  return {
    enabled: true,
    resolvers,
    fallbacks: fallbacks && fallbacks.length > 0 ? fallbacks : null,
    timeout,
  };
}

function buildResolverConfig(dnsConfig: DnsResolverRouteConfig): Record<string, unknown> | null {
  if (!dnsConfig?.enabled || dnsConfig.resolvers.length === 0) {
    return null;
  }

  // Resolver addresses (primary + fallbacks); DNS resolvers need a port, defaulting to :53
  const formatResolver = (r: string) => {
    if (r.includes(":")) return r;
    return `${r}:53`;
  };

  const addresses = dnsConfig.resolvers.map(formatResolver);
  if (dnsConfig.fallbacks && dnsConfig.fallbacks.length > 0) {
    addresses.push(...dnsConfig.fallbacks.map(formatResolver));
  }

  return { addresses };
}
