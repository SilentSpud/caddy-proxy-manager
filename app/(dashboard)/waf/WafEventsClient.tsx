"use client";

import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useActionState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { ShieldOff, Trash2, Copy } from "lucide-react";

import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { CheckboxInput } from "@astryxdesign/core/CheckboxInput";
import { CodeBlock } from "@astryxdesign/core/CodeBlock";
import { Collapsible } from "@astryxdesign/core/Collapsible";
import { DateTimeInput, type ISODateTimeString } from "@astryxdesign/core/DateTimeInput";
import { Divider } from "@astryxdesign/core/Divider";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Grid } from "@astryxdesign/core/Grid";
import { Heading } from "@astryxdesign/core/Heading";
import { IconButton } from "@astryxdesign/core/IconButton";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Switch } from "@astryxdesign/core/Switch";
import { TabList, Tab } from "@astryxdesign/core/TabList";
import { Text } from "@astryxdesign/core/Text";
import { TextArea } from "@astryxdesign/core/TextArea";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Tooltip } from "@astryxdesign/core/Tooltip";
import { HStack, VStack } from "@astryxdesign/core/Stack";

import { AppDialog } from "@/components/ui/AppDialog";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { SearchField } from "@/components/ui/SearchField";
import { nativeAttrs } from "@/components/ui/native-input-attrs";
import type { WafEvent, WafEventStats } from "@/lib/models/waf-events";
import type { WafSettings } from "@/lib/settings";
import { withRowIds } from "@/lib/row-id";
import {
  suppressWafRuleGloballyAction,
  suppressWafRuleForHostAction,
  removeWafRuleGloballyAction,
  lookupWafRuleMessageAction,
  updateWafSettingsAction,
} from "../settings/actions";

type Props = {
  events: WafEvent[];
  stats: WafEventStats;
  pagination: { total: number; page: number; perPage: number };
  initialSearch: string;
  initialRange: "all" | "24h" | "7d" | "30d" | "custom";
  initialFrom: number | null;
  initialTo: number | null;
  globalExcluded: number[];
  globalExcludedMessages: Record<number, string | null>;
  globalWafEnabled: boolean;
  hostWafMap: Record<string, number[]>;
  globalWaf: WafSettings | null;
};

type RangeOption = Props["initialRange"];

function formatDateTimeLocal(unixTs: number | null): string {
  if (!unixTs) return "";
  const d = new Date(unixTs * 1000);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}

function parseDateTimeLocal(value: string): number | null {
  if (!value) return null;
  const ts = Math.floor(new Date(value).getTime() / 1000);
  return Number.isFinite(ts) ? ts : null;
}

/* ── Audit data types ─────────────────────────────────────────────────────── */
interface AuditRequest {
  method?: string;
  protocol?: string;
  uri?: string;
  headers?: Record<string, string | string[]>;
  body?: string;
  args?: Record<string, string | string[]>;
  length?: number;
}
interface AuditResponse {
  protocol?: string;
  status?: number;
  headers?: Record<string, string | string[]>;
  body?: string;
}
interface AuditTransaction {
  timestamp?: string;
  id?: string;
  client_ip?: string;
  client_port?: number;
  host_port?: number;
  server_id?: string;
  request?: AuditRequest;
  response?: AuditResponse;
}
interface AuditMessageDetails {
  match?: string;
  reference?: string;
  ruleId?: number;
  file?: string;
  lineNumber?: string;
  tags?: string[];
  logdata?: string;
  severity?: string;
  msg?: string;
}
interface AuditMessage {
  message?: string;
  details?: AuditMessageDetails;
  error_message?: string;
}
interface AuditData {
  transaction?: AuditTransaction;
  messages?: AuditMessage[];
}

function extractBracketField(message: string, field: string): string | null {
  const match = message.match(new RegExp(`\\[${field} "([^"]*)"\\]`));
  return match ? match[1] : null;
}

function extractBracketFields(message: string, field: string): string[] {
  return [...message.matchAll(new RegExp(`\\[${field} "([^"]*)"\\]`, "g"))].map(
    (match) => match[1],
  );
}

function normalizeAuditMessage(message: AuditMessage): AuditMessage {
  if (message.details || !message.error_message) return message;

  const ruleId = extractBracketField(message.error_message, "id");
  const msg = extractBracketField(message.error_message, "msg");
  const severity = extractBracketField(message.error_message, "severity");
  const logdata = extractBracketField(message.error_message, "data");
  const file = extractBracketField(message.error_message, "file");
  const lineNumber = extractBracketField(message.error_message, "line");
  const tags = extractBracketFields(message.error_message, "tag");

  return {
    ...message,
    message: message.message || msg || message.error_message,
    details: {
      ruleId: ruleId ? Number.parseInt(ruleId, 10) : undefined,
      severity: severity ?? undefined,
      msg: msg ?? undefined,
      match: logdata ?? undefined,
      logdata: logdata ?? undefined,
      file: file ?? undefined,
      lineNumber: lineNumber ?? undefined,
      tags: tags.length > 0 ? tags : undefined,
    },
  };
}

