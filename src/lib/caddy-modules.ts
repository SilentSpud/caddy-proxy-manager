/**
 * The catalog of Caddy modules this app knows how to drive.
 *
 * Caddy is a single static binary: a plugin either was compiled into the image
 * by xcaddy or it does not exist at runtime. That makes the module list a
 * *build* input, and it makes every feature built on top of a plugin
 * conditional on that build. This module is the one place that records the
 * relationship, so three otherwise-disconnected concerns stay in agreement:
 *
 *   1. `docker/caddy/Dockerfile` — what gets compiled in (via CADDY_MODULES).
 *   2. `src/lib/caddy.ts` — which handlers may appear in the generated config.
 *      Emitting a handler for a plugin that is not in the binary makes Caddy
 *      reject the *entire* config, taking every unrelated host down with it.
 *   3. The Settings UI — which controls are live, and which are greyed out
 *      with a note naming the module the operator has to turn back on.
 *
 * DNS provider modules are derived from DNS_PROVIDERS rather than restated,
 * because a provider's credentials form and its Go module path are the same
 * fact viewed from two sides.
 */

import { DNS_PROVIDERS } from "./dns-providers";

/**
 * A capability the rest of the app can ask about. Features are what UI and
 * config generation gate on; modules are what the operator toggles. The
 * indirection matters because a feature can outlive the module that first
 * provided it, and because one module can power several features.
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
   * DNS provider name (DnsProviderDefinition.name) for provider modules, so
   * the DNS Providers UI can find the module backing each entry.
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
 * The module list the shipped image is built with when nothing is configured.
 *
 * Everything is on by default so an existing install keeps behaving exactly as
 * it did before this setting existed — an upgrade must not silently drop a
 * plugin someone's hosts depend on.
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
 * Go module paths are pasted from README files, so they arrive with schemes,
 * trailing slashes, and stray whitespace. They also land verbatim in a shell
 * command inside the Dockerfile, so anything outside this character set is
 * rejected rather than escaped — an allowlist is the only version of this that
 * stays correct when the Dockerfile's quoting changes.
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
 * Validate a custom module entry, returning an error message or null.
 * Exported so the server action and the REST API reject the same inputs.
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
