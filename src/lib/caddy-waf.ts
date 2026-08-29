/**
 * WAF handler builder and effective-config resolver for Caddy. Extracted from caddy.ts so
 * these functions can be unit tested.
 */
import type { WafSettings } from "./settings";
import type { WafHostConfig } from "./models/proxy-hosts";

/**
 * Effective WAF settings for a host: null host → global as-is; `enabled === false` → opt out
 * entirely; `waf_mode === "override"` → host only; `"merge"` (default) → host over global.
 */
export function resolveEffectiveWaf(
  global: WafSettings | null,
  host: WafHostConfig | null | undefined,
): WafSettings | null {
  const hostEnabled = host?.enabled;
  const globalEnabled = global?.enabled;

  if (!hostEnabled && !globalEnabled) return null;

  // Override mode: use host config entirely
  if (host && host.waf_mode === "override") {
    if (!hostEnabled) return null;
    return {
      enabled: true,
      mode: host.mode ?? "On",
      load_owasp_crs: host.load_owasp_crs ?? false,
      custom_directives: host.custom_directives ?? "",
      excluded_rule_ids: host.excluded_rule_ids,
    };
  }

  // Merge mode: start with global, overlay host fields.
  // host.enabled === false is an explicit opt-out — respect it even when global is on.
  if (host && global) {
    if (host.enabled === false) return null;
    return {
      enabled: true,
      mode: host.mode ?? global.mode,
      load_owasp_crs: host.load_owasp_crs ?? global.load_owasp_crs,
      custom_directives: [global.custom_directives, host.custom_directives]
        .filter(Boolean)
        .join("\n"),
      excluded_rule_ids: [...(global.excluded_rule_ids ?? []), ...(host.excluded_rule_ids ?? [])],
    };
  }

  if (host?.enabled) {
    return {
      enabled: true,
      mode: host.mode ?? "On",
      load_owasp_crs: host.load_owasp_crs ?? false,
      custom_directives: host.custom_directives ?? "",
      excluded_rule_ids: host.excluded_rule_ids,
    };
  }
  if (global?.enabled) return global;
  return null;
}

/**
 * Caddy matcher for a WebSocket upgrade handshake. Mirrors Caddy's built-in `@websockets`, so
 * detection matches what `reverse_proxy` uses to switch into tunnel mode.
 */
export const WEBSOCKET_UPGRADE_MATCHER: Record<string, unknown> = {
  header: {
    Connection: ["*Upgrade*"],
    Upgrade: ["websocket"],
  },
};

/**
 * Builds the Caddy `waf` handler. @-prefixed SecLang paths resolve from the embedded
 * coraza-coreruleset filesystem, which the plugin mounts only when `load_owasp_crs` is true —
 * including them otherwise fails the config load, so every @-include is gated on that flag.
 */