/* ── Severity config ──────────────────────────────────────────────────────── */
/** Maps a Coraza severity onto the theme's badge variants. */
const SEVERITY_VARIANTS: Record<string, "error" | "warning" | "info"> = {
  CRITICAL: "error",
  ERROR: "error",
  HIGH: "error",
  WARNING: "warning",
  NOTICE: "info",
  INFO: "info",
};

/* ── Chips ───────────────────────────────────────────────────────────────── */
function SeverityChip({ severity }: { severity: string | null }) {
  if (!severity) {
    return (
      <Text type="body" size="xsm" color="secondary">
        &mdash;
      </Text>
    );
  }
  const upper = severity.toUpperCase();
  return <Badge variant={SEVERITY_VARIANTS[upper] ?? "neutral"} label={upper} />;
}

function BlockedChip({ blocked }: { blocked: boolean }) {
  return blocked ? (
    <Badge variant="error" label="Blocked" />
  ) : (
    <Badge variant="warning" label="Detected" />
  );
}

/* ── Detail field row ─────────────────────────────────────────────────────── */
function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <VStack gap={0}>
      <Text type="label" size="3xs" weight="bold" color="secondary">
        {label}
      </Text>
      {children}
    </VStack>
  );
}

/* ── Stats bar ────────────────────────────────────────────────────────────── */
function StatsBar({ stats }: { stats: WafEventStats }) {
  const items = [
    { label: "Total Events", value: stats.total, color: "primary" as const },
    { label: "Blocked", value: stats.blocked, color: "accent" as const },
    { label: "Critical", value: stats.critical, color: "accent" as const },
    { label: "Unique Hosts", value: stats.uniqueHosts, color: "accent" as const },
    { label: "Rule IDs Triggered", value: stats.ruleIdsTriggered, color: "accent" as const },
  ];

  return (
    <Grid columns={{ minWidth: 140, max: 5 }} gap={3}>
      {items.map(({ label, value, color }) => (
        <Card key={label} padding={3}>
          <VStack gap={0}>
            <Text type="display-3" color={color} hasTabularNumbers>
              {value}
            </Text>
            <Text type="body" size="xsm" weight="medium" color="secondary">
              {label}
            </Text>
          </VStack>
        </Card>
      ))}
    </Grid>
  );
}

/* ── Audit panel ─────────────────────────────────────────────────────────── */
function HeadersGrid({ headers }: { headers?: Record<string, string | string[]> }) {
  if (!headers || Object.keys(headers).length === 0) {
    return (
      <Text type="body" size="xsm" color="secondary">
        &mdash;
      </Text>
    );
  }
  return (
    <MetadataList>
      {Object.entries(headers).map(([k, v]) => (
        <MetadataListItem key={k} label={k}>
          <Text type="code" size="xsm">
            {Array.isArray(v) ? v.join(", ") : v}
          </Text>
        </MetadataListItem>
      ))}
    </MetadataList>
  );
}

/** Pretty-prints a body when it parses as JSON, otherwise shows it verbatim. */
function bodyCode(body: string) {
  try {
    return { code: JSON.stringify(JSON.parse(body), null, 2), language: "json" };
  } catch {
    return { code: body, language: "plaintext" };
  }
}

function MatchTags({ tags }: { tags: string[] }) {
  return (
    <HStack gap={1} wrap="wrap">
      {tags.map((t) => (
        <Badge key={t} label={t} />
      ))}
    </HStack>
  );
}

