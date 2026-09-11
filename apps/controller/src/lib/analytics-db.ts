import db from "./db";
import { proxyHosts } from "./db/schema";
import {
  querySummary,
  queryTimeline,
  queryCountries,
  queryCountryBreakdown,
  queryProtocols,
  queryUserAgents,
  queryBlocked,
  queryTrafficEvents,
  queryStatusClasses,
  queryWafCount,
  queryDistinctHosts,
  queryHostTotals,
  isAnalyticsEnabled,
  type AnalyticsSummary as CHSummary,
  type TimelineBucket,
  type CountryStats,
  type CountryBreakdown,
  type ProtoStats,
  type UAStats,
  type BlockedEvent,
  type BlockedPage,
  type TrafficEvent,
  type TrafficEventFilter,
  type StatusClassCounts,
} from "./clickhouse/client";

export type {
  TimelineBucket,
  CountryStats,
  CountryBreakdown,
  ProtoStats,
  UAStats,
  BlockedEvent,
  BlockedPage,
  TrafficEvent,
  TrafficEventFilter,
  StatusClassCounts,
};

export type Interval = "1h" | "12h" | "24h" | "7d" | "30d";

export const INTERVAL_SECONDS: Record<Interval, number> = {
  "1h": 3600,
  "12h": 43200,
  "24h": 86400,
  "7d": 7 * 86400,
  "30d": 30 * 86400,
};

/** A whole number of seconds since the epoch, as the analytics routes take `from` and `to`. */
const EPOCH_SECONDS = /^\d{1,12}$/;

/**
 * The time window an analytics request asks for.
 *
 * An explicit `from`/`to` pair wins only when both are plain epoch seconds and `from` is before
 * `to`. Anything else - a missing half, `abc`, `1e9`, a reversed range - falls back to the
 * interval rather than reaching ClickHouse as NaN, which would either fail the query or, worse,
 * quietly match nothing and render as "no traffic".
 */
export function resolveAnalyticsRange(
  params: URLSearchParams,
  defaultInterval: Interval = "1h",
): { from: number; to: number } {
  const fromParam = params.get("from") ?? "";
  const toParam = params.get("to") ?? "";
  if (EPOCH_SECONDS.test(fromParam) && EPOCH_SECONDS.test(toParam)) {
    const from = Number(fromParam);
    const to = Number(toParam);
    if (from < to) return { from, to };
  }
  const interval = params.get("interval");
  const seconds =
    interval && Object.hasOwn(INTERVAL_SECONDS, interval)
      ? INTERVAL_SECONDS[interval as Interval]
      : INTERVAL_SECONDS[defaultInterval];
  const to = Math.floor(Date.now() / 1000);
  return { from: to - seconds, to };
}

// ── Summary ──────────────────────────────────────────────────────────────────

export interface AnalyticsSummary extends CHSummary {
  loggingDisabled: boolean;
  analyticsDisabled: boolean;
}

/**
 * Whether any agent is writing an access log.
 *
 * Asked of the agents rather than checked on this filesystem: the log lives on the agent's host,
 * so a controller looking at its own disk would report logging as disabled on every deployment
 * whose Caddy is somewhere else. With no agent answering, nothing is being written either, which
 * is the same answer.
 */
async function isLoggingActive(): Promise<boolean> {
  const { getAllAgentStatuses } = await import("./agent/client");
  const statuses = await getAllAgentStatuses();
  return statuses.some((result) => result.ok && result.value.analytics.accessLogPresent);
}

export async function getAnalyticsSummary(
  from: number,
  to: number,
  hosts: string[],
): Promise<AnalyticsSummary> {
  const [loggingActive, summary, analyticsOn] = await Promise.all([
    isLoggingActive(),
    querySummary(from, to, hosts),
    isAnalyticsEnabled(),
  ]);
  return { ...summary, loggingDisabled: !loggingActive, analyticsDisabled: !analyticsOn };
}

// ── Timeline ─────────────────────────────────────────────────────────────────

export async function getAnalyticsTimeline(
  from: number,
  to: number,
  hosts: string[],
): Promise<TimelineBucket[]> {
  return queryTimeline(from, to, hosts);
}

// ── Countries ────────────────────────────────────────────────────────────────

export async function getAnalyticsCountries(
  from: number,
  to: number,
  hosts: string[],
): Promise<CountryStats[]> {
  return queryCountries(from, to, hosts);
}

/** One country's hosts, response classes and user agents, for the drill-down under the map. */
export async function getAnalyticsCountryBreakdown(
  from: number,
  to: number,
  hosts: string[],
  countryCode: string,
): Promise<CountryBreakdown> {
  return queryCountryBreakdown(from, to, hosts, countryCode);
}

// ── Protocols ────────────────────────────────────────────────────────────────

export async function getAnalyticsProtocols(
  from: number,
  to: number,
  hosts: string[],
): Promise<ProtoStats[]> {
  return queryProtocols(from, to, hosts);
}

// ── User Agents ──────────────────────────────────────────────────────────────

export async function getAnalyticsUserAgents(
  from: number,
  to: number,
  hosts: string[],
): Promise<UAStats[]> {
  return queryUserAgents(from, to, hosts);
}

// ── Blocked events ───────────────────────────────────────────────────────────

