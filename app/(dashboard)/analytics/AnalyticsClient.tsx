"use client";

import type React from "react";
import { useState, useEffect, useCallback, useMemo } from "react";
import dynamic from "next/dynamic";
import dayjs, { type Dayjs } from "dayjs";
import { toast } from "sonner";
import type { ApexOptions } from "apexcharts";

import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { CheckboxInput } from "@astryxdesign/core/CheckboxInput";
import { DateTimeInput, type ISODateTimeString } from "@astryxdesign/core/DateTimeInput";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Grid } from "@astryxdesign/core/Grid";
import { Heading } from "@astryxdesign/core/Heading";
import { Link as AstryxLink } from "@astryxdesign/core/Link";
import { MultiSelector } from "@astryxdesign/core/MultiSelector";
import { Pagination } from "@astryxdesign/core/Pagination";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Spinner } from "@astryxdesign/core/Spinner";
import {
  Table,
  pixel,
  proportional,
  useTableRowStatus,
  type TableColumn,
} from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";
import { Tooltip } from "@astryxdesign/core/Tooltip";
import { HStack, VStack } from "@astryxdesign/core/Stack";

// ── Dynamic imports (browser-only) ────────────────────────────────────────────

const ReactApexChart = dynamic(() => import("react-apexcharts"), { ssr: false });

const WorldMap = dynamic(() => import("./WorldMapInner"), {
  ssr: false,
  loading: () => (
    <HStack justify="center" vAlign="center" height={240}>
      <Spinner label="Loading map" />
    </HStack>
  ),
}) as React.ComponentType<{
  data: import("./WorldMapInner").CountryStats[];
  selectedCountry?: string | null;
}>;

// ── Types (mirrored from analytics-db — can't import server-only code) ────────

type Interval = "1h" | "12h" | "24h" | "7d" | "30d";
type DisplayInterval = Interval | "custom";

const INTERVAL_SECONDS_CLIENT: Record<Interval, number> = {
  "1h": 3600,
  "12h": 43200,
  "24h": 86400,
  "7d": 7 * 86400,
  "30d": 30 * 86400,
};

interface AnalyticsSummary {
  totalRequests: number;
  uniqueIps: number;
  blockedRequests: number;
  blockedPercent: number;
  bytesServed: number;
  loggingDisabled: boolean;
  analyticsDisabled: boolean;
}

interface TimelineBucket {
  ts: number;
  total: number;
  blocked: number;
}
interface CountryStats {
  countryCode: string;
  total: number;
  blocked: number;
}
interface ProtoStats {
  proto: string;
  count: number;
  percent: number;
}
interface UAStats {
  userAgent: string;
  count: number;
  percent: number;
}

interface AnalyticsHost {
  host: string;
  configured: boolean;
}

interface BlockedEvent {
  id: number;
  ts: number;
  clientIp: string;
  countryCode: string | null;
  method: string;
  uri: string;
  status: number;
  host: string;
}
interface BlockedPage {
  events: BlockedEvent[];
  total: number;
  page: number;
  pages: number;
}

/** Table-facing shapes: Astryx's Table requires an index signature on rows. */
type CountryRow = {
  countryCode: string;
  total: number;
  blocked: number;
  waf: number;
  allowed: number;
  [k: string]: unknown;
};
type ProtoRow = ProtoStats & { [k: string]: unknown };
type BlockedRow = BlockedEvent & { [k: string]: unknown };