function AuditPanel({ rawData }: { rawData: string | null }) {
  const [innerTab, setInnerTab] = useState("overview");

  // Parsed once per event instead of on every render. The matched rules get
  // their row ids here, so switching the inner tab re-keys nothing.
  const { data, msgs } = useMemo(() => {
    let parsed: AuditData | null = null;
    if (rawData) {
      try {
        parsed = JSON.parse(rawData) as AuditData;
      } catch {
        /* leave null */
      }
    }
    return {
      data: parsed,
      msgs: withRowIds((parsed?.messages ?? []).map(normalizeAuditMessage)),
    };
  }, [rawData]);

  if (!data) {
    return <EmptyState title="No audit data available for this event." isCompact />;
  }

  const tx = data.transaction ?? null;
  const req = tx?.request ?? null;
  const res = tx?.response ?? null;

  return (
    <VStack gap={3}>
      <TabList value={innerTab} onChange={setInnerTab} size="sm">
        <Tab value="overview" label="Overview" />
        <Tab value="request" label="Request" />
        <Tab value="response" label="Response" />
        {msgs.length > 0 && <Tab value="matches" label={`Matches (${msgs.length})`} />}
      </TabList>

      <Card variant="muted" padding={4}>
        <VStack gap={3}>
          {innerTab === "overview" && tx && (
            <>
              <MetadataList columns="multi">
                <MetadataListItem label="Transaction ID">
                  <Text type="code" size="xsm">
                    {tx.id ?? "—"}
                  </Text>
                </MetadataListItem>
                <MetadataListItem label="Timestamp">
                  <Text type="body" size="sm">
                    {tx.timestamp ?? "—"}
                  </Text>
                </MetadataListItem>
                <MetadataListItem label="Client">
                  <Text type="code" size="xsm">
                    {tx.client_ip ?? "—"}:{tx.client_port ?? 0}
                  </Text>
                </MetadataListItem>
                <MetadataListItem label="Server">
                  <Text type="code" size="xsm">
                    {tx.server_id ?? "—"}:{tx.host_port ?? 0}
                  </Text>
                </MetadataListItem>
              </MetadataList>
              {msgs.length > 0 && (
                <>
                  <Divider />
                  <VStack gap={2}>
                    <Text type="label" size="3xs" weight="bold" color="secondary">
                      Matched Rules
                    </Text>
                    {msgs.map((m) => (
                      <Card key={m.rowId} variant="red" padding={3}>
                        <VStack gap={2}>
                          <HStack gap={2} vAlign="center">
                            <Text type="code" size="xsm" weight="semibold">
                              Rule {m.details?.ruleId ?? "—"}
                            </Text>
                            <SeverityChip severity={m.details?.severity ?? null} />
                          </HStack>
                          <Text type="body" size="xsm">
                            {m.message}
                          </Text>
                          {m.details?.match && (
                            <Text type="code" size="xsm" color="secondary">
                              &#8627; {m.details.match}
                            </Text>
                          )}
                          {(m.details?.tags?.length ?? 0) > 0 && (
                            <MatchTags tags={m.details!.tags!} />
                          )}
                        </VStack>
                      </Card>
                    ))}
                  </VStack>
                </>
              )}
            </>
          )}

          {innerTab === "request" && req && (
            <VStack gap={3}>
              <Card padding={2}>
                <HStack gap={2} vAlign="center" wrap="wrap" justify="between">
                  <HStack gap={2} vAlign="center">
                    <Text type="code" size="xsm" weight="semibold" color="accent">
                      {req.method}
                    </Text>
                    <Text type="code" size="xsm">
                      {req.uri}
                    </Text>
                  </HStack>
                  <Text type="code" size="xsm" color="secondary">
                    {req.protocol}
                  </Text>
                </HStack>
              </Card>
              <DetailRow label="Headers">
                <HeadersGrid headers={req.headers} />
              </DetailRow>
              {req.args && Object.keys(req.args).length > 0 && (
                <DetailRow label="Query Args">
                  <HeadersGrid headers={req.args as Record<string, string>} />
                </DetailRow>
              )}
              {req.body && (
                <DetailRow label="Body">
                  <CodeBlock {...bodyCode(req.body)} width="100%" isCollapsible />
                </DetailRow>
              )}
              <DetailRow label="Content Length">
                <Text type="code" size="xsm">
                  {req.length ?? 0} bytes
                </Text>
              </DetailRow>
            </VStack>
          )}

          {innerTab === "response" && res && (
            <VStack gap={3}>
              <Card padding={2}>
                <HStack gap={2} vAlign="center">
                  <Badge
                    variant={
                      (res.status ?? 0) >= 400
                        ? "error"
                        : (res.status ?? 0) >= 300
                          ? "warning"
                          : "success"
                    }
                    label={String(res.status || "—")}
                  />
                  <Text type="code" size="xsm" color="secondary">
                    {res.protocol}
                  </Text>
                </HStack>
              </Card>
              <DetailRow label="Response Headers">
                <HeadersGrid headers={res.headers} />
              </DetailRow>
              {res.body && (
                <DetailRow label="Body">
                  <CodeBlock {...bodyCode(res.body)} width="100%" isCollapsible />
                </DetailRow>
              )}
            </VStack>
          )}

          {innerTab === "matches" && (
            <VStack gap={4}>
              {msgs.map((m) => (
                <VStack key={m.rowId} gap={2}>
                  <MetadataList columns="multi">
                    <MetadataListItem label="Rule ID">
                      <Text type="code" size="xsm" weight="semibold">
                        {m.details?.ruleId ?? "—"}
                      </Text>
                    </MetadataListItem>
                    <MetadataListItem label="Severity">
                      <SeverityChip severity={m.details?.severity ?? null} />
                    </MetadataListItem>
                    <MetadataListItem label="Message">
                      <Text type="body" size="xsm">
                        {m.message}
                      </Text>
                    </MetadataListItem>
                    <MetadataListItem label="Log Data">
                      <Text type="code" size="xsm">
                        {m.details?.logdata ?? "—"}
                      </Text>
                    </MetadataListItem>
                    <MetadataListItem label="File">
                      <Text type="code" size="xsm" color="secondary">
                        {m.details?.file ?? "—"}:{m.details?.lineNumber ?? ""}
                      </Text>
                    </MetadataListItem>
                    <MetadataListItem label="Reference">
                      <Text type="code" size="xsm" color="secondary">
                        {m.details?.reference ?? "—"}
                      </Text>
                    </MetadataListItem>
                  </MetadataList>
                  {(m.details?.tags?.length ?? 0) > 0 && (
                    <DetailRow label="Tags">
                      <MatchTags tags={m.details!.tags!} />
                    </DetailRow>
                  )}
                </VStack>
              ))}
            </VStack>
          )}
        </VStack>
      </Card>

      <Collapsible
        defaultIsOpen={false}
        trigger={
          <Text type="body" size="xsm">
            Raw JSON
          </Text>
        }
      >
        <CodeBlock
          code={JSON.stringify(data, null, 2)}
          language="json"
          width="100%"
          isCollapsible
        />
      </Collapsible>
    </VStack>
  );
}

