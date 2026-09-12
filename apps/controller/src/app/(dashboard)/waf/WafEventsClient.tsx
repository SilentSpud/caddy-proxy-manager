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
import { ArrowLeft, Check, Copy, MoreHorizontal, Search, ShieldOff, Trash2, X } from "lucide-react";

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
import { CodeEditor } from "@/components/ui/CodeEditor";
import { ModuleGated, useDisabledReason } from "@/components/caddy-modules/ModuleGate";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Tooltip } from "@astryxdesign/core/Tooltip";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { DropdownMenu } from "@astryxdesign/core/DropdownMenu";
import { useMediaQuery } from "@astryxdesign/core/hooks";

import { DataTable, type Column } from "@/components/ui/DataTable";
import { FilterChip } from "@/src/components/mobile/FilterChip";
import { OptionSheet } from "@/src/components/mobile/OptionSheet";
import { SearchField } from "@/components/ui/SearchField";
import { NumberInput } from "@astryxdesign/core/NumberInput";
import { nativeAttrs } from "@/components/ui/native-input-attrs";
import { bytesToMib, MAX_BODY_LIMIT_MIB, MIN_BODY_LIMIT_MIB } from "@/src/lib/caddy-waf";
import { formatDateTimeUtc } from "@/src/lib/date-format";
import type { WafEvent, WafEventStats } from "@/lib/models/waf-events";
import type { WafSettings } from "@/lib/settings";
import { withRowIds } from "@/lib/row-id";
import { useTranslations } from "next-intl";
import { useEmptyValue } from "@/components/ui/empty-value";
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

