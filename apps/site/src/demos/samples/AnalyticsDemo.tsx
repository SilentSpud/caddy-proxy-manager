import { useMemo, useState } from "react";
import ReactApexChart from "react-apexcharts";
import { Badge } from "@astryxdesign/core/Badge";
import { Card } from "@astryxdesign/core/Card";
import { Grid } from "@astryxdesign/core/Grid";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Text } from "@astryxdesign/core/Text";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { useChartTheme } from "@cpm/controller/src/app/(dashboard)/analytics/chart-theme";
import { DemoSurface } from "../DemoSurface";

type Range = "24h" | "7d" | "30d";

/**
 * A week of traffic against a small deployment, shaped the way real traffic is: a working-hours
 * curve with a quiet night, and a scanner that shows up as a flat trickle of blocked requests.
 */
const SERIES: Record<Range, { labels: string[]; ok: number[]; blocked: number[] }> = {
  "24h": {
    labels: ["00", "03", "06", "09", "12", "15", "18", "21"],
    ok: [180, 120, 340, 1420, 1680, 1510, 990, 420],
    blocked: [4, 2, 11, 18, 9, 7, 26, 12],
  },
  "7d": {
    labels: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    ok: [8600, 9100, 8800, 9400, 7900, 2600, 2100],
    blocked: [61, 74, 58, 92, 66, 21, 18],
  },
  "30d": {
    labels: ["W1", "W2", "W3", "W4"],
    ok: [48200, 51900, 47400, 53100],
    blocked: [380, 412, 355, 447],
  },
};

const PROTOCOLS = [
  { label: "HTTP/2", value: 62 },
  { label: "HTTP/3", value: 29 },
  { label: "HTTP/1.1", value: 9 },
];

const COUNTRIES = [
  { code: "GB", name: "United Kingdom", requests: 21400 },
  { code: "DE", name: "Germany", requests: 12800 },
  { code: "US", name: "United States", requests: 9600 },
  { code: "NL", name: "Netherlands", requests: 4100 },
  { code: "SG", name: "Singapore", requests: 1900 },
];

const USER_AGENTS = [
  { name: "Chrome 141", requests: 18200 },
  { name: "Safari 19", requests: 9700 },
  { name: "Firefox 146", requests: 5100 },
  { name: "curl/8.9", requests: 2400 },
  { name: "Unknown scanner", requests: 890 },
];

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <VStack gap={3}>
        <Text type="label" size="xsm" weight="semibold" color="secondary">
          {title}
        </Text>
        {children}
      </VStack>
    </Card>
  );
}

/** A labelled bar, for the breakdowns the app draws as a map or a donut. */
function Bar({
  label,
  value,
  max,
  badge,
}: {
  label: string;
  value: number;
  max: number;
  badge?: string;
}) {
  return (
    <VStack gap={1}>
      <HStack justify="between" vAlign="center" gap={2}>
        <HStack gap={2} vAlign="center">
          {badge && <Badge label={badge} />}
          <Text type="body" size="sm">
            {label}
          </Text>
        </HStack>
        <Text type="code" size="xsm" color="secondary">
          {value.toLocaleString("en-GB")}
        </Text>
      </HStack>
      <div
        style={{
          height: 6,
          borderRadius: "var(--radius-full)",
          background: "var(--color-background-muted)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${Math.round((value / max) * 100)}%`,
            background: "var(--color-data-categorical-blue)",
          }}
        />
      </div>
    </VStack>
  );
}

export default function AnalyticsDemo() {
  const [range, setRange] = useState<Range>("7d");
  const theme = useChartTheme();
  const data = SERIES[range];

  const options = useMemo(
    () => ({
      ...theme.base,
      chart: { ...theme.base.chart, type: "area" as const, stacked: false },
      colors: [theme.series.blue, theme.series.red],
      dataLabels: { enabled: false },
      stroke: { curve: "smooth" as const, width: 2 },
      fill: { type: "gradient", gradient: { opacityFrom: 0.35, opacityTo: 0.02 } },
      xaxis: { categories: data.labels, labels: { style: { colors: theme.labelColor } } },
      yaxis: { labels: { style: { colors: theme.labelColor } } },
      legend: { labels: { colors: theme.labelColor } },
    }),
    [theme, data.labels],
  );

  const maxCountry = Math.max(...COUNTRIES.map((c) => c.requests));
  const maxAgent = Math.max(...USER_AGENTS.map((a) => a.requests));

  return (
    <DemoSurface>
      <VStack gap={4}>
        <SegmentedControl
          label="Time range"
          value={range}
          onChange={(next) => setRange(next as Range)}
        >
          <SegmentedControlItem value="24h" label="24 hours" />
          <SegmentedControlItem value="7d" label="7 days" />
          <SegmentedControlItem value="30d" label="30 days" />
        </SegmentedControl>

        <Panel title="Requests">
          <ReactApexChart
            type="area"
            height={220}
            options={options}
            series={[
              { name: "Served", data: data.ok },
              { name: "Blocked", data: data.blocked },
            ]}
          />
        </Panel>

        <Grid columns={{ minWidth: 240, max: 2 }} gap={3}>
          <Panel title="Protocols">
            <VStack gap={3}>
              {PROTOCOLS.map((protocol) => (
                <Bar key={protocol.label} label={protocol.label} value={protocol.value} max={100} />
              ))}
            </VStack>
          </Panel>

          <Panel title="Top countries">
            <VStack gap={3}>
              {COUNTRIES.map((country) => (
                <Bar
                  key={country.code}
                  badge={country.code}
                  label={country.name}
                  value={country.requests}
                  max={maxCountry}
                />
              ))}
            </VStack>
          </Panel>
        </Grid>

        <Panel title="Top user agents">
          <VStack gap={3}>
            {USER_AGENTS.map((agent) => (
              <Bar key={agent.name} label={agent.name} value={agent.requests} max={maxAgent} />
            ))}
          </VStack>
        </Panel>
      </VStack>
    </DemoSurface>
  );
}