export function buildWafHandler(waf: WafSettings): Record<string, unknown> {
  const parts: string[] = [];

  // `mode` is interpolated straight into the directive block and settings are stored without
  // validation, so anything but a known engine mode (e.g. "On\nSecRuleRemoveById 1-999999")
  // would smuggle in SecLang that the custom_directives allowlist exists to reject. Clamp to
  // Coraza's three real values and fall back to the safe one.
  const engineMode = waf.mode === "Off" || waf.mode === "DetectionOnly" ? waf.mode : "On";

  if (waf.load_owasp_crs) {
    // @-prefixed paths resolve from the embedded coraza-coreruleset filesystem,
    // which is only mounted when load_owasp_crs is true.
    parts.push(
      "Include @coraza.conf-recommended",
      "Include @crs-setup.conf.example",
      "Include @owasp_crs/*.conf",
    );
  }

  // Runtime-validate excluded_rule_ids are positive integers
  if (waf.excluded_rule_ids?.length) {
    const validIds = waf.excluded_rule_ids.filter(
      (id): id is number =>
        typeof id === "number" && Number.isFinite(id) && id > 0 && Number.isInteger(id),
    );
    if (validIds.length > 0) {
      parts.push(`SecRuleRemoveById ${validIds.join(" ")}`);
    }
  }

  parts.push(
    `SecRuleEngine ${engineMode}`,
    // RelevantOnly logs transactions where a rule fired with the auditlog action (which all
    // OWASP CRS rules set via SecDefaultAction), covering blocked and DetectionOnly hits. Clean
    // requests with no matches are skipped, avoiding massive log growth.
    "SecAuditEngine RelevantOnly",
    "SecAuditLog /logs/waf-audit.log",
    "SecAuditLogFormat JSON",
    // The audit log is owned by caddy with mode 0644, so the web container can read but not
    // truncate it; SecAuditLogFileMode can't fix that (the 0022 umask strips group-write), so
    // waf-log-parser treats truncation as best-effort. Part H carries the matched rules it reads;
    // bodies (I, J, E) and intermediate response headers (D) are omitted to avoid huge payloads.
    "SecAuditLogParts ABFHZ",
    "SecResponseBodyAccess Off",
  );

  // Allowlist approach: only permit known-safe directive prefixes in custom directives
  if (waf.custom_directives?.trim()) {
    const directives = waf.custom_directives.trim();
    const allowedPrefixes = [/^SecRule\s/, /^SecAction\s/, /^SecMarker\s/, /^SecDefaultAction\s/];
    const allowedBodyLimitDirectives = [
      /^SecRequestBodyLimit\s+\d+\s*$/i,
      /^SecRequestBodyNoFilesLimit\s+\d+\s*$/i,
      /^SecRequestBodyInMemoryLimit\s+\d+\s*$/i,
      /^SecRequestBodyLimitAction\s+(?:Reject|ProcessPartial)\s*$/i,
    ];
    // SecRule* variants that are NOT plain SecRule (must be rejected)
    const blockedSecRulePrefixes = [
      /^SecRuleEngine\s/i,
      /^SecRuleRemoveById\s/i,
      /^SecRuleRemoveByTag\s/i,
      /^SecRuleRemoveByMsg\s/i,
      /^SecRuleUpdateActionById\s/i,
      /^SecRuleUpdateTargetById\s/i,
    ];
    const lines = directives.split("\n");
    const safeLines = lines.filter((line) => {
      const trimmed = line.trim();
      // Allow empty lines and comments
      if (!trimmed || trimmed.startsWith("#")) return true;
      // Reject Include directives (prevents file inclusion from container filesystem)
      if (/^Include\s/i.test(trimmed)) return false;
      // Check against allowlist
      const matchesAllowed =
        allowedPrefixes.some((pattern) => pattern.test(trimmed)) ||
        allowedBodyLimitDirectives.some((pattern) => pattern.test(trimmed));
      if (!matchesAllowed) return false;
      // Reject blocked SecRule* variants (e.g. SecRuleEngine)
      if (blockedSecRulePrefixes.some((pattern) => pattern.test(trimmed))) return false;
      // Reject ctl:ruleEngine inside allowed lines (can conditionally disable WAF)
      if (/ctl:ruleEngine/i.test(trimmed)) return false;
      return true;
    });
    if (safeLines.length > 0) {
      parts.push(safeLines.join("\n"));
    }
  }

  const handler: Record<string, unknown> = { handler: "waf", directives: parts.join("\n") };
  if (waf.load_owasp_crs) handler.load_owasp_crs = true;
  return handler;
}

/**
 * The handler-chain entry applying the WAF for a proxy route.
 *
 * With allowWebsocket, the handler sits in a non-terminal subroute that runs only for
 * NON-WebSocket requests. Upgrades must bypass coraza entirely, not just disable the rule engine
 * (issue #195): coraza-caddy wraps the response writer, and that wrapper breaks the `101 Switching
 * Protocols` connection hijack — raw bytes leak out with no status line and the handshake fails.
 * A `subroute` compiles inner routes with the OUTER `next`, so ordinary requests still get the WAF;
 * only the matched-out upgrade falls through. Without allowWebsocket, upgrades are inspected too.
 */
export function buildWafHandlerEntry(
  waf: WafSettings,
  allowWebsocket = false,
): Record<string, unknown> {
  const wafHandler = buildWafHandler(waf);
  if (!allowWebsocket) return wafHandler;
  return {
    handler: "subroute",
    routes: [
      {
        match: [{ not: [WEBSOCKET_UPGRADE_MATCHER] }],
        handle: [wafHandler],
      },
    ],
  };
}
