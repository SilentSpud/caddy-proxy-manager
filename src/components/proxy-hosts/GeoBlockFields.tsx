"use client";

import { useState, useEffect, useMemo } from "react";
import { Globe, Home, Plus, X } from "lucide-react";
import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Collapsible } from "@astryxdesign/core/Collapsible";
import { Divider } from "@astryxdesign/core/Divider";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { MultiSelector } from "@astryxdesign/core/MultiSelector";
import { NumberInput } from "@astryxdesign/core/NumberInput";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Spinner } from "@astryxdesign/core/Spinner";
import { Tab, TabList } from "@astryxdesign/core/TabList";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Text } from "@astryxdesign/core/Text";
import { Token } from "@astryxdesign/core/Token";
import { Tooltip } from "@astryxdesign/core/Tooltip";
import { Grid } from "@astryxdesign/core/Grid";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import type { GeoBlockSettings } from "@/lib/settings";
import type { GeoBlockMode } from "@/lib/models/proxy-hosts";
import { withRowId, withRowIds, type WithRowId } from "@/lib/row-id";
import { COUNTRIES, flagEmoji } from "./countries";
import { CheckboxInput, Switch } from "@/src/components/ui/FormBooleanControls";
import { ModuleGated, useDisabledReason } from "@/components/caddy-modules/ModuleGate";

// ─── GeoIpStatus ─────────────────────────────────────────────────────────────

type GeoIpStatusData = { country: boolean; asn: boolean } | null;

