/**
 * Refusing a module selection that something is still using.
 *
 * Kept out of caddy-build.ts on purpose: this reaches into the proxy-host and
 * settings models, and those import caddy.ts, which imports caddy-build.ts for
 * its feature gating. Putting the check there would close that loop into an
 * import cycle. Nothing in the config-building path needs this — only the two
 * write paths (the settings server action and the REST endpoint) do.
 */

import { resolveEnabledModuleIds } from "./caddy-build";
import { dnsModuleId } from "./caddy-modules";
import { countEnabledL4ProxyHosts } from "./models/l4-proxy-hosts";
import { listProxyHosts } from "./models/proxy-hosts";
import {
  type CaddyBuildSettings,
  getDnsProviderSettings,
  getGeoBlockSettings,
  getWafSettings,
} from "./settings";

/**
 * Describe, in the operator's terms, why a selection cannot be applied yet —
 * or null when it can.
 *
 * Naming the thing that uses a module ("3 enabled L4 proxy hosts") is the
 * difference between a rule someone can act on and one that just blocks them.
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
        `${l4Count} enabled L4 proxy host${l4Count === 1 ? "" : "s"} need the Layer 4 Proxy module`,
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

  // Per-host configuration counts just as much as the global switch. Both WAF
  // and geoblocking can be enabled on an individual host with the global
  // setting left off, and resolveEffectiveWaf/resolveEffectiveGeoBlock honour
  // that. Checking only the globals let an operator disable a module a dozen
  // hosts relied on; the config builder would then quietly stop emitting their
  // handlers, and a security control would vanish without a word.
  if (wafOff || blockerOff) {
    const hosts = await listProxyHosts();
    if (wafOff) {
      const count = hosts.filter((h) => h.enabled && h.waf?.enabled).length;
      if (count > 0) {
        problems.push(
          `${count} proxy host${count === 1 ? " has" : "s have"} per-host WAF enabled and need the Coraza WAF module`,
        );
      }
    }
    if (blockerOff) {
      const count = hosts.filter((h) => h.enabled && h.geoblock?.enabled).length;
      if (count > 0) {
        problems.push(
          `${count} proxy host${count === 1 ? " has" : "s have"} per-host geoblocking enabled and need the Request Blocker module`,
        );
      }
    }
  }

  // Every configured provider, not just the default: a certificate can pin its
  // own provider through providerOptions.provider, so a non-default provider
  // with credentials on file is very likely issuing something.
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
