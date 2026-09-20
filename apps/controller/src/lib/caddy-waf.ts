/** WAF handler builder and effective-config resolver, split from caddy.ts for unit testing. */
import type { WafSettings } from "./settings";
import type { WafHostConfig } from "./models/proxy-hosts";
import { type DomainErrorCode, domainError, domainErrorMessage } from "./domain-error";

// ---------------------------------------------------------------------------
// Request body limits
// ---------------------------------------------------------------------------

/**
 * Coraza refuses to build a WAF whose request body limit exceeds 1 GiB
 * (internal/corazawaf/waf.go - "request body limit should be at most 1GiB").
 * coraza-caddy constructs its WAF while Caddy is loading the config, so a
 * single out-of-range value makes Caddy reject the ENTIRE config document -
 * every host goes unapplied, not just the offending one. Never emit a value
 * above this.
 */
export const CORAZA_MAX_BODY_LIMIT = 1_073_741_824; // 1 GiB

/** Below ~1 KiB the limit is meaningless and only serves to break uploads. */
export const CORAZA_MIN_BODY_LIMIT = 1_024;

/** Coraza's built-in default when no SecRequestBodyLimit directive is parsed. */
export const CORAZA_DEFAULT_BODY_LIMIT = 134_217_728; // 128 MiB

/**
 * SecRequestBodyLimit / SecRequestBodyInMemoryLimit set by
 * `@coraza.conf-recommended`, which we Include when load_owasp_crs is on.
 * The 12.5 MiB limit is why large uploads (Nextcloud/Immich chunks) fail with
 * the CRS enabled while the same host works with it off.
 */
export const CRS_BODY_LIMIT = 13_107_200; // 12.5 MiB
export const CRS_IN_MEMORY_BODY_LIMIT = 131_072; // 128 KiB

/** True when `value` is a byte count Coraza will accept for a body limit. */
export function isValidBodyLimit(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= CORAZA_MIN_BODY_LIMIT &&
    value <= CORAZA_MAX_BODY_LIMIT
  );
}

export function bodyLimitRangeMessage(label: string): string {
  return `${label} must be an integer between ${CORAZA_MIN_BODY_LIMIT} and ${CORAZA_MAX_BODY_LIMIT} bytes (1 GiB is Coraza's hard maximum)`;
}

/**
 * The settings are stored in bytes (what SecLang takes), but the forms ask for
 * MiB - nobody sizes an upload limit in bytes. Anything finer stays reachable
 * through the custom directives.
 */
export const BYTES_PER_MIB = 1_048_576;
export const MIN_BODY_LIMIT_MIB = 1;
export const MAX_BODY_LIMIT_MIB = CORAZA_MAX_BODY_LIMIT / BYTES_PER_MIB; // 1024

export function bytesToMib(bytes: number | undefined): string {
  return typeof bytes === "number" && bytes > 0 ? String(Math.round(bytes / BYTES_PER_MIB)) : "";
}

/**
 * Which field a body limit came from. Each is its own message rather than a label spliced into one,
 * because not every language puts the field name first.
 */
export type BodyLimitErrorCode = Extract<
  DomainErrorCode,
  | "wafRequestBodyLimitInvalid"
  | "wafInMemoryBodyLimitInvalid"
  | "hostWafRequestBodyLimitInvalid"
  | "hostWafInMemoryBodyLimitInvalid"
>;

/** Parses a MiB form field into bytes. Blank means "unset - inherit the default". */
export function parseBodyLimitMib(raw: unknown, errorCode: BodyLimitErrorCode): number | undefined {
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  const mib = Number(raw.trim());
  if (!Number.isInteger(mib) || mib < MIN_BODY_LIMIT_MIB || mib > MAX_BODY_LIMIT_MIB) {
    // Strings, not numbers: the catalog would format 1024 as "1,024".
    throw domainError(errorCode, {
      min: String(MIN_BODY_LIMIT_MIB),
      max: String(MAX_BODY_LIMIT_MIB),
    });
  }
  return mib * BYTES_PER_MIB;
}

/** SecRequestBody*Limit directives that carry a byte count. */
const BODY_LIMIT_DIRECTIVE =
  /^(SecRequestBodyLimit|SecRequestBodyNoFilesLimit|SecRequestBodyInMemoryLimit)\s+(\d+)\s*$/i;
