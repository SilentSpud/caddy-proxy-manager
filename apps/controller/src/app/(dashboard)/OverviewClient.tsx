"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ApexOptions } from "apexcharts";
import { ArrowLeftRight, BarChart2, Gauge, History, KeyRound, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { Card } from "@astryxdesign/core/Card";
import { ClickableCard } from "@astryxdesign/core/ClickableCard";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Grid } from "@astryxdesign/core/Grid";
import { Heading } from "@astryxdesign/core/Heading";
import { Icon } from "@astryxdesign/core/Icon";
import { Link as AstryxLink } from "@astryxdesign/core/Link";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { SelectableCard } from "@astryxdesign/core/SelectableCard";
import { Spinner } from "@astryxdesign/core/Spinner";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Table, pixel, proportional, type TableColumn } from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { useTranslations } from "next-intl";
import { useEmptyValue } from "@/components/ui/empty-value";
import { useChartTheme, type ChartTheme } from "./analytics/chart-theme";

// ApexCharts renders on the client only, for the reason given in AnalyticsClient: v7's
// server entry is an async Server Component this file cannot reach, and there is nothing
// to draw until the effect below has fetched a window anyway.
const ReactApexChart = dynamic(() => import("react-apexcharts"), { ssr: false });

/** Icons the resource shortcuts can show, keyed by name so the server can name one. */
const STAT_ICONS = {
  proxyHosts: ArrowLeftRight,
  certificates: ShieldCheck,
  accessLists: KeyRound,
} as const;

export type StatCard = {
  label: string;
  icon: keyof typeof STAT_ICONS;
  /** The headline number. Where `total` is set this is the enabled subset of it. */
  count: number;
  /**
   * The whole set, when "how many are switched on" is a different question from "how
   * many exist" - a disabled proxy host still occupies a domain and still shows in the
   * list, so a bare count would overstate what is being served.
   */
  total?: number;
  href: string;
};

export type RecentEvent = {
  // The audit row's primary key, so the list keys on real identity rather than page position.
  id: number;
  action: string;
  entityType: string;
  /** Null when the actor was the system, or an account that has since been deleted. */
  actor: string | null;
  summary: string;
  createdAt: string;
};

type TrafficSummary = {
  totalRequests: number;
  blockedPercent: number;
} | null;

// ── The shapes /api/analytics/overview returns ───────────────────────────────
// Declared here rather than imported from analytics-db: that module reaches ClickHouse
// and the settings registry, and a client component must not pull either into the bundle.

type TimelineBucket = {
  ts: number;
  total: number;
  blocked: number;
  clientErrors: number;
  serverErrors: number;
  bytes: number;
};

type TrafficEvent = {
  ts: number;
  clientIp: string;
  countryCode: string | null;
  host: string;
  method: string;
  uri: string;
  status: number;
  proto: string;
  bytesSent: number;
  isBlocked: boolean;
};

export type OverviewPayload = {
  summary: {
    totalRequests: number;
    uniqueIps: number;
    blockedRequests: number;
    blockedPercent: number;
    bytesServed: number;
    loggingDisabled: boolean;
    analyticsDisabled: boolean;
  };
  statusClasses: { ok: number; clientErrors: number; serverErrors: number; blocked: number };
  wafBlocked: number;
  timeline: TimelineBucket[];
  events: TrafficEvent[];
};

const INTERVALS = ["1h", "12h", "24h", "7d", "30d"] as const;
type Interval = (typeof INTERVALS)[number];

type MetricKey =
  | "requests"
  | "serverEvents"
  | "serverErrors"
  | "clientErrors"
  | "bandwidth"
  | "blocked";

/**
 * A tile, and what selecting it does to the two bands below.
 *
 * `filter` is the slice of the access log the request pane shows, and `series` is what
 * the chart plots - both drawn from the same window, so a tile's number, its line and
 * its rows are always the same population.
 *
 * With no tile selected every series is plotted at once, which is the page's resting
 * state; selecting one narrows the chart and the log to it, and selecting it again
 * returns to the overlay. `color` is fixed per metric rather than per position so a
 * series keeps the same colour whether it is alone or one line among five.
 *
 * `serverEvents` is the exception: it has no traffic series of its own, so it narrows
 * the log to controller changes and leaves the chart on the overlay. Audit rows are not
 * bucketed over time anywhere in the schema, and inventing a series for them would be
 * the only fabricated thing on this page.
 */
