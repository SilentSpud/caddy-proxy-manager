/**
 * Coraza's audit log, turned into WAF events. Runs on the agent for the same reason the access-log
 * parser does: the file is on this host. Its two seams are the same — the parse offset lives in the
 * agent's SQLite, and the rows go straight to ClickHouse.
 */
import { existsSync, statSync, truncateSync } from "node:fs";
import maxmind, { type CountryResponse } from "maxmind";
import type { WafEventRow } from "@cpm/shared";
import type { AgentStore } from "../db";
import { insertWafEvents } from "./clickhouse";
import { readLines } from "./log-read";

const AUDIT_LOG = process.env.WAF_AUDIT_LOG || "/logs/waf-audit.log";
const RULES_LOG = process.env.WAF_RULES_LOG || "/logs/waf-rules.log";
const GEOIP_DB = process.env.GEOIP_DB || "/usr/share/GeoIP/GeoLite2-Country.mmdb";
const BATCH_SIZE = 200;
// Coraza's SecAuditLog writes straight to AUDIT_LOG with no rotation of its own (unlike
// access.log/waf-rules.log, which roll through Caddy's file writer). Once fully ingested,
// truncate it in place past this size so it can't grow unbounded and fill the disk.
const AUDIT_LOG_TRUNCATE_THRESHOLD = 100 * 1024 * 1024;

let geoReader: Awaited<ReturnType<typeof maxmind.open<CountryResponse>>> | null = null;
const geoCache = new Map<string, string | null>();

let stopped = false;

// ── state helpers ─────────────────────────────────────────────────────────────

/** Set once at startup; every state read and write goes through it. */
let store: AgentStore | null = null;

export function bindStore(next: AgentStore): void {
  store = next;
}

async function getState(key: string): Promise<string | null> {
  return store?.parseState(key) ?? null;
}

async function setState(key: string, value: string): Promise<void> {
  store?.setParseState(key, value);
}

// ── GeoIP ─────────────────────────────────────────────────────────────────────

async function initGeoIP(): Promise<void> {
  if (!existsSync(GEOIP_DB)) return;
  try {
    geoReader = await maxmind.open<CountryResponse>(GEOIP_DB);
  } catch {
    // GeoIP optional
  }
}

function lookupCountry(ip: string): string | null {
  if (!geoReader) return null;
  if (geoCache.has(ip)) return geoCache.get(ip)!;
  if (geoCache.size > 10_000) geoCache.clear();
  try {
    const result = geoReader.get(ip);
    const code = result?.country?.iso_code ?? null;
    geoCache.set(ip, code);
    return code;
  } catch {
    geoCache.set(ip, null);
    return null;
  }
}

// ── WAF rules log parsing ─────────────────────────────────────────────────────
// Caddy's http.handlers.waf logger emits one JSON line per matched rule holding a ModSecurity
// message, e.g. `[id "941100"] [msg "XSS Attack ..."] [unique_id "abc123"]`. Mapped by unique_id.

interface RuleInfo {
  ruleId: number | null;
  ruleMessage: string | null;
  severity: string | null;
}

export function extractBracketField(msg: string, field: string): string | null {
  const m = msg.match(new RegExp(`\\[${field} "([^"]*)"\\]`));
  return m ? m[1] : null;
}

// Anomaly-evaluation rules only report the accumulated score, not a specific attack, so they
// must never be picked as an event's rule.
function isAnomalyEvaluationRule(ruleId: number | null): boolean {
  return ruleId === 949110 || ruleId === 980130;
}

/** Build RuleInfo from a ModSecurity-format rule string, or null if it isn't a specific attack rule. */
export function ruleInfoFromMessage(msg: string): RuleInfo | null {
  const ruleIdStr = extractBracketField(msg, "id");
  const ruleId = ruleIdStr ? parseInt(ruleIdStr, 10) : null;
  if (isAnomalyEvaluationRule(ruleId)) return null;
  return {
    ruleId,
    ruleMessage: extractBracketField(msg, "msg"),
    severity: extractBracketField(msg, "severity"),
  };
}

async function readRulesLog(
  startOffset: number,
): Promise<{ ruleMap: Map<string, RuleInfo>; newOffset: number }> {
  const ruleMap = new Map<string, RuleInfo>();
  const { lines, newOffset } = await readLines(startOffset, RULES_LOG);

  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as { msg?: string };
      const msg = entry.msg ?? "";
      const uniqueId = extractBracketField(msg, "unique_id");
      if (!uniqueId) continue;
      // Keep only the first detection rule per unique_id
      if (ruleMap.has(uniqueId)) continue;
      const info = ruleInfoFromMessage(msg);
      if (!info) continue;
      ruleMap.set(uniqueId, info);
    } catch {
      // skip malformed lines
    }
  }

  return { ruleMap, newOffset };
}

