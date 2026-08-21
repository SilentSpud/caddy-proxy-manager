"use client";

import { ReactNode, useActionState, useEffect, useState } from "react";
import {
  createL4ProxyHostAction,
  deleteL4ProxyHostAction,
  updateL4ProxyHostAction,
} from "@/app/(dashboard)/l4-proxy-hosts/actions";
import { INITIAL_ACTION_STATE } from "@/lib/actions";
import type { L4ProxyHost } from "@/lib/models/l4-proxy-hosts";
import { AppDialog } from "@/components/ui/AppDialog";
import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { Card } from "@astryxdesign/core/Card";
import { Collapsible } from "@astryxdesign/core/Collapsible";
import { Icon } from "@astryxdesign/core/Icon";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";
import { Selector } from "@astryxdesign/core/Selector";
import { Switch } from "@astryxdesign/core/Switch";
import { Text } from "@astryxdesign/core/Text";
import { TextArea } from "@astryxdesign/core/TextArea";
import { TextInput } from "@astryxdesign/core/TextInput";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { NATIVE_REQUIRED } from "@/components/ui/native-input-attrs";
import { Globe, Layers, MapPin, Pin } from "lucide-react";
import type { LucideIcon } from "lucide-react";

const PROTOCOL_OPTIONS = [
  { value: "tcp", label: "TCP" },
  { value: "udp", label: "UDP" },
];

const MATCHER_OPTIONS = [
  { value: "none", label: "None (catch-all)" },
  { value: "tls_sni", label: "TLS SNI" },
  { value: "http_host", label: "HTTP Host" },
  { value: "proxy_protocol", label: "Proxy Protocol" },
];

const PROXY_PROTOCOL_OPTIONS = [
  { value: "__none__", label: "None" },
  { value: "v1", label: "v1" },
  { value: "v2", label: "v2" },
];

const LB_POLICY_OPTIONS = [
  { value: "random", label: "Random" },
  { value: "round_robin", label: "Round Robin" },
  { value: "least_conn", label: "Least Connections" },
  { value: "ip_hash", label: "IP Hash" },
  { value: "first", label: "First Available" },
];

const GEOBLOCK_MODE_OPTIONS = [
  { value: "merge", label: "Merge with global settings" },
  { value: "override", label: "Override global settings" },
];

const UPSTREAM_DNS_MODE_OPTIONS = [
  { value: "inherit", label: "Inherit from global settings" },
  { value: "enabled", label: "Enabled" },
  { value: "disabled", label: "Disabled" },
];

const UPSTREAM_DNS_FAMILY_OPTIONS = [
  { value: "inherit", label: "Inherit from global settings" },
  { value: "both", label: "Both (IPv6 + IPv4)" },
  { value: "ipv6", label: "IPv6 only" },
  { value: "ipv4", label: "IPv4 only" },
];

/** Collapsible section with an icon in its trigger, replacing the accordions. */
function Section({
  icon,
  title,
  defaultIsOpen,
  children,
}: {
  icon: LucideIcon;
  title: string;
  defaultIsOpen: boolean;
  children: ReactNode;
}) {
  return (
    <Card padding={3}>
      <Collapsible
        defaultIsOpen={defaultIsOpen}
        trigger={
          <HStack gap={2} vAlign="center">
            <Icon icon={icon} size="sm" />
            <Text type="body" size="sm" weight="medium">
              {title}
            </Text>
          </HStack>
        }
      >
        <VStack gap={3}>{children}</VStack>
      </Collapsible>
    </Card>
  );
}

/** Every free-text field in the form, keyed by its form field name. */
type TextFields = {
  name: string;
  listenAddress: string;
  upstreams: string;
  matcherValue: string;
  lbTryDuration: string;
  lbTryInterval: string;
  lbRetries: string;
  lbActiveHealthPort: string;
  lbActiveHealthInterval: string;
  lbActiveHealthTimeout: string;
  lbPassiveHealthFailDuration: string;
  lbPassiveHealthMaxFails: string;
  lbPassiveHealthUnhealthyLatency: string;
  dnsResolvers: string;
  dnsFallbacks: string;
  dnsTimeout: string;
  geoblockBlockCountries: string;
  geoblockBlockContinents: string;
  geoblockBlockAsns: string;
  geoblockBlockCidrs: string;
  geoblockBlockIps: string;
  geoblockAllowCountries: string;
  geoblockAllowContinents: string;
  geoblockAllowAsns: string;
  geoblockAllowCidrs: string;
  geoblockAllowIps: string;
};