/* ── Event detail panel ──────────────────────────────────────────────────── */
function EventDetailPanel({
  event,
  onClose,
  globalExcluded,
  hostWafMap,
  onSuppressGlobal,
  onSuppressHost,
}: {
  event: WafEvent;
  onClose: () => void;
  globalExcluded: number[];
  hostWafMap: Record<string, number[]>;
  onSuppressGlobal: (ruleId: number) => void;
  onSuppressHost: (ruleId: number, host: string) => void;
}) {
  const [pending, startTransition] = useTransition();

  const eventHostBare = event.host ? event.host.replace(/:\d+$/, "") : "";
  const isGloballySuppressed = event.ruleId != null && globalExcluded.includes(event.ruleId);
  const isHostOnlySuppressed =
    event.ruleId != null &&
    !!eventHostBare &&
    (hostWafMap[eventHostBare] ?? []).includes(event.ruleId);
  const isHostSuppressed = isGloballySuppressed || isHostOnlySuppressed;

  function handleSuppressGlobally() {
    if (!event.ruleId) return;
    startTransition(async () => {
      const result = await suppressWafRuleGloballyAction(event.ruleId!);
      if (result.success) {
        toast.success(result.message ?? "Done");
        onSuppressGlobal(event.ruleId!);
      } else toast.error(result.message ?? "Failed");
    });
  }

  function handleSuppressForHost() {
    if (!event.ruleId || !event.host) return;
    startTransition(async () => {
      const result = await suppressWafRuleForHostAction(event.ruleId!, event.host!);
      if (result.success) {
        toast.success(result.message ?? "Done");
        onSuppressHost(event.ruleId!, event.host!);
      } else toast.error(result.message ?? "Failed");
    });
  }

  return (
    // Was a hand-built fixed-position drawer with its own backdrop and Escape
    // handler; Dialog brings focus trapping and dismissal with it.
    <AppDialog
      open
      onClose={onClose}
      title="WAF Event"
      maxWidth="lg"
      actions={<Button variant="secondary" label="Close" onClick={onClose} />}
    >
      <VStack gap={4}>
        <HStack gap={2} vAlign="center">
          <BlockedChip blocked={event.blocked} />
          <SeverityChip severity={event.severity} />
        </HStack>

        <Card variant="muted" padding={4}>
          <MetadataList columns="multi">
            <MetadataListItem label="Time">
              {/* Rendered on the server in the container's timezone and again in
                  the browser's; the two never match, so this opts out of
                  hydration checks rather than discarding the tree. */}
              <Text type="body" size="sm">
                <span suppressHydrationWarning>{new Date(event.ts * 1000).toLocaleString()}</span>
              </Text>
            </MetadataListItem>
            <MetadataListItem label="Host">
              <Text type="code" size="sm">
                {event.host || "—"}
              </Text>
            </MetadataListItem>
            <MetadataListItem label="Client IP">
              <HStack gap={2} vAlign="center" wrap="wrap">
                <Text type="code" size="sm">
                  {event.clientIp}
                </Text>
                {event.countryCode && <Badge label={event.countryCode} />}
              </HStack>
            </MetadataListItem>
            <MetadataListItem label="Method">
              <Text type="code" size="sm" weight="semibold" color="accent">
                {event.method}
              </Text>
            </MetadataListItem>
            <MetadataListItem label="URI">
              <Text type="code" size="xsm" color="secondary">
                {event.uri || "—"}
              </Text>
            </MetadataListItem>
            <MetadataListItem label="Rule ID">
              <Text type="code" size="sm" weight="semibold">
                {event.ruleId ?? "—"}
              </Text>
            </MetadataListItem>
            <MetadataListItem label="Rule Message">
              <Text type="body" size="sm">
                {event.ruleMessage ?? "—"}
              </Text>
            </MetadataListItem>
          </MetadataList>
        </Card>

        {event.ruleId != null && (
          <HStack gap={2} wrap="wrap">
            <Button
              size="sm"
              variant="secondary"
              icon={<ShieldOff />}
              label={isGloballySuppressed ? "Suppressed Globally" : "Suppress Globally"}
              isDisabled={pending || isGloballySuppressed}
              onClick={handleSuppressGlobally}
            />
            {event.host && (
              <Button
                size="sm"
                variant="secondary"
                icon={<ShieldOff />}
                label={
                  isHostSuppressed ? `Suppressed for ${event.host}` : `Suppress for ${event.host}`
                }
                isDisabled={pending || isHostSuppressed}
                onClick={handleSuppressForHost}
              />
            )}
          </HStack>
        )}

        <Divider />

        <VStack gap={2}>
          <Text type="label" size="3xs" weight="bold" color="secondary">
            Audit Data
          </Text>
          <AuditPanel rawData={event.rawData} />
        </VStack>
      </VStack>
    </AppDialog>
  );
}

