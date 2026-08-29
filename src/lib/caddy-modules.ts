/**
 * The catalog of Caddy modules this app knows how to drive.
 *
 * Caddy is one static binary: a plugin was either compiled in by xcaddy or does not exist. This is
 * the one place recording that, so three concerns agree — `docker/caddy/Dockerfile` (what gets
 * compiled), `src/lib/caddy.ts` (which handlers may be emitted; naming an absent module makes Caddy
 * reject the *entire* config), and the Settings UI (which controls are live). DNS provider modules
 * derive from DNS_PROVIDERS: the credentials form and the Go module path are the same fact.
 */

import { DNS_PROVIDERS } from "./dns-providers";

/**
 * A capability the rest of the app can ask about. Features are what UI and config generation gate
 * on, modules are what the operator toggles — one module can power several features.
 */
export type CaddyFeatureId =
  | "l4"
  | "geoblock"
  | "waf"
  /** ACME DNS-01 challenges in general — satisfied by *any* enabled DNS module. */
  | "dns01";

export type CaddyModuleCategory = "dns" | "proxy" | "security";

export type CaddyModuleDefinition = {
  /** Stable key persisted in settings. Never reuse or rename. */
  id: string;
  /** Human-readable name shown on the toggle. */
  name: string;
  /** Go module path passed to `xcaddy build --with`. */
  modulePath: string;
  description: string;
  docsUrl?: string;
  category: CaddyModuleCategory;
  /** Features that stop working when this module is not compiled in. */
  features: CaddyFeatureId[];
  /**
   * DNS provider name (DnsProviderDefinition.name) for provider modules, so the DNS Providers
   * UI can find the module backing each entry.
   */
  dnsProvider?: string;
};

const CORE_MODULES: CaddyModuleDefinition[] = [
  {
    id: "caddy-l4",
    name: "Layer 4 Proxy",
    modulePath: "github.com/mholt/caddy-l4",
    description:
      "TCP/UDP proxying. Required by L4 Proxy Hosts and by the port manager sidecar that binds their ports.",
    docsUrl: "https://github.com/mholt/caddy-l4",
    category: "proxy",
    features: ["l4"],
  },
  {
    id: "caddy-blocker",
    name: "Request Blocker",
    modulePath: "github.com/fuomag9/caddy-blocker-plugin",
    description:
      "Country, continent, ASN, and CIDR blocking. Required by global geoblocking and by per-host geoblock rules.",
    docsUrl: "https://github.com/fuomag9/caddy-blocker-plugin",
    category: "security",
    features: ["geoblock"],
  },
  {
    id: "coraza-waf",
    name: "Coraza WAF",
    modulePath: "github.com/corazawaf/coraza-caddy/v2",
    description:
      "ModSecurity-compatible web application firewall with the OWASP Core Rule Set. Required by the WAF settings and the WAF events page.",
    docsUrl: "https://github.com/corazawaf/coraza-caddy",
    category: "security",
    features: ["waf"],
  },
];

/** Module id for a DNS provider, e.g. "cloudflare" -> "caddy-dns-cloudflare". */
export function dnsModuleId(providerName: string): string {
  return `caddy-dns-${providerName}`;
}

const DNS_MODULES: CaddyModuleDefinition[] = DNS_PROVIDERS.map((provider) => ({
  id: dnsModuleId(provider.name),
  name: `${provider.displayName} DNS`,
  modulePath: provider.modulePath,
  description:
    provider.description ??
    `ACME DNS-01 challenge support for ${provider.displayName}. Required to issue certificates through this provider.`,
  docsUrl: provider.docsUrl,
  category: "dns" as const,
  features: ["dns01" as const],
  dnsProvider: provider.name,
}));

/** Every module the UI offers as a toggle, in display order. */
export const CADDY_MODULES: CaddyModuleDefinition[] = [...CORE_MODULES, ...DNS_MODULES];

const MODULES_BY_ID = new Map(CADDY_MODULES.map((m) => [m.id, m]));

export function findCaddyModule(id: string): CaddyModuleDefinition | undefined {
  return MODULES_BY_ID.get(id);
}

/** Module ids that power a feature. A feature is available if *any* of them is on. */
export function modulesForFeature(feature: CaddyFeatureId): CaddyModuleDefinition[] {
  return CADDY_MODULES.filter((m) => m.features.includes(feature));
}

/**
 * The module list the shipped image is built with when nothing is configured. Everything is on by
 * default, so an upgrade never silently drops a plugin someone's hosts need.
 */
export const DEFAULT_ENABLED_MODULE_IDS: string[] = CADDY_MODULES.map((m) => m.id);

// ─── Custom modules ──────────────────────────────────────────────────────────

export type CaddyCustomModule = {
  /** Go module path, e.g. "github.com/greenpau/caddy-security". */
  modulePath: string;
  /** Optional version suffix passed as `--with path@version`. */
  version?: string;
  enabled: boolean;
};

/**
 * Go module paths are pasted from READMEs, so they arrive with schemes, slashes and whitespace,
 * and they land verbatim in a shell command in the Dockerfile. An allowlist is the only form of
 * this that stays correct when the Dockerfile's quoting changes.
 */
const MODULE_PATH_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._~/-]*[a-zA-Z0-9]$/;
const VERSION_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._+-]*$/;

export function normalizeModulePath(raw: string): string {
  return raw
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
}

/**
 * Validate a custom module entry, returning an error message or null. Exported so the server
 * action and the REST API reject the same inputs.
 */
export function validateCustomModule(entry: CaddyCustomModule): string | null {
  const path = normalizeModulePath(entry.modulePath);
  if (!path) return "Module path is required";
  if (path.length > 200) return `Module path is too long: ${path.slice(0, 40)}…`;
  if (!MODULE_PATH_PATTERN.test(path)) {
    return `Invalid module path "${path}". Expected a Go module path such as github.com/owner/repo`;
  }
  if (!path.includes("/")) {
    return `Invalid module path "${path}". Expected a host and a path, such as github.com/owner/repo`;
  }
  if (entry.version) {
    const version = entry.version.trim();
    if (!VERSION_PATTERN.test(version)) {
      return `Invalid version "${version}" for ${path}. Expected a tag, branch, or commit such as v1.2.3`;
    }
  }
  return null;
}

/** The `--with` argument for a custom module, e.g. "github.com/x/y@v1.2.3". */
export function customModuleSpec(entry: CaddyCustomModule): string {
  const path = normalizeModulePath(entry.modulePath);
  const version = entry.version?.trim();
  return version ? `${path}@${version}` : path;
}