type MetricDef = {
  key: MetricKey;
  filter: "all" | "server-errors" | "client-errors" | "largest" | "blocked";
  series:
    | keyof Pick<TimelineBucket, "total" | "blocked" | "clientErrors" | "serverErrors" | "bytes">
    | null;
  format: "count" | "bytes";
  /** Set on every metric that has a series; there is one colour per line in the overlay. */
  color?: keyof ChartTheme["series"];
};

const METRICS: MetricDef[] = [
  { key: "requests", filter: "all", series: "total", format: "count", color: "blue" },
  { key: "serverEvents", filter: "all", series: null, format: "count" },
  {
    key: "serverErrors",
    filter: "server-errors",
    series: "serverErrors",
    format: "count",
    color: "red",
  },
  {
    key: "clientErrors",
    filter: "client-errors",
    series: "clientErrors",
    format: "count",
    color: "orange",
  },
  {
    key: "bandwidth",
    filter: "largest",
    series: "bytes",
    format: "bytes",
    color: "purple",
  },
  { key: "blocked", filter: "blocked", series: "blocked", format: "count", color: "cyan" },
];

/** The metrics the chart can draw - everything except the one with no series. */
type PlottedMetric = MetricDef & {
  series: NonNullable<MetricDef["series"]>;
  color: NonNullable<MetricDef["color"]>;
};
const PLOTTABLE: PlottedMetric[] = METRICS.filter(
  (m): m is PlottedMetric => m.series !== null && m.color !== undefined,
);

/** Bytes as the log shows them, so a row and its tile agree on the unit. */
function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0";
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