/* ── Global suppressed rules tab ─────────────────────────────────────────── */
function GlobalSuppressedRules({
  excluded,
  messages: initialMessages,
  wafEnabled,
  onRemove,
  onAdd,
}: {
  excluded: number[];
  messages: Record<number, string | null>;
  wafEnabled: boolean;
  onRemove: (ruleId: number) => void;
  onAdd: (ruleId: number, message: string | null) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [messages, setMessages] = useState(initialMessages);

  const [addInput, setAddInput] = useState("");
  const [lookupPending, setLookupPending] = useState(false);
  const [pendingRule, setPendingRule] = useState<{ id: number; message: string | null } | null>(
    null,
  );
  const [search, setSearch] = useState("");

  function handleRemove(ruleId: number) {
    startTransition(async () => {
      const result = await removeWafRuleGloballyAction(ruleId);
      if (result.success) {
        toast.success(result.message ?? "Done");
        onRemove(ruleId);
      } else toast.error(result.message ?? "Failed");
    });
  }

  async function handleLookup() {
    const n = parseInt(addInput.trim(), 10);
    if (!Number.isInteger(n) || n <= 0) return;
    if (excluded.includes(n)) {
      toast.error(`Rule ${n} is already suppressed.`);
      return;
    }
    setLookupPending(true);
    try {
      const result = await lookupWafRuleMessageAction(n);
      setPendingRule({ id: n, message: result.message });
    } finally {
      setLookupPending(false);
    }
  }

  function handleConfirmAdd() {
    if (!pendingRule) return;
    startTransition(async () => {
      const result = await suppressWafRuleGloballyAction(pendingRule.id);
      if (result.success) {
        toast.success(result.message ?? "Done");
        onAdd(pendingRule.id, pendingRule.message);
        setMessages((prev) => ({ ...prev, [pendingRule.id]: pendingRule.message }));
        setAddInput("");
        setPendingRule(null);
      } else {
        toast.error(result.message ?? "Failed");
      }
    });
  }

  const filtered = excluded.filter((id) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return String(id).includes(q) || (messages[id] ?? "").toLowerCase().includes(q);
  });

  const noDescription = "No description available — rule has not triggered yet";

  return (
    <VStack gap={4}>
      <VStack gap={2}>
        <Heading level={2}>Global WAF Rule Exclusions</Heading>
        <Text type="body" size="sm" color="secondary">
          Rules listed here are suppressed globally via SecRuleRemoveById for all proxy hosts using
          global WAF settings.
        </Text>
        {!wafEnabled && (
          <Banner
            status="warning"
            title="Global WAF is currently disabled"
            description="Exclusions are saved but have no effect until WAF is enabled."
          />
        )}
      </VStack>

      <VStack gap={2}>
        <HStack gap={2} vAlign="end" maxWidth={360}>
          <TextInput
            {...nativeAttrs({ pattern: "[0-9]*" })}
            label="Add Rule by ID"
            size="sm"
            value={addInput}
            onChange={(v) => {
              setAddInput(v);
              setPendingRule(null);
            }}
            onEnter={handleLookup}
            placeholder="Rule ID"
            isDisabled={lookupPending || pending}
            width="100%"
          />
          <Button
            variant="secondary"
            size="sm"
            label="Look up"
            isLoading={lookupPending}
            isDisabled={!addInput.trim() || lookupPending || pending}
            onClick={handleLookup}
          />
        </HStack>
        {pendingRule && (
          <Card variant="muted" padding={3} maxWidth={480}>
            <VStack gap={2}>
              <Text type="code" size="sm" weight="bold">
                Rule {pendingRule.id}
              </Text>
              <Text type="body" size="xsm" color="secondary">
                {pendingRule.message ?? noDescription}
              </Text>
              <HStack gap={2} vAlign="center">
                <Button
                  size="sm"
                  variant="destructive"
                  label="Suppress Globally"
                  isLoading={pending}
                  isDisabled={pending}
                  onClick={handleConfirmAdd}
                />
                <Button
                  size="sm"
                  variant="secondary"
                  label="Cancel"
                  isDisabled={pending}
                  onClick={() => {
                    setPendingRule(null);
                    setAddInput("");
                  }}
                />
              </HStack>
            </VStack>
          </Card>
        )}
      </VStack>

      {excluded.length > 0 && (
        <SearchField
          value={search}
          onChange={setSearch}
          placeholder="Search by rule ID or message…"
          label="Search suppressed rules"
          width={400}
        />
      )}

      {excluded.length === 0 ? (
        <EmptyState
          icon={<ShieldOff />}
          title="No globally suppressed rules."
          description='Add a rule above or open a WAF event and click "Suppress Globally".'
        />
      ) : filtered.length === 0 ? (
        <Text type="body" size="sm" color="secondary">
          No rules match your search.
        </Text>
      ) : (
        <VStack gap={2}>
          {filtered.map((id) => (
            <Card key={id} variant="muted" padding={3}>
              <HStack gap={4} vAlign="center" justify="between">
                <VStack gap={0}>
                  <Text type="code" size="sm" weight="bold">
                    Rule {id}
                  </Text>
                  <Text type="body" size="xsm" color="secondary">
                    {messages[id] ?? noDescription}
                  </Text>
                </VStack>
                <IconButton
                  variant="ghost"
                  label={`Remove suppression for rule ${id}`}
                  tooltip="Remove suppression"
                  icon={<Trash2 />}
                  isDisabled={pending}
                  onClick={() => handleRemove(id)}
                />
              </HStack>
            </Card>
          ))}
        </VStack>
      )}
    </VStack>
  );
}