const BODY_LIMIT_ACTION_DIRECTIVE = /^SecRequestBodyLimitAction\s+(?:Reject|ProcessPartial)\s*$/i;

/**
 * Returns the first custom directive whose byte count Coraza would reject, or
 * null when every body-limit line is in range. Input layers call this so the
 * user gets a precise error at save time instead of a silent drop here plus an
 * opaque "Caddy rejected configuration" later.
 */
export function findInvalidBodyLimitDirective(
  directives: string | null | undefined,
): string | null {
  if (!directives?.trim()) return null;
  for (const line of directives.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = BODY_LIMIT_DIRECTIVE.exec(trimmed);
    if (match && !isValidBodyLimit(Number(match[2]))) return trimmed;
  }
  return null;
}

/**
 * Why a custom SecLang line never reaches Caddy. A code rather than a sentence: the wording lives
 * in the catalog, next to every other sentence a person reads.
 */
export type DroppedWafDirectiveReason =
  | "wafDirectiveDroppedInclude"
  | "wafDirectiveDroppedRuleMutation"
  | "wafDirectiveDroppedCtlRuleEngine"
  | "wafDirectiveDroppedBodyLimit"
  | "wafDirectiveDroppedNotAllowed";

/** A custom SecLang line CPM will not send to Caddy, and why. */
export type DroppedWafDirective = { line: string; reason: DroppedWafDirectiveReason };

/** Allowed on their own; anything else is dropped. */
const ALLOWED_DIRECTIVE_PREFIXES = [
  /^SecRule\s/,
  /^SecAction\s/,
  /^SecMarker\s/,
  /^SecDefaultAction\s/,
];

/** SecRule* variants that are not a plain SecRule: they mutate or disable the engine. */
const BLOCKED_SEC_RULE_PREFIXES = [
  /^SecRuleEngine\s/i,
  /^SecRuleRemoveById\s/i,
  /^SecRuleRemoveByTag\s/i,
  /^SecRuleRemoveByMsg\s/i,
  /^SecRuleUpdateActionById\s/i,
  /^SecRuleUpdateTargetById\s/i,
];

/**
 * Splits the user's custom directives into the lines that will be emitted and the ones this drops.
 *
 * The allowlist is the security boundary and stays exactly as strict as it was; what changed is
 * that a dropped line is now something to say out loud. A silently discarded
 * `SecRuleUpdateActionById` reads as "the WAF ignores my rule" rather than "CPM refused that
 * directive", so both validators fail the write and name each line (upstream discussion #146).
 */
export function filterCustomDirectives(raw: string | null | undefined): {
  kept: string[];
  dropped: DroppedWafDirective[];
} {
  const kept: string[] = [];
  const dropped: DroppedWafDirective[] = [];
  if (!raw?.trim()) return { kept, dropped };

  for (const line of raw.trim().split("\n")) {
    const trimmed = line.trim();
    // Blank lines and comments carry nothing to reject.
    if (!trimmed || trimmed.startsWith("#")) {
      kept.push(line);
      continue;
    }
    // Include would read arbitrary files out of the container filesystem.
    if (/^Include\s/i.test(trimmed)) {
      dropped.push({ line: trimmed, reason: "wafDirectiveDroppedInclude" });
      continue;
    }
    // Body limits are allowed, but only inside the range Coraza accepts - an out-of-range value
    // would make Caddy reject the whole config document. Input validation reports these; dropping
    // here is the net. (SecRequestBodyNoFilesLimit parses but is not enforced by Coraza:
    // corazawaf/coraza#896. Kept accepted so existing configs keep loading.)
    const bodyLimit = BODY_LIMIT_DIRECTIVE.exec(trimmed);
    if (bodyLimit) {
      if (isValidBodyLimit(Number(bodyLimit[2]))) kept.push(line);
      else dropped.push({ line: trimmed, reason: "wafDirectiveDroppedBodyLimit" });
      continue;
    }
    if (BODY_LIMIT_ACTION_DIRECTIVE.test(trimmed)) {
      kept.push(line);
      continue;
    }
    // Before the generic allowlist, so the reason names the real objection.
    if (BLOCKED_SEC_RULE_PREFIXES.some((pattern) => pattern.test(trimmed))) {
      dropped.push({ line: trimmed, reason: "wafDirectiveDroppedRuleMutation" });
      continue;
    }
    if (!ALLOWED_DIRECTIVE_PREFIXES.some((pattern) => pattern.test(trimmed))) {
      dropped.push({ line: trimmed, reason: "wafDirectiveDroppedNotAllowed" });
      continue;
    }
    // ctl:ruleEngine inside an allowed line can conditionally disable the WAF.
    if (/ctl:ruleEngine/i.test(trimmed)) {
      dropped.push({ line: trimmed, reason: "wafDirectiveDroppedCtlRuleEngine" });
      continue;
    }
    kept.push(line);
  }
  return { kept, dropped };
}

