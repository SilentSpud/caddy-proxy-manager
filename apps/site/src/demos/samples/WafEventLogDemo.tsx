import { useMemo, useState } from "react";
import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Divider } from "@astryxdesign/core/Divider";
import { Text } from "@astryxdesign/core/Text";
import { Grid } from "@astryxdesign/core/Grid";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { DataTable, type Column } from "@cpm/controller/src/components/ui/DataTable";
import { SearchField } from "@cpm/controller/src/components/ui/SearchField";
import { formatDateTimeUtc } from "@cpm/controller/src/lib/date-format";
import { DemoSurface } from "../DemoSurface";

type Event = {
  id: number;
  ts: number;
  blocked: boolean;
  severity: "CRITICAL" | "WARNING" | "NOTICE";
  host: string;
  clientIp: string;
  countryCode: string;
  method: string;
  uri: string;
  ruleId: number;
  ruleMessage: string;
  matchedData: string;
};

const SEVERITY_VARIANTS = {
  CRITICAL: "error",
  WARNING: "warning",
  NOTICE: "info",
} as const;

/**
 * A morning's traffic against one small deployment: two real attacks blocked, one scanner walking
 * the tree, and one false positive from an application posting HTML in a form — which is the event
 * the suppression flow in the prose exists for.
 */
const EVENTS: Event[] = [
  {
    id: 1,
    ts: Date.UTC(2026, 1, 11, 9, 42, 7) / 1000,
    blocked: true,
    severity: "CRITICAL",
    host: "app.example.com",
    clientIp: "45.147.230.14",
    countryCode: "NL",
    method: "POST",
    uri: "/login",
    ruleId: 942100,
    ruleMessage: "SQL Injection Attack Detected via libinjection",
    matchedData: "username=' OR 1=1 -- ",
  },
  {
    id: 2,
    ts: Date.UTC(2026, 1, 11, 9, 38, 51) / 1000,
    blocked: true,
    severity: "CRITICAL",
    host: "app.example.com",
    clientIp: "45.147.230.14",
    countryCode: "NL",
    method: "GET",
    uri: "/search?q=%3Cscript%3E",
    ruleId: 941100,
    ruleMessage: "XSS Attack Detected via libinjection",
    matchedData: "q=<script>alert(1)</script>",
  },
  {
    id: 3,
    ts: Date.UTC(2026, 1, 11, 8, 12, 3) / 1000,
    blocked: true,
    severity: "WARNING",
    host: "grafana.example.com",
    clientIp: "185.220.101.77",
    countryCode: "DE",
    method: "GET",
    uri: "/.env",
    ruleId: 930120,
    ruleMessage: "OS File Access Attempt",
    matchedData: "REQUEST_FILENAME: /.env",
  },
  {
    id: 4,
    ts: Date.UTC(2026, 1, 11, 8, 11, 58) / 1000,
    blocked: true,
    severity: "WARNING",
    host: "grafana.example.com",
    clientIp: "185.220.101.77",
    countryCode: "DE",
    method: "GET",
    uri: "/wp-admin/setup-config.php",
    ruleId: 930130,
    ruleMessage: "Restricted File Access Attempt",
    matchedData: "REQUEST_FILENAME: /wp-admin/setup-config.php",
  },
  {
    id: 5,
    ts: Date.UTC(2026, 1, 11, 7, 55, 20) / 1000,
    blocked: false,
    severity: "NOTICE",
    host: "wiki.example.com",
    clientIp: "10.0.4.18",
    countryCode: "—",
    method: "POST",
    uri: "/api/pages/42",
    ruleId: 941160,
    ruleMessage: "NoScript XSS InjectionChecker: HTML Injection",
    matchedData: "body: <p>Release notes for <b>3.0</b></p>",
  },
  {
    id: 6,
    ts: Date.UTC(2026, 1, 11, 6, 30, 44) / 1000,
    blocked: true,
    severity: "CRITICAL",
    host: "app.example.com",
    clientIp: "103.152.220.9",
    countryCode: "SG",
    method: "POST",
    uri: "/api/import",
    ruleId: 932130,
    ruleMessage: "Remote Command Execution: Unix Shell Expression Found",
    matchedData: "file=$(cat /etc/passwd)",
  },
  {
    id: 7,
    ts: Date.UTC(2026, 1, 11, 5, 3, 12) / 1000,
    blocked: false,
    severity: "NOTICE",
    host: "wiki.example.com",
    clientIp: "10.0.4.18",
    countryCode: "—",
    method: "POST",
    uri: "/api/pages/17",
    ruleId: 941160,
    ruleMessage: "NoScript XSS InjectionChecker: HTML Injection",
    matchedData: "body: <ul><li>Fixed the importer</li></ul>",
  },
];

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <VStack gap={1}>
        <Text type="label" size="3xs" weight="bold" color="secondary">
          {label}
        </Text>
        <Text type="body" size="lg" weight="semibold">
          {value}
        </Text>
      </VStack>
    </Card>
  );
}