/* ── Main client component ───────────────────────────────────────────────── */
const RANGE_OPTIONS: { value: RangeOption; label: string }[] = [
  { value: "all", label: "All time" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "custom", label: "Custom" },
];

const WAF_TEMPLATES = [
  {
    label: "Allow IP",
    snippet: `SecRule REMOTE_ADDR "@ipMatch 1.2.3.4" "id:9000,phase:1,allow,nolog,msg:'Allow IP'"`,
  },
  {
    label: "Disable WAF for path",
    snippet: `SecRule REQUEST_URI "@beginsWith /api/" "id:9001,phase:1,ctl:ruleEngine=Off,nolog"`,
  },
  { label: "Remove XSS rules", snippet: `SecRuleRemoveByTag "attack-xss"` },
  {
    label: "Block User-Agent",
    snippet: `SecRule REQUEST_HEADERS:User-Agent "@contains badbot" "id:9002,phase:1,deny,status:403,log"`,
  },
];

export default function WafEventsClient({
  events,
  stats,
  pagination,
  initialSearch,
  initialRange,
  initialFrom,
  initialTo,
  globalExcluded,
  globalExcludedMessages,
  globalWafEnabled,
  hostWafMap,
  globalWaf,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState("events");
  const [searchTerm, setSearchTerm] = useState(initialSearch);
  const [range, setRange] = useState<RangeOption>(initialRange);
  const [customFrom, setCustomFrom] = useState(formatDateTimeLocal(initialFrom));
  const [customTo, setCustomTo] = useState(formatDateTimeLocal(initialTo));
  const [selected, setSelected] = useState<WafEvent | null>(null);
  const [localGlobalExcluded, setLocalGlobalExcluded] = useState(globalExcluded);
  const [localGlobalMessages, setLocalGlobalMessages] = useState(globalExcludedMessages);
  const [localHostWafMap, setLocalHostWafMap] = useState(hostWafMap);
  const [wafState, wafFormAction] = useActionState(updateWafSettingsAction, null);
  const [wafEnabled, setWafEnabled] = useState(globalWaf?.enabled ?? false);
  const [wafLoadOwaspCrs, setWafLoadOwaspCrs] = useState(globalWaf?.load_owasp_crs ?? true);
  const [wafCustomDirectives, setWafCustomDirectives] = useState(
    globalWaf?.custom_directives ?? "",
  );

  useEffect(() => {
    setSearchTerm(initialSearch);
  }, [initialSearch]);
  useEffect(() => {
    setRange(initialRange);
    setCustomFrom(formatDateTimeLocal(initialFrom));
    setCustomTo(formatDateTimeLocal(initialTo));
  }, [initialRange, initialFrom, initialTo]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updateSearch = useCallback(
    (value: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        const params = new URLSearchParams(searchParams.toString());
        if (value.trim()) {
          params.set("search", value.trim());
        } else {
          params.delete("search");
        }
        params.delete("page");
        router.push(`${pathname}?${params.toString()}`);
      }, 400);
    },
    [router, pathname, searchParams],
  );

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  const pushRange = useCallback(
    (nextRange: RangeOption, nextFrom?: string, nextTo?: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("page");

      if (nextRange === "all") {
        params.delete("range");
        params.delete("from");
        params.delete("to");
        router.push(`${pathname}?${params.toString()}`);
        return;
      }

      params.set("range", nextRange);
      if (nextRange === "custom") {
        const fromTs = parseDateTimeLocal(nextFrom ?? "");
        const toTs = parseDateTimeLocal(nextTo ?? "");
        if (fromTs == null || toTs == null || fromTs >= toTs) {
          toast.error("Choose a valid custom time range");
          return;
        }
        params.set("from", String(fromTs));
        params.set("to", String(toTs));
      } else {
        params.delete("from");
        params.delete("to");
      }

      router.push(`${pathname}?${params.toString()}`);
    },
    [pathname, router, searchParams],
  );

  const activateCustom = useCallback(() => {
    setRange("custom");
    if (!customFrom || !customTo) {
      const now = new Date();
      const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      setCustomFrom(formatDateTimeLocal(Math.floor(dayAgo.getTime() / 1000)));
      setCustomTo(formatDateTimeLocal(Math.floor(now.getTime() / 1000)));
    }
  }, [customFrom, customTo]);

  const handleRangeChange = useCallback(
    (next: string) => {
      const value = next as RangeOption;
      if (value === "custom") {
        activateCustom();
        return;
      }
      setRange(value);
      pushRange(value);
    },
    [activateCustom, pushRange],
  );

  const mobileCard = (event: WafEvent) => (
    <Card>
      <VStack gap={2}>
        <HStack justify="between" vAlign="center" gap={2}>
          <HStack gap={2} vAlign="center">
            <BlockedChip blocked={event.blocked} />
            <SeverityChip severity={event.severity} />
          </HStack>
          <Text type="body" size="xsm" color="secondary">
            <span suppressHydrationWarning>{new Date(event.ts * 1000).toLocaleString()}</span>
          </Text>
        </HStack>
        <Text type="code" size="xsm" color="secondary">
          {event.host || "—"}
        </Text>
        {event.ruleId && (
          <Text type="body" size="xsm" color="secondary">
            Rule #{event.ruleId}
          </Text>
        )}
      </VStack>
    </Card>
  );

  const columns: Column<WafEvent>[] = [
    {
      id: "ts",
      label: "Time",
      width: 150,
      // The timestamp renders on the server in the container's locale/timezone
      // and again in the browser's — the two never match, so this text opts out
      // of hydration checks rather than letting React discard the whole tree
      // (error #418).
      render: (r) => (
        <Text type="code" size="xsm" color="secondary">
          <span suppressHydrationWarning>{new Date(r.ts * 1000).toLocaleString()}</span>
        </Text>
      ),
    },
    {
      id: "blocked",
      label: "Action",
      width: 90,
      render: (r) => <BlockedChip blocked={r.blocked} />,
    },
    {
      id: "severity",
      label: "Severity",
      width: 100,
      render: (r) => <SeverityChip severity={r.severity} />,
    },
    {
      id: "host",
      label: "Host",
      width: 130,
      render: (r) =>
        r.host ? (
          <Tooltip content={r.host}>
            <Text type="code" size="xsm" maxLines={1}>
              {r.host}
            </Text>
          </Tooltip>
        ) : (
          <Text type="body" size="xsm" color="secondary">
            &mdash;
          </Text>
        ),
    },
    {
      id: "clientIp",
      label: "Client IP",
      width: 130,
      render: (r) => (
        <HStack gap={1} vAlign="center">
          <Text type="code" size="xsm">
            {r.clientIp}
          </Text>
          {r.countryCode && <Badge label={r.countryCode} />}
        </HStack>
      ),
    },
    {
      id: "method",
      label: "Request",
      width: 200,
      render: (r) => (
        <HStack gap={2} vAlign="center">
          <Text type="code" size="xsm" weight="bold" color={r.method ? "accent" : "secondary"}>
            {r.method || "—"}
          </Text>
          <Tooltip content={r.uri ?? ""}>
            <Text type="code" size="xsm" color="secondary" maxLines={1}>
              {r.uri || "—"}
            </Text>
          </Tooltip>
        </HStack>
      ),
    },
    {
      id: "ruleId",
      label: "Rule ID",
      width: 80,
      render: (r) => (
        <Text type="code" size="xsm" color="secondary">
          {r.ruleId ?? "—"}
        </Text>
      ),
    },
  ];

  return (
    <VStack gap={4}>
      <VStack gap={1}>
        <Heading level={1}>WAF</Heading>
        <Text type="body" color="secondary">
          Web Application Firewall events and rule management.
        </Text>
      </VStack>

      <TabList
        value={tab}
        onChange={(v) => {
          setTab(v);
          if (v !== "events") setSelected(null);
        }}
        hasDivider
      >
        <Tab value="events" label="Events" />
        <Tab value="suppressed" label="Suppressed Rules" />
        <Tab value="settings" label="Settings" />
      </TabList>

      {tab === "events" && (
        <VStack gap={4}>
          <StatsBar stats={stats} />
          <VStack gap={3}>
            {/* Was five buttons whose "selected" state read only as a filled
                variant; SegmentedControl exposes the choice as a radio group. */}
            <SegmentedControl
              label="Time range"
              size="sm"
              value={range}
              onChange={handleRangeChange}
            >
              {RANGE_OPTIONS.map((o) => (
                <SegmentedControlItem key={o.value} value={o.value} label={o.label} />
              ))}
            </SegmentedControl>
            {range === "custom" && (
              <HStack gap={2} vAlign="end" wrap="wrap">
                <DateTimeInput
                  label="From"
                  size="sm"
                  value={(customFrom || undefined) as ISODateTimeString | undefined}
                  onChange={(v) => setCustomFrom(v ?? "")}
                />
                <DateTimeInput
                  label="To"
                  size="sm"
                  value={(customTo || undefined) as ISODateTimeString | undefined}
                  onChange={(v) => setCustomTo(v ?? "")}
                />
                <Button
                  size="sm"
                  label="Apply range"
                  onClick={() => pushRange("custom", customFrom, customTo)}
                />
              </HStack>
            )}
            <SearchField
              value={searchTerm}
              onChange={(v) => {
                setSearchTerm(v);
                updateSearch(v);
              }}
              placeholder="Search by host, IP, URI, or rule message..."
              label="Search WAF events"
              width={480}
            />
          </VStack>
          <DataTable
            columns={columns}
            data={events}
            keyField="id"
            emptyMessage="No WAF events found. Enable the WAF in Settings and send some traffic to see events here."
            pagination={pagination}
            onRowClick={(row) => setSelected((prev) => (prev?.id === row.id ? null : row))}
            rowStatus={(row) =>
              row.id === selected?.id ? { color: "accent", label: "Selected" } : null
            }
            mobileCard={mobileCard}
          />

          {selected && (
            <EventDetailPanel
              event={selected}
              onClose={() => setSelected(null)}
              globalExcluded={localGlobalExcluded}
              hostWafMap={localHostWafMap}
              onSuppressGlobal={(ruleId) =>
                setLocalGlobalExcluded((prev) => [...new Set([...prev, ruleId])])
              }
              onSuppressHost={(ruleId, host) => {
                const bare = host.replace(/:\d+$/, "");
                setLocalHostWafMap((prev) => ({
                  ...prev,
                  [bare]: [...new Set([...(prev[bare] ?? []), ruleId])],
                }));
              }}
            />
          )}
        </VStack>
      )}

      {tab === "suppressed" && (
        <GlobalSuppressedRules
          excluded={localGlobalExcluded}
          messages={localGlobalMessages}
          wafEnabled={globalWafEnabled}
          onRemove={(ruleId) =>
            setLocalGlobalExcluded((prev) => prev.filter((id) => id !== ruleId))
          }
          onAdd={(ruleId, message) => {
            setLocalGlobalExcluded((prev) => [...new Set([...prev, ruleId])]);
            setLocalGlobalMessages((prev) => ({ ...prev, [ruleId]: message }));
          }}
        />
      )}

      {tab === "settings" && (
        <VStack gap={6} maxWidth={720}>
          <VStack gap={1}>
            <Heading level={2}>WAF Settings</Heading>
            <Text type="body" size="sm" color="secondary">
              Configure the global Web Application Firewall. Per-host settings can merge with or
              override these defaults. Powered by Coraza with optional OWASP Core Rule Set.
            </Text>
          </VStack>
          <form action={wafFormAction}>
            <VStack gap={4}>
              <input type="hidden" name="wafEnabled" value={wafEnabled ? "on" : ""} />
              <input type="hidden" name="wafLoadOwaspCrs" value={wafLoadOwaspCrs ? "on" : ""} />
              {wafState?.message && (
                <Banner status={wafState.success ? "success" : "error"} title={wafState.message} />
              )}
              <Switch
                label="Enable WAF globally (blocking)"
                value={wafEnabled}
                onChange={setWafEnabled}
              />
              <CheckboxInput
                label="Load OWASP Core Rule Set"
                description="Covers SQLi, XSS, LFI, RCE — recommended."
                value={wafLoadOwaspCrs}
                onChange={setWafLoadOwaspCrs}
              />
              <TextArea
                label="Custom SecLang Directives"
                isOptional
                htmlName="wafCustomDirectives"
                rows={3}
                value={wafCustomDirectives}
                onChange={setWafCustomDirectives}
                placeholder={`SecRule REQUEST_URI "@contains /secret" "id:9001,deny,status:403,log,msg:'Blocked path'"`}
                description="ModSecurity SecLang syntax. Applied after OWASP CRS if enabled."
              />
              <Collapsible
                defaultIsOpen={false}
                trigger={
                  <Text type="body" size="sm">
                    Quick Templates
                  </Text>
                }
              >
                <VStack gap={2}>
                  {WAF_TEMPLATES.map((t) => (
                    <Button
                      key={t.label}
                      type="button"
                      size="sm"
                      variant="secondary"
                      icon={<Copy />}
                      label={t.label}
                      onClick={() =>
                        setWafCustomDirectives((prev) =>
                          prev ? `${prev}\n${t.snippet}` : t.snippet,
                        )
                      }
                    />
                  ))}
                </VStack>
              </Collapsible>
              <Banner status="info" title="Rule exclusions live on the Suppressed Rules tab" />
              <HStack justify="end">
                <Button type="submit" label="Save WAF settings" />
              </HStack>
            </VStack>
          </form>
        </VStack>
      )}
    </VStack>
  );
}