function initialText(initialData?: L4ProxyHost | null): TextFields {
  const lb = initialData?.loadBalancer;
  const geo = initialData?.geoblock;
  return {
    name: initialData?.name ?? "",
    listenAddress: initialData?.listenAddress ?? "",
    upstreams: initialData?.upstreams.join("\n") ?? "",
    matcherValue: initialData?.matcherValue?.join(", ") ?? "",
    lbTryDuration: lb?.tryDuration ?? "",
    lbTryInterval: lb?.tryInterval ?? "",
    lbRetries: lb?.retries != null ? String(lb.retries) : "",
    lbActiveHealthPort:
      lb?.activeHealthCheck?.port != null ? String(lb.activeHealthCheck.port) : "",
    lbActiveHealthInterval: lb?.activeHealthCheck?.interval ?? "",
    lbActiveHealthTimeout: lb?.activeHealthCheck?.timeout ?? "",
    lbPassiveHealthFailDuration: lb?.passiveHealthCheck?.failDuration ?? "",
    lbPassiveHealthMaxFails:
      lb?.passiveHealthCheck?.maxFails != null
        ? String(lb.passiveHealthCheck.maxFails)
        : "",
    lbPassiveHealthUnhealthyLatency: lb?.passiveHealthCheck?.unhealthyLatency ?? "",
    dnsResolvers: initialData?.dnsResolver?.resolvers?.join("\n") ?? "",
    dnsFallbacks: initialData?.dnsResolver?.fallbacks?.join("\n") ?? "",
    dnsTimeout: initialData?.dnsResolver?.timeout ?? "",
    geoblockBlockCountries: geo?.block_countries?.join(", ") ?? "",
    geoblockBlockContinents: geo?.block_continents?.join(", ") ?? "",
    geoblockBlockAsns: geo?.block_asns?.join(", ") ?? "",
    geoblockBlockCidrs: geo?.block_cidrs?.join(", ") ?? "",
    geoblockBlockIps: geo?.block_ips?.join(", ") ?? "",
    geoblockAllowCountries: geo?.allow_countries?.join(", ") ?? "",
    geoblockAllowContinents: geo?.allow_continents?.join(", ") ?? "",
    geoblockAllowAsns: geo?.allow_asns?.join(", ") ?? "",
    geoblockAllowCidrs: geo?.allow_cidrs?.join(", ") ?? "",
    geoblockAllowIps: geo?.allow_ips?.join(", ") ?? "",
  };
}