// ── audit log parsing ─────────────────────────────────────────────────────────

interface CorazaAuditEntry {
  transaction?: {
    id?: string;
    client_ip?: string;
    // unix_timestamp is nanoseconds since epoch
    unix_timestamp?: number;
    timestamp?: string;
    // is_interrupted: true means the request was blocked/detected by the WAF
    is_interrupted?: boolean;
    request?: {
      method?: string;
      uri?: string;
      // header values are arrays of strings (lowercase keys)
      headers?: Record<string, string[]>;
    };
  };
  // Populated when audit log part H (or K) is enabled: one entry per matched rule, carrying
  // the ModSecurity-format rule string.
  messages?: { message?: string; error_message?: string }[];
}

/**
 * The first specific (non anomaly-evaluation) matched rule from a Coraza audit entry's own
 * `messages` array, which carries the same string waf-rules.log gets when audit part H is on.
 * Reading it from the entry makes attribution deterministic; a join loses events on tick edges.
 */
export function ruleInfoFromAuditEntry(entry: CorazaAuditEntry): RuleInfo | null {
  for (const m of entry.messages ?? []) {
    const msg = m.error_message || m.message || "";
    if (!msg) continue;
    const info = ruleInfoFromMessage(msg);
    // Keep looking past anomaly-evaluation rules — a real attack rule usually
    // precedes them, but ordering is not guaranteed.
    if (info && info.ruleId !== null) return info;
  }
  return null;
}

export function parseLine(line: string, ruleMap: Map<string, RuleInfo>): WafEventRow | null {
  let entry: CorazaAuditEntry;
  try {
    entry = JSON.parse(line);
  } catch {
    return null;
  }

  const tx = entry.transaction;
  if (!tx) return null;

  const clientIp = tx.client_ip ?? "";
  if (!clientIp) return null;

  const req = tx.request ?? {};

  // unix_timestamp is nanoseconds; fall back to parsing timestamp string
  let ts: number;
  if (tx.unix_timestamp) {
    ts = Math.floor(tx.unix_timestamp / 1e9);
  } else if (tx.timestamp) {
    ts = Math.floor(new Date(tx.timestamp).getTime() / 1000);
  } else {
    ts = Math.floor(Date.now() / 1000);
  }

  // Host header is an array under lowercase key
  const hostArr = req.headers?.host ?? req.headers?.Host;
  const host = Array.isArray(hostArr) ? (hostArr[0] ?? "") : (hostArr ?? "");

  // Prefer the rule carried by the audit entry itself; fall back to the
  // waf-rules.log join only for Coraza builds that don't populate `messages`.
  const ruleInfo = ruleInfoFromAuditEntry(entry) ?? (tx.id ? ruleMap.get(tx.id) : undefined);

  const blocked = tx.is_interrupted ?? false;

  // Only store events where a specific rule matched or the request was blocked.
  // Audit log entries without any rule match are clean requests and can be discarded.
  if (!blocked && !ruleInfo) return null;

  return {
    ts,
    host,
    client_ip: clientIp,
    country_code: lookupCountry(clientIp),
    method: req.method ?? "",
    uri: req.uri ?? "",
    rule_id: ruleInfo?.ruleId ?? null,
    rule_message: ruleInfo?.ruleMessage ?? null,
    severity: ruleInfo?.severity ?? null,
    raw_data: line,
    blocked,
  };
}

async function readAuditLog(startOffset: number): Promise<{ lines: string[]; newOffset: number }> {
  return readLines(startOffset, AUDIT_LOG);
}

/**
 * Reset the stored audit-log position so the next pass starts from the top. Used when the tracked
 * file is gone or replaced: an offset from a different inode would park the parser past EOF, since
 * the rotation guard only fires when the file is *smaller* than last recorded.
 */
async function resetAuditLogState(): Promise<void> {
  await setState("waf_audit_log_offset", "0");
  await setState("waf_audit_log_size", "0");
  await setState("waf_audit_log_inode", "0");
}

// Warn once per episode so a deleted audit log — or one we are never allowed to truncate —
// doesn't spam a line every 30s, while still surfacing the condition instead of failing
// silently the way this used to.
let warnedAuditLogMissing = false;
let warnedTruncateFailed = false;

async function insertBatch(rows: WafEventRow[]): Promise<void> {
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    await insertWafEvents(rows.slice(i, i + BATCH_SIZE));
  }
}

// ── public API ────────────────────────────────────────────────────────────────