/** A bucket label short enough for an axis, at the resolution the range implies. */
function formatBucket(ts: number, rangeSeconds: number): string {
  const d = new Date(ts * 1000);
  if (rangeSeconds > 7 * 86400)
    return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  if (rangeSeconds > 86400) {
    return d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit" });
  }
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

const RANGE_SECONDS: Record<Interval, number> = {
  "1h": 3600,
  "12h": 43200,
  "24h": 86400,
  "7d": 7 * 86400,
  "30d": 30 * 86400,
};

/**
 * The tile filters, as a predicate.
 *
 * Only the preview path needs this - in the product the same slice is a WHERE clause in
 * `queryTrafficEvents`, and the two are kept deliberately in step.
 */
function matchesFilter(filter: MetricDef["filter"]): (event: TrafficEvent) => boolean {
  switch (filter) {
    case "server-errors":
      return (event) => event.status >= 500;
    case "client-errors":
      return (event) => event.status >= 400 && event.status < 500;
    case "blocked":
      return (event) => event.isBlocked;
    case "largest":
      return (event) => event.bytesSent > 0;
    default:
      return () => true;
  }
}

/** Audit actions, coloured the way the status codes beside them are. */
const AUDIT_VARIANT: Record<string, "success" | "error" | "info"> = {
  create: "success",
  add: "success",
  delete: "error",
  remove: "error",
};

function Tile({
  label,
  value,
  isSelected,
  onSelect,
  children,
}: {
  label: string;
  value: string;
  isSelected: boolean;
  onSelect: () => void;
  children?: ReactNode;
}) {
  return (
    <SelectableCard label={label} isSelected={isSelected} onChange={onSelect} padding={4}>
      <VStack gap={1}>
        <Text type="body" size="sm" weight="semibold" color="secondary" maxLines={1}>
          {label}
        </Text>
        <Text type="large" weight="semibold" hasTabularNumbers>
          {value}
        </Text>
        {children}
      </VStack>
    </SelectableCard>
  );
}

export default function OverviewClient({
  userName,
  stats,
  trafficSummary,
  recentEvents,
  serverEventCount = 0,
  previewPayload,
  isAdmin = true,
}: {
  userName: string;
  stats: StatCard[];
  trafficSummary: TrafficSummary;
  recentEvents: RecentEvent[];
  /** Audit rows in the last 24 hours, for the Server log tile. */
  serverEventCount?: number;
  /**
   * A window supplied by the caller instead of fetched.
   *
   * The docs site renders this component directly, with no API behind it. Without a way
   * in, the demo would show the load-failure banner - and the alternative, a copy of this
   * page kept in the docs, is exactly the thing that goes stale silently.
   */
  previewPayload?: OverviewPayload;
  isAdmin?: boolean;
}) {
  const t = useTranslations("overview");
  const emptyValue = useEmptyValue();
  const chartTheme = useChartTheme();

  const [interval, setIntervalValue] = useState<Interval>("24h");
  // Null is the resting state: no tile is picked out, so the chart carries every series
  // and the log carries everything the server did.
  const [metricKey, setMetricKey] = useState<MetricKey | null>(null);
  const [payload, setPayload] = useState<OverviewPayload | null>(previewPayload ?? null);
  const [isLoading, setIsLoading] = useState(isAdmin && !previewPayload);
  const [hasFailed, setHasFailed] = useState(false);

  const metric = metricKey === null ? null : (METRICS.find((m) => m.key === metricKey) ?? null);
  const filter = metric?.filter ?? "all";
  // The one tile whose rows come from Postgres rather than the traffic window.
  const isEventsOnly = metricKey === "serverEvents";
  // Requests, and the unfiltered view it is the tile for, are the whole log: traffic and
  // controller changes interleaved. Every other traffic tile is a slice of the requests,
  // which a controller change is not part of.
  const blendsEvents = metricKey === null || metricKey === "requests";

  // next-intl types t() against the catalog, so the key has to be a literal here
  // rather than carried on the metric definition.
  const metricLabel = useCallback(
    (key: MetricKey): string => {
      switch (key) {
        case "requests":
          return t("metricRequests");
        case "serverEvents":
          return t("metricServerEvents");
        case "serverErrors":
          return t("metricServerErrors");
        case "clientErrors":
          return t("metricClientErrors");
        case "bandwidth":
          return t("metricBandwidth");
        case "blocked":
          return t("metricBlocked");
      }
    },
    [t],
  );

  useEffect(() => {
    if (!isAdmin) return;
    // A supplied window is the whole dataset; there is nothing to fetch and nothing the
    // range or tile controls could load, so they act on what is already here.
    if (previewPayload) {
      setPayload(previewPayload);
      setIsLoading(false);
      return;
    }
    const abort = new AbortController();
    setIsLoading(true);
    const params = new URLSearchParams({ interval, filter, limit: "40" });
    fetch(`/api/analytics/overview?${params.toString()}`, { signal: abort.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((json: OverviewPayload) => {
        setPayload(json);
        setHasFailed(false);
        setIsLoading(false);
      })
      .catch((error: unknown) => {
        // An abort is this effect superseding itself, not a failure: leaving the old
        // window on screen while the new one lands is what keeps the page from flashing.
        if (error instanceof DOMException && error.name === "AbortError") return;
        setHasFailed(true);
        setIsLoading(false);
      });
    return () => abort.abort();
  }, [isAdmin, interval, filter, previewPayload]);

  const rangeSeconds = RANGE_SECONDS[interval];
  const timeline = payload?.timeline ?? [];

  /**
   * The series on the chart: the selected tile's alone, or all of them.
   *
   * A tile with no series of its own leaves the overlay up rather than blanking the
   * chart - the log is what that tile is really for.
   */
  const plotted = useMemo<PlottedMetric[]>(() => {
    const selected = PLOTTABLE.find((m) => m.key === metricKey);
    return selected ? [selected] : PLOTTABLE;
  }, [metricKey]);
  const isOverlay = plotted.length > 1;

  const chartSeries = useMemo(
    () =>
      plotted.map((m) => ({
        name: metricLabel(m.key),
        data: timeline.map((b) => b[m.series]),
      })),
    [plotted, timeline, metricLabel],
  );

  const chartOptions: ApexOptions = useMemo(() => {
    // Every count series reads off one axis, so a glance compares them honestly. Bytes
    // cannot share that scale, so bandwidth takes the right-hand one instead.
    const countAxis = chartSeries[plotted.findIndex((m) => m.format === "count")]?.name;
    return {
      ...chartTheme.base,
      chart: {
        ...chartTheme.base.chart,
        // Five filled areas on top of each other is mud; alone, the fill is what makes
        // the shape readable at 220px.
        type: isOverlay ? "line" : "area",
        stacked: false,
        id: "overview",
      },
      colors: plotted.map((m) => chartTheme.series[m.color]),
      fill: isOverlay
        ? { type: "solid" }
        : { type: "gradient", gradient: { shadeIntensity: 1, opacityFrom: 0.45, opacityTo: 0.05 } },
      stroke: { curve: "smooth", width: 2 },
      dataLabels: { enabled: false },
      xaxis: {
        categories: timeline.map((b) => formatBucket(b.ts, rangeSeconds)),
        labels: { rotate: 0, style: { colors: chartTheme.labelColor, fontSize: "11px" } },
        axisBorder: { show: false },
        axisTicks: { show: false },
      },
      // One entry per series, which is how ApexCharts pairs them. Pointing the count
      // series at a single `seriesName` is what makes them share a scale rather than
      // each getting its own.
      yaxis: plotted.map((m, index) => ({
        opposite: m.format === "bytes",
        seriesName: m.format === "bytes" ? chartSeries[index]?.name : countAxis,
        show: m.format === "bytes" || chartSeries[index]?.name === countAxis,
        labels: {
          style: { colors: chartTheme.labelColor },
          formatter: (value: number) =>
            m.format === "bytes" ? formatBytes(value) : Math.round(value).toLocaleString(),
        },
      })),
      legend: {
        show: isOverlay,
        position: "bottom",
        horizontalAlign: "left",
        labels: { colors: chartTheme.labelColor },
        // Two axes means two series groups, which ApexCharts otherwise stacks as separate
        // legend blocks - five names down the side of a 260px chart. One flat row instead.
        clusterGroupedSeries: false,
      },
      tooltip: {
        theme: chartTheme.mode,
        shared: true,
        intersect: false,
        // Shared tooltip, mixed units: the formatter has to ask which series it is on.
        y: {
          formatter: (value: number, opts?: { seriesIndex: number }) =>
            plotted[opts?.seriesIndex ?? 0]?.format === "bytes"
              ? formatBytes(value)
              : Math.round(value).toLocaleString(),
        },
      },
    };
  }, [chartTheme, plotted, chartSeries, isOverlay, timeline, rangeSeconds]);

  /**
   * One row of the server log, whichever store it came from.
   *
   * The two are interleaved rather than shown side by side, so "what was the server
   * doing when this broke" is one read: a config change and the 502s that followed it
   * land next to each other instead of in two panes with different clocks.
   */
  type LogRow =
    | ({ kind: "traffic"; id: string } & TrafficEvent)
    | {
        kind: "event";
        id: string;
        ts: number;
        action: string;
        entityType: string;
        actor: string | null;
        summary: string;
      };

  const logColumns: TableColumn<LogRow>[] = useMemo(
    () => [
      {
        key: "ts",
        header: t("logTime"),
        // Wide enough for a 12-hour clock with seconds and a meridiem, which is the
        // longest this renders in any locale; below that the "AM" wraps to its own line.
        width: pixel(116),
        renderCell: (row) => (
          <Text type="code" size="sm" color="secondary">
            {new Date(row.ts * 1000).toLocaleTimeString()}
          </Text>
        ),
      },
      {
        // One column for "what happened": an HTTP status, or the kind of change.
        key: "what",
        header: t("logStatus"),
        width: pixel(104),
        renderCell: (row) =>
          row.kind === "traffic" ? (
            <HStack gap={1} vAlign="center">
              <Badge
                variant={row.status >= 500 ? "error" : row.status >= 400 ? "warning" : "success"}
                label={String(row.status)}
              />
              {row.isBlocked && <StatusDot variant="error" label={t("logBlocked")} />}
            </HStack>
          ) : (
            <Badge variant={AUDIT_VARIANT[row.action] ?? "info"} label={row.action} />
          ),
      },
      {
        key: "detail",
        header: t("logDetail"),
        width: proportional(1),
        renderCell: (row) =>
          row.kind === "traffic" ? (
            <VStack gap={0}>
              <Text type="code" size="sm" maxLines={1}>
                {row.method} {row.host}
                {row.uri}
              </Text>
              {/* The rest of what traffic_events stores, on one line: nine columns will
                  not fit a table that also has to carry audit rows. */}
              <Text type="body" size="xsm" color="secondary" maxLines={1}>
                {formatBytes(row.bytesSent)} &middot; {row.proto || emptyValue} &middot;{" "}
                {row.countryCode ?? emptyValue} &middot; {row.clientIp}
              </Text>
            </VStack>
          ) : (
            <VStack gap={0}>
              <Text type="body" size="sm" maxLines={1}>
                {row.summary}
              </Text>
              <Text type="body" size="xsm" color="secondary" maxLines={1}>
                {row.actor ?? t("actorSystem")} &middot; {row.entityType}
              </Text>
            </VStack>
          ),
      },
    ],
    [t, emptyValue],
  );

  const logRows = useMemo<LogRow[]>(() => {
    let traffic = isEventsOnly ? [] : (payload?.events ?? []);
    // A supplied window arrives whole, so the tile's slice is taken here instead of by
    // the query that would otherwise have applied it. Without this the docs demo would
    // retitle the pane on a tile change and then show the same rows underneath.
    if (previewPayload && !isEventsOnly) {
      traffic = traffic.filter(matchesFilter(filter));
      if (filter === "largest") {
        traffic = [...traffic].sort((a, b) => b.bytesSent - a.bytesSent);
      }
    }
    const trafficRows: LogRow[] = traffic.map((event, index) => ({
      ...event,
      kind: "traffic",
      id: `t-${event.ts}-${index}`,
    }));

    if (!blendsEvents && !isEventsOnly) return trafficRows;

    const eventRows: LogRow[] = recentEvents.map((event) => ({
      kind: "event",
      id: `e-${event.id}`,
      ts: Math.floor(new Date(event.createdAt).getTime() / 1000),
      action: event.action,
      entityType: event.entityType,
      actor: event.actor,
      summary: event.summary,
    }));
    if (isEventsOnly) return eventRows;

    // Largest-first is a bandwidth question, not a timeline one, and that tile never
    // blends; everything that reaches here is newest first.
    return [...trafficRows, ...eventRows].sort((a, b) => b.ts - a.ts);
  }, [payload, previewPayload, filter, isEventsOnly, blendsEvents, recentEvents]);

  const tileValue = (key: MetricKey): string => {
    if (key === "serverEvents") return serverEventCount.toLocaleString();
    if (!payload) return emptyValue;
    switch (key) {
      case "requests":
        return payload.summary.totalRequests.toLocaleString();
      case "serverErrors":
        return payload.statusClasses.serverErrors.toLocaleString();
      case "clientErrors":
        return payload.statusClasses.clientErrors.toLocaleString();
      case "bandwidth":
        return formatBytes(payload.summary.bytesServed);
      case "blocked":
        return payload.statusClasses.blocked.toLocaleString();
    }
  };

  // Non-admins get the welcome header and nothing else: every band below reads either
  // ClickHouse or the audit log, both of which are admin-only.
  if (!isAdmin) {
    return (
      <VStack gap={8}>
        <VStack gap={1}>
          <Heading level={1}>Welcome back, {userName}</Heading>
          <Text type="body" size="sm" color="secondary" className="cpm-desktop-only">
            {t("pageDescription")}
          </Text>
        </VStack>
      </VStack>
    );
  }

  const loggingOff = payload?.summary.loggingDisabled || payload?.summary.analyticsDisabled;

  return (
    <VStack gap={5}>
      <HStack justify="between" vAlign="center" gap={4} wrap="wrap">
        <VStack gap={1}>
          <Heading level={1}>Welcome back, {userName}</Heading>
          {/* Not on a phone, like every page's description: read once, then only in the way. */}
          <Text type="body" size="sm" color="secondary" className="cpm-desktop-only">
            {t("pageDescription")}
          </Text>
        </VStack>
        <SegmentedControl
          label={t("timeRange")}
          size="sm"
          value={interval}
          onChange={(next) => setIntervalValue(next as Interval)}
        >
          {INTERVALS.map((iv) => (
            <SegmentedControlItem key={iv} value={iv} label={iv} />
          ))}
        </SegmentedControl>
      </HStack>

      {loggingOff && (
        <Banner
          status="warning"
          title={t("loggingOffTitle")}
          description={t("loggingOffDescription")}
        />
      )}
      {hasFailed && <Banner status="error" title={t("loadFailedTitle")} />}

      {/* Resource shortcuts. Kept from the previous overview: they are the only route to
          these pages that does not go through the side navigation. */}
      <Grid columns={{ minWidth: 200, max: 3 }} gap={3}>
        {stats.map((stat) => (
          <ClickableCard
            key={stat.label}
            label={
              stat.total === undefined
                ? `${stat.label}: ${stat.count}`
                : `${stat.label}: ${t("statEnabledOf", { enabled: stat.count, total: stat.total })}`
            }
            href={stat.href}
            padding={4}
          >
            <HStack gap={3} vAlign="center">
              <Icon icon={STAT_ICONS[stat.icon]} />
              <VStack gap={0}>
                <HStack gap={1} vAlign="end">
                  <Text type="display-3" hasTabularNumbers>
                    {String(stat.count)}
                  </Text>
                  {stat.total !== undefined && (
                    <Text type="body" size="sm" color="secondary" hasTabularNumbers>
                      {t("statOfTotal", { total: stat.total })}
                    </Text>
                  )}
                </HStack>
                <Text type="body" size="sm" color="secondary">
                  {stat.label}
                </Text>
              </VStack>
            </HStack>
          </ClickableCard>
        ))}
      </Grid>

      {/* Tiles. Selecting one changes the chart and the request log below. */}
      <Grid columns={{ minWidth: 160, max: 6 }} gap={3}>
        {METRICS.map((m) => (
          <Tile
            key={m.key}
            label={metricLabel(m.key)}
            value={tileValue(m.key)}
            isSelected={m.key === metricKey}
            // Selecting the tile that is already on clears it, which puts the chart back
            // on every series and the log back on everything.
            onSelect={() => setMetricKey((current) => (current === m.key ? null : m.key))}
          />
        ))}
      </Grid>

      {/* The series the selected tile plots, then the rows behind it. Each takes a
          row of its own: the chart wants width to be read, and the log wants it more. */}
      <Card padding={5}>
        <VStack gap={3}>
          <HStack justify="between" vAlign="center" gap={2}>
            <HStack gap={2} vAlign="center">
              <Icon icon={metricKey === "bandwidth" ? Gauge : BarChart2} size="sm" color="accent" />
              <Heading level={2} accessibilityLevel={2}>
                {isOverlay ? t("metricAll") : metricLabel(plotted[0].key)}
              </Heading>
            </HStack>
            <HStack gap={3} vAlign="center">
              {isLoading && <Spinner label={t("loading")} size="sm" />}
              {/* The overview answers "is anything off"; the analytics page is where a
              question this chart raises gets followed up. */}
              <AstryxLink href="/analytics">{t("viewAnalytics")}</AstryxLink>
            </HStack>
          </HStack>
          {timeline.length === 0 ? (
            <EmptyState title={t("periodEmptyTitle")} isCompact />
          ) : (
            <ReactApexChart
              type={isOverlay ? "line" : "area"}
              series={chartSeries}
              options={chartOptions}
              height={isOverlay ? 260 : 220}
            />
          )}
        </VStack>
      </Card>

      {/* One log for the whole server: requests and controller changes interleaved, with
          the tile row picking which of them it holds. */}
      <Card padding={5}>
        <VStack gap={3}>
          <HStack justify="between" vAlign="center" gap={2}>
            <HStack gap={2} vAlign="center">
              <Icon icon={History} size="sm" color="accent" />
              <Heading level={2} accessibilityLevel={2}>
                {t("logTitle")}
              </Heading>
            </HStack>
            <Badge variant="neutral" label={metricKey ? metricLabel(metricKey) : t("metricAll")} />
          </HStack>
          {logRows.length === 0 ? (
            <EmptyState
              title={isEventsOnly ? t("activityEmptyMessage") : t("requestLogEmptyTitle")}
              isCompact
            />
          ) : (
            // Table brings its own scroll wrapper, and its two fixed columns and truncating
            // third come to a 320px minimum, so it fits any card it can be read in. Wrapping
            // it again in an overflow-x box only added a second scroller - and one axis set
            // to `auto` turns the other from `visible` into `auto` too, which is where the
            // stray vertical scrollbar came from.
            <Table data={logRows} columns={logColumns} idKey="id" />
          )}
          <Text type="body" size="xsm" color="secondary">
            {isEventsOnly
              ? t("logSourceEvents")
              : blendsEvents
                ? t("logSourceBoth")
                : t("logSourceTraffic")}
          </Text>
        </VStack>
      </Card>

      {/* Kept so the 24h headline stays on the page even when a longer range is selected. */}
      {trafficSummary && trafficSummary.totalRequests > 0 && (
        <Text type="body" size="xsm" color="secondary">
          {t("traffic24h")}: {trafficSummary.totalRequests.toLocaleString()} &middot; {t("blocked")}{" "}
          {trafficSummary.blockedPercent}%
        </Text>
      )}
    </VStack>
  );
}
