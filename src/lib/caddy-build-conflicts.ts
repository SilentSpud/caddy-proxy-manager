/**
 * Refusing a module selection that something is still using. Kept out of caddy-build.ts because it
 * reaches into models that import caddy.ts, which imports caddy-build.ts — an import cycle. Only
 * the two write paths (settings action, REST endpoint) need it.
 */

import { resolveEnabledModuleIds } from "./caddy-build";
import { CADDY_MODULES, dnsModuleId } from "./caddy-modules";
import { countEnabledL4ProxyHosts } from "./models/l4-proxy-hosts";
import { listProxyHosts } from "./models/proxy-hosts";
import {
  type CaddyBuildSettings,
  getDnsProviderSettings,
  getGeoBlockSettings,
  getWafSettings,
} from "./settings";

/**
 * Why a selection cannot be applied yet, in the operator's terms, or null when it can. Naming what
 * uses the module ("3 enabled L4 proxy hosts") is what makes the refusal actionable.
 */
export async function describeModuleConflicts(
  settings: CaddyBuildSettings,
): Promise<string | null> {
  const enabled = new Set(resolveEnabledModuleIds(settings));
  const problems: string[] = [];

  const wafOff = !enabled.has("coraza-waf");
  const blockerOff = !enabled.has("caddy-blocker");

  if (!enabled.has("caddy-l4")) {
    const l4Count = await countEnabledL4ProxyHosts();
    if (l4Count > 0) {
      problems.push(
        `${l4Count} enabled L4 proxy host${l4Count === 1 ? " needs" : "s need"} the Layer 4 Proxy module`,
      );
    }
  }

  if (wafOff) {
    const waf = await getWafSettings();
    if (waf?.enabled && waf.mode !== "Off") {
      problems.push("global WAF is switched on and needs the Coraza WAF module");
    }
  }

  if (blockerOff) {
    const geoblock = await getGeoBlockSettings();
    if (geoblock?.enabled) {
      problems.push("global geoblocking is switched on and needs the Request Blocker module");
    }
  }

  // Per-host config counts as much as the global switch: WAF and geoblocking can be on per host
  // with the global off. Checking only globals let an operator disable a module a dozen hosts used.
  if (wafOff || blockerOff) {
    const hosts = await listProxyHosts();
    if (wafOff) {
      const count = hosts.filter((h) => h.enabled && h.waf?.enabled).length;
      if (count > 0) {
        problems.push(
          `${count} proxy host${count === 1 ? " has" : "s have"} per-host WAF enabled and ${count === 1 ? "needs" : "need"} the Coraza WAF module`,
        );
      }
    }
    if (blockerOff) {
      const count = hosts.filter((h) => h.enabled && h.geoblock?.enabled).length;
      if (count > 0) {
        problems.push(
          `${count} proxy host${count === 1 ? " has" : "s have"} per-host geoblocking enabled and ${count === 1 ? "needs" : "need"} the Request Blocker module`,
        );
      }
    }
  }

  // Every configured provider, not just the default: a certificate can pin its own through
  // providerOptions.provider, so a non-default provider with credentials on file is likely busy.
  const dnsProviders = await getDnsProviderSettings();
  const defaultProvider = dnsProviders?.default ?? null;
  for (const provider of Object.keys(dnsProviders?.providers ?? {})) {
    if (enabled.has(dnsModuleId(provider))) continue;
    problems.push(
      provider === defaultProvider
        ? `${provider} is the default DNS provider and needs its caddy-dns module`
        : `${provider} has DNS credentials configured and needs its caddy-dns module`,
    );
  }

  if (problems.length === 0) return null;
  return `Cannot disable those modules yet: ${problems.join("; ")}. Turn the feature off first.`;
}

/**
 * A non-blocking heads-up about per-host Caddyfile snippets, or null. Snippets are free-form text
 * that can name any compiled-in plugin's directive, and only Caddy's adapter could say which — and
 * only for the binary running now. So this warns rather than refuses.
 */
export async function describeCaddyfileSnippetWarning(
  settings: CaddyBuildSettings,
): Promise<string | null> {
  const enabled = new Set(resolveEnabledModuleIds(settings));
  const anyDisabled = CADDY_MODULES.some((m) => !enabled.has(m.id));
  if (!anyDisabled) return null;

  const hosts = await listProxyHosts();
  const withSnippets = hosts.filter((h) => h.enabled && h.customCaddyfile?.trim());
  if (withSnippets.length === 0) return null;

  const names = withSnippets
    .slice(0, 3)
    .map((h) => h.name)
    .join(", ");
  const more = withSnippets.length > 3 ? `, and ${withSnippets.length - 3} more` : "";
  return `${withSnippets.length} proxy host${withSnippets.length === 1 ? "" : "s"} (${names}${more}) use custom Caddyfile directives, which may reference a module you just switched off. Review them before rebuilding — a snippet Caddy can no longer adapt is skipped silently.`;
}