function GeoIpStatus() {
  const [status, setStatus] = useState<GeoIpStatusData>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/geoip-status")
      .then((r) => r.json())
      .then((d) => setStatus(d))
      .catch(() => setStatus(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <Spinner size="sm" label="Checking GeoIP databases" />;
  }

  const allLoaded = status?.country && status?.asn;
  const noneLoaded = !status?.country && !status?.asn;

  const label = allLoaded ? "GeoIP ready" : noneLoaded ? "GeoIP missing" : "GeoIP partial";
  const tooltip = noneLoaded
    ? "GeoIP databases not found — country/continent/ASN blocking will not work. Enable the geoipupdate service."
    : !status?.country
      ? "GeoLite2-Country database missing — country/continent blocking disabled"
      : !status?.asn
        ? "GeoLite2-ASN database missing — ASN blocking disabled"
        : "GeoLite2-Country and GeoLite2-ASN databases loaded";

  return (
    <Tooltip content={tooltip}>
      <Badge label={label} variant={allLoaded ? "success" : noneLoaded ? "error" : "warning"} />
    </Tooltip>
  );
}

// ─── Pickers ──────────────────────────────────────────────────────────────────

const CONTINENTS = [
  { code: "AF", name: "Africa", emoji: "🌍" },
  { code: "AN", name: "Antarctica", emoji: "🧊" },
  { code: "AS", name: "Asia", emoji: "🌏" },
  { code: "EU", name: "Europe", emoji: "🌍" },
  { code: "NA", name: "N. America", emoji: "🌎" },
  { code: "OC", name: "Oceania", emoji: "🌏" },
  { code: "SA", name: "S. America", emoji: "🌎" },
];

const COUNTRY_OPTIONS = COUNTRIES.map((c) => ({
  value: c.code,
  label: `${flagEmoji(c.code)}  ${c.name} (${c.code})`,
}));

const CONTINENT_OPTIONS = CONTINENTS.map((c) => ({
  value: c.code,
  label: `${c.emoji}  ${c.name} (${c.code})`,
}));

/**
 * The country and continent pickers were ~200 lines of hand-built chips,
 * sticky letter headers, inline SVG checkmarks and colour-coded accents.
 * MultiSelector provides the search, select-all, badge summary and keyboard
 * handling natively; the hidden input keeps the submitted comma-joined value
 * byte-identical so the server action is untouched.
 */
function CodeMultiSelect({
  name,
  label,
  options,
  initialValues = [],
  searchPlaceholder,
}: {
  name: string;
  label: string;
  options: { value: string; label: string }[];
  initialValues?: string[];
  searchPlaceholder?: string;
}) {
  const [selected, setSelected] = useState<string[]>(() =>
    initialValues.map((c) => c.toUpperCase()).filter(Boolean),
  );

  return (
    <>
      <input type="hidden" name={name} value={selected.join(",")} />
      <MultiSelector
        label={label}
        options={options}
        value={selected}
        onChange={setSelected}
        hasSearch={Boolean(searchPlaceholder)}
        searchPlaceholder={searchPlaceholder}
        hasSelectAll
        triggerDisplay="badges"
        maxBadges={6}
        placeholder="None selected"
      />
    </>
  );
}

// ─── TagInput ────────────────────────────────────────────────────────────────

type TagInputProps = {
  name: string;
  label: string;
  initialValues?: string[];
  placeholder?: string;
  helperText?: string;
  validate?: (value: string) => boolean;
  uppercase?: boolean;
};

/** Free-text chips. Token owns its own remove control and focus handling. */
function TagInput({
  name,
  label,
  initialValues = [],
  placeholder,
  helperText,
  validate,
  uppercase = false,
}: TagInputProps) {
  const [tags, setTags] = useState<string[]>(initialValues);
  const [draft, setDraft] = useState("");

  function commit(raw: string) {
    const value = uppercase ? raw.trim().toUpperCase() : raw.trim();
    if (!value) return;
    if (validate && !validate(value)) return;
    setTags((prev) => (prev.includes(value) ? prev : [...prev, value]));
    setDraft("");
  }

  return (
    <VStack gap={2}>
      <input type="hidden" name={name} value={tags.join(",")} />

      {tags.length > 0 && (
        <HStack gap={2} wrap="wrap">
          {tags.map((tag) => (
            <Token
              key={tag}
              size="sm"
              label={tag}
              onRemove={() => setTags((prev) => prev.filter((t) => t !== tag))}
            />
          ))}
        </HStack>
      )}

      <HStack gap={2} vAlign="end">
        <TextInput
          label={label}
          size="sm"
          value={draft}
          onChange={setDraft}
          placeholder={placeholder}
          description={helperText}
          onEnter={() => commit(draft)}
          // Enter here means "add this tag", not "submit the form". The design
          // system fires onEnter without preventing the default, so without this
          // the same keypress also triggers implicit form submission — saving
          // the whole config, and re-applying Caddy, on every tag added.
          onKeyDown={(e) => {
            if (e.key === "Enter") e.preventDefault();
          }}
          onBlur={() => commit(draft)}
        />
        <IconButton
          variant="ghost"
          size="sm"
          label={`Add to ${label}`}
          icon={<Plus />}
          onClick={() => commit(draft)}
        />
      </HStack>
    </VStack>
  );
}

// ─── ResponseHeadersEditor ────────────────────────────────────────────────────

type HeaderRow = { key: string; value: string };

function ResponseHeadersEditor({ initialHeaders }: { initialHeaders: Record<string, string> }) {
  const [rows, setRows] = useState<WithRowId<HeaderRow>[]>(() =>
    withRowIds(Object.entries(initialHeaders).map(([key, value]) => ({ key, value }))),
  );

  return (
    <VStack gap={2}>
      <HStack justify="between" vAlign="center">
        <Text type="body" size="sm" weight="semibold">
          Custom Response Headers
        </Text>
        <IconButton
          variant="ghost"
          size="sm"
          label="Add response header"
          icon={<Plus />}
          onClick={() => setRows((prev) => [...prev, withRowId({ key: "", value: "" })])}
        />
      </HStack>

      {rows.length === 0 ? (
        <Text type="body" size="xsm" color="secondary">
          No custom headers — use the + button to add one.
        </Text>
      ) : (
        <VStack gap={2}>
          {rows.map((row, i) => (
            <HStack key={row.rowId} gap={2} vAlign="end">
              <input type="hidden" name="geoblockResponseHeadersKeys[]" value={row.key} />
              <input type="hidden" name="geoblockResponseHeadersValues[]" value={row.value} />
              <TextInput
                label="Header"
                isLabelHidden={i > 0}
                size="sm"
                placeholder="Header"
                value={row.key}
                onChange={(next) =>
                  setRows((prev) =>
                    prev.map((r) => (r.rowId === row.rowId ? { ...r, key: next } : r)),
                  )
                }
              />
              <TextInput
                label="Value"
                isLabelHidden={i > 0}
                size="sm"
                placeholder="Value"
                value={row.value}
                onChange={(next) =>
                  setRows((prev) =>
                    prev.map((r) => (r.rowId === row.rowId ? { ...r, value: next } : r)),
                  )
                }
              />
              <IconButton
                variant="ghost"
                size="sm"
                label={`Remove header ${i + 1}`}
                icon={<X />}
                onClick={() => setRows((prev) => prev.filter((r) => r.rowId !== row.rowId))}
              />
            </HStack>
          ))}
        </VStack>
      )}
    </VStack>
  );
}

// ─── RulesPanel ───────────────────────────────────────────────────────────────

type RulesPanelProps = {
  prefix: "block" | "allow";
  initial: GeoBlockSettings | null;
  resetKey?: number;
};

function RulesPanel({ prefix, initial, resetKey = 0 }: RulesPanelProps) {
  const cap = prefix === "block" ? "Block" : "Allow";
  const countries =
    prefix === "block" ? (initial?.block_countries ?? []) : (initial?.allow_countries ?? []);
  const continents =
    prefix === "block" ? (initial?.block_continents ?? []) : (initial?.allow_continents ?? []);
  const asns = prefix === "block" ? (initial?.block_asns ?? []) : (initial?.allow_asns ?? []);
  const cidrs = prefix === "block" ? (initial?.block_cidrs ?? []) : (initial?.allow_cidrs ?? []);
  const ips = prefix === "block" ? (initial?.block_ips ?? []) : (initial?.allow_ips ?? []);

  return (
    <VStack gap={6}>
      <CodeMultiSelect
        key={`${prefix}-countries-${resetKey}`}
        name={`geoblock${cap}Countries`}
        label="Countries"
        options={COUNTRY_OPTIONS}
        initialValues={countries}
        searchPlaceholder="Search countries…"
      />

      <Divider />

      <CodeMultiSelect
        key={`${prefix}-continents-${resetKey}`}
        name={`geoblock${cap}Continents`}
        label="Continents"
        options={CONTINENT_OPTIONS}
        initialValues={continents}
      />

      <Divider />

      <TagInput
        key={`${prefix}-asns-${resetKey}`}
        name={`geoblock${cap}Asns`}
        label="ASNs"
        initialValues={asns.map(String)}
        placeholder="13335, 15169…"
        helperText="Autonomous System Numbers — press Enter to add"
        validate={(v) => /^\d+$/.test(v)}
      />

      <Grid columns={2} gap={4}>
        <TagInput
          key={`${prefix}-cidrs-${resetKey}`}
          name={`geoblock${cap}Cidrs`}
          label="CIDRs"
          initialValues={cidrs}
          placeholder="10.0.0.0/8…"
          helperText="Press Enter to add"
        />
        <TagInput
          key={`${prefix}-ips-${resetKey}`}
          name={`geoblock${cap}Ips`}
          label="IP Addresses"
          initialValues={ips}
          placeholder="1.2.3.4…"
          helperText="Press Enter to add"
        />
      </Grid>
    </VStack>
  );
}

// ─── GeoBlockFields ───────────────────────────────────────────────────────────

type GeoBlockFieldsProps = {
  initialValues?: {
    geoblock: GeoBlockSettings | null;
    geoblock_mode: GeoBlockMode;
  };
  showModeSelector?: boolean;
};

const RFC1918_CIDRS = ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"];
const BLOCK_ALL_CIDR = "0.0.0.0/0";

export function GeoBlockFields({ initialValues, showModeSelector = true }: GeoBlockFieldsProps) {
  const rawInitial = initialValues?.geoblock ?? null;
  // Geoblocking is entirely the caddy-blocker plugin. With it switched off the
  // rules would be recorded and then never emitted, so the switch is locked
  // rather than left to look functional.
  const moduleDisabledReason = useDisabledReason("geoblock");
  const [enabled, setEnabled] = useState(rawInitial?.enabled ?? false);
  const [mode, setMode] = useState<GeoBlockMode>(initialValues?.geoblock_mode ?? "merge");
  const [resetKey, setResetKey] = useState(0);
  const [initial, setInitial] = useState<GeoBlockSettings | null>(rawInitial);
  const [activeTab, setActiveTab] = useState("block");

  const [responseStatus, setResponseStatus] = useState<number | null>(
    rawInitial?.response_status ?? 403,
  );
  const [responseBody, setResponseBody] = useState(rawInitial?.response_body ?? "Forbidden");
  const [redirectUrl, setRedirectUrl] = useState(rawInitial?.redirect_url ?? "");
  const [failClosed, setFailClosed] = useState(rawInitial?.fail_closed ?? false);

  const headers = useMemo(() => initial?.response_headers ?? {}, [initial]);

  function applyLanOnlyPreset() {
    setEnabled(true);
    setInitial((prev) => ({
      enabled: true,
      block_countries: prev?.block_countries ?? [],
      block_continents: prev?.block_continents ?? [],
      block_asns: prev?.block_asns ?? [],
      block_cidrs: [BLOCK_ALL_CIDR],
      block_ips: prev?.block_ips ?? [],
      allow_countries: prev?.allow_countries ?? [],
      allow_continents: prev?.allow_continents ?? [],
      allow_asns: prev?.allow_asns ?? [],
      allow_cidrs: RFC1918_CIDRS,
      allow_ips: prev?.allow_ips ?? [],
      trusted_proxies: prev?.trusted_proxies ?? [],
      fail_closed: prev?.fail_closed ?? false,
      response_status: prev?.response_status ?? 403,
      response_body: prev?.response_body ?? "Forbidden",
      response_headers: prev?.response_headers ?? {},
      redirect_url: prev?.redirect_url ?? "",
    }));
    setResetKey((k) => k + 1);
  }

  return (
    <Card>
      <input type="hidden" name="geoblockPresent" value="1" />
      <input type="hidden" name="geoblockMode" value={mode} />

      <VStack gap={4}>
        <HStack justify="between" vAlign="start" gap={2}>
          <HStack gap={3} vAlign="start">
            <Icon icon={Globe} size="md" color="error" />
            <VStack gap={1}>
              <HStack gap={2} vAlign="center" wrap="wrap">
                <Text type="body" size="sm" weight="bold">
                  Geo Blocking
                </Text>
                <GeoIpStatus />
              </HStack>
              <Text type="body" size="sm" color="secondary">
                Block or allow traffic by country, continent, ASN, CIDR, or IP
              </Text>
            </VStack>
          </HStack>
          {/* A disabled control emits no pointer events of its own, so
              ModuleGated wraps it in the tooltip that explains why. */}
          <ModuleGated feature="geoblock">
            <Switch
              label="Enable geo blocking"
              isLabelHidden
              htmlName="geoblockEnabled"
              value={enabled}
              onChange={setEnabled}
              isDisabled={Boolean(moduleDisabledReason)}
            />
          </ModuleGated>
        </HStack>

        {moduleDisabledReason && (
          <Text type="body" size="xsm" color="secondary">
            {moduleDisabledReason}
          </Text>
        )}

        {/* Deliberately NOT gated on moduleDisabledReason. The hidden
            `geoblockPresent` marker above always submits, and the parser treats
            a missing rule input as an empty list — so unmounting these while the
            module is off would silently erase every stored rule on the next
            save of an unrelated field. The Switch above is what stays locked. */}
        {enabled && (
          <VStack gap={4}>
            {showModeSelector && (
              <>
                <SegmentedControl
                  label="Global rule handling"
                  value={mode}
                  onChange={(next) => setMode(next as GeoBlockMode)}
                >
                  <SegmentedControlItem value="merge" label="Merge with global" />
                  <SegmentedControlItem value="override" label="Override global" />
                </SegmentedControl>
                <Divider />
              </>
            )}
            {!showModeSelector && <Divider />}

            <HStack gap={2} vAlign="center">
              <Text type="body" size="xsm" color="secondary">
                Presets:
              </Text>
              <Button
                size="sm"
                variant="secondary"
                label="LAN Only (RFC1918)"
                icon={<Home />}
                onClick={applyLanOnlyPreset}
              />
            </HStack>

            <TabList value={activeTab} onChange={setActiveTab} layout="fill">
              <Tab value="block" label="Block Rules" />
              <Tab value="allow" label="Allow Rules" />
            </TabList>

            {/* Both panels stay mounted and the inactive one is hidden, rather
                than unmounted: each carries the hidden inputs for its side of
                the rules, and dropping them would submit empty values and wipe
                the other tab's configuration. This is what the old markup did
                with forceMount + data-[state=inactive]:hidden. The `hidden`
                attribute is a visibility toggle here, not layout. */}
            <VStack gap={4}>
              <div hidden={activeTab !== "block"}>
                <RulesPanel prefix="block" initial={initial} resetKey={resetKey} />
              </div>
              <div hidden={activeTab !== "allow"}>
                <VStack gap={3}>
                  <Text type="body" size="xsm" color="secondary">
                    Allow rules take precedence over block rules.
                  </Text>
                  <RulesPanel prefix="allow" initial={initial} resetKey={resetKey} />
                </VStack>
              </div>
            </VStack>

            <Collapsible trigger="Trusted Proxies & Block Response">
              <VStack gap={4}>
                <TagInput
                  key={`trusted-proxies-${resetKey}`}
                  name="geoblockTrustedProxies"
                  label="Trusted Proxies"
                  initialValues={initial?.trusted_proxies ?? []}
                  placeholder="private_ranges, 10.0.0.0/8…"
                  helperText="Used to parse X-Forwarded-For. Use private_ranges for all RFC-1918 ranges."
                />

                <CheckboxInput
                  label="Fail closed (block indeterminate IPs)"
                  description="Blocks requests where the real client IP cannot be determined, e.g. behind a trusted proxy with no usable X-Forwarded-For. Default: off (fail-open)."
                  htmlName="geoblockFailClosed"
                  value={failClosed}
                  onChange={setFailClosed}
                />

                <Divider />

                <Grid columns={3} gap={4}>
                  <NumberInput
                    label="Status Code"
                    htmlName="geoblockResponseStatus"
                    min={100}
                    max={599}
                    isIntegerOnly
                    value={responseStatus}
                    onChange={setResponseStatus}
                    description="HTTP status when blocked"
                  />
                  <TextInput
                    label="Response Body"
                    htmlName="geoblockResponseBody"
                    value={responseBody}
                    onChange={setResponseBody}
                    description="Body text returned to blocked clients"
                  />
                  <TextInput
                    label="Redirect URL"
                    htmlName="geoblockRedirectUrl"
                    value={redirectUrl}
                    onChange={setRedirectUrl}
                    placeholder="https://example.com/blocked"
                    description="If set, sends a 302 redirect instead of the status/body above"
                  />
                </Grid>

                <ResponseHeadersEditor key={`headers-${resetKey}`} initialHeaders={headers} />
              </VStack>
            </Collapsible>
          </VStack>
        )}
      </VStack>
    </Card>
  );
}