interface TopWafRule {
  ruleId: number;
  count: number;
  message: string | null;
  hosts: { host: string; count: number }[];
}
type WafRuleRow = TopWafRule & { [k: string]: unknown };
interface WafStats {
  total: number;
  topRules: TopWafRule[];
  byCountry: { countryCode: string; count: number }[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function countryFlag(code: string): string {
  if (!code || code.length !== 2) return "🌐";
  return String.fromCodePoint(
    ...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65),
  );
}

function parseUA(ua: string): string {
  if (!ua) return "Unknown";
  if (/Googlebot/i.test(ua)) return "Googlebot";
  if (/bingbot/i.test(ua)) return "Bingbot";
  if (/DuckDuckBot/i.test(ua)) return "DuckDuckBot";
  if (/curl/i.test(ua)) return "curl";
  if (/python-requests|Python\//i.test(ua)) return "Python";
  if (/Go-http-client/i.test(ua)) return "Go";
  if (/wget/i.test(ua)) return "wget";
  if (/Edg\//i.test(ua)) return "Edge";
  if (/OPR\//i.test(ua)) return "Opera";
  if (/SamsungBrowser/i.test(ua)) return "Samsung Browser";
  if (/Chrome\//i.test(ua)) return "Chrome";
  if (/Firefox\//i.test(ua)) return "Firefox";
  if (/Safari\//i.test(ua)) return "Safari";
  return ua.substring(0, 32);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatTs(ts: number, rangeSeconds: number): string {
  const d = new Date(ts * 1000);
  if (rangeSeconds <= 86400)
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (rangeSeconds <= 7 * 86400)
    return (
      d.toLocaleDateString([], { weekday: "short" }) +
      " " +
      d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    );
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

const DARK_CHART: ApexOptions = {
  chart: { background: "transparent", toolbar: { show: false }, animations: { enabled: false } },
  theme: { mode: "dark" },
  grid: { borderColor: "rgba(255,255,255,0.06)" },
  tooltip: { theme: "dark" },
};

// ── Local DateTimePicker ───────────────────────────────────────────────────────

/**
 * A date and a time in one control.
 *
 * Was a Popover holding a Calendar plus a bare <input type="time">, which meant
 * two separate widgets and a hand-rolled string round-trip. DateTimeInput owns
 * both halves, so this only converts between its ISO string and the Dayjs value
 * the rest of the page works in.
 */
function DateTimePicker({
  value,
  onChange,
  placeholder,
}: {
  value: Dayjs | null;
  onChange: (v: Dayjs | null) => void;
  placeholder?: string;
}) {
  return (
    <DateTimeInput
      label={placeholder ?? "Pick date & time"}
      isLabelHidden
      value={
        (value ? value.format("YYYY-MM-DDTHH:mm") : undefined) as ISODateTimeString | undefined
      }
      onChange={(next) => onChange(next ? dayjs(next) : null)}
      size="sm"
      width={200}
    />
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────────

/**
 * The `color` prop stays a raw hex: these cards share the chart palette so a
 * red block-rate figure matches the red in the series beside it, and the chart
 * library is not theme-token aware.
 */
function StatCard({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
}) {
  return (
    <Card padding={5} height="100%">
      <VStack gap={1}>
        <Text type="label" size="xsm" color="secondary">
          {label}
        </Text>
        <Text type="display-3" hasTabularNumbers>
          <span style={color ? { color } : undefined}>{value}</span>
        </Text>
        {sub && (
          <Text type="body" size="sm" color="secondary">
            {sub}
          </Text>
        )}
      </VStack>
    </Card>
  );
}

// ── Hosts multi-select combobox ───────────────────────────────────────────────

const INCLUDE_UNCONFIGURED_KEY = "analytics:includeUnconfiguredHosts";

/**
 * Host filter.
 *
 * Was a Popover wrapping a Command list with hand-built "select all" / "clear"
 * buttons, a hand-built include-unconfigured toggle, and a hand-built badge
 * summary. MultiSelector provides search, select-all and the badge summary
 * natively; the unconfigured toggle is the one thing left to render, and it is
 * a real checkbox now rather than a button with a faded tick.
 */
function HostsCombobox({
  allHosts,
  selectedHosts,
  onChange,
}: {
  allHosts: AnalyticsHost[];
  selectedHosts: string[];
  onChange: (v: string[]) => void;
}) {
  const [includeUnconfigured, setIncludeUnconfigured] = useState(false);

  // Restore the persisted "include unconfigured hosts" preference
  useEffect(() => {
    try {
      setIncludeUnconfigured(localStorage.getItem(INCLUDE_UNCONFIGURED_KEY) === "1");
    } catch {
      /* ignore */
    }
  }, []);

  function setFilter(v: boolean) {
    setIncludeUnconfigured(v);
    try {
      localStorage.setItem(INCLUDE_UNCONFIGURED_KEY, v ? "1" : "0");
    } catch {
      /* ignore */
    }
  }

  const hasUnconfigured = allHosts.some((h) => !h.configured);
  const visibleHosts = (includeUnconfigured ? allHosts : allHosts.filter((h) => h.configured)).map(
    (h) => h.host,
  );

  return (
    <VStack gap={2}>
      <MultiSelector
        label="Hosts"
        isLabelHidden
        options={visibleHosts.map((h) => ({ value: h, label: h }))}
        value={selectedHosts}
        onChange={onChange}
        hasSearch
        searchPlaceholder="Search hosts..."
        hasSelectAll
        triggerDisplay="badges"
        maxBadges={2}
        placeholder="All hosts"
        width={240}
      />
      {hasUnconfigured && (
        <CheckboxInput
          label="Include unconfigured hosts"
          description="Hosts that received traffic but are not configured as proxy hosts in Caddy."
          value={includeUnconfigured}
          onChange={setFilter}
        />
      )}
    </VStack>
  );
}

// ── Data fetching ─────────────────────────────────────────────────────────────

/**
 * Fetch JSON, treating a non-2xx response as a failure.
 *
 * The analytics endpoints answer errors with `{ error: "…" }` and a 4xx/5xx
 * status. Parsing that body without checking `response.ok` yields an object
 * where the caller expects an array, and the first `.map()`/`.some()` on it
 * throws during render — which unmounts the whole analytics page, map included.
 * So a single unreachable ClickHouse used to blank the entire page.
 */
async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const reported =
      body && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error).trim()
        : "";
    // Errors thrown by the ClickHouse client often carry an empty message, so
    // always fall back to something renderable — an empty string is falsy and
    // would leave the failure banner invisible.
    throw new Error(reported || `${url.split("?")[0]} failed with status ${response.status}`);
  }
  return body;
}

/**
 * Defensive cast for list-shaped payloads. Renders empty rather than throwing if
 * an endpoint ever answers 200 with something unexpected.
 */
function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AnalyticsClient() {
  const [interval, setIntervalVal] = useState<DisplayInterval>("1h");
  const [selectedHosts, setSelectedHosts] = useState<string[]>([]);
  const [allHosts, setAllHosts] = useState<AnalyticsHost[]>([]);

  // Custom range as Dayjs objects
  const [customFrom, setCustomFrom] = useState<Dayjs | null>(null);
  const [customTo, setCustomTo] = useState<Dayjs | null>(null);

  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [timeline, setTimeline] = useState<TimelineBucket[]>([]);
  const [countries, setCountries] = useState<CountryStats[]>([]);
  const [protocols, setProtocols] = useState<ProtoStats[]>([]);
  const [userAgents, setUserAgents] = useState<UAStats[]>([]);
  const [blocked, setBlocked] = useState<BlockedPage | null>(null);
  const [wafStats, setWafStats] = useState<WafStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);

  /** How many seconds the current selection spans — used for chart axis labels */
  const rangeSeconds = useMemo(() => {
    if (interval === "custom" && customFrom && customTo) {
      const diff = customTo.unix() - customFrom.unix();
      return diff > 0 ? diff : 3600;
    }
    return INTERVAL_SECONDS_CLIENT[interval as Interval] ?? 3600;
  }, [interval, customFrom, customTo]);

  /** Build the query string for all analytics endpoints */
  const buildParams = useCallback(
    (extra = "") => {
      const h =
        selectedHosts.length > 0 ? `hosts=${selectedHosts.map(encodeURIComponent).join(",")}` : "";
      const sep = h ? `&${h}` : "";
      if (interval === "custom" && customFrom && customTo) {
        return `?from=${customFrom.unix()}&to=${customTo.unix()}${sep}${extra}`;
      }
      return `?interval=${interval}${sep}${extra}`;
    },
    [interval, selectedHosts, customFrom, customTo],
  );

  // Fetch all configured+active hosts once
  useEffect(() => {
    fetchJson("/api/analytics/hosts")
      .then((h) => setAllHosts(asArray<AnalyticsHost>(h)))
      .catch(() => setAllHosts([]));
  }, []);

  // Fetch all analytics data when range/host selection changes
  useEffect(() => {
    if (interval === "custom") {
      if (!customFrom || !customTo || customFrom.unix() >= customTo.unix()) return;
    }
    setLoading(true);
    const params = buildParams();
    Promise.all([
      fetchJson(`/api/analytics/summary${params}`),
      fetchJson(`/api/analytics/timeline${params}`),
      fetchJson(`/api/analytics/countries${params}`),
      fetchJson(`/api/analytics/protocols${params}`),
      fetchJson(`/api/analytics/user-agents${params}`),
      fetchJson(`/api/analytics/blocked${params}&page=1`),
      fetchJson(`/api/analytics/waf-stats${params}`),
    ])
      .then(([s, t, c, p, u, b, w]) => {
        setLoadError(null);
        setSummary(s as AnalyticsSummary);
        setTimeline(asArray<TimelineBucket>(t));
        setCountries(asArray<CountryStats>(c));
        setProtocols(asArray<ProtoStats>(p));
        setUserAgents(asArray<UAStats>(u));
        setBlocked(b as BlockedPage);
        setWafStats(w as WafStats);
      })
      .catch((err: unknown) => {
        // Reset to empty rather than leaving stale data next to an error banner.
        setLoadError(err instanceof Error ? err.message : "Failed to load analytics data");
        setSummary(null);
        setTimeline([]);
        setCountries([]);
        setProtocols([]);
        setUserAgents([]);
        setBlocked(null);
        setWafStats(null);
        toast.error("Failed to load analytics data");
      })
      .finally(() => setLoading(false));
  }, [buildParams, interval, customFrom, customTo]);

  const fetchBlockedPage = useCallback(
    (page: number) => {
      fetchJson(`/api/analytics/blocked${buildParams(`&page=${page}`)}`)
        .then((b) => setBlocked(b as BlockedPage))
        .catch(() => toast.error("Failed to load blocked requests"));
    },
    [buildParams],
  );

  // ── Chart configs ─────────────────────────────────────────────────────────

  const timelineLabels = timeline.map((b) => formatTs(b.ts, rangeSeconds));
  const timelineOptions: ApexOptions = {
    ...DARK_CHART,
    chart: { ...DARK_CHART.chart, type: "area", stacked: false, id: "timeline" },
    colors: ["#3b82f6", "#ef4444"],
    fill: { type: "gradient", gradient: { shadeIntensity: 1, opacityFrom: 0.45, opacityTo: 0.05 } },
    stroke: { curve: "smooth", width: 2 },
    dataLabels: { enabled: false },
    xaxis: {
      categories: timelineLabels,
      labels: { rotate: 0, style: { colors: "#94a3b8", fontSize: "11px" } },
      axisBorder: { show: false },
      axisTicks: { show: false },
    },
    yaxis: { labels: { style: { colors: "#94a3b8" } } },
    legend: { labels: { colors: "#94a3b8" } },
    tooltip: { theme: "dark", shared: true, intersect: false },
  };
  const timelineSeries = [
    { name: "Allowed", data: timeline.map((b) => b.total - b.blocked) },
    { name: "Blocked", data: timeline.map((b) => b.blocked) },
  ];

  const donutOptions: ApexOptions = {
    ...DARK_CHART,
    chart: { ...DARK_CHART.chart, type: "donut", id: "protocols" },
    colors: ["#3b82f6", "#8b5cf6", "#06b6d4", "#f59e0b"],
    labels: protocols.map((p) => p.proto),
    legend: { position: "bottom", labels: { colors: "#94a3b8" } },
    dataLabels: { style: { colors: ["#fff"] } },
    plotOptions: { pie: { donut: { size: "65%" } } },
  };
  const donutSeries = protocols.map((p) => p.count);

  const uaNames = userAgents.map((u) => parseUA(u.userAgent));
  const barOptions: ApexOptions = {
    ...DARK_CHART,
    chart: { ...DARK_CHART.chart, type: "bar", id: "ua" },
    colors: ["#7f5bff"],
    plotOptions: { bar: { horizontal: true, borderRadius: 4 } },
    dataLabels: { enabled: false },
    xaxis: { categories: uaNames, labels: { style: { colors: "#94a3b8", fontSize: "12px" } } },
    yaxis: { labels: { style: { colors: "#94a3b8", fontSize: "12px" } } },
  };
  const barSeries = [{ name: "Requests", data: userAgents.map((u) => u.count) }];

  const wafRuleLabels = (wafStats?.topRules ?? []).map((r) => `#${r.ruleId}`);
  const wafBarOptions: ApexOptions = {
    ...DARK_CHART,
    chart: { ...DARK_CHART.chart, type: "bar", id: "waf-rules" },
    colors: ["#f59e0b"],
    plotOptions: { bar: { horizontal: true, borderRadius: 4 } },
    dataLabels: { enabled: false },
    xaxis: {
      categories: wafRuleLabels,
      labels: { style: { colors: "#94a3b8", fontSize: "12px" } },
    },
    yaxis: { labels: { style: { colors: "#94a3b8", fontSize: "12px" } } },
  };
  const wafBarSeries = [{ name: "Hits", data: (wafStats?.topRules ?? []).map((r) => r.count) }];

  const wafByCountry = new Map((wafStats?.byCountry ?? []).map((r) => [r.countryCode, r.count]));

  const INTERVALS: DisplayInterval[] = ["1h", "12h", "24h", "7d", "30d", "custom"];

  // -- Table shapes ----------------------------------------------------------
  // Astryx's Table wants rows carrying an index signature, so each dataset is
  // widened at this one boundary rather than on the domain types themselves.

  const countryRows: CountryRow[] = countries.slice(0, 10).map((c) => ({
    countryCode: c.countryCode,
    total: c.total,
    blocked: c.blocked,
    waf: wafByCountry.get(c.countryCode) ?? 0,
    allowed: Math.max(0, c.total - c.blocked),
  }));

  // Replaces a hand-tinted row background, which signalled selection by colour
  // alone and was invisible to assistive tech.
  const countryStatus = useTableRowStatus<CountryRow>({
    getStatus: (row) =>
      row.countryCode === selectedCountry ? { color: "accent", label: "Selected" } : null,
  });

  const countryColumns: TableColumn<CountryRow>[] = [
    {
      key: "countryCode",
      header: "Country",
      width: proportional(1),
      // The whole row used to be the click target for filtering the map, which
      // no keyboard user could reach. The country itself is the control now.
      renderCell: (row) => (
        <Button
          variant="ghost"
          size="sm"
          label={
            row.countryCode === selectedCountry
              ? `Clear map filter for ${row.countryCode}`
              : `Filter map to ${row.countryCode}`
          }
          onClick={() =>
            setSelectedCountry((cur) => (cur === row.countryCode ? null : row.countryCode))
          }
        >
          <HStack gap={2} vAlign="center">
            <span aria-hidden="true">{countryFlag(row.countryCode)}</span>
            <Text type="inherit" size="sm">
              {row.countryCode}
            </Text>
          </HStack>
        </Button>
      ),
    },
    {
      key: "total",
      header: "Total",
      align: "end",
      width: pixel(90),
      renderCell: (row) => (
        <Text type="body" size="sm" hasTabularNumbers>
          {row.total.toLocaleString()}
        </Text>
      ),
    },
    {
      key: "allowed",
      header: "Allowed",
      align: "end",
      width: pixel(90),
      renderCell: (row) => (
        <Text type="body" size="sm" hasTabularNumbers>
          {row.allowed.toLocaleString()}
        </Text>
      ),
    },
    {
      key: "waf",
      header: "WAF",
      align: "end",
      width: pixel(80),
      renderCell: (row) => (
        <Text type="body" size="sm" color={row.waf > 0 ? "primary" : "secondary"} hasTabularNumbers>
          {row.waf > 0 ? row.waf.toLocaleString() : "—"}
        </Text>
      ),
    },
    {
      key: "blocked",
      header: "Blocked",
      align: "end",
      width: pixel(90),
      renderCell: (row) => (
        <Text
          type="body"
          size="sm"
          color={row.blocked > 0 ? "primary" : "secondary"}
          hasTabularNumbers
        >
          {row.blocked.toLocaleString()}
        </Text>
      ),
    },
  ];

  const protocolRows: ProtoRow[] = protocols.map((p) => ({ ...p }));

  const protocolColumns: TableColumn<ProtoRow>[] = [
    {
      key: "proto",
      header: "Protocol",
      width: proportional(1),
      renderCell: (row) => (
        <Text type="body" size="sm">
          {row.proto}
        </Text>
      ),
    },
    {
      key: "count",
      header: "Requests",
      align: "end",
      width: pixel(110),
      renderCell: (row) => (
        <Text type="body" size="sm" hasTabularNumbers>
          {row.count.toLocaleString()}
        </Text>
      ),
    },
    {
      key: "percent",
      header: "Share",
      align: "end",
      width: pixel(80),
      renderCell: (row) => (
        <Text type="body" size="sm" color="secondary" hasTabularNumbers>
          {row.percent}%
        </Text>
      ),
    },
  ];

  const blockedRows: BlockedRow[] = (blocked?.events ?? []).map((ev) => ({ ...ev }));

  const blockedColumns: TableColumn<BlockedRow>[] = [
    {
      key: "ts",
      header: "Time",
      width: pixel(170),
      renderCell: (row) => (
        <Text type="body" size="sm" color="secondary">
          <span suppressHydrationWarning>{new Date(row.ts * 1000).toLocaleString()}</span>
        </Text>
      ),
    },
    {
      key: "clientIp",
      header: "IP",
      width: pixel(130),
      renderCell: (row) => (
        <Text type="code" size="sm">
          {row.clientIp}
        </Text>
      ),
    },
    {
      key: "countryCode",
      header: "Country",
      width: pixel(100),
      renderCell: (row) => (
        <Text type="body" size="sm">
          {row.countryCode ? `${countryFlag(row.countryCode)} ${row.countryCode}` : "—"}
        </Text>
      ),
    },
    {
      key: "host",
      header: "Host",
      width: pixel(160),
      renderCell: (row) => (
        <Text type="body" size="sm" maxLines={1}>
          {row.host || "—"}
        </Text>
      ),
    },
    {
      key: "method",
      header: "Method",
      width: pixel(90),
      renderCell: (row) => (
        <Text type="code" size="sm">
          {row.method}
        </Text>
      ),
    },
    {
      key: "uri",
      header: "URI",
      width: proportional(1),
      renderCell: (row) => (
        <Tooltip content={row.uri}>
          <Text type="code" size="sm" maxLines={1}>
            {row.uri}
          </Text>
        </Tooltip>
      ),
    },
    {
      key: "status",
      header: "Status",
      width: pixel(80),
      align: "end",
      renderCell: (row) => <Badge variant="error" label={String(row.status)} />,
    },
  ];

  const wafRuleRows: WafRuleRow[] = (wafStats?.topRules ?? []).map((r) => ({ ...r }));

  const wafRuleColumns: TableColumn<WafRuleRow>[] = [
    {
      key: "ruleId",
      header: "Rule",
      width: pixel(90),
      renderCell: (row) => (
        <Text type="code" size="sm">
          #{row.ruleId}
        </Text>
      ),
    },
    {
      key: "message",
      header: "Description",
      width: proportional(1),
      renderCell: (row) =>
        row.message ? (
          <Tooltip content={row.message}>
            <Text type="body" size="sm" color="secondary" maxLines={1}>
              {row.message}
            </Text>
          </Tooltip>
        ) : (
          <Text type="body" size="sm" color="secondary">
            —
          </Text>
        ),
    },
    {
      key: "count",
      header: "Hits",
      width: pixel(80),
      align: "end",
      renderCell: (row) => (
        <Text type="body" size="sm" weight="semibold" hasTabularNumbers>
          {row.count.toLocaleString()}
        </Text>
      ),
    },
    {
      key: "hosts",
      header: "Triggered by",
      width: proportional(1),
      renderCell: (row) => (
        <HStack gap={1} wrap="wrap">
          {row.hosts.map((h) => (
            <Badge key={h.host} label={`${h.host} ×${h.count}`} />
          ))}
        </HStack>
      ),
    },
  ];

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <VStack gap={8}>
      {/* Header */}
      <HStack justify="between" vAlign="center" gap={4} wrap="wrap">
        <VStack gap={0}>
          <Text type="label" size="xsm" color="secondary">
            Traffic Intelligence
          </Text>
          <Heading level={1}>Analytics</Heading>
        </VStack>
        <HStack gap={3} vAlign="center" wrap="wrap">
          {/* Was six buttons whose selected state read only as a filled
              variant; SegmentedControl exposes the choice as a radio group. */}
          <SegmentedControl
            label="Time interval"
            size="sm"
            value={interval}
            onChange={(next) => {
              const iv = next as DisplayInterval;
              if (iv === "custom" && !customFrom) {
                setCustomFrom(dayjs().subtract(24, "hour"));
                setCustomTo(dayjs());
              }
              setIntervalVal(iv);
            }}
          >
            {INTERVALS.map((iv) => (
              <SegmentedControlItem key={iv} value={iv} label={iv === "custom" ? "Custom" : iv} />
            ))}
          </SegmentedControl>

          {interval === "custom" && (
            <HStack gap={2} vAlign="center">
              <DateTimePicker value={customFrom} onChange={setCustomFrom} placeholder="From" />
              <Text type="body" size="xsm" color="secondary">
                &ndash;
              </Text>
              <DateTimePicker value={customTo} onChange={setCustomTo} placeholder="To" />
            </HStack>
          )}

          <HostsCombobox
            allHosts={allHosts}
            selectedHosts={selectedHosts}
            onChange={setSelectedHosts}
          />
        </HStack>
      </HStack>

      {/* Load failure alert — e.g. ClickHouse unreachable or a failing query.
          Rendered instead of crashing the page, so the rest of the UI stays usable. */}
      {loadError && (
        <div data-testid="analytics-load-error">
          <Banner status="error" title="Failed to load analytics data" description={loadError} />
        </div>
      )}

      {/* Analytics disabled alert */}
      {summary?.analyticsDisabled && (
        <Banner
          status="info"
          title="ClickHouse analytics is not enabled"
          description="Traffic and WAF data is not being collected. Add COMPOSE_PROFILES=clickhouse and CLICKHOUSE_PASSWORD=… to your .env and restart to enable analytics."
        />
      )}

      {/* Logging disabled alert */}
      {summary?.loggingDisabled && !summary?.analyticsDisabled && (
        <Banner
          status="warning"
          title="Caddy access logging is not enabled"
          description={
            <Text type="body" size="sm">
              No traffic data is being collected.{" "}
              <AstryxLink href="/settings">Enable logging in Settings</AstryxLink>.
            </Text>
          }
        />
      )}

      {/* Loading overlay */}
      {loading && (
        <HStack justify="center" padding={10}>
          <Spinner size="lg" label="Loading analytics" />
        </HStack>
      )}

      {!loading && summary && (
        <>
          {/* Stats row */}
          <Grid columns={{ minWidth: 150, max: 5 }} gap={3}>
            <StatCard label="Total Requests" value={summary.totalRequests.toLocaleString()} />
            <StatCard label="Unique IPs" value={summary.uniqueIps.toLocaleString()} />
            <StatCard
              label="Blocked Requests"
              value={summary.blockedRequests.toLocaleString()}
              sub={
                (wafStats?.total ?? 0) > 0
                  ? `${wafStats!.total.toLocaleString()} from WAF`
                  : undefined
              }
              color={summary.blockedRequests > 0 ? "#ef4444" : undefined}
            />
            <StatCard
              label="Block Rate"
              value={`${summary.blockedPercent}%`}
              sub={`${formatBytes(summary.bytesServed)} served`}
              color={summary.blockedPercent > 10 ? "#f59e0b" : undefined}
            />
            <StatCard
              label="WAF Events"
              value={(wafStats?.total ?? 0).toLocaleString()}
              sub={
                wafStats && wafStats.topRules.length > 0
                  ? `${wafStats.topRules.length} rules triggered`
                  : "No WAF events"
              }
              color={(wafStats?.total ?? 0) > 0 ? "#f59e0b" : undefined}
            />
          </Grid>

          {/* Timeline */}
          <Card padding={5}>
            <VStack gap={4}>
              <Text type="body" size="sm" weight="semibold">
                Requests Over Time
              </Text>
              {timeline.length === 0 ? (
                <EmptyState title="No data for this period" isCompact />
              ) : (
                <div style={{ overflowX: "auto", width: "100%" }}>
                  <ReactApexChart
                    type="area"
                    series={timelineSeries}
                    options={timelineOptions}
                    height={220}
                  />
                </div>
              )}
            </VStack>
          </Card>

          {/* World map + Countries */}
          <Grid columns={{ minWidth: 320, max: 2 }} gap={3}>
            <Card padding={5}>
              <VStack gap={2} minHeight={280}>
                <Text type="body" size="sm" weight="semibold">
                  Traffic by Country
                </Text>
                <WorldMap data={countries} selectedCountry={selectedCountry} />
              </VStack>
            </Card>
            <Card padding={4}>
              <VStack gap={3}>
                <Text type="body" size="sm" weight="semibold">
                  Top Countries
                </Text>
                {countries.length === 0 ? (
                  <EmptyState title="No geo data available" isCompact />
                ) : (
                  <Table
                    data={countryRows}
                    columns={countryColumns}
                    idKey="countryCode"
                    hasHover
                    plugins={{ rowStatus: countryStatus }}
                  />
                )}
              </VStack>
            </Card>
          </Grid>

          {/* Protocols + User Agents */}
          <Grid columns={{ minWidth: 320, max: 2 }} gap={3}>
            <Card padding={5}>
              <VStack gap={4}>
                <Text type="body" size="sm" weight="semibold">
                  HTTP Protocols
                </Text>
                {protocols.length === 0 ? (
                  <EmptyState title="No data" isCompact />
                ) : (
                  <>
                    <div style={{ overflowX: "auto", width: "100%" }}>
                      <ReactApexChart
                        type="donut"
                        series={donutSeries}
                        options={donutOptions}
                        height={220}
                      />
                    </div>
                    <Table data={protocolRows} columns={protocolColumns} idKey="proto" />
                  </>
                )}
              </VStack>
            </Card>
            <Card padding={5}>
              <VStack gap={4}>
                <Text type="body" size="sm" weight="semibold">
                  Top User Agents
                </Text>
                {userAgents.length === 0 ? (
                  <EmptyState title="No data" isCompact />
                ) : (
                  <div style={{ overflowX: "auto", width: "100%" }}>
                    <ReactApexChart
                      type="bar"
                      series={barSeries}
                      options={barOptions}
                      height={260}
                    />
                  </div>
                )}
              </VStack>
            </Card>
          </Grid>

          {/* Recent Blocked Requests */}
          <Card padding={5}>
            <VStack gap={4}>
              <Text type="body" size="sm" weight="semibold">
                Recent Blocked Requests
              </Text>
              {!blocked || blocked.events.length === 0 ? (
                <EmptyState title="No blocked requests in this period" isCompact />
              ) : (
                <>
                  <Table data={blockedRows} columns={blockedColumns} idKey="id" hasHover />
                  {blocked.pages > 1 && (
                    <HStack justify="center">
                      <Pagination
                        page={blocked.page}
                        pageSize={blocked.events.length || 1}
                        totalItems={blocked.total}
                        onChange={fetchBlockedPage}
                      />
                    </HStack>
                  )}
                </>
              )}
            </VStack>
          </Card>

          {/* WAF Top Rules */}
          {wafStats && wafStats.total > 0 && (
            <Card padding={5}>
              <VStack gap={4}>
                <Text type="body" size="sm" weight="semibold">
                  Top WAF Rules Triggered
                </Text>
                <div style={{ overflowX: "auto", width: "100%" }}>
                  <ReactApexChart
                    type="bar"
                    series={wafBarSeries}
                    options={wafBarOptions}
                    height={Math.max(120, wafStats.topRules.length * 32)}
                  />
                </div>
                <Table data={wafRuleRows} columns={wafRuleColumns} idKey="ruleId" />
              </VStack>
            </Card>
          )}
        </>
      )}
    </VStack>
  );
}