export async function initWafLogParser(): Promise<void> {
  stopped = false;
  await initGeoIP();
  console.log("[waf-log-parser] initialized");
}

export async function parseNewWafLogEntries(): Promise<void> {
  if (stopped) return;

  // Coraza holds the audit log open, so a deleted file keeps receiving writes on the unlinked inode
  // and is never recreated — returning silently left ingestion dead with no trace. Surface it, and
  // clear the stale offset so a recreated file is read from the start.
  if (!existsSync(AUDIT_LOG)) {
    if (!warnedAuditLogMissing) {
      console.warn(
        `[waf-log-parser] ${AUDIT_LOG} is missing — WAF events cannot be ingested until Caddy recreates it (restart the caddy container).`,
      );
      warnedAuditLogMissing = true;
      await resetAuditLogState();
    }
    return;
  }
  warnedAuditLogMissing = false;

  try {
    // ── 1. Parse WAF rules log to build unique_id → rule info map ────────────
    const rulesOffset = parseInt((await getState("waf_rules_log_offset")) ?? "0", 10);
    const rulesSize = parseInt((await getState("waf_rules_log_size")) ?? "0", 10);

    let currentRulesSize = 0;
    if (existsSync(RULES_LOG)) {
      try {
        currentRulesSize = statSync(RULES_LOG).size;
      } catch {
        /* ignore */
      }
    }
    const rulesStartOffset = currentRulesSize < rulesSize ? 0 : rulesOffset;
    const { ruleMap, newOffset: newRulesOffset } = await readRulesLog(rulesStartOffset);

    await setState("waf_rules_log_offset", String(newRulesOffset));
    await setState("waf_rules_log_size", String(currentRulesSize));

    // ── 2. Parse audit log, enriching events with rule info from map ─────────
    const storedOffset = parseInt((await getState("waf_audit_log_offset")) ?? "0", 10);
    const storedSize = parseInt((await getState("waf_audit_log_size")) ?? "0", 10);
    const storedInode = parseInt((await getState("waf_audit_log_inode")) ?? "0", 10);

    let currentSize: number;
    let currentInode: number;
    try {
      const st = statSync(AUDIT_LOG);
      currentSize = st.size;
      currentInode = Number(st.ino);
    } catch {
      return;
    }

    // Restart from the top when the file was rotated (shrank) or replaced by a different
    // inode. Size alone is not enough: a delete-and-recreate that already grew past the last
    // recorded size would strand the stored offset beyond EOF with no way back.
    const replaced = storedInode !== 0 && currentInode !== storedInode;
    const startOffset = currentSize < storedSize || replaced ? 0 : storedOffset;
    if (replaced) {
      console.warn(
        "[waf-log-parser] waf-audit.log was replaced (new inode) — re-reading from the start",
      );
    }

    const { lines, newOffset } = await readAuditLog(startOffset);

    if (lines.length > 0) {
      const rows = lines
        .map((l) => parseLine(l, ruleMap))
        .filter((r): r is WafEventRow => r !== null);
      if (rows.length > 0) {
        await insertBatch(rows);
        console.log(`[waf-log-parser] inserted ${rows.length} WAF events`);
      }
    }

    // Persist progress BEFORE truncating. Truncation is a best-effort disk guard that fails with
    // EACCES when web and caddy run as different UIDs, and doing it first froze these offsets — so
    // every later pass re-read and re-inserted the same tail forever.
    await setState("waf_audit_log_offset", String(newOffset));
    await setState("waf_audit_log_size", String(currentSize));
    await setState("waf_audit_log_inode", String(currentInode));

    // Having read through to the current end of file, truncation is safe: Coraza appends via
    // O_APPEND, so writes after truncation land at the new (empty) end of file.
    if (newOffset === currentSize && currentSize > AUDIT_LOG_TRUNCATE_THRESHOLD) {
      try {
        truncateSync(AUDIT_LOG, 0);
        // Same inode, now empty — keep tracking it, just rewind.
        await setState("waf_audit_log_offset", "0");
        await setState("waf_audit_log_size", "0");
        warnedTruncateFailed = false;
        console.log(
          `[waf-log-parser] truncated waf-audit.log after ingesting ${currentSize} bytes`,
        );
      } catch (err) {
        if (!warnedTruncateFailed) {
          const code = (err as NodeJS.ErrnoException).code;
          console.warn(
            `[waf-log-parser] could not truncate ${AUDIT_LOG} (${code ?? err}); ` +
              `it will keep growing. Ingestion is unaffected.`,
          );
          warnedTruncateFailed = true;
        }
      }
    }
  } catch (err) {
    console.error("[waf-log-parser] error during parse:", err);
  }
}

export function stopWafLogParser(): void {
  stopped = true;
}
