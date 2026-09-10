"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import type { ApexOptions } from "apexcharts";
import {
  ArrowLeftRight,
  BarChart2,
  Gauge,
  History,
  KeyRound,
  Server,
  ShieldCheck,
} from "lucide-react";
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
import { List, ListItem } from "@astryxdesign/core/List";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { SelectableCard } from "@astryxdesign/core/SelectableCard";
import { Spinner } from "@astryxdesign/core/Spinner";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Table, pixel, proportional, type TableColumn } from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { useTranslations } from "next-intl";
import { useEmptyValue } from "@/components/ui/empty-value";
import { useChartTheme } from "./analytics/chart-theme";

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
  count: number;
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

export type FleetAgent = {
  id: number;
  name: string;
  /** Paired but switched off by an operator, which is not the same as unreachable. */
  isPaused: boolean;
  isConnected: boolean;
  /** Null until the agent has reported, which a paused or offline one never has. */
  mode: string | null;
  version: string | null;
};

export type FleetStatus = {
  proxyHosts: { total: number; enabled: number };
  l4Hosts: { total: number; enabled: number };
  agents: FleetAgent[];
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

type OverviewPayload = {
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
  | "serverLog"
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
 * `serverLog` is the exception: it has no traffic series of its own, so it leaves the
 * chart and the request pane alone and highlights the server-event pane instead. Audit
 * rows are not bucketed over time anywhere in the schema, and inventing a series for
 * them would be the only fabricated thing on this page.
 */
type MetricDef = {
  key: MetricKey;
  filter: "all" | "server-errors" | "client-errors" | "largest" | "blocked";
  series:
    | keyof Pick<TimelineBucket, "total" | "blocked" | "clientErrors" | "serverErrors" | "bytes">
    | null;
  format: "count" | "bytes";
};

const METRICS: MetricDef[] = [
  { key: "requests", filter: "all", series: "total", format: "count" },
  { key: "serverLog", filter: "all", series: null, format: "count" },
  {
    key: "serverErrors",
    filter: "server-errors",
    series: "serverErrors",
    format: "count",
  },
  {
    key: "clientErrors",
    filter: "client-errors",
    series: "clientErrors",
    format: "count",
  },
  {
    key: "bandwidth",
    filter: "largest",
    series: "bytes",
    format: "bytes",
  },
  { key: "blocked", filter: "blocked", series: "blocked", format: "count" },
];

/** Bytes as the log shows them, so a row and its tile agree on the unit. */
function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0";
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(iso).toLocaleDateString();
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

/** StatusDot carries a label as well as colour, so the change kind reaches screen readers. */
function getEventStatus(action: string): {
  variant: "success" | "error" | "accent";
  label: string;
} {
  const lower = action.toLowerCase();
  if (lower.startsWith("delete") || lower.startsWith("remove")) {
    return { variant: "error", label: "Removal" };
  }
  if (lower.startsWith("create") || lower.startsWith("add")) {
    return { variant: "success", label: "Creation" };
  }
  return { variant: "accent", label: "Change" };
}

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
        <Text type="body" size="xsm" weight="semibold" color="secondary" maxLines={1}>
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
  fleet,
  trafficSummary,
  recentEvents,
  serverEventCount = 0,
  isAdmin = true,
}: {
  userName: string;
  stats: StatCard[];
  /** Null for a non-admin, who is not shown the fleet card at all. */
  fleet: FleetStatus | null;
  trafficSummary: TrafficSummary;
  recentEvents: RecentEvent[];
  /** Audit rows in the last 24 hours, for the Server log tile. */
  serverEventCount?: number;
  isAdmin?: boolean;
}) {
  const t = useTranslations("overview");
  const emptyValue = useEmptyValue();
  const chartTheme = useChartTheme();

  const [interval, setIntervalValue] = useState<Interval>("24h");
  const [metricKey, setMetricKey] = useState<MetricKey>("requests");
  const [payload, setPayload] = useState<OverviewPayload | null>(null);
  const [isLoading, setIsLoading] = useState(isAdmin);
  const [hasFailed, setHasFailed] = useState(false);

  const metric = METRICS.find((m) => m.key === metricKey) ?? METRICS[0];

  // next-intl types t() against the catalog, so the key has to be a literal here
  // rather than carried on the metric definition.
  const metricLabel = (key: MetricKey): string => {
    switch (key) {
      case "requests":
        return t("metricRequests");
      case "serverLog":
        return t("metricServerLog");
      case "serverErrors":
        return t("metricServerErrors");
      case "clientErrors":
        return t("metricClientErrors");
      case "bandwidth":
        return t("metricBandwidth");
      case "blocked":
        return t("metricBlocked");
    }
  };

  useEffect(() => {
    if (!isAdmin) return;
    const abort = new AbortController();
    setIsLoading(true);
    const params = new URLSearchParams({ interval, filter: metric.filter, limit: "40" });
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
  }, [isAdmin, interval, metric.filter]);

  const rangeSeconds = RANGE_SECONDS[interval];
  const timeline = payload?.timeline ?? [];

  // Resolved outside the memo: metricLabel is rebuilt every render, so depending on it
  // would make the memo recompute every time anyway.
  const seriesName = metric.series ? metricLabel(metric.key) : t("metricRequests");
  const chartSeries = useMemo(() => {
    const field = metric.series ?? "total";
    return [{ name: seriesName, data: timeline.map((b) => b[field]) }];
  }, [metric.series, timeline, seriesName]);

  const chartOptions: ApexOptions = useMemo(
    () => ({
      ...chartTheme.base,
      chart: { ...chartTheme.base.chart, type: "area", stacked: false, id: "overview" },
      colors: [
        metric.key === "serverErrors" || metric.key === "blocked"
          ? chartTheme.series.red
          : metric.key === "clientErrors"
            ? chartTheme.series.orange
            : chartTheme.series.blue,
      ],
      fill: {
        type: "gradient",
        gradient: { shadeIntensity: 1, opacityFrom: 0.45, opacityTo: 0.05 },
      },
      stroke: { curve: "smooth", width: 2 },
      dataLabels: { enabled: false },
      xaxis: {
        categories: timeline.map((b) => formatBucket(b.ts, rangeSeconds)),
        labels: { rotate: 0, style: { colors: chartTheme.labelColor, fontSize: "11px" } },
        axisBorder: { show: false },
        axisTicks: { show: false },
      },
      yaxis: {
        labels: {
          style: { colors: chartTheme.labelColor },
          formatter: (value: number) =>
            metric.format === "bytes" ? formatBytes(value) : Math.round(value).toLocaleString(),
        },
      },
      legend: { show: false },
      tooltip: { theme: chartTheme.mode, shared: true, intersect: false },
    }),
    [chartTheme, metric, timeline, rangeSeconds],
  );

  const eventColumns: TableColumn<TrafficEvent & { id: string }>[] = useMemo(
    () => [
      {
        key: "ts",
        header: t("logTime"),
        width: pixel(96),
        renderCell: (row) => (
          <Text type="code" size="sm" color="secondary">
            {new Date(row.ts * 1000).toLocaleTimeString()}
          </Text>
        ),
      },
      {
        key: "status",
        header: t("logStatus"),
        width: pixel(76),
        renderCell: (row) => (
          <HStack gap={1} vAlign="center">
            <Badge
              variant={row.status >= 500 ? "error" : row.status >= 400 ? "warning" : "success"}
              label={String(row.status)}
            />
            {row.isBlocked && <StatusDot variant="error" label={t("logBlocked")} />}
          </HStack>
        ),
      },
      {
        key: "method",
        header: t("logMethod"),
        width: pixel(64),
        renderCell: (row) => (
          <Text type="code" size="sm" color="secondary">
            {row.method}
          </Text>
        ),
      },
      {
        key: "request",
        header: t("logRequest"),
        width: proportional(1),
        renderCell: (row) => (
          <VStack gap={0}>
            <Text type="code" size="sm" maxLines={1}>
              {row.host}
              {row.uri}
            </Text>
            {/* The rest of what traffic_events stores. On one line because the pane
                shares its row with the server-event log and cannot carry nine columns. */}
            <Text type="body" size="xsm" color="secondary" maxLines={1}>
              {formatBytes(row.bytesSent)} &middot; {row.proto || emptyValue} &middot;{" "}
              {row.countryCode ?? emptyValue} &middot; {row.clientIp}
            </Text>
          </VStack>
        ),
      },
    ],
    [t, emptyValue],
  );

  const eventRows = useMemo(
    () =>
      (payload?.events ?? []).map((event, index) => ({
        ...event,
        id: `${event.ts}-${index}`,
      })),
    [payload],
  );

  const tileValue = (key: MetricKey): string => {
    if (key === "serverLog") return serverEventCount.toLocaleString();
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
          <Text type="body" size="sm" color="secondary">
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
          <Text type="body" size="sm" color="secondary">
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
            label={`${stat.label}: ${stat.count}`}
            href={stat.href}
            padding={4}
          >
            <HStack gap={3} vAlign="center">
              <Icon icon={STAT_ICONS[stat.icon]} />
              <VStack gap={0}>
                <Text type="display-3" hasTabularNumbers>
                  {String(stat.count)}
                </Text>
                <Text type="body" size="xsm" color="secondary">
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
            onSelect={() => setMetricKey(m.key)}
          />
        ))}
      </Grid>

      <Card padding={5}>
        <VStack gap={3}>
          <HStack justify="between" vAlign="center" gap={2}>
            <HStack gap={2} vAlign="center">
              <Icon
                icon={metric.key === "bandwidth" ? Gauge : BarChart2}
                size="sm"
                color="accent"
              />
              <Heading level={2} accessibilityLevel={2}>
                {metric.series ? metricLabel(metric.key) : t("metricRequests")}
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
            <div style={{ overflowX: "auto", width: "100%" }}>
              <ReactApexChart
                type="area"
                series={chartSeries}
                options={chartOptions}
                height={220}
              />
            </div>
          )}
        </VStack>
      </Card>

      {/* Two logs side by side: proxied traffic, and what changed on this controller. */}
      <Grid columns={{ minWidth: 280, max: 3 }} gap={3}>
        <Card padding={5}>
          <VStack gap={3}>
            <HStack justify="between" vAlign="center" gap={2}>
              <Heading level={2} accessibilityLevel={2}>
                {t("requestLog")}
              </Heading>
              <Badge variant="neutral" label={metricLabel(metric.key)} />
            </HStack>
            {eventRows.length === 0 ? (
              <EmptyState title={t("requestLogEmptyTitle")} isCompact />
            ) : (
              <div style={{ overflowX: "auto", width: "100%" }}>
                <Table data={eventRows} columns={eventColumns} idKey="id" />
              </div>
            )}
            <Text type="body" size="xsm" color="secondary">
              {t("requestLogSource")}
            </Text>
          </VStack>
        </Card>

        {/* Between the two logs: what is configured, and what is answering. Neither log
            says whether an agent has gone quiet, and a silent agent is the reason a
            request pane can be empty while nothing is actually wrong with the hosts. */}
        <Card padding={5}>
          <VStack gap={3}>
            <HStack gap={2} vAlign="center">
              <Icon icon={Server} size="sm" color="accent" />
              <Heading level={2} accessibilityLevel={2}>
                {t("fleetStatus")}
              </Heading>
            </HStack>

            <VStack gap={2}>
              <HStack justify="between" vAlign="center" gap={2}>
                <Text type="body" size="sm" color="secondary">
                  {t("fleetProxyHosts")}
                </Text>
                <Text type="body" size="sm" hasTabularNumbers>
                  {t("fleetEnabledOf", {
                    enabled: fleet?.proxyHosts.enabled ?? 0,
                    total: fleet?.proxyHosts.total ?? 0,
                  })}
                </Text>
              </HStack>
              <HStack justify="between" vAlign="center" gap={2}>
                <Text type="body" size="sm" color="secondary">
                  {t("fleetL4Hosts")}
                </Text>
                <Text type="body" size="sm" hasTabularNumbers>
                  {t("fleetEnabledOf", {
                    enabled: fleet?.l4Hosts.enabled ?? 0,
                    total: fleet?.l4Hosts.total ?? 0,
                  })}
                </Text>
              </HStack>
            </VStack>

            {fleet && fleet.agents.length === 0 ? (
              <EmptyState title={t("fleetNoAgents")} isCompact />
            ) : (
              <List hasDividers>
                {(fleet?.agents ?? []).map((agent) => (
                  <ListItem
                    key={agent.id}
                    startContent={
                      <StatusDot
                        variant={
                          agent.isPaused ? "neutral" : agent.isConnected ? "success" : "error"
                        }
                        label={
                          agent.isPaused
                            ? t("fleetAgentPaused")
                            : agent.isConnected
                              ? t("fleetAgentConnected")
                              : t("fleetAgentOffline")
                        }
                      />
                    }
                    label={agent.name}
                    // A paused or offline agent has never reported, so there is no mode or
                    // version to show for one - say why it is quiet instead.
                    description={
                      agent.isPaused
                        ? t("fleetAgentPaused")
                        : agent.isConnected
                          ? [agent.mode, agent.version].filter(Boolean).join(" · ")
                          : t("fleetAgentOffline")
                    }
                  />
                ))}
              </List>
            )}
          </VStack>
        </Card>

        <Card padding={5}>
          <VStack gap={3}>
            <HStack justify="between" vAlign="center" gap={2}>
              <HStack gap={2} vAlign="center">
                <Icon icon={History} size="sm" color="accent" />
                <Heading level={2} accessibilityLevel={2}>
                  {t("serverEvents")}
                </Heading>
              </HStack>
              {metricKey === "serverLog" && <Badge variant="info" label={t("metricServerLog")} />}
            </HStack>
            {recentEvents.length === 0 ? (
              <EmptyState title={t("activityEmptyMessage")} isCompact />
            ) : (
              <List hasDividers>
                {recentEvents.map((event) => {
                  const status = getEventStatus(event.action);
                  return (
                    <ListItem
                      key={event.id}
                      startContent={<StatusDot variant={status.variant} label={status.label} />}
                      label={event.summary}
                      description={`${event.actor ?? t("actorSystem")} · ${event.entityType}`}
                      endContent={
                        <Text type="body" size="xsm" color="secondary" hasTabularNumbers>
                          {formatRelativeTime(event.createdAt)}
                        </Text>
                      }
                    />
                  );
                })}
              </List>
            )}
            <Text type="body" size="xsm" color="secondary">
              {t("serverEventsSource")}
            </Text>
          </VStack>
        </Card>
      </Grid>

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