/**
 * The "line -> why" list both validators put in their error. Echoing the line back is safe: only
 * lines CPM is about to drop are named, so nothing new is repeated to the caller.
 */
export function droppedWafDirectiveDetails(dropped: readonly DroppedWafDirective[]): string[] {
  // The bounds go as strings, or the catalog would format 1073741824 with separators. Only the
  // body-limit reason reads them; the others ignore the extra params.
  const bounds = { min: String(CORAZA_MIN_BODY_LIMIT), max: String(CORAZA_MAX_BODY_LIMIT) };
  return dropped.map((entry) => `"${entry.line}" - ${domainErrorMessage(entry.reason, bounds)}`);
}

/**
 * Effective WAF settings for a host: null host → global as-is; `enabled === false` → opt out;
 * `waf_mode === "override"` → host only; `"merge"` (default) → host over global.
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
      request_body_limit: host.request_body_limit,
      request_body_in_memory_limit: host.request_body_in_memory_limit,
      request_body_limit_action: host.request_body_limit_action,
    };
  }

  // Merge mode: start with global, overlay host fields.
  // host.enabled === false is an explicit opt-out - respect it even when global is on.
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
      // Body limits are scalars, not lists: the host value wins when set,
      // otherwise the global one applies.
      request_body_limit: host.request_body_limit ?? global.request_body_limit,
      request_body_in_memory_limit:
        host.request_body_in_memory_limit ?? global.request_body_in_memory_limit,
      request_body_limit_action: host.request_body_limit_action ?? global.request_body_limit_action,
    };
  }

  if (host?.enabled) {
    return {
      enabled: true,
      mode: host.mode ?? "On",
      load_owasp_crs: host.load_owasp_crs ?? false,
      custom_directives: host.custom_directives ?? "",
      excluded_rule_ids: host.excluded_rule_ids,
      request_body_limit: host.request_body_limit,
      request_body_in_memory_limit: host.request_body_in_memory_limit,
      request_body_limit_action: host.request_body_limit_action,
    };
  }
  if (global?.enabled) return global;
  return null;
}

/** Caddy matcher for a WebSocket upgrade, mirroring the built-in `@websockets`. */
export const WEBSOCKET_UPGRADE_MATCHER: Record<string, unknown> = {
  header: {
    Connection: ["*Upgrade*"],
    Upgrade: ["websocket"],
  },
};

/**
 * Builds the Caddy `waf` handler. @-prefixed SecLang paths resolve from the embedded
 * coraza-coreruleset filesystem, mounted only when `load_owasp_crs` is true - so every @-include
 * is gated on that flag, or the config load fails.
 */