// UTC counterparts of the datetime-local input helpers, so the custom-range
// fields agree with the UTC timestamps shown in the event list and render the
// same on the server as in the browser.
function formatDateTimeLocalUtc(unixTs: number | null): string {
  if (!unixTs) return "";
  const d = new Date(unixTs * 1000);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const min = String(d.getUTCMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}

function parseDateTimeLocalUtc(value: string): number | null {
  if (!value) return null;
  // "YYYY-MM-DDTHH:mm" parses as local time per spec; the trailing "Z" pins it
  // to UTC so it matches the displayed timestamps.
  const ts = Math.floor(new Date(`${value}Z`).getTime() / 1000);
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
  const t = useTranslations("waf");
  return blocked ? (
    <Badge variant="error" label={t("blocked")} />
  ) : (
    <Badge variant="warning" label={t("detected")} />
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

/* ── Phone summary card ───────────────────────────────────────────────────── */
/** The stat tiles folded into one card for a phone: the blocked count leads, the rest sit under it. */
function WafStatusCard({ stats, isEnabled }: { stats: WafEventStats; isEnabled: boolean }) {
  const t = useTranslations("waf");
  const rest = [
    { label: "Total Events", value: stats.total },
    { label: "Critical", value: stats.critical },
    { label: "Unique Hosts", value: stats.uniqueHosts },
    { label: "Rule IDs Triggered", value: stats.ruleIdsTriggered },
  ];

  return (
    <Card padding={4}>
      <VStack gap={3}>
        <HStack justify="between" vAlign="center" gap={2}>
          <Text type="body" weight="semibold">
            {t("firewall")}
          </Text>
          <Badge
            variant={isEnabled ? "success" : "neutral"}
            label={isEnabled ? t("enabled") : t("disabled")}
          />
        </HStack>
        <VStack gap={0}>
          <Text type="display-3" color="accent" hasTabularNumbers>
            {stats.blocked}
          </Text>
          <Text type="body" size="xsm" weight="medium" color="secondary">
            {t("blocked")}
          </Text>
        </VStack>
        <Grid columns={{ minWidth: 120, max: 2 }} gap={3}>
          {rest.map(({ label, value }) => (
            <VStack key={label} gap={0}>
              <Text type="body" weight="semibold" hasTabularNumbers>
                {value}
              </Text>
              <Text type="body" size="xsm" color="secondary">
                {label}
              </Text>
            </VStack>
          ))}
        </Grid>
      </VStack>
    </Card>
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
  const t = useTranslations("waf");
  const emptyValue = useEmptyValue();
  const [innerTab, setInnerTab] = useState("overview");

  // Parsed once per event instead of on every render. The matched rules get their row ids here, so
  // switching the inner tab re-keys nothing.
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
    return <EmptyState title={t("auditDataEmptyTitle")} isCompact />;
  }

  const tx = data.transaction ?? null;
  const req = tx?.request ?? null;
  const res = tx?.response ?? null;

  return (
    <VStack gap={3}>
      <TabList value={innerTab} onChange={setInnerTab} size="sm">
        <Tab value="overview" label={t("overview")} />
        <Tab value="request" label={t("request")} />
        <Tab value="response" label={t("response")} />
        {msgs.length > 0 && <Tab value="matches" label={`Matches (${msgs.length})`} />}
      </TabList>

      <Card variant="muted" padding={4}>
        <VStack gap={3}>
          {innerTab === "overview" && tx && (
            <>
              <MetadataList columns="multi">
                <MetadataListItem label={t("transactionId")}>
                  <Text type="code" size="xsm">
                    {tx.id ?? emptyValue}
                  </Text>
                </MetadataListItem>
                <MetadataListItem label={t("timestamp")}>
                  <Text type="body" size="sm">
                    {tx.timestamp ?? emptyValue}
                  </Text>
                </MetadataListItem>
                <MetadataListItem label={t("client")}>
                  <Text type="code" size="xsm">
                    {tx.client_ip ?? emptyValue}:{tx.client_port ?? 0}
                  </Text>
                </MetadataListItem>
                <MetadataListItem label={t("server")}>
                  <Text type="code" size="xsm">
                    {tx.server_id ?? emptyValue}:{tx.host_port ?? 0}
                  </Text>
                </MetadataListItem>
              </MetadataList>
              {msgs.length > 0 && (
                <>
                  <Divider />
                  <VStack gap={2}>
                    <Text type="label" size="3xs" weight="bold" color="secondary">
                      {t("matchedRules")}
                    </Text>
                    {msgs.map((m) => (
                      <Card key={m.rowId} variant="red" padding={3}>
                        <VStack gap={2}>
                          <HStack gap={2} vAlign="center">
                            <Text type="code" size="xsm" weight="semibold">
                              Rule {m.details?.ruleId ?? emptyValue}
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
              <DetailRow label={t("headers")}>
                <HeadersGrid headers={req.headers} />
              </DetailRow>
              {req.args && Object.keys(req.args).length > 0 && (
                <DetailRow label={t("queryArgs")}>
                  <HeadersGrid headers={req.args as Record<string, string>} />
                </DetailRow>
              )}
              {req.body && (
                <DetailRow label={t("body")}>
                  <CodeBlock {...bodyCode(req.body)} width="100%" isCollapsible />
                </DetailRow>
              )}
              <DetailRow label={t("contentLength")}>
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
                    label={String(res.status || emptyValue)}
                  />
                  <Text type="code" size="xsm" color="secondary">
                    {res.protocol}
                  </Text>
                </HStack>
              </Card>
              <DetailRow label={t("responseHeaders")}>
                <HeadersGrid headers={res.headers} />
              </DetailRow>
              {res.body && (
                <DetailRow label={t("body")}>
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
                    <MetadataListItem label={t("ruleId")}>
                      <Text type="code" size="xsm" weight="semibold">
                        {m.details?.ruleId ?? emptyValue}
                      </Text>
                    </MetadataListItem>
                    <MetadataListItem label={t("severity")}>
                      <SeverityChip severity={m.details?.severity ?? null} />
                    </MetadataListItem>
                    <MetadataListItem label={t("message")}>
                      <Text type="body" size="xsm">
                        {m.message}
                      </Text>
                    </MetadataListItem>
                    <MetadataListItem label={t("logData")}>
                      <Text type="code" size="xsm">
                        {m.details?.logdata ?? emptyValue}
                      </Text>
                    </MetadataListItem>
                    <MetadataListItem label={t("file")}>
                      <Text type="code" size="xsm" color="secondary">
                        {m.details?.file ?? emptyValue}:{m.details?.lineNumber ?? ""}
                      </Text>
                    </MetadataListItem>
                    <MetadataListItem label={t("reference")}>
                      <Text type="code" size="xsm" color="secondary">
                        {m.details?.reference ?? emptyValue}
                      </Text>
                    </MetadataListItem>
                  </MetadataList>
                  {(m.details?.tags?.length ?? 0) > 0 && (
                    <DetailRow label={t("tags")}>
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
            {t("rawJson")}
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
  const t = useTranslations("waf");
  const emptyValue = useEmptyValue();
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
    // Beside the list rather than over it. Triage means reading several events in a row, and a
    // modal makes you dismiss one to see the next - so this is plain layout, with no backdrop and
    // no focus trap to fight the table it sits next to.
    <Card padding={4}>
      <VStack gap={4}>
        <HStack gap={2} vAlign="center" justify="between">
          <HStack gap={2} vAlign="center">
            <Text type="label" weight="bold">
              {t("wafEvent")}
            </Text>
            <BlockedChip blocked={event.blocked} />
            <SeverityChip severity={event.severity} />
          </HStack>
          <IconButton
            variant="ghost"
            size="sm"
            label={t("close")}
            tooltip={t("close")}
            icon={<X />}
            onClick={onClose}
          />
        </HStack>

        <Card variant="muted" padding={4}>
          <MetadataList columns="multi">
            <MetadataListItem label={t("timeUtc")}>
              <Text type="body" size="sm">
                {formatDateTimeUtc(event.ts * 1000)}
              </Text>
            </MetadataListItem>
            <MetadataListItem label={t("host")}>
              <Text type="code" size="sm">
                {event.host || emptyValue}
              </Text>
            </MetadataListItem>
            <MetadataListItem label={t("clientIp")}>
              <HStack gap={2} vAlign="center" wrap="wrap">
                <Text type="code" size="sm">
                  {event.clientIp}
                </Text>
                {event.countryCode && <Badge label={event.countryCode} />}
              </HStack>
            </MetadataListItem>
            <MetadataListItem label={t("method")}>
              <Text type="code" size="sm" weight="semibold" color="accent">
                {event.method}
              </Text>
            </MetadataListItem>
            <MetadataListItem label={t("uri")}>
              <Text type="code" size="xsm" color="secondary">
                {event.uri || emptyValue}
              </Text>
            </MetadataListItem>
            <MetadataListItem label={t("ruleId")}>
              <Text type="code" size="sm" weight="semibold">
                {event.ruleId ?? emptyValue}
              </Text>
            </MetadataListItem>
            <MetadataListItem label={t("ruleMessage")}>
              <Text type="body" size="sm">
                {event.ruleMessage ?? emptyValue}
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
            {t("auditData")}
          </Text>
          <AuditPanel rawData={event.rawData} />
        </VStack>
      </VStack>
    </Card>
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
  const t = useTranslations("waf");
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

  const noDescription = "No description available - rule has not triggered yet";

  return (
    <VStack gap={4}>
      <VStack gap={2}>
        <Heading level={2}>Global WAF Rule Exclusions</Heading>
        <Text type="body" size="sm" color="secondary">
          {t("globalExclusionsHelp")}
        </Text>
        {!wafEnabled && (
          <Banner
            status="warning"
            title={t("exclusionsDisabledTitle")}
            description={t("exclusionsDisabledDescription")}
          />
        )}
      </VStack>

      <VStack gap={2}>
        <HStack gap={2} vAlign="end" maxWidth={360}>
          <TextInput
            {...nativeAttrs({ pattern: "[0-9]*" })}
            label={t("addRuleById")}
            size="sm"
            value={addInput}
            onChange={(v) => {
              setAddInput(v);
              setPendingRule(null);
            }}
            onEnter={handleLookup}
            placeholder={t("ruleId")}
            isDisabled={lookupPending || pending}
            width="100%"
          />
          <Button
            variant="secondary"
            size="sm"
            label={t("lookUp")}
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
                  label={t("suppressGlobally")}
                  isLoading={pending}
                  isDisabled={pending}
                  onClick={handleConfirmAdd}
                />
                <Button
                  size="sm"
                  variant="secondary"
                  label={t("cancel")}
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
        <div style={{ maxWidth: 400 }}>
          <SearchField
            value={search}
            onChange={setSearch}
            placeholder={t("suppressedRulesSearchPlaceholder")}
            label={t("searchSuppressedRules")}
            width="100%"
          />
        </div>
      )}

      {excluded.length === 0 ? (
        <EmptyState
          icon={<ShieldOff />}
          title={t("noGloballySuppressedRules")}
          description='Add a rule above or open a WAF event and click "Suppress Globally".'
        />
      ) : filtered.length === 0 ? (
        <Text type="body" size="sm" color="secondary">
          {t("suppressedRulesSearchEmptyMessage")}
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
                  tooltip={t("removeSuppression")}
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

/** Stored body limits are bytes; the form asks for whole MiB. Unset means "inherit the default". */
function bodyLimitMib(bytes: number | undefined): number | null {
  const mib = bytesToMib(bytes);
  return mib ? Number(mib) : null;
}

const BODY_LIMIT_ACTIONS = [
  { value: "", label: "Default" },
  { value: "Reject", label: "Reject" },
  { value: "ProcessPartial", label: "Partial" },
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
  const t = useTranslations("waf");
  const emptyValue = useEmptyValue();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState("events");
  const [searchTerm, setSearchTerm] = useState(initialSearch);
  const [range, setRange] = useState<RangeOption>(initialRange);
  const [customFrom, setCustomFrom] = useState(formatDateTimeLocalUtc(initialFrom));
  const [customTo, setCustomTo] = useState(formatDateTimeLocalUtc(initialTo));
  const [selected, setSelected] = useState<WafEvent | null>(null);
  // Phone-only chrome: the range sheet, and search tucked behind its icon until it is wanted.
  const isNarrow = useMediaQuery("(max-width: 767px)");
  const [rangeSheetOpen, setRangeSheetOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const detailRef = useRef<HTMLDivElement>(null);
  const searchWrapRef = useRef<HTMLDivElement>(null);

  // The field is mounted all along (only hidden), so autofocus would never fire: focus it when the
  // icon reveals it instead.
  useEffect(() => {
    if (searchOpen) searchWrapRef.current?.querySelector("input")?.focus();
  }, [searchOpen]);
  const [localGlobalExcluded, setLocalGlobalExcluded] = useState(globalExcluded);
  const [localGlobalMessages, setLocalGlobalMessages] = useState(globalExcludedMessages);
  const [localHostWafMap, setLocalHostWafMap] = useState(hostWafMap);
  const [wafState, wafFormAction] = useActionState(updateWafSettingsAction, null);
  const [wafEnabled, setWafEnabled] = useState(globalWaf?.enabled ?? false);
  const [wafLoadOwaspCrs, setWafLoadOwaspCrs] = useState(globalWaf?.load_owasp_crs ?? true);
  const [wafCustomDirectives, setWafCustomDirectives] = useState(
    globalWaf?.custom_directives ?? "",
  );
  const [wafBodyLimitMb, setWafBodyLimitMb] = useState(bodyLimitMib(globalWaf?.request_body_limit));
  const [wafInMemoryLimitMb, setWafInMemoryLimitMb] = useState(
    bodyLimitMib(globalWaf?.request_body_in_memory_limit),
  );
  const [wafLimitAction, setWafLimitAction] = useState<string>(
    globalWaf?.request_body_limit_action ?? "",
  );
  // Coraza is a compiled-in plugin. With it off the settings below would be stored and then never
  // reach Caddy, so the form says so up front rather than accepting a rule set that does nothing.
  const wafModuleDisabledReason = useDisabledReason("waf");

  useEffect(() => {
    setSearchTerm(initialSearch);
  }, [initialSearch]);
  useEffect(() => {
    setRange(initialRange);
    setCustomFrom(formatDateTimeLocalUtc(initialFrom));
    setCustomTo(formatDateTimeLocalUtc(initialTo));
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
        const fromTs = parseDateTimeLocalUtc(nextFrom ?? "");
        const toTs = parseDateTimeLocalUtc(nextTo ?? "");
        if (fromTs == null || toTs == null || fromTs >= toTs) {
          toast.error(t("invalidTimeRangeError"));
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
    [pathname, router, searchParams, t],
  );

  const activateCustom = useCallback(() => {
    setRange("custom");
    if (!customFrom || !customTo) {
      const now = new Date();
      const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      setCustomFrom(formatDateTimeLocalUtc(Math.floor(dayAgo.getTime() / 1000)));
      setCustomTo(formatDateTimeLocalUtc(Math.floor(now.getTime() / 1000)));
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
            {formatDateTimeUtc(event.ts * 1000)}
          </Text>
        </HStack>
        <Text type="code" size="xsm" color="secondary">
          {event.host || emptyValue}
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
      label: "Time (UTC)",
      width: 150,
      // formatDateTimeUtc pins locale and timezone, so the server- and client-rendered text are
      // identical: no hydration mismatch, and no locale-dependent dots vs slashes (issue #233).
      render: (r) => (
        <Text type="code" size="xsm" color="secondary">
          {formatDateTimeUtc(r.ts * 1000)}
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
            {r.method || emptyValue}
          </Text>
          <Tooltip content={r.uri ?? ""}>
            <Text type="code" size="xsm" color="secondary" maxLines={1}>
              {r.uri || emptyValue}
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
          {r.ruleId ?? emptyValue}
        </Text>
      ),
    },
  ];

  const changeTab = (next: string) => {
    setTab(next);
    if (next !== "events") setSelected(null);
  };

  const views = [
    { value: "events", label: t("events") },
    { value: "suppressed", label: t("suppressedRules") },
    { value: "settings", label: t("settings") },
  ];

  const detailPanel = selected && (
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
  );

  // On a phone the event replaces the list, which may have been scrolled well down: bring its top
  // into view rather than opening it somewhere above the fold.
  const selectedId = selected?.id;
  useEffect(() => {
    if (isNarrow && selectedId != null) detailRef.current?.scrollIntoView({ block: "start" });
  }, [isNarrow, selectedId]);

  return (
    <VStack gap={4}>
      <HStack justify="between" vAlign="center" gap={2}>
        <VStack gap={1}>
          <Heading level={1}>WAF</Heading>
          <Text type="body" color="secondary" className="cpm-desktop-only">
            {t("pageDescription")}
          </Text>
        </VStack>
        {/* A phone has no room for the tabs: the views move behind the overflow button, and search
            waits behind its icon until it is wanted. */}
        <HStack gap={1} vAlign="center" className="cpm-mobile-flex">
          {tab === "events" && (
            <IconButton
              variant="ghost"
              label={t("searchWafEvents")}
              icon={<Search />}
              onClick={() => setSearchOpen((open) => !open)}
            />
          )}
          <DropdownMenu
            hasChevron={false}
            presentation="adaptive"
            alignment="end"
            button={{
              variant: "ghost",
              icon: <MoreHorizontal />,
              label: t("views"),
              isIconOnly: true,
            }}
            items={views.map((view) => ({
              id: view.value,
              label: view.label,
              endContent: view.value === tab ? <Check size={16} aria-hidden="true" /> : undefined,
              onClick: () => changeTab(view.value),
            }))}
          />
        </HStack>
      </HStack>

      <TabList value={tab} onChange={changeTab} hasDivider className="cpm-desktop-only">
        <Tab value="events" label={t("events")} />
        <Tab value="suppressed" label={t("suppressedRules")} />
        <Tab value="settings" label={t("settings")} />
      </TabList>

      {tab === "events" && (
        <VStack gap={4}>
          <div className="cpm-desktop-only">
            <StatsBar stats={stats} />
          </div>
          <div className="cpm-mobile-only">
            <WafStatusCard stats={stats} isEnabled={globalWafEnabled} />
          </div>
          <VStack gap={3}>
            {/* Was five buttons whose "selected" state read only as a filled
                variant; SegmentedControl exposes the choice as a radio group. */}
            <div className="cpm-desktop-only">
              <SegmentedControl
                label={t("timeRange")}
                size="sm"
                value={range}
                onChange={handleRangeChange}
              >
                {RANGE_OPTIONS.map((o) => (
                  <SegmentedControlItem key={o.value} value={o.value} label={o.label} />
                ))}
              </SegmentedControl>
            </div>
            <div className="cpm-chip-row cpm-mobile-flex">
              <FilterChip
                label={RANGE_OPTIONS.find((o) => o.value === range)?.label ?? range}
                aria-label={t("timeRange")}
                isActive={range !== "all"}
                onClick={() => setRangeSheetOpen(true)}
              />
            </div>
            <OptionSheet
              title={t("timeRange")}
              isOpen={rangeSheetOpen}
              onOpenChange={setRangeSheetOpen}
              value={range}
              options={RANGE_OPTIONS}
              onChange={handleRangeChange}
            />
            {range === "custom" && (
              <HStack gap={2} vAlign="end" wrap="wrap">
                <DateTimeInput
                  label={t("fromUtc")}
                  size="sm"
                  value={(customFrom || undefined) as ISODateTimeString | undefined}
                  onChange={(v) => setCustomFrom(v ?? "")}
                />
                <DateTimeInput
                  label={t("toUtc")}
                  size="sm"
                  value={(customTo || undefined) as ISODateTimeString | undefined}
                  onChange={(v) => setCustomTo(v ?? "")}
                />
                <Button
                  size="sm"
                  label={t("applyRange")}
                  onClick={() => pushRange("custom", customFrom, customTo)}
                />
              </HStack>
            )}
            {/* Always there on a desktop; on a phone only once the search icon asks for it, or
                while a search is applied so the filter never hides. */}
            <div
              ref={searchWrapRef}
              className={searchOpen || searchTerm ? undefined : "cpm-desktop-only"}
              style={{ maxWidth: 480 }}
            >
              <SearchField
                value={searchTerm}
                onChange={(v) => {
                  setSearchTerm(v);
                  updateSearch(v);
                }}
                placeholder={t("eventsSearchPlaceholder")}
                label={t("searchWafEvents")}
                width="100%"
              />
            </div>
          </VStack>
          {isNarrow && selected ? (
            // A phone has no room for the list and the event side by side: the event replaces it.
            <VStack gap={3} ref={detailRef}>
              <div>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<ArrowLeft />}
                  label={t("backToEvents")}
                  onClick={() => setSelected(null)}
                />
              </div>
              {detailPanel}
            </VStack>
          ) : (
            <HStack gap={4} vAlign="start" wrap="wrap">
              <div style={{ flexGrow: 1, flexBasis: 520, minWidth: 0 }}>
                <DataTable
                  columns={columns}
                  data={events}
                  keyField="id"
                  emptyMessage={t("eventsEmptyDescription")}
                  pagination={pagination}
                  onRowClick={(row) => setSelected((prev) => (prev?.id === row.id ? null : row))}
                  rowStatus={(row) =>
                    row.id === selected?.id ? { color: "accent", label: "Selected" } : null
                  }
                  mobileCard={mobileCard}
                />
              </div>

              {/* flexBasis rather than a fixed width: below roughly 900px the panel wraps under the
                  table instead of squeezing it, which is the same behaviour the dialog had. */}
              {selected && (
                <div style={{ flexGrow: 1, flexBasis: 380, maxWidth: 460, minWidth: 0 }}>
                  {detailPanel}
                </div>
              )}
            </HStack>
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
              {t("globalSettingsDescription")}
            </Text>
          </VStack>
          <form action={wafFormAction}>
            <VStack gap={4}>
              <input type="hidden" name="wafEnabled" value={wafEnabled ? "on" : ""} />
              <input type="hidden" name="wafLoadOwaspCrs" value={wafLoadOwaspCrs ? "on" : ""} />
              {wafState?.message && (
                <Banner status={wafState.success ? "success" : "error"} title={wafState.message} />
              )}
              {wafModuleDisabledReason && (
                <Banner
                  status="warning"
                  title={t("moduleDisabledTitle")}
                  description={wafModuleDisabledReason}
                />
              )}
              {/* Disabled controls emit no pointer events, so the reason is
                  attached by wrapping. */}
              <ModuleGated feature="waf">
                <Switch
                  label={t("enableWafGloballyBlocking")}
                  value={wafEnabled}
                  onChange={setWafEnabled}
                  isDisabled={Boolean(wafModuleDisabledReason)}
                />
              </ModuleGated>
              <CheckboxInput
                label={t("owaspCrsLabel")}
                description={t("owaspCrsHelp")}
                value={wafLoadOwaspCrs}
                onChange={setWafLoadOwaspCrs}
              />
              <HStack gap={3} vAlign="start" wrap="wrap">
                <NumberInput
                  label={t("maxBodySizeMib")}
                  htmlName="wafRequestBodyLimitMb"
                  value={wafBodyLimitMb}
                  onChange={setWafBodyLimitMb}
                  min={MIN_BODY_LIMIT_MIB}
                  max={MAX_BODY_LIMIT_MIB}
                  step={1}
                  isIntegerOnly
                  hasClear
                  placeholder={t("corazaDefault")}
                  description={t("bodySizeLimitHelp")}
                />
                <NumberInput
                  label={t("bufferedInMemoryMib")}
                  htmlName="wafRequestBodyInMemoryLimitMb"
                  value={wafInMemoryLimitMb}
                  onChange={setWafInMemoryLimitMb}
                  min={MIN_BODY_LIMIT_MIB}
                  max={MAX_BODY_LIMIT_MIB}
                  step={1}
                  isIntegerOnly
                  hasClear
                  placeholder={t("corazaDefault")}
                  description={t("memoryBodyLimitHelp")}
                />
              </HStack>
              <input type="hidden" name="wafRequestBodyLimitAction" value={wafLimitAction} />
              <SegmentedControl
                label={t("overLimitAction")}
                size="sm"
                value={wafLimitAction}
                onChange={setWafLimitAction}
              >
                {BODY_LIMIT_ACTIONS.map((o) => (
                  <SegmentedControlItem key={o.value} value={o.value} label={o.label} />
                ))}
              </SegmentedControl>
              <Text type="body" size="xsm" color="secondary">
                {t("wafOverLimitActionHelp")}
              </Text>
              <CodeEditor
                label={t("customSeclangDirectives")}
                language="seclang"
                htmlName="wafCustomDirectives"
                height="sm"
                value={wafCustomDirectives}
                onChange={setWafCustomDirectives}
                // isReadOnly, not isDisabled: a disabled field submits nothing, and
                // updateWafSettingsAction reads a missing value as an empty string, which would
                // erase the stored directives.
                isReadOnly={Boolean(wafModuleDisabledReason)}
                placeholder={`SecRule REQUEST_URI "@contains /secret" "id:9001,deny,status:403,log,msg:'Blocked path'"`}
                description={t("customDirectivesHelp")}
              />
              <Collapsible
                defaultIsOpen={false}
                trigger={
                  <Text type="body" size="sm">
                    {t("quickTemplates")}
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
              <Banner status="info" title={t("exclusionsTabHelp")} />
              <HStack justify="end">
                <Button type="submit" label={t("saveWafSettings")} />
              </HStack>
            </VStack>
          </form>
        </VStack>
      )}
    </VStack>
  );
}