function L4HostForm({
  formId,
  formAction,
  state,
  initialData,
}: {
  formId: string;
  formAction: (formData: FormData) => void;
  state: { status: string; message?: string };
  initialData?: L4ProxyHost | null;
}) {
  const [enabled, setEnabled] = useState(initialData?.enabled ?? true);
  const [protocol, setProtocol] = useState(initialData?.protocol ?? "tcp");
  const [matcherType, setMatcherType] = useState(initialData?.matcherType ?? "none");

  // Astryx inputs are controlled, so every field that used defaultValue now
  // needs seeded state. They are grouped rather than declared one useState at
  // a time, since there are twenty-six of them.
  const [text, setText] = useState<TextFields>(() => initialText(initialData));
  const set = <K extends keyof TextFields>(key: K) => (value: string) =>
    setText((prev) => ({ ...prev, [key]: value }));

  const [tlsTermination, setTlsTermination] = useState(initialData?.tlsTermination ?? false);
  const [proxyProtocolReceive, setProxyProtocolReceive] = useState(
    initialData?.proxyProtocolReceive ?? false
  );
  const [proxyProtocolVersion, setProxyProtocolVersion] = useState<string>(
    initialData?.proxyProtocolVersion ?? "__none__"
  );
  const [lbEnabled, setLbEnabled] = useState(initialData?.loadBalancer?.enabled ?? false);
  const [lbPolicy, setLbPolicy] = useState<string>(
    initialData?.loadBalancer?.policy ?? "random"
  );
  const [lbActiveHealthEnabled, setLbActiveHealthEnabled] = useState(
    initialData?.loadBalancer?.activeHealthCheck?.enabled ?? false
  );
  const [lbPassiveHealthEnabled, setLbPassiveHealthEnabled] = useState(
    initialData?.loadBalancer?.passiveHealthCheck?.enabled ?? false
  );
  const [dnsEnabled, setDnsEnabled] = useState(initialData?.dnsResolver?.enabled ?? false);
  const [geoblockEnabled, setGeoblockEnabled] = useState(initialData?.geoblock?.enabled ?? false);
  const [geoblockMode, setGeoblockMode] = useState<string>(
    initialData?.geoblockMode ?? "merge"
  );
  const [upstreamDnsMode, setUpstreamDnsMode] = useState(
    initialData?.upstreamDnsResolution?.enabled === true
      ? "enabled"
      : initialData?.upstreamDnsResolution?.enabled === false
        ? "disabled"
        : "inherit"
  );
  const [upstreamDnsFamily, setUpstreamDnsFamily] = useState<string>(
    initialData?.upstreamDnsResolution?.family ?? "inherit"
  );

  return (
    <form id={formId} action={formAction}>
      <VStack gap={5}>
        {state.status !== "idle" && state.message && (
          <Banner
            status={state.status === "error" ? "error" : "success"}
            title={state.message}
          />
        )}

        <input type="hidden" name="enabledPresent" value="1" />
        {/* Empty (not "off") when disabled, matching the original: the parser
            treats anything that is not on/true/1 as false. */}
        <input type="hidden" name="enabled" value={enabled ? "on" : ""} />

        <Card variant={enabled ? "muted" : "default"} padding={4}>
          <HStack justify="between" vAlign="center" gap={4}>
            <VStack gap={0}>
              <Text type="body" size="sm" weight="semibold">
                {enabled ? "L4 Host Enabled" : "L4 Host Paused"}
              </Text>
              <Text type="body" size="sm" color="secondary">
                {enabled
                  ? "This host is active and proxying connections"
                  : "This host is disabled and will not accept connections"}
              </Text>
            </VStack>
            <Switch label="Enable this L4 host" isLabelHidden value={enabled} onChange={setEnabled} />
          </HStack>
        </Card>

        <TextInput
          {...NATIVE_REQUIRED}
          label="Name"
          htmlName="name"
          placeholder="PostgreSQL Proxy"
          value={text.name}
          onChange={set("name")}
          isRequired
        />

        <Selector
          label="Protocol"
          htmlName="protocol"
          options={PROTOCOL_OPTIONS}
          value={protocol}
          onChange={(v) => setProtocol(v as "tcp" | "udp")}
        />

        <TextInput
          {...NATIVE_REQUIRED}
          label="Listen Address"
          htmlName="listenAddress"
          placeholder=":5432"
          value={text.listenAddress}
          onChange={set("listenAddress")}
          isRequired
          description="Format: :PORT or HOST:PORT. Make sure to expose this port in docker-compose.yml on the caddy service."
        />

        <TextArea
          {...NATIVE_REQUIRED}
          label="Upstreams"
          htmlName="upstreams"
          placeholder={"10.0.0.1:5432\n10.0.0.2:5432"}
          value={text.upstreams}
          onChange={set("upstreams")}
          rows={2}
          isRequired
          description="One per line in host:port format."
        />

        <Selector
          label="Matcher"
          htmlName="matcherType"
          options={MATCHER_OPTIONS}
          value={matcherType}
          onChange={(v) =>
            setMatcherType(v as "none" | "tls_sni" | "http_host" | "proxy_protocol")
          }
          description="Match incoming connections before proxying. 'None' matches all connections on this port."
        />

        {(matcherType === "tls_sni" || matcherType === "http_host") && (
          <TextInput
            {...NATIVE_REQUIRED}
            label={matcherType === "tls_sni" ? "SNI Hostnames" : "HTTP Hostnames"}
            htmlName="matcherValue"
            placeholder="db.example.com, api.example.com"
            value={text.matcherValue}
            onChange={set("matcherValue")}
            isRequired
            description="Comma-separated list of hostnames to match."
          />
        )}

        {protocol === "tcp" && (
          <Switch
            label="TLS Termination"
            htmlName="tlsTermination"
            value={tlsTermination}
            onChange={setTlsTermination}
          />
        )}

        <Switch
          label="Accept inbound PROXY protocol"
          htmlName="proxyProtocolReceive"
          value={proxyProtocolReceive}
          onChange={setProxyProtocolReceive}
        />

        <Selector
          label="Send PROXY protocol to upstream"
          htmlName="proxyProtocolVersion"
          options={PROXY_PROTOCOL_OPTIONS}
          value={proxyProtocolVersion}
          onChange={setProxyProtocolVersion}
        />

        <Section
          icon={Layers}
          title="Load Balancer"
          defaultIsOpen={initialData?.loadBalancer?.enabled ?? false}
        >
          <input type="hidden" name="lbPresent" value="1" />
          <input type="hidden" name="lbEnabledPresent" value="1" />
          <Switch
            label="Enable Load Balancing"
            htmlName="lbEnabled"
            value={lbEnabled}
            onChange={setLbEnabled}
          />
          <Selector
            label="Policy"
            htmlName="lbPolicy"
            options={LB_POLICY_OPTIONS}
            value={lbPolicy}
            onChange={setLbPolicy}
          />
          <TextInput
            label="Try Duration"
            isOptional
            htmlName="lbTryDuration"
            placeholder="5s"
            value={text.lbTryDuration}
            onChange={set("lbTryDuration")}
          />
          <TextInput
            label="Try Interval"
            isOptional
            htmlName="lbTryInterval"
            placeholder="250ms"
            value={text.lbTryInterval}
            onChange={set("lbTryInterval")}
          />
          <TextInput
            label="Retries"
            isOptional
            htmlName="lbRetries"
            value={text.lbRetries}
            onChange={set("lbRetries")}
          />

          <Text type="label" size="xsm" weight="semibold" color="secondary">
            Active Health Check
          </Text>
          <input type="hidden" name="lbActiveHealthEnabledPresent" value="1" />
          <Switch
            label="Enable Active Health Check"
            htmlName="lbActiveHealthEnabled"
            value={lbActiveHealthEnabled}
            onChange={setLbActiveHealthEnabled}
          />
          <TextInput
            label="Health Check Port"
            isOptional
            htmlName="lbActiveHealthPort"
            value={text.lbActiveHealthPort}
            onChange={set("lbActiveHealthPort")}
          />
          <TextInput
            label="Interval"
            isOptional
            htmlName="lbActiveHealthInterval"
            placeholder="30s"
            value={text.lbActiveHealthInterval}
            onChange={set("lbActiveHealthInterval")}
          />
          <TextInput
            label="Timeout"
            isOptional
            htmlName="lbActiveHealthTimeout"
            placeholder="5s"
            value={text.lbActiveHealthTimeout}
            onChange={set("lbActiveHealthTimeout")}
          />

          <Text type="label" size="xsm" weight="semibold" color="secondary">
            Passive Health Check
          </Text>
          <input type="hidden" name="lbPassiveHealthEnabledPresent" value="1" />
          <Switch
            label="Enable Passive Health Check"
            htmlName="lbPassiveHealthEnabled"
            value={lbPassiveHealthEnabled}
            onChange={setLbPassiveHealthEnabled}
          />
          <TextInput
            label="Fail Duration"
            isOptional
            htmlName="lbPassiveHealthFailDuration"
            placeholder="30s"
            value={text.lbPassiveHealthFailDuration}
            onChange={set("lbPassiveHealthFailDuration")}
          />
          <TextInput
            label="Max Fails"
            isOptional
            htmlName="lbPassiveHealthMaxFails"
            value={text.lbPassiveHealthMaxFails}
            onChange={set("lbPassiveHealthMaxFails")}
          />
          <TextInput
            label="Unhealthy Latency"
            isOptional
            htmlName="lbPassiveHealthUnhealthyLatency"
            placeholder="5s"
            value={text.lbPassiveHealthUnhealthyLatency}
            onChange={set("lbPassiveHealthUnhealthyLatency")}
          />
        </Section>

        <Section
          icon={Globe}
          title="Custom DNS Resolvers"
          defaultIsOpen={initialData?.dnsResolver?.enabled ?? false}
        >
          <input type="hidden" name="dnsPresent" value="1" />
          <input type="hidden" name="dnsEnabledPresent" value="1" />
          <Switch
            label="Enable Custom DNS"
            htmlName="dnsEnabled"
            value={dnsEnabled}
            onChange={setDnsEnabled}
          />
          <TextArea
            label="DNS Resolvers"
            isOptional
            htmlName="dnsResolvers"
            placeholder={"1.1.1.1\n8.8.8.8"}
            value={text.dnsResolvers}
            onChange={set("dnsResolvers")}
            rows={2}
            description="One per line. Used for upstream hostname resolution."
          />
          <TextArea
            label="Fallback Resolvers"
            isOptional
            htmlName="dnsFallbacks"
            placeholder="8.8.4.4"
            value={text.dnsFallbacks}
            onChange={set("dnsFallbacks")}
            rows={1}
            description="Fallback DNS servers (one per line)."
          />
          <TextInput
            label="Timeout"
            isOptional
            htmlName="dnsTimeout"
            placeholder="5s"
            value={text.dnsTimeout}
            onChange={set("dnsTimeout")}
          />
        </Section>

        <Section
          icon={MapPin}
          title="Geo Blocking"
          defaultIsOpen={initialData?.geoblock?.enabled ?? false}
        >
          <input type="hidden" name="geoblockPresent" value="1" />
          <Switch
            label="Enable Geo Blocking"
            htmlName="geoblockEnabled"
            value={geoblockEnabled}
            onChange={setGeoblockEnabled}
          />
          <Selector
            label="Mode"
            htmlName="geoblockMode"
            options={GEOBLOCK_MODE_OPTIONS}
            value={geoblockMode}
            onChange={setGeoblockMode}
          />

          <Text type="label" size="xsm" weight="semibold" color="secondary">
            Block Rules
          </Text>
          <TextInput
            label="Block Countries"
            isOptional
            htmlName="geoblockBlockCountries"
            placeholder="CN, RU, KP"
            value={text.geoblockBlockCountries}
            onChange={set("geoblockBlockCountries")}
            description="ISO 3166-1 alpha-2 codes, comma-separated"
          />
          <TextInput
            label="Block Continents"
            isOptional
            htmlName="geoblockBlockContinents"
            placeholder="AF, AS"
            value={text.geoblockBlockContinents}
            onChange={set("geoblockBlockContinents")}
            description="AF, AN, AS, EU, NA, OC, SA"
          />
          <TextInput
            label="Block ASNs"
            isOptional
            htmlName="geoblockBlockAsns"
            placeholder="12345, 67890"
            value={text.geoblockBlockAsns}
            onChange={set("geoblockBlockAsns")}
          />
          <TextInput
            label="Block CIDRs"
            isOptional
            htmlName="geoblockBlockCidrs"
            placeholder="192.0.2.0/24"
            value={text.geoblockBlockCidrs}
            onChange={set("geoblockBlockCidrs")}
          />
          <TextInput
            label="Block IPs"
            isOptional
            htmlName="geoblockBlockIps"
            placeholder="203.0.113.1"
            value={text.geoblockBlockIps}
            onChange={set("geoblockBlockIps")}
          />

          <Text type="label" size="xsm" weight="semibold" color="secondary">
            Allow Rules (override blocks)
          </Text>
          <TextInput
            label="Allow Countries"
            isOptional
            htmlName="geoblockAllowCountries"
            placeholder="US, DE"
            value={text.geoblockAllowCountries}
            onChange={set("geoblockAllowCountries")}
          />
          <TextInput
            label="Allow Continents"
            isOptional
            htmlName="geoblockAllowContinents"
            placeholder="EU, NA"
            value={text.geoblockAllowContinents}
            onChange={set("geoblockAllowContinents")}
          />
          <TextInput
            label="Allow ASNs"
            isOptional
            htmlName="geoblockAllowAsns"
            placeholder="11111"
            value={text.geoblockAllowAsns}
            onChange={set("geoblockAllowAsns")}
          />
          <TextInput
            label="Allow CIDRs"
            isOptional
            htmlName="geoblockAllowCidrs"
            placeholder="10.0.0.0/8"
            value={text.geoblockAllowCidrs}
            onChange={set("geoblockAllowCidrs")}
          />
          <TextInput
            label="Allow IPs"
            isOptional
            htmlName="geoblockAllowIps"
            placeholder="1.2.3.4"
            value={text.geoblockAllowIps}
            onChange={set("geoblockAllowIps")}
          />

          <Banner
            status="info"
            title="Geo blocking uses the client's direct IP at L4"
            description="There is no X-Forwarded-For support here. Blocked connections are immediately closed."
          />
        </Section>

        <Section
          icon={Pin}
          title="Upstream DNS Pinning"
          defaultIsOpen={initialData?.upstreamDnsResolution?.enabled === true}
        >
          <input type="hidden" name="upstreamDnsResolutionPresent" value="1" />
          <Text type="body" size="sm" color="secondary">
            When enabled, upstream hostnames are resolved to IP addresses at config time, pinning
            DNS resolution.
          </Text>
          <Selector
            label="Resolution Mode"
            htmlName="upstreamDnsResolutionMode"
            options={UPSTREAM_DNS_MODE_OPTIONS}
            value={upstreamDnsMode}
            onChange={setUpstreamDnsMode}
          />
          <Selector
            label="Address Family Preference"
            htmlName="upstreamDnsResolutionFamily"
            options={UPSTREAM_DNS_FAMILY_OPTIONS}
            value={upstreamDnsFamily}
            onChange={setUpstreamDnsFamily}
          />
        </Section>
      </VStack>
    </form>
  );
}