export function buildWafHandler(waf: WafSettings): Record<string, unknown> {
  const parts: string[] = [];

  // `mode` is interpolated straight into the directive block and settings are stored unvalidated,
  // so anything but a known engine mode would smuggle in SecLang past the allowlist. Clamp to
  // Coraza's three real values.
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
    // The caddy image ships the audit log pre-created as caddy-owned 0660, which a new volume copies
    // in, and Coraza opens an existing file without touching its mode - so the agent can truncate
    // it through caddy's group. No SecAuditLogFileMode: the container's 0022 umask would strip the
    // group-write bit from it anyway. A file Coraza creates itself is 0644, and the agent reports
    // that on the Agents page. Part H carries the matched rules; bodies (I, J, E) and headers (D)
    // are omitted to avoid huge writes.
    "SecAuditLogParts ABFHZ",
    "SecResponseBodyAccess Off",
  );

  // Body limits from the dedicated settings fields. Emitted after the CRS
  // include (so they override @coraza.conf-recommended's 12.5 MiB) but before
  // custom_directives, which stay the escape hatch that wins over the UI.
  if (isValidBodyLimit(waf.request_body_limit)) {
    parts.push(`SecRequestBodyLimit ${waf.request_body_limit}`);
  }
  if (isValidBodyLimit(waf.request_body_in_memory_limit)) {
    parts.push(`SecRequestBodyInMemoryLimit ${waf.request_body_in_memory_limit}`);
  }
  if (
    waf.request_body_limit_action === "Reject" ||
    waf.request_body_limit_action === "ProcessPartial"
  ) {
    parts.push(`SecRequestBodyLimitAction ${waf.request_body_limit_action}`);
  }

  // Allowlist approach: only known-safe directive prefixes reach the handler. The validators
  // refuse a write that would drop a line, so by here `dropped` is normally empty - this stays the
  // net for rows written before that check existed.
  const { kept } = filterCustomDirectives(waf.custom_directives);
  if (kept.length > 0) {
    parts.push(kept.join("\n"));
  }

  const handler: Record<string, unknown> = {
    handler: "waf",
    directives: reconcileInMemoryBodyLimit(parts.join("\n"), waf.load_owasp_crs),
  };
  if (waf.load_owasp_crs) handler.load_owasp_crs = true;
  return handler;
}

/**
 * Coraza also validates `SecRequestBodyInMemoryLimit <= SecRequestBodyLimit`
 * and fails config load when it doesn't hold. That pairing is easy to break by
 * accident: lowering only the request limit leaves the CRS's 128 KiB in-memory
 * value above it, and the resulting rejection takes down every host's config,
 * not just this handler's.
 *
 * Coraza validates the FINAL parsed values, so only the last directive of each
 * kind matters. When they conflict, append a corrective in-memory line - the
 * last one wins, so the config stays loadable with the user's request limit
 * intact.
 */
function reconcileInMemoryBodyLimit(directives: string, crsLoaded: boolean): string {
  let requestLimit = crsLoaded ? CRS_BODY_LIMIT : CORAZA_DEFAULT_BODY_LIMIT;
  let inMemoryLimit = crsLoaded ? CRS_IN_MEMORY_BODY_LIMIT : null;

  for (const line of directives.split("\n")) {
    const match = BODY_LIMIT_DIRECTIVE.exec(line.trim());
    if (!match) continue;
    const name = match[1].toLowerCase();
    const value = Number(match[2]);
    if (name === "secrequestbodylimit") requestLimit = value;
    else if (name === "secrequestbodyinmemorylimit") inMemoryLimit = value;
  }

  if (inMemoryLimit === null || inMemoryLimit <= requestLimit) return directives;
  return `${directives}\nSecRequestBodyInMemoryLimit ${requestLimit}`;
}

/**
 * The handler-chain entry applying the WAF for a proxy route.
 *
 * When allowWebsocket is true the WAF handler is wrapped in a non-terminal
 * subroute that only runs for NON-WebSocket requests.  WebSocket upgrades must
 * bypass the coraza handler ENTIRELY - not merely have the rule engine turned
 * off via `ctl:ruleEngine=off` (issue #195):
 *
 *   The coraza-caddy middleware wraps the response writer to inspect the
 *   upstream response (SecLang phase 3/4 rules).  That wrapper does not pass
 *   through the connection hijack that a `101 Switching Protocols` upgrade
 *   performs, so the raw WebSocket bytes leak out without the HTTP status line.
 *   The client sees a corrupt "HTTP/0.9" response and the handshake fails.
 *   Disabling only the rule engine leaves the response wrapper in place, so the
 *   connection is still mangled - routing around the handler is the only fix.
 *
 * Because a Caddy `subroute` compiles its inner routes with the OUTER `next`
 * handler as their continuation, the WAF handler still wraps the downstream
 * `reverse_proxy` for ordinary requests (response inspection preserved); only
 * the matched-out WebSocket upgrade skips it and falls straight through to the
 * next handler in the chain.
 *
 * With allowWebsocket the handler sits in a non-terminal subroute that skips upgrades. They must
 * bypass coraza entirely, not just disable the rule engine (#195): coraza-caddy wraps the response
 * writer, breaking the `101 Switching Protocols` hijack - raw bytes leak out with no status line.
 * A `subroute` compiles inner routes with the OUTER `next`, so ordinary requests still get the WAF.
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