/** The row detail the app opens for an event: what fired, on what, and the two ways out. */
function Detail({ event }: { event: Event }) {
  return (
    <VStack gap={3}>
      <VStack gap={0}>
        <Text type="label" size="3xs" weight="bold" color="secondary">
          Rule message
        </Text>
        <Text type="body" size="sm">
          {event.ruleMessage}
        </Text>
      </VStack>

      <VStack gap={0}>
        <Text type="label" size="3xs" weight="bold" color="secondary">
          Matched data
        </Text>
        <Text type="code" size="xsm">
          {event.matchedData}
        </Text>
      </VStack>

      <Divider />

      <HStack gap={2} wrap="wrap">
        <Button variant="secondary" size="sm" label={`Suppress ${event.ruleId} everywhere`} />
        <Button variant="secondary" size="sm" label={`Suppress on ${event.host}`} />
      </HStack>
    </VStack>
  );
}

export default function WafEventLogDemo() {
  const [search, setSearch] = useState("");

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return EVENTS;
    return EVENTS.filter((event) =>
      `${event.host} ${event.clientIp} ${event.uri} ${event.ruleId} ${event.ruleMessage}`
        .toLowerCase()
        .includes(needle),
    );
  }, [search]);

  const columns: Column<Event>[] = [
    {
      id: "ts",
      label: "Time (UTC)",
      width: 150,
      render: (r) => (
        <Text type="code" size="xsm" color="secondary">
          {formatDateTimeUtc(r.ts * 1000)}
        </Text>
      ),
    },
    {
      id: "blocked",
      label: "Action",
      width: 110,
      render: (r) =>
        r.blocked ? (
          <Badge variant="error" label="Blocked" />
        ) : (
          <Badge variant="warning" label="Detected" />
        ),
    },
    {
      id: "severity",
      label: "Severity",
      width: 100,
      render: (r) => <Badge variant={SEVERITY_VARIANTS[r.severity]} label={r.severity} />,
    },
    {
      id: "host",
      label: "Host",
      width: 150,
      render: (r) => (
        <Text type="code" size="xsm" maxLines={1}>
          {r.host}
        </Text>
      ),
    },
    {
      id: "clientIp",
      label: "Client IP",
      width: 150,
      render: (r) => (
        <HStack gap={1} vAlign="center">
          <Text type="code" size="xsm">
            {r.clientIp}
          </Text>
          {r.countryCode !== "—" && <Badge label={r.countryCode} />}
        </HStack>
      ),
    },
    {
      id: "method",
      label: "Request",
      width: 220,
      render: (r) => (
        <HStack gap={2} vAlign="center">
          <Text type="code" size="xsm" weight="bold" color="accent">
            {r.method}
          </Text>
          <Text type="code" size="xsm" color="secondary" maxLines={1}>
            {r.uri}
          </Text>
        </HStack>
      ),
    },
    {
      id: "ruleId",
      label: "Rule ID",
      width: 80,
      render: (r) => (
        <Text type="code" size="xsm" color="secondary">
          {r.ruleId}
        </Text>
      ),
    },
  ];

  return (
    <DemoSurface>
      <VStack gap={4}>
        <Grid columns={{ minWidth: 130, max: 4 }} gap={3}>
          <Stat label="Events" value={String(EVENTS.length)} />
          <Stat label="Blocked" value={String(EVENTS.filter((e) => e.blocked).length)} />
          <Stat
            label="Critical"
            value={String(EVENTS.filter((e) => e.severity === "CRITICAL").length)}
          />
          <Stat label="Hosts" value={String(new Set(EVENTS.map((e) => e.host)).size)} />
        </Grid>

        <SearchField
          value={search}
          onChange={setSearch}
          width="100%"
          placeholder="Search events by host, IP, path or rule..."
        />

        <DataTable
          columns={columns}
          data={rows}
          keyField="id"
          emptyMessage="No events match that search"
          expandedRow={(row) => <Detail event={row} />}
        />
      </VStack>
    </DemoSurface>
  );
}
