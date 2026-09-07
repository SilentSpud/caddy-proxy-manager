/**
 * Refusing a module selection something still uses. Kept out of caddy-build.ts to avoid an import
 * cycle; only the two write paths (settings action, REST endpoint) need it.
 */

import { resolveEnabledModuleIds } from "./caddy-build";
import { CADDY_MODULES, dnsModuleId } from "./caddy-modules";
import { listEnabledL4ProxyHostIds } from "./models/l4-proxy-hosts";
import { listHostAssignments, servedByAgent } from "./models/host-agents";
import { listProxyHosts } from "./models/proxy-hosts";
import {
  type CaddyBuildSettings,
  getDnsProviderSettings,
  getGeoBlockSettings,
  getWafSettings,
} from "./settings";

/**
 * Why a selection cannot be applied yet, in the operator's terms, or null. Naming what uses the
 * module ("3 enabled L4 proxy hosts") is what makes the refusal actionable.
 */
export async function describeModuleConflicts(
  settings: CaddyBuildSettings,
  agentRowId?: number,
): Promise<string | null> {
  const enabled = new Set(resolveEnabledModuleIds(settings));
  const problems: string[] = [];

  // Scoped to what this agent actually serves. A host pinned to a different agent has no bearing
  // on whether *this* binary needs a module, and counting it would refuse a legitimate selection
  // with a reason the operator cannot act on — the host is not on this agent to turn off.
  const [httpAssignments, l4Assignments] =
    agentRowId === undefined
      ? [null, null]
      : await Promise.all([listHostAssignments("http"), listHostAssignments("l4")]);
  const servesHttp = (hostId: number) =>
    httpAssignments === null || servedByAgent(httpAssignments, hostId, agentRowId ?? null);
  const servesL4 = (hostId: number) =>
    l4Assignments === null || servedByAgent(l4Assignments, hostId, agentRowId ?? null);

  const wafOff = !enabled.has("coraza-waf");
  const blockerOff = !enabled.has("caddy-blocker");
  const tailscaleOff = !enabled.has("caddy-tailscale");

  if (!enabled.has("caddy-l4")) {
    const l4Count = (await listEnabledL4ProxyHostIds()).filter(servesL4).length;
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
  if (wafOff || blockerOff || tailscaleOff) {
    const hosts = (await listProxyHosts()).filter((host) => servesHttp(host.id));
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
    if (tailscaleOff) {
      // Worth refusing rather than warning: a tailnet-only host stops being served at all — the
      // config drops it rather than publishing it, which looks like the host simply vanished.
      const count = hosts.filter((h) => h.enabled && h.tailscale?.serve).length;
      if (count > 0) {
        problems.push(
          `${count} proxy host${count === 1 ? " is" : "s are"} served on the tailnet and ${count === 1 ? "needs" : "need"} the Tailscale module`,
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
 * A non-blocking heads-up about per-host Caddyfile snippets, or null. Only Caddy's adapter could
 * say which plugin a snippet needs, and only for the binary running now — so warn, don't refuse.
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