export async function getAnalyticsBlocked(
  from: number,
  to: number,
  hosts: string[],
  page: number,
): Promise<BlockedPage> {
  return queryBlocked(from, to, hosts, page);
}

// ── Overview ─────────────────────────────────────────────────────────────────

export interface OverviewAnalytics {
  summary: AnalyticsSummary;
  statusClasses: StatusClassCounts;
  wafBlocked: number;
  timeline: TimelineBucket[];
  events: TrafficEvent[];
}

/**
 * Everything the overview draws, in one round trip.
 *
 * The page changes all three of its bands together - tiles, chart and log all follow
 * the same range - so splitting this across the existing per-widget routes would put
 * three requests on every range change and let the bands disagree while they land.
 *
 * `limit` is the log's screenful; the rows are a sample of the window, not a page to
 * walk through, which is why there is no pagination here.
 */
export async function getOverviewAnalytics(
  from: number,
  to: number,
  hosts: string[],
  filter: TrafficEventFilter,
  limit: number,
): Promise<OverviewAnalytics> {
  const [summary, statusClasses, wafBlocked, timeline, events] = await Promise.all([
    getAnalyticsSummary(from, to, hosts),
    queryStatusClasses(from, to, hosts),
    queryWafCount(from, to),
    queryTimeline(from, to, hosts),
    queryTrafficEvents(from, to, hosts, filter, limit),
  ]);
  return { summary, statusClasses, wafBlocked, timeline, events };
}

// ── Per-host traffic ─────────────────────────────────────────────────────────

export interface HostTraffic {
  total: number;
  blocked: number;
}

export interface HostTrafficResult {
  /**
   * Whether traffic numbers exist to show at all: analytics is switched on and ClickHouse
   * answered. Distinct from `byHost` being empty, which with analytics on just means none of these
   * hosts took traffic in the window - a zero worth showing, not an absence to hide.
   */
  available: boolean;
  byHost: Map<number, HostTraffic>;
}

/**
 * Traffic totals keyed by proxy host id, for a list that shows one number per row.
 *
 * ClickHouse records the Host header, which is a domain rather than a host id, so the totals are
 * folded back onto the row that serves that domain - a host with three domains reports the sum of
 * all three. Wildcards are not expanded: `*.lab.example.com` never appears as a Host header, so a
 * request to `a.lab.example.com` counts only if that exact name is also on the host.
 *
 * `available` is false when analytics is switched off or ClickHouse cannot be reached; the list
 * then renders without the column rather than failing, or showing zeroes that read as "no traffic".
 */
export async function getTrafficByProxyHost(
  from: number,
  to: number,
  hosts: { id: number; domains: string[] }[],
): Promise<HostTrafficResult> {
  const byHost = new Map<number, HostTraffic>();

  let totals: Awaited<ReturnType<typeof queryHostTotals>>;
  try {
    // Asked separately rather than read off an empty result: ClickHouse returns no rows both when
    // analytics is off and when nothing was recorded, and only the first should hide the column.
    if (!(await isAnalyticsEnabled())) return { available: false, byHost };
    if (hosts.length === 0) return { available: true, byHost };
    totals = await queryHostTotals(from, to);
  } catch {
    return { available: false, byHost };
  }

  const domainToHost = new Map<string, number[]>();
  for (const host of hosts) {
    for (const domain of host.domains) {
      const key = domain.trim().toLowerCase();
      if (!key) continue;
      const ids = domainToHost.get(key);
      if (ids) ids.push(host.id);
      else domainToHost.set(key, [host.id]);
    }
  }

  for (const row of totals) {
    // Caddy logs the authority, which carries the port on a non-default one.
    const name = row.host.trim().toLowerCase().split(":")[0];
    for (const id of domainToHost.get(name) ?? []) {
      const current = byHost.get(id);
      if (current) {
        current.total += row.total;
        current.blocked += row.blocked;
      } else {
        byHost.set(id, { total: row.total, blocked: row.blocked });
      }
    }
  }

  return { available: true, byHost };
}

// ── Hosts ────────────────────────────────────────────────────────────────────

export interface AnalyticsHost {
  host: string;
  /** true when this host matches a domain configured on a proxy host in Caddy */
  configured: boolean;
}

export async function getAnalyticsHosts(): Promise<AnalyticsHost[]> {
  const hostSet = new Set<string>();
  const configured = new Set<string>();

  // Hosts from ClickHouse traffic events
  const chHosts = await queryDistinctHosts();
  for (const h of chHosts) if (h) hostSet.add(h);

  // All domains configured on proxy hosts
  const proxyRows = await db.select({ domains: proxyHosts.domains }).from(proxyHosts);
  for (const r of proxyRows) {
    try {
      const domains = JSON.parse(r.domains) as string[];
      for (const d of domains) {
        const trimmed = d?.trim().toLowerCase();
        if (trimmed) {
          hostSet.add(trimmed);
          configured.add(trimmed);
        }
      }
    } catch {
      /* ignore malformed rows */
    }
  }

  const isIp = (h: string) => /^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/.test(h);
  return Array.from(hostSet)
    .filter((h) => !isIp(h))
    .sort()
    .map((host) => ({ host, configured: configured.has(host.toLowerCase()) }));
}