export function CreateL4HostDialog({
  open,
  onClose,
  initialData,
}: {
  open: boolean;
  onClose: () => void;
  initialData?: L4ProxyHost | null;
}) {
  const [state, formAction] = useActionState(
    createL4ProxyHostAction,
    INITIAL_ACTION_STATE
  );

  useEffect(() => {
    if (state.status === "success") {
      setTimeout(onClose, 1000);
    }
  }, [state.status, onClose]);

  return (
    <AppDialog
      open={open}
      onClose={onClose}
      title={initialData ? "Duplicate L4 Proxy Host" : "Create L4 Proxy Host"}
      maxWidth="lg"
      submitLabel="Create"
      onSubmit={() => {
        (
          document.getElementById("create-l4-host-form") as HTMLFormElement
        )?.requestSubmit();
      }}
    >
      <L4HostForm
        formId="create-l4-host-form"
        formAction={formAction}
        state={state}
        initialData={
          initialData ? { ...initialData, name: `${initialData.name} (Copy)` } : null
        }
      />
    </AppDialog>
  );
}

export function EditL4HostDialog({
  open,
  host,
  onClose,
}: {
  open: boolean;
  host: L4ProxyHost;
  onClose: () => void;
}) {
  const [state, formAction] = useActionState(
    updateL4ProxyHostAction.bind(null, host.id),
    INITIAL_ACTION_STATE
  );

  useEffect(() => {
    if (state.status === "success") {
      setTimeout(onClose, 1000);
    }
  }, [state.status, onClose]);

  return (
    <AppDialog
      open={open}
      onClose={onClose}
      title="Edit L4 Proxy Host"
      maxWidth="lg"
      submitLabel="Save Changes"
      onSubmit={() => {
        (
          document.getElementById("edit-l4-host-form") as HTMLFormElement
        )?.requestSubmit();
      }}
    >
      <L4HostForm
        formId="edit-l4-host-form"
        formAction={formAction}
        state={state}
        initialData={host}
      />
    </AppDialog>
  );
}

export function DeleteL4HostDialog({
  open,
  host,
  onClose,
}: {
  open: boolean;
  host: L4ProxyHost;
  onClose: () => void;
}) {
  const [state, formAction] = useActionState(
    deleteL4ProxyHostAction.bind(null, host.id),
    INITIAL_ACTION_STATE
  );

  useEffect(() => {
    if (state.status === "success") {
      setTimeout(onClose, 1000);
    }
  }, [state.status, onClose]);

  return (
    <AppDialog
      open={open}
      onClose={onClose}
      title="Delete L4 Proxy Host"
      maxWidth="lg"
      submitLabel="Delete"
      onSubmit={() => {
        (
          document.getElementById("delete-l4-host-form") as HTMLFormElement
        )?.requestSubmit();
      }}
    >
      <form id="delete-l4-host-form" action={formAction}>
        <VStack gap={4}>
          {state.status !== "idle" && state.message && (
            <Banner
              status={state.status === "error" ? "error" : "success"}
              title={state.message}
            />
          )}
          <Text type="body" size="sm">
            Are you sure you want to delete the L4 proxy host <strong>{host.name}</strong>?
          </Text>
          <Card variant="muted" padding={3}>
            <MetadataList>
              <MetadataListItem label="Protocol">
                <Badge
                  variant={host.protocol === "tcp" ? "info" : "warning"}
                  label={host.protocol.toUpperCase()}
                />
              </MetadataListItem>
              <MetadataListItem label="Listen">
                <Text type="code" size="xsm">
                  {host.listenAddress}
                </Text>
              </MetadataListItem>
              <MetadataListItem label="Upstreams">
                <Text type="code" size="xsm">
                  {host.upstreams.join(", ")}
                </Text>
              </MetadataListItem>
            </MetadataList>
          </Card>
          <Text type="body" size="sm" weight="medium">
            This action cannot be undone.
          </Text>
        </VStack>
      </form>
    </AppDialog>
  );
}
