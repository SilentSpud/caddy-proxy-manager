"use client";

import { useState, useActionState, useEffect, type ReactNode } from "react";
import {
  Cloud,
  Globe,
  Pin,
  Activity,
  ScrollText,
  Settings2,
  UserCheck,
  MapPin,
  KeyRound,
  Search,
  FileWarning,
  ShieldCheck,
  Waypoints,
  UserCircle,
  Package,
  Server,
  Cpu,
  BarChart2,
  Globe2,
  Image,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Badge } from "@astryxdesign/core/Badge";
import { Breadcrumbs, BreadcrumbItem } from "@astryxdesign/core/Breadcrumbs";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Code } from "@astryxdesign/core/Code";
import { CommandPalette } from "@astryxdesign/core/CommandPalette";
import { Heading } from "@astryxdesign/core/Heading";
import { Kbd } from "@astryxdesign/core/Kbd";
import { Layout, LayoutContent, LayoutPanel } from "@astryxdesign/core/Layout";
import { Link } from "@astryxdesign/core/Link";
import { NumberInput } from "@astryxdesign/core/NumberInput";
import { Selector } from "@astryxdesign/core/Selector";
import {
  FormCard,
  InfoAlert,
  SaveButton,
  StatusAlert,
  WarnAlert,
} from "@/src/components/ui/FormLayout";
import { SideNav, SideNavItem, SideNavSection } from "@astryxdesign/core/SideNav";
import { Text } from "@astryxdesign/core/Text";
import { TextArea } from "@astryxdesign/core/TextArea";
import { TextInput } from "@astryxdesign/core/TextInput";
import { createStaticSource } from "@astryxdesign/core/Typeahead/utils";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import {
  AUTOFILL_NEW_PASSWORD,
  AUTOFILL_OFF,
  NATIVE_REQUIRED,
} from "@/components/ui/native-input-attrs";
import type {
  GeneralSettings,
  AcmeSettings,
  AuthentikSettings,
  MetricsSettings,
  LoggingSettings,
  DnsSettings,
  UpstreamDnsResolutionSettings,
  GeoBlockSettings,
  ErrorPagesSettings,
  TrustedProxiesSettings,
  DefaultResponseSettings,
} from "@/lib/settings";
import type { DnsProviderApiStatus, DnsProviderDefinition } from "@/src/lib/dns-providers";
import type { CaddyBuildSettings } from "@/lib/settings";
import type { AnalyticsView, GeoipView } from "@/src/lib/settings/optional-features";
import { CaddyBuildFields } from "@/components/caddy-modules/CaddyBuildFields";
import { dnsModuleId } from "@/src/lib/caddy-modules";
import { useModuleGate } from "@/components/caddy-modules/ModuleGate";
import { GeoBlockFields } from "@/components/proxy-hosts/GeoBlockFields";
import { ErrorPagesFields } from "@/components/proxy-hosts/ErrorPagesFields";
import { useMediaQuery } from "@astryxdesign/core/hooks";
import OAuthProvidersSection from "./OAuthProvidersSection";
import { CheckboxInput } from "@/src/components/ui/FormBooleanControls";
import type { OAuthProviderView } from "@/src/lib/oauth-provider-view";
import type { AgentStatus } from "@cpm/shared";
import type { AgentResult } from "@/src/lib/agent/client";
import type { PairedAgent } from "@/src/lib/models/agents";
import {
  updateDnsProviderSettingsAction,
  updateGeneralSettingsAction,
  updateAcmeSettingsAction,
  updateAuthentikSettingsAction,
  updateMetricsSettingsAction,
  updateAnalyticsSettingsAction,
  updateGeoipSettingsAction,
  updateAvatarSettingsAction,
  updateFaviconAction,
  updatePasswordPolicySettingsAction,
  updateLoggingSettingsAction,
  updateDnsSettingsAction,
  updateUpstreamDnsResolutionSettingsAction,
  updateGeoBlockSettingsAction,
  updateErrorPagesSettingsAction,
  updateTrustedProxiesSettingsAction,
  updateCaddyBuildSettingsAction,
  updateDefaultResponseSettingsAction,
  pairAgentAction,
  unpairAgentAction,
} from "./actions";

// ─── Settings navigation catalog ─────────────────────────────────────────────

type SettingItem = {
  id: string;
  name: string;
  desc: string;
  icon: LucideIcon;
};

type SettingsGroup = {
  id: string;
  label: string;
  items: SettingItem[];
};

const SETTINGS_GROUPS: SettingsGroup[] = [
  {
    id: "system",
    label: "System",
    items: [
      {
        id: "general",
        name: "General",
        desc: "Primary domain and ACME contact email",
        icon: Settings2,
      },
      {
        id: "acme",
        name: "ACME Server",
        desc: "Custom ACME directory URL for internal CAs",
        icon: ShieldCheck,
      },
      {
        id: "default-response",
        name: "Default Response",
        desc: "Handle requests for unknown hosts and direct IP access",
        icon: Server,
      },
      {
        id: "avatars",
        name: "User Avatars",
        desc: "Gravatar fallback for users without an icon",
        icon: UserCircle,
      },
      {
        id: "branding",
        name: "Branding",
        desc: "The favicon browsers show for this instance",
        icon: Image,
      },
      {
        id: "caddy-build",
        name: "Caddy Build",
        desc: "Which plugins the Caddy image is compiled with",
        icon: Package,
      },
      {
        id: "agent",
        name: "Agent",
        desc: "The service that recreates and rebuilds the Caddy container",
        icon: Cpu,
      },
    ],
  },
  {
    id: "networking",
    label: "Networking",
    items: [
      {
        id: "dns-providers",
        name: "DNS Providers",
        desc: "Provider credentials for ACME DNS-01",
        icon: Cloud,
      },
      {
        id: "dns-resolvers",
        name: "DNS Resolvers",
        desc: "Custom resolvers for challenge verification",
        icon: Globe,
      },
      {
        id: "upstream-dns",
        name: "Upstream DNS Pinning",
        desc: "Pin upstream IPs at config-apply time",
        icon: Pin,
      },
      {
        id: "trusted-proxies",
        name: "Trusted Proxies",
        desc: "Resolve real client IP behind an upstream proxy",
        icon: Waypoints,
      },
    ],
  },
  {
    id: "security",
    label: "Security",
    items: [
      {
        id: "geoip",
        name: "GeoIP Databases",
        desc: "MaxMind subscription and whether country lookups run at all",
        icon: Globe2,
      },
      {
        id: "geoblock",
        name: "Global Geoblocking",
        desc: "Default geoblock rules across all hosts",
        icon: MapPin,
      },
      {
        id: "error-pages",
        name: "Error Pages",
        desc: "Global custom error responses (fallback for all hosts)",
        icon: FileWarning,
      },
      {
        id: "authentik",
        name: "Authentik Defaults",
        desc: "Forward-auth defaults for new proxy hosts",
        icon: UserCheck,
      },
      { id: "oauth", name: "OAuth Providers", desc: "OAuth/OIDC SSO providers", icon: KeyRound },
      {
        id: "password-policy",
        name: "Password Policy",
        desc: "Migrate users off older password hashes",
        icon: KeyRound,
      },
    ],
  },
  {
    id: "observability",
    label: "Observability",
    items: [
      {
        id: "analytics",
        name: "Analytics",
        desc: "Traffic and WAF event collection, and the ClickHouse it writes to",
        icon: BarChart2,
      },
      {
        id: "metrics",
        name: "Metrics & Monitoring",
        desc: "Prometheus metrics endpoint",
        icon: Activity,
      },
      {
        id: "logging",
        name: "Access Logging",
        desc: "HTTP access log for proxied requests",
        icon: ScrollText,
      },
    ],
  },
];

const ALL_ITEMS = SETTINGS_GROUPS.flatMap((g) =>
  g.items.map((i) => ({ ...i, groupId: g.id, groupLabel: g.label })),
);

function findItem(id: string) {
  return ALL_ITEMS.find((i) => i.id === id);
}

// ─── Layout primitives ───────────────────────────────────────────────────────

// ─── Cmd-K Palette ───────────────────────────────────────────────────────────

type PaletteItem = {
  id: string;
  label: string;
  auxiliaryData: { desc: string; group: string };
};

const PALETTE_ITEMS: PaletteItem[] = ALL_ITEMS.map((item) => ({
  id: item.id,
  label: item.name,
  auxiliaryData: { desc: item.desc, group: item.groupLabel },
}));

// Keywords let a search match a setting's description or its group, as the old CommandItem
// `value` string concatenation did.
const PALETTE_SOURCE = createStaticSource(PALETTE_ITEMS, {
  keywords: (item) => [item.auxiliaryData.desc, item.auxiliaryData.group],
});

function SettingsCmdK({
  open,
  onOpenChange,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (id: string) => void;
}) {
  return (
    <CommandPalette
      isOpen={open}
      onOpenChange={onOpenChange}
      label="Jump to a setting"
      searchSource={PALETTE_SOURCE}
      emptySearchText="No settings match your search."
      onValueChange={(id) => {
        onSelect(id);
        onOpenChange(false);
      }}
      renderItem={(item) => (
        <VStack gap={0}>
          <Text type="body" size="sm" weight="medium">
            {item.label}
          </Text>
          <Text type="body" size="xsm" color="secondary" maxLines={1}>
            {item.auxiliaryData.desc}
          </Text>
        </VStack>
      )}
    />
  );
}

// ─── Settings navigation ─────────────────────────────────────────────────────

function SettingsSidebar({
  active,
  onSelect,
  onSearchClick,
}: {
  active: string;
  onSelect: (id: string) => void;
  onSearchClick: () => void;
}) {
  return (
    <VStack gap={2} padding={3}>
      <Button
        variant="secondary"
        size="sm"
        width="100%"
        icon={<Search />}
        label="Jump to setting..."
        endContent={<Kbd keys="mod+K" />}
        onClick={onSearchClick}
      />
      <SideNav>
        {SETTINGS_GROUPS.map((group) => (
          <SideNavSection key={group.id} title={group.label}>
            {group.items.map((item) => (
              <SideNavItem
                key={item.id}
                label={item.name}
                icon={<item.icon />}
                isSelected={item.id === active}
                onClick={() => onSelect(item.id)}
              />
            ))}
          </SideNavSection>
        ))}
      </SideNav>
    </VStack>
  );
}

/** Narrow-screen navigation: a select naming the current section, replacing a strip of pills. */
function MobileSettingsNav({
  active,
  onSelect,
  onSearchClick,
}: {
  active: string;
  onSelect: (id: string) => void;
  onSearchClick: () => void;
}) {
  return (
    <VStack gap={2} data-testid="mobile-settings-nav">
      <Button
        variant="secondary"
        size="sm"
        width="100%"
        icon={<Search />}
        label="Jump to setting..."
        onClick={onSearchClick}
      />
      <Selector
        label="Settings section"
        isLabelHidden
        value={active}
        onChange={onSelect}
        options={SETTINGS_GROUPS.map((group) => ({
          type: "section" as const,
          title: group.label,
          options: group.items.map((item) => ({ value: item.id, label: item.name })),
        }))}
      />
    </VStack>
  );
}

// ─── Detail header ───────────────────────────────────────────────────────────

function DetailHeader({ activeId }: { activeId: string }) {
  const item = findItem(activeId);
  if (!item) return null;
  return (
    <VStack gap={1}>
      <div data-testid="settings-breadcrumb">
        <Breadcrumbs>
          <BreadcrumbItem>Settings</BreadcrumbItem>
          <BreadcrumbItem isCurrent>{item.groupLabel}</BreadcrumbItem>
        </Breadcrumbs>
      </div>
      <Heading level={1}>{item.name}</Heading>
      <Text type="body" size="sm" color="secondary">
        {item.desc}
      </Text>
    </VStack>
  );
}

// ─── Props ───────────────────────────────────────────────────────────────────

type Props = {
  general: GeneralSettings | null;
  acme: AcmeSettings | null;
  dnsProvider: DnsProviderApiStatus | null;
  dnsProviderDefinitions: DnsProviderDefinition[];
  authentik: AuthentikSettings | null;
  metrics: MetricsSettings | null;
  logging: LoggingSettings | null;
  dns: DnsSettings | null;
  upstreamDnsResolution: UpstreamDnsResolutionSettings | null;
  trustedProxies: TrustedProxiesSettings | null;
  defaultResponse: DefaultResponseSettings | null;
  globalGeoBlock?: GeoBlockSettings | null;
  globalErrorPages?: ErrorPagesSettings | null;
  oauthProviders: OAuthProviderView[];
  localUsersDisabled: boolean;
  avatars: { gravatarEnabled: boolean; fromEnv: boolean };
  passwordPolicy: { requireChangeOnLegacyHash: boolean; fromEnv: boolean };
  caddyBuild: CaddyBuildSettings | null;
  /** Whether a custom favicon is stored. The bytes are served by its route, never sent here. */
  hasFavicon: boolean;
  analytics: AnalyticsView;
  geoip: GeoipView;
  /** Whether any agent is answering, and can therefore start or stop the optional containers. */
  canManageServices: boolean;
  baseUrl: string;
  agents: {
    /** Agents paired over the network. Empty on a single-host deployment, which uses the socket. */
    paired: PairedAgent[];
    /** What each agent reports, per agent, so one unreachable host is visible as itself. */
    statuses: AgentResult<AgentStatus>[];
  };
};

// ─── Component ───────────────────────────────────────────────────────────────

export default function SettingsClient({
  general,
  acme,
  dnsProvider,
  dnsProviderDefinitions,
  authentik,
  metrics,
  logging,
  dns,
  upstreamDnsResolution,
  trustedProxies,
  defaultResponse,
  globalGeoBlock,
  globalErrorPages,
  oauthProviders,
  localUsersDisabled,
  avatars,
  passwordPolicy,
  caddyBuild,
  hasFavicon,
  analytics,
  geoip,
  canManageServices,
  baseUrl,
  agents,
}: Props) {
  const [active, setActive] = useState("general");
  const [cmdkOpen, setCmdkOpen] = useState(false);

  // Cmd-K keyboard shortcut
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmdkOpen(true);
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Form action states
  const [generalState, generalFormAction] = useActionState(updateGeneralSettingsAction, null);
  const [acmeState, acmeFormAction] = useActionState(updateAcmeSettingsAction, null);
  const [caddyBuildState, caddyBuildFormAction] = useActionState(
    updateCaddyBuildSettingsAction,
    null,
  );
  const [dnsProviderState, dnsProviderFormAction] = useActionState(
    updateDnsProviderSettingsAction,
    null,
  );
  const [selectedProvider, setSelectedProvider] = useState("none");
  const configuredProviders = dnsProvider?.providers ? Object.keys(dnsProvider.providers) : [];
  const [authentikState, authentikFormAction] = useActionState(updateAuthentikSettingsAction, null);
  const [metricsState, metricsFormAction] = useActionState(updateMetricsSettingsAction, null);
  const [analyticsState, analyticsFormAction] = useActionState(updateAnalyticsSettingsAction, null);
  const [geoipState, geoipFormAction] = useActionState(updateGeoipSettingsAction, null);
  const [avatarsState, avatarsFormAction] = useActionState(updateAvatarSettingsAction, null);
  const [faviconState, faviconFormAction] = useActionState(updateFaviconAction, null);
  const [passwordPolicyState, passwordPolicyFormAction] = useActionState(
    updatePasswordPolicySettingsAction,
    null,
  );
  const [loggingState, loggingFormAction] = useActionState(updateLoggingSettingsAction, null);
  const [dnsState, dnsFormAction] = useActionState(updateDnsSettingsAction, null);
  const [upstreamDnsResolutionState, upstreamDnsResolutionFormAction] = useActionState(
    updateUpstreamDnsResolutionSettingsAction,
    null,
  );
  const [geoBlockState, geoBlockFormAction] = useActionState(updateGeoBlockSettingsAction, null);
  const [errorPagesState, errorPagesFormAction] = useActionState(
    updateErrorPagesSettingsAction,
    null,
  );
  const [trustedProxiesState, trustedProxiesFormAction] = useActionState(
    updateTrustedProxiesSettingsAction,
    null,
  );
  const [defaultResponseState, defaultResponseFormAction] = useActionState(
    updateDefaultResponseSettingsAction,
    null,
  );
  const [pairState, pairFormAction] = useActionState(pairAgentAction, null);

  // The page has two navigations — the sidebar panel and the compact picker in the content column
  // — and neither carried a media gate, so both rendered at every width. Same breakpoint DataTable
  // uses for its card layout.
  const isNarrow = useMediaQuery("(max-width: 767px)");

  return (
    <>
      <Layout
        height="fill"
        start={
          isNarrow ? undefined : (
            <LayoutPanel width={260} hasDivider role="navigation" label="Settings navigation">
              <SettingsSidebar
                active={active}
                onSelect={setActive}
                onSearchClick={() => setCmdkOpen(true)}
              />
            </LayoutPanel>
          )
        }
        content={
          <LayoutContent padding={5}>
            <VStack gap={5} maxWidth={768}>
              <DetailHeader activeId={active} />

              {isNarrow && (
                <MobileSettingsNav
                  active={active}
                  onSelect={setActive}
                  onSearchClick={() => setCmdkOpen(true)}
                />
              )}

              <VStack gap={4}>
                {active === "general" && (
                  <GeneralSection
                    general={general}
                    generalState={generalState}
                    generalFormAction={generalFormAction}
                  />
                )}
                {active === "acme" && (
                  <AcmeSection acme={acme} acmeState={acmeState} acmeFormAction={acmeFormAction} />
                )}
                {active === "default-response" && (
                  <DefaultResponseSection
                    defaultResponse={defaultResponse}
                    defaultResponseState={defaultResponseState}
                    defaultResponseFormAction={defaultResponseFormAction}
                  />
                )}
                {active === "dns-providers" && (
                  <DnsProvidersSection
                    dnsProvider={dnsProvider}
                    dnsProviderDefinitions={dnsProviderDefinitions}
                    dnsProviderState={dnsProviderState}
                    dnsProviderFormAction={dnsProviderFormAction}
                    selectedProvider={selectedProvider}
                    setSelectedProvider={setSelectedProvider}
                    configuredProviders={configuredProviders}
                  />
                )}
                {active === "dns-resolvers" && (
                  <DnsResolversSection
                    dns={dns}
                    dnsState={dnsState}
                    dnsFormAction={dnsFormAction}
                  />
                )}
                {active === "upstream-dns" && (
                  <UpstreamDnsSection
                    upstreamDnsResolution={upstreamDnsResolution}
                    upstreamDnsResolutionState={upstreamDnsResolutionState}
                    upstreamDnsResolutionFormAction={upstreamDnsResolutionFormAction}
                  />
                )}
                {active === "trusted-proxies" && (
                  <TrustedProxiesSection
                    trustedProxies={trustedProxies}
                    trustedProxiesState={trustedProxiesState}
                    trustedProxiesFormAction={trustedProxiesFormAction}
                  />
                )}
                {active === "geoblock" && (
                  <GeoBlockSection
                    globalGeoBlock={globalGeoBlock}
                    geoBlockState={geoBlockState}
                    geoBlockFormAction={geoBlockFormAction}
                  />
                )}
                {active === "error-pages" && (
                  <ErrorPagesSection
                    globalErrorPages={globalErrorPages}
                    errorPagesState={errorPagesState}
                    errorPagesFormAction={errorPagesFormAction}
                  />
                )}
                {active === "authentik" && (
                  <AuthentikSection
                    authentik={authentik}
                    authentikState={authentikState}
                    authentikFormAction={authentikFormAction}
                  />
                )}
                {active === "oauth" && (
                  <OAuthSection
                    oauthProviders={oauthProviders}
                    localUsersDisabled={localUsersDisabled}
                    baseUrl={baseUrl}
                  />
                )}
                {active === "password-policy" && (
                  <PasswordPolicySection
                    passwordPolicy={passwordPolicy}
                    passwordPolicyState={passwordPolicyState}
                    passwordPolicyFormAction={passwordPolicyFormAction}
                  />
                )}
                {active === "avatars" && (
                  <AvatarsSection
                    avatars={avatars}
                    avatarsState={avatarsState}
                    avatarsFormAction={avatarsFormAction}
                  />
                )}
                {active === "branding" && (
                  <BrandingSection
                    hasFavicon={hasFavicon}
                    faviconState={faviconState}
                    faviconFormAction={faviconFormAction}
                  />
                )}
                {active === "caddy-build" && (
                  <CaddyBuildSection
                    caddyBuild={caddyBuild}
                    caddyBuildState={caddyBuildState}
                    caddyBuildFormAction={caddyBuildFormAction}
                  />
                )}
                {active === "agent" && (
                  <AgentSection
                    agents={agents}
                    pairState={pairState}
                    pairFormAction={pairFormAction}
                  />
                )}
                {active === "analytics" && (
                  <AnalyticsSection
                    analytics={analytics}
                    canManageServices={canManageServices}
                    analyticsState={analyticsState}
                    analyticsFormAction={analyticsFormAction}
                  />
                )}
                {active === "geoip" && (
                  <GeoipSection
                    geoip={geoip}
                    canManageServices={canManageServices}
                    geoipState={geoipState}
                    geoipFormAction={geoipFormAction}
                  />
                )}
                {active === "metrics" && (
                  <MetricsSection
                    metrics={metrics}
                    metricsState={metricsState}
                    metricsFormAction={metricsFormAction}
                  />
                )}
                {active === "logging" && (
                  <LoggingSection
                    logging={logging}
                    loggingState={loggingState}
                    loggingFormAction={loggingFormAction}
                  />
                )}
              </VStack>
            </VStack>
          </LayoutContent>
        }
      />

      <SettingsCmdK open={cmdkOpen} onOpenChange={setCmdkOpen} onSelect={setActive} />
    </>
  );
}

// ─── Section: General ────────────────────────────────────────────────────────

function GeneralSection({
  general,
  generalState,
  generalFormAction,
}: {
  general: GeneralSettings | null;
  generalState: { success: boolean; message?: string } | null;
  generalFormAction: (payload: FormData) => void;
}) {
  const [primaryDomain, setPrimaryDomain] = useState(
    general?.primaryDomain ?? "caddyproxymanager.com",
  );
  const [acmeEmail, setAcmeEmail] = useState(general?.acmeEmail ?? "");

  return (
    <FormCard title="Defaults">
      <form action={generalFormAction}>
        <VStack gap={3}>
          {generalState?.message && (
            <StatusAlert message={generalState.message} success={generalState.success} />
          )}
          <TextInput
            {...NATIVE_REQUIRED}
            label="Primary domain"
            description="Default domain shown when creating new proxy hosts."
            htmlName="primaryDomain"
            value={primaryDomain}
            onChange={setPrimaryDomain}
            isRequired
          />
          <TextInput
            label="ACME contact email"
            description="Used by Let's Encrypt for expiry notifications."
            type="email"
            htmlName="acmeEmail"
            value={acmeEmail}
            onChange={setAcmeEmail}
          />
          <SaveButton label="Save general settings" />
        </VStack>
      </form>
    </FormCard>
  );
}

// ─── Section: Default Response ──────────────────────────────────────────────

const DEFAULT_RESPONSE_MODES = [
  { value: "caddy", label: "Caddy native behavior" },
  { value: "respond", label: "Custom HTTP response" },
  { value: "redirect", label: "Redirect" },
  { value: "abort", label: "No response (abort connection)" },
];

const REDIRECT_STATUS_OPTIONS = [
  { value: "301", label: "301 Permanent" },
  { value: "302", label: "302 Temporary" },
  { value: "303", label: "303 See Other" },
  { value: "307", label: "307 Temporary" },
  { value: "308", label: "308 Permanent" },
];

function DefaultResponseSection({
  defaultResponse,
  defaultResponseState,
  defaultResponseFormAction,
}: {
  defaultResponse: DefaultResponseSettings | null;
  defaultResponseState: { success: boolean; message?: string } | null;
  defaultResponseFormAction: (payload: FormData) => void;
}) {
  const [mode, setMode] = useState<DefaultResponseSettings["mode"]>(
    defaultResponse?.mode ?? "caddy",
  );
  const [status, setStatus] = useState<number | null>(
    defaultResponse?.mode === "respond" ? (defaultResponse.status ?? 404) : 404,
  );
  const [redirectStatus, setRedirectStatus] = useState(
    String(defaultResponse?.mode === "redirect" ? (defaultResponse.status ?? 302) : 302),
  );
  const [body, setBody] = useState(
    defaultResponse?.mode === "respond" ? (defaultResponse.body ?? "") : "",
  );
  const [redirectUrl, setRedirectUrl] = useState(
    defaultResponse?.mode === "redirect" ? (defaultResponse.redirectUrl ?? "") : "",
  );
  const storedHeaders = Object.entries(defaultResponse?.headers ?? {})
    .map(([name, value]) => `${name}: ${value}`)
    .join("\n");
  // Headers only carry over when the stored mode is the one being edited; switching modes starts
  // from that mode's sensible default rather than the other mode's headers.
  const [headers, setHeaders] = useState(
    defaultResponse?.mode === "respond" || defaultResponse?.mode === "redirect"
      ? storedHeaders
      : "Content-Type: text/plain; charset=utf-8",
  );

  return (
    <VStack gap={4}>
      <FormCard title="Unknown Host Handling">
        <form action={defaultResponseFormAction}>
          <VStack gap={3}>
            {defaultResponseState?.message && (
              <StatusAlert
                message={defaultResponseState.message}
                success={defaultResponseState.success}
              />
            )}
            <Selector
              label="Behavior"
              description="Applied only when no configured proxy host matches the request."
              htmlName="mode"
              options={DEFAULT_RESPONSE_MODES}
              value={mode}
              onChange={(v) => setMode(v as DefaultResponseSettings["mode"])}
            />

            {mode === "respond" && (
              <>
                <NumberInput
                  label="Status code"
                  description="Any final HTTP status from 200 through 599."
                  htmlName="status"
                  min={200}
                  max={599}
                  isIntegerOnly
                  value={status}
                  onChange={setStatus}
                />
                <TextArea
                  label="Response body"
                  isOptional
                  description="Plain text, JSON, or custom HTML. Empty is allowed."
                  htmlName="body"
                  value={body}
                  onChange={setBody}
                  rows={8}
                  placeholder="Not Found"
                />
              </>
            )}

            {mode === "redirect" && (
              <>
                <Selector
                  label="Redirect status"
                  description="307 and 308 preserve the original request method."
                  htmlName="status"
                  options={REDIRECT_STATUS_OPTIONS}
                  value={redirectStatus}
                  onChange={setRedirectStatus}
                />
                <TextInput
                  label="Redirect URL"
                  isRequired
                  description="Absolute, relative, and Caddy placeholder-based targets are supported."
                  htmlName="redirectUrl"
                  value={redirectUrl}
                  onChange={setRedirectUrl}
                  placeholder="https://example.com{http.request.uri}"
                />
              </>
            )}

            {(mode === "respond" || mode === "redirect") && (
              <TextArea
                label="Response headers"
                isOptional
                description="Optional Name: value pairs, one per line. For custom HTML, set Content-Type: text/html; charset=utf-8."
                htmlName="headers"
                value={headers}
                onChange={setHeaders}
                rows={4}
                placeholder={"Content-Type: text/html; charset=utf-8\nCache-Control: no-store"}
              />
            )}

            {mode === "abort" && (
              <WarnAlert title="Unmatched connections are closed without a response">
                Caddy writes no status line or body — the native equivalent of a &ldquo;444 / no
                response&rdquo; policy.
              </WarnAlert>
            )}

            <SaveButton label="Save default response" />
          </VStack>
        </form>
      </FormCard>
      <InfoAlert title="Configured hosts always run before this catch-all">
        For HTTPS the response can only be sent once a TLS certificate completes the handshake, so
        an unknown hostname or direct IP may fail earlier.
      </InfoAlert>
    </VStack>
  );
}

// ─── Section: ACME Server ────────────────────────────────────────────────────

function AcmeSection({
  acme,
  acmeState,
  acmeFormAction,
}: {
  acme: AcmeSettings | null;
  acmeState: { success: boolean; message?: string } | null;
  acmeFormAction: (payload: FormData) => void;
}) {
  const [caUrl, setCaUrl] = useState(acme?.caUrl ?? "");
  const [caRootPem, setCaRootPem] = useState(acme?.caRootPem ?? "");

  return (
    <FormCard title="Custom ACME Directory">
      <form action={acmeFormAction}>
        <VStack gap={3}>
          {acmeState?.message && (
            <StatusAlert message={acmeState.message} success={acmeState.success} />
          )}
          <TextInput
            label="ACME directory URL"
            isOptional
            description="Leave empty to use the Let's Encrypt default. For an internal CA (OpenBao, Step-CA, Windows ADCS), paste its ACME directory URL — must be HTTPS."
            htmlName="caUrl"
            value={caUrl}
            onChange={setCaUrl}
            placeholder="https://ca.internal.example.com/acme/acme/directory"
          />
          <TextArea
            label="CA root certificate (PEM)"
            isOptional
            description="If the ACME endpoint's TLS certificate is signed by an internal root not in the system trust store, paste the root (or chain) here so Caddy can connect to it."
            htmlName="caRootPem"
            value={caRootPem}
            onChange={setCaRootPem}
            placeholder={"-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----"}
            rows={6}
          />
          <SaveButton label="Save ACME settings" />
        </VStack>
      </form>
    </FormCard>
  );
}

// ─── Section: DNS Providers ──────────────────────────────────────────────────

function DnsProviderCredentialFields({ providerDef }: { providerDef: DnsProviderDefinition }) {
  // Keyed on the provider so switching providers resets the credentials instead of carrying the
  // previous provider's values across.
  const [values, setValues] = useState<Record<string, string>>({});

  return (
    <>
      {providerDef.description && (
        <Text type="body" size="xsm" color="secondary">
          {providerDef.description}
        </Text>
      )}
      {providerDef.fields.map((field) => (
        <TextInput
          key={field.key}
          {...(field.type === "password" ? AUTOFILL_NEW_PASSWORD : AUTOFILL_OFF)}
          label={field.label}
          isOptional={!field.required}
          isRequired={field.required}
          description={field.description ?? undefined}
          type={field.type === "password" ? "password" : "text"}
          htmlName={`credential_${field.key}`}
          value={values[field.key] ?? ""}
          onChange={(v) => setValues((prev) => ({ ...prev, [field.key]: v }))}
          placeholder={field.placeholder ?? ""}
        />
      ))}
    </>
  );
}

function DnsProvidersSection({
  dnsProvider,
  dnsProviderDefinitions,
  dnsProviderState,
  dnsProviderFormAction,
  selectedProvider,
  setSelectedProvider,
  configuredProviders,
}: {
  dnsProvider: DnsProviderApiStatus | null;
  dnsProviderDefinitions: DnsProviderDefinition[];
  dnsProviderState: { success: boolean; message?: string } | null;
  dnsProviderFormAction: (payload: FormData) => void;
  selectedProvider: string;
  setSelectedProvider: (v: string) => void;
  configuredProviders: string[];
}) {
  const { enabledModuleIds } = useModuleGate();
  // Each provider is a separate caddy-dns plugin, so availability is per provider, not one blanket
  // "DNS-01 works" flag. A provider whose module is switched off would produce a config Caddy
  // rejects outright, so it leaves the picker rather than failing at certificate-issuance time.
  const isProviderAvailable = (name: string) =>
    enabledModuleIds === null || enabledModuleIds.includes(dnsModuleId(name));

  const providerDef = dnsProviderDefinitions.find((p) => p.name === selectedProvider);
  const isUpdate = configuredProviders.includes(selectedProvider);
  const hasProvider = Boolean(selectedProvider) && selectedProvider !== "none";
  const selectedUnavailable = hasProvider && !isProviderAvailable(selectedProvider);

  const unavailableCount = dnsProviderDefinitions.filter(
    (p) => !isProviderAvailable(p.name),
  ).length;

  const providerOptions = [
    { value: "none", label: "Select..." },
    ...dnsProviderDefinitions.map((p) => ({
      value: p.name,
      label: `${p.displayName}${configuredProviders.includes(p.name) ? " (update)" : ""}`,
      // Kept in the list rather than filtered out, so an admin looking for a provider finds it and
      // learns why it is unavailable.
      disabled: !isProviderAvailable(p.name),
      description: isProviderAvailable(p.name)
        ? undefined
        : "Its caddy-dns module is disabled in Settings → Caddy Build",
    })),
  ];

  return (
    <>
      {dnsProviderState?.message && (
        <StatusAlert message={dnsProviderState.message} success={dnsProviderState.success} />
      )}

      {configuredProviders.length > 0 && (
        <FormCard title="Configured providers">
          <VStack gap={2}>
            {configuredProviders.map((name) => {
              const def = dnsProviderDefinitions.find((p) => p.name === name);
              const isDefault = dnsProvider?.default === name;
              return (
                <Card key={name} variant="muted" padding={3}>
                  <HStack justify="between" gap={3} vAlign="center" wrap="wrap">
                    <HStack gap={2} vAlign="center">
                      <Text type="body" size="sm" weight="semibold">
                        {def?.displayName ?? name}
                      </Text>
                      {isDefault && <Badge variant="info" label="Default" />}
                    </HStack>
                    <HStack gap={2}>
                      {!isDefault && (
                        <form action={dnsProviderFormAction}>
                          <input type="hidden" name="action" value="set-default" />
                          <input type="hidden" name="provider" value={name} />
                          <Button type="submit" variant="secondary" size="sm" label="Set default" />
                        </form>
                      )}
                      <form action={dnsProviderFormAction}>
                        <input type="hidden" name="action" value="remove" />
                        <input type="hidden" name="provider" value={name} />
                        <Button type="submit" variant="destructive" size="sm" label="Remove" />
                      </form>
                    </HStack>
                  </HStack>
                </Card>
              );
            })}
            {dnsProvider?.default && (
              <form action={dnsProviderFormAction}>
                <input type="hidden" name="action" value="set-default" />
                <input type="hidden" name="provider" value="none" />
                <Button
                  type="submit"
                  variant="ghost"
                  size="sm"
                  label="Clear default (HTTP-01 only)"
                />
              </form>
            )}
          </VStack>
        </FormCard>
      )}

      <FormCard
        title={configuredProviders.length > 0 ? "Add or update provider" : "Add a provider"}
        footer={
          <Button
            type="submit"
            form="dnsp-add-form"
            size="sm"
            label={hasProvider && isUpdate ? "Update provider" : "Add provider"}
            isDisabled={!hasProvider}
          />
        }
      >
        <form id="dnsp-add-form" action={dnsProviderFormAction}>
          <VStack gap={3}>
            <input type="hidden" name="action" value="save" />
            <Selector
              label="Provider"
              description={
                unavailableCount > 0
                  ? `${dnsProviderDefinitions.length} providers supported — ${unavailableCount} unavailable because their Caddy module is disabled`
                  : `${dnsProviderDefinitions.length} providers supported`
              }
              htmlName="provider"
              options={providerOptions}
              value={selectedProvider}
              onChange={setSelectedProvider}
              placeholder="Select a DNS provider..."
              hasSearch
            />

            {selectedUnavailable && (
              <WarnAlert title="This provider's Caddy module is disabled">
                Enable it under Settings → Caddy Build and rebuild Caddy before using it for DNS-01
                challenges. Credentials saved now will not be used until then.
              </WarnAlert>
            )}

            {hasProvider && providerDef && (
              <>
                <DnsProviderCredentialFields key={providerDef.name} providerDef={providerDef} />
                {isUpdate && (
                  <InfoAlert title="Credentials are already configured">
                    Leave fields blank to keep existing values.
                  </InfoAlert>
                )}
                {providerDef.docsUrl && (
                  <Link href={providerDef.docsUrl} target="_blank">
                    Provider documentation
                  </Link>
                )}
              </>
            )}
          </VStack>
        </form>
      </FormCard>
    </>
  );
}

// ─── Section: DNS Resolvers ──────────────────────────────────────────────────

function DnsResolversSection({
  dns,
  dnsState,
  dnsFormAction,
}: {
  dns: DnsSettings | null;
  dnsState: { success: boolean; message?: string } | null;
  dnsFormAction: (payload: FormData) => void;
}) {
  const [enabled, setEnabled] = useState(dns?.enabled ?? false);
  const [resolvers, setResolvers] = useState(dns?.resolvers?.join("\n") ?? "");
  const [fallbacks, setFallbacks] = useState(dns?.fallbacks?.join("\n") ?? "");
  const [timeout, setTimeoutValue] = useState(dns?.timeout ?? "");

  return (
    <>
      <FormCard>
        <form action={dnsFormAction}>
          <VStack gap={3}>
            {dnsState?.message && (
              <StatusAlert message={dnsState.message} success={dnsState.success} />
            )}
            <CheckboxInput
              label="Enable custom DNS resolvers"
              htmlName="enabled"
              value={enabled}
              onChange={setEnabled}
            />
            <TextArea
              label="Primary resolvers"
              isOptional
              htmlName="resolvers"
              value={resolvers}
              onChange={setResolvers}
              placeholder={"1.1.1.1\n9.9.9.9"}
              rows={2}
            />
            <TextArea
              label="Fallback resolvers"
              isOptional
              htmlName="fallbacks"
              value={fallbacks}
              onChange={setFallbacks}
              placeholder={"1.0.0.1\n149.112.112.112"}
              rows={2}
            />
            <TextInput
              label="Query timeout"
              isOptional
              description="e.g. 5s, 10s"
              htmlName="timeout"
              value={timeout}
              onChange={setTimeoutValue}
              placeholder="5s"
              width={160}
            />
            <SaveButton label="Save DNS settings" />
          </VStack>
        </form>
      </FormCard>
      <InfoAlert title="When to use custom resolvers">
        Useful when your DNS provider has slow propagation or when using split-horizon DNS. Common
        public resolvers: 1.1.1.1 (Cloudflare), 194.242.2.2 (Mullvad), 9.9.9.9 (Quad9).
      </InfoAlert>
    </>
  );
}

// ─── Section: Upstream DNS Pinning ───────────────────────────────────────────

const FAMILY_OPTIONS = [
  { value: "both", label: "Both (Prefer IPv6)" },
  { value: "ipv6", label: "IPv6 only" },
  { value: "ipv4", label: "IPv4 only" },
];

function UpstreamDnsSection({
  upstreamDnsResolution,
  upstreamDnsResolutionState,
  upstreamDnsResolutionFormAction,
}: {
  upstreamDnsResolution: UpstreamDnsResolutionSettings | null;
  upstreamDnsResolutionState: { success: boolean; message?: string } | null;
  upstreamDnsResolutionFormAction: (payload: FormData) => void;
}) {
  const [enabled, setEnabled] = useState(upstreamDnsResolution?.enabled ?? false);
  const [family, setFamily] = useState<string>(upstreamDnsResolution?.family ?? "both");

  return (
    <>
      <FormCard>
        <form action={upstreamDnsResolutionFormAction}>
          <VStack gap={3}>
            {upstreamDnsResolutionState?.message && (
              <StatusAlert
                message={upstreamDnsResolutionState.message}
                success={upstreamDnsResolutionState.success}
              />
            )}
            <CheckboxInput
              label="Enable upstream DNS pinning"
              description="Resolves upstream hostnames at config-apply time and writes IPs into Caddy's active config."
              htmlName="enabled"
              value={enabled}
              onChange={setEnabled}
            />
            <Selector
              label="Address family"
              description="Both resolves AAAA + A with IPv6 preferred ordering."
              htmlName="family"
              options={FAMILY_OPTIONS}
              value={family}
              onChange={setFamily}
              width={280}
            />
            <SaveButton label="Save upstream DNS pinning settings" />
          </VStack>
        </form>
      </FormCard>
      <InfoAlert title="Host-level settings can override this default">
        Resolution happens at config save/reload time and resolved IPs are written into Caddy&apos;s
        active config. If one handler has multiple different HTTPS upstream hostnames, HTTPS pinning
        is skipped for those HTTPS upstreams to avoid SNI mismatch.
      </InfoAlert>
    </>
  );
}

// ─── Section: Trusted Proxies ────────────────────────────────────────────────

function TrustedProxiesSection({
  trustedProxies,
  trustedProxiesState,
  trustedProxiesFormAction,
}: {
  trustedProxies: TrustedProxiesSettings | null;
  trustedProxiesState: { success: boolean; message?: string } | null;
  trustedProxiesFormAction: (payload: FormData) => void;
}) {
  const [ranges, setRanges] = useState((trustedProxies?.ranges ?? []).join("\n"));
  const [clientIpHeaders, setClientIpHeaders] = useState(
    (trustedProxies?.client_ip_headers ?? []).join("\n"),
  );
  const [strict, setStrict] = useState(trustedProxies?.strict ?? false);
  const [defaultGeoblock, setDefaultGeoblock] = useState(trustedProxies?.default_geoblock ?? false);

  return (
    <>
      <FormCard>
        <form action={trustedProxiesFormAction}>
          <VStack gap={3}>
            {trustedProxiesState?.message && (
              <StatusAlert
                message={trustedProxiesState.message}
                success={trustedProxiesState.success}
              />
            )}
            <TextArea
              label="Trusted proxy ranges"
              isOptional
              description="CIDRs, IPs, or the private_ranges shorthand — one per line. When CPM runs behind another proxy, Caddy resolves the real client IP from these. Leave empty to keep the current behaviour."
              htmlName="ranges"
              value={ranges}
              onChange={setRanges}
              rows={3}
              placeholder={"private_ranges\n172.21.0.1/32"}
            />
            <TextArea
              label="Client IP headers"
              isOptional
              description="Headers Caddy reads the client IP from — one per line. Empty defaults to X-Forwarded-For. Set Cf-Connecting-Ip for Cloudflare, etc."
              htmlName="clientIpHeaders"
              value={clientIpHeaders}
              onChange={setClientIpHeaders}
              rows={2}
              placeholder="X-Forwarded-For"
            />
            <CheckboxInput
              label="Enable strict trusted proxies"
              description="Only trust the client IP headers from the configured proxies, rejecting spoofed values from untrusted peers."
              htmlName="strict"
              value={strict}
              onChange={setStrict}
            />
            <CheckboxInput
              label="Default geoblock trusted proxies from this list"
              description="Use these ranges as the default trusted-proxy list for global geoblocking so the two can't silently disagree. A geoblock list set explicitly wins."
              htmlName="defaultGeoblock"
              value={defaultGeoblock}
              onChange={setDefaultGeoblock}
            />
            <SaveButton label="Save trusted proxies settings" />
          </VStack>
        </form>
      </FormCard>
      <InfoAlert title="Applied to the main HTTP server">
        This fixes client-IP attribution everywhere at once — access logs, analytics, the country
        map, and any downstream handler using the client_ip placeholder.
      </InfoAlert>
    </>
  );
}

// ─── Section: Global Geoblocking ─────────────────────────────────────────────

function GeoBlockSection({
  globalGeoBlock,
  geoBlockState,
  geoBlockFormAction,
}: {
  globalGeoBlock?: GeoBlockSettings | null;
  geoBlockState: { success: boolean; message?: string } | null;
  geoBlockFormAction: (payload: FormData) => void;
}) {
  return (
    <FormCard>
      <form action={geoBlockFormAction}>
        <VStack gap={3}>
          {geoBlockState?.message && (
            <StatusAlert message={geoBlockState.message} success={geoBlockState.success} />
          )}
          <GeoBlockFields
            initialValues={{ geoblock: globalGeoBlock ?? null, geoblock_mode: "merge" }}
            showModeSelector={false}
          />
          <SaveButton label="Save geoblocking settings" />
        </VStack>
      </form>
    </FormCard>
  );
}

// ─── Section: Error Pages ────────────────────────────────────────────────────

function ErrorPagesSection({
  globalErrorPages,
  errorPagesState,
  errorPagesFormAction,
}: {
  globalErrorPages?: ErrorPagesSettings | null;
  errorPagesState: { success: boolean; message?: string } | null;
  errorPagesFormAction: (payload: FormData) => void;
}) {
  return (
    <FormCard>
      <form action={errorPagesFormAction}>
        <VStack gap={3}>
          {errorPagesState?.message && (
            <StatusAlert message={errorPagesState.message} success={errorPagesState.success} />
          )}
          <Text type="body" size="sm" color="secondary">
            These error pages apply to every proxy host as a fallback. A per-host error page for the
            same status code takes precedence.
          </Text>
          <ErrorPagesFields initialData={globalErrorPages?.rules ?? []} />
          <SaveButton label="Save error pages" />
        </VStack>
      </form>
    </FormCard>
  );
}

// ─── Section: Authentik Defaults ─────────────────────────────────────────────

function AuthentikSection({
  authentik,
  authentikState,
  authentikFormAction,
}: {
  authentik: AuthentikSettings | null;
  authentikState: { success: boolean; message?: string } | null;
  authentikFormAction: (payload: FormData) => void;
}) {
  const [outpostDomain, setOutpostDomain] = useState(authentik?.outpostDomain ?? "");
  const [outpostUpstream, setOutpostUpstream] = useState(authentik?.outpostUpstream ?? "");
  const [authEndpoint, setAuthEndpoint] = useState(authentik?.authEndpoint ?? "");

  return (
    <FormCard>
      <form action={authentikFormAction}>
        <VStack gap={3}>
          {authentikState?.message && (
            <StatusAlert message={authentikState.message} success={authentikState.success} />
          )}
          <TextInput
            {...NATIVE_REQUIRED}
            label="Outpost domain"
            htmlName="outpostDomain"
            value={outpostDomain}
            onChange={setOutpostDomain}
            placeholder="outpost.goauthentik.io"
            isRequired
          />
          <TextInput
            {...NATIVE_REQUIRED}
            label="Outpost upstream"
            htmlName="outpostUpstream"
            value={outpostUpstream}
            onChange={setOutpostUpstream}
            placeholder="http://authentik-server:9000"
            isRequired
          />
          <TextInput
            label="Auth endpoint"
            isOptional
            htmlName="authEndpoint"
            value={authEndpoint}
            onChange={setAuthEndpoint}
            placeholder="/outpost.goauthentik.io/auth/caddy"
          />
          <SaveButton label="Save Authentik defaults" />
        </VStack>
      </form>
    </FormCard>
  );
}

// ─── Section: OAuth Providers ────────────────────────────────────────────────

function OAuthSection({
  oauthProviders,
  localUsersDisabled,
  baseUrl,
}: {
  oauthProviders: OAuthProviderView[];
  localUsersDisabled: boolean;
  baseUrl: string;
}) {
  return (
    <FormCard>
      <OAuthProvidersSection
        initialProviders={oauthProviders}
        baseUrl={baseUrl}
        localUsersDisabled={localUsersDisabled}
      />
    </FormCard>
  );
}

// ─── Section: Password Policy ────────────────────────────────────────────────

/**
 * Not offered as an agent override: forcing a password reset is a local security decision, and
 * inheriting it would let one instance lock another's users out.
 */
function PasswordPolicySection({
  passwordPolicy,
  passwordPolicyState,
  passwordPolicyFormAction,
}: {
  passwordPolicy: { requireChangeOnLegacyHash: boolean; fromEnv: boolean };
  passwordPolicyState: { success: boolean; message?: string } | null;
  passwordPolicyFormAction: (payload: FormData) => void;
}) {
  const [requireChange, setRequireChange] = useState(passwordPolicy.requireChangeOnLegacyHash);

  return (
    <FormCard title="Legacy password hashes">
      <form action={passwordPolicyFormAction}>
        <VStack gap={3}>
          {passwordPolicy.fromEnv && (
            <InfoAlert title="This policy is set by the AUTH_REQUIRE_PASSWORD_CHANGE_ON_LEGACY_HASH environment variable">
              It cannot be changed here.
            </InfoAlert>
          )}
          {passwordPolicyState?.message && (
            <StatusAlert
              message={passwordPolicyState.message}
              success={passwordPolicyState.success}
            />
          )}
          <CheckboxInput
            label="Require a password change for users still on an older hash"
            description="New passwords are hashed with argon2id. Accounts created before that change still use bcrypt, which caps the password at 72 bytes. Turning this on sends those users to a reset screen at their next sign-in; choosing a new password upgrades the hash and clears the prompt. Users who sign in through an OAuth/OIDC provider have no password and are never asked."
            htmlName="requireChangeOnLegacyHash"
            value={requireChange}
            onChange={setRequireChange}
            isDisabled={passwordPolicy.fromEnv}
          />
          <SaveButton label="Save password policy" isDisabled={passwordPolicy.fromEnv} />
        </VStack>
      </form>
    </FormCard>
  );
}

// ─── Section: User Avatars ───────────────────────────────────────────────────

function AvatarsSection({
  avatars,
  avatarsState,
  avatarsFormAction,
}: {
  avatars: { gravatarEnabled: boolean; fromEnv: boolean };
  avatarsState: { success: boolean; message?: string } | null;
  avatarsFormAction: (payload: FormData) => void;
}) {
  const [gravatarEnabled, setGravatarEnabled] = useState(avatars.gravatarEnabled);

  return (
    <FormCard title="Fallback icon">
      <form action={avatarsFormAction}>
        <VStack gap={3}>
          {avatars.fromEnv && (
            <InfoAlert title="Gravatar is set by the AVATAR_GRAVATAR environment variable">
              It cannot be changed here.
            </InfoAlert>
          )}
          {avatarsState?.message && (
            <StatusAlert message={avatarsState.message} success={avatarsState.success} />
          )}
          <CheckboxInput
            label="Use Gravatar when a user has no icon"
            description="For users with no icon of their own, look one up from gravatar.com by their email address. Their browser contacts gravatar.com directly, which discloses their IP and a hash of their address to a third party. Accounts with a local-only address are never looked up, and anyone without a Gravatar falls back to their initial."
            htmlName="gravatarEnabled"
            value={gravatarEnabled}
            onChange={setGravatarEnabled}
            isDisabled={avatars.fromEnv}
          />
          <SaveButton label="Save avatar settings" isDisabled={avatars.fromEnv} />
        </VStack>
      </form>
    </FormCard>
  );
}

// ─── Section: Branding ───────────────────────────────────────────────────────

/**
 * Upload or remove the favicon.
 *
 * A plain `<input type="file">` rather than a design-system control: Astryx has no file input, and
 * the point of this field is the native picker anyway. The preview is built from the chosen File
 * with an object URL — the stored icon is never sent to this page, only served by its own route.
 */
function BrandingSection({
  hasFavicon,
  faviconState,
  faviconFormAction,
}: {
  hasFavicon: boolean;
  faviconState: { success: boolean; message?: string } | null;
  faviconFormAction: (payload: FormData) => void;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);

  // Revoked on replacement and unmount: an object URL pins the file in memory until it is.
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  // A cache-busting query so the tab icon and the preview below update on the same save. The
  // route revalidates by ETag, which a browser is entitled to skip for an unchanged URL.
  const currentSrc = `/api/branding/favicon?v=${faviconState?.success ? "new" : "current"}`;

  return (
    <FormCard title="Favicon">
      <form action={faviconFormAction}>
        <VStack gap={3}>
          {faviconState?.message && (
            <StatusAlert message={faviconState.message} success={faviconState.success} />
          )}
          <InfoAlert title="Shown in the browser tab and in bookmarks">
            PNG, ICO, SVG, WebP, GIF or JPEG, up to 256 KB. A square image of at least 32×32 works
            everywhere; browsers scale it down themselves.
          </InfoAlert>

          <HStack gap={3} align="center">
            {(preview || hasFavicon) && (
              // A plain <img>: next/image cannot serve an object URL built from a File the user
              // has only just picked, and that preview is the point of this control.
              <img
                src={preview ?? currentSrc}
                alt={preview ? "The favicon you selected" : "The current favicon"}
                width={32}
                height={32}
                style={{ width: 32, height: 32, objectFit: "contain" }}
              />
            )}
            <Text size="sm" color="secondary">
              {preview
                ? `Selected: ${chosen}. Save to apply it.`
                : hasFavicon
                  ? "A custom favicon is set."
                  : "No custom favicon — browsers show their own default."}
            </Text>
          </HStack>

          <input
            type="file"
            name="favicon"
            accept="image/png,image/x-icon,image/vnd.microsoft.icon,image/svg+xml,image/webp,image/gif,image/jpeg,.ico"
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              setChosen(file?.name ?? null);
              setPreview(file ? URL.createObjectURL(file) : null);
            }}
          />

          <HStack gap={2} justify="end">
            {hasFavicon && (
              <Button
                type="submit"
                size="sm"
                variant="secondary"
                name="intent"
                value="remove"
                label="Remove favicon"
              />
            )}
            <Button type="submit" size="sm" label="Save favicon" isDisabled={!preview} />
          </HStack>
        </VStack>
      </form>
    </FormCard>
  );
}

// ─── Section: Analytics ──────────────────────────────────────────────────────

/**
 * Explains where the current answer came from when nothing is stored yet.
 *
 * Worth a line of its own: an operator who has never opened this page sees a checkbox already
 * ticked, and without this it reads as a setting someone else changed rather than as the
 * deployment's existing configuration being described back to them.
 */
function InferredNote({ source, children }: { source: string; children: ReactNode }) {
  if (source === "environment") {
    return (
      <InfoAlert title="Currently set by an environment variable">
        Saving here stores the value in the database, which takes precedence from then on. The
        variable can be removed from your <Code>.env</Code> afterwards.
      </InfoAlert>
    );
  }
  return <InfoAlert title="Not configured here yet">{children}</InfoAlert>;
}

function AnalyticsSection({
  analytics,
  canManageServices,
  analyticsState,
  analyticsFormAction,
}: {
  analytics: AnalyticsView;
  canManageServices: boolean;
  analyticsState: { success: boolean; message?: string } | null;
  analyticsFormAction: (payload: FormData) => void;
}) {
  const [enabled, setEnabled] = useState(analytics.enabled);
  const [url, setUrl] = useState(analytics.url);
  const [user, setUser] = useState(analytics.user);
  const [password, setPassword] = useState("");
  const [database, setDatabase] = useState(analytics.database);
  const [retentionDays, setRetentionDays] = useState(analytics.retentionDays);

  return (
    <FormCard title="Traffic and WAF events">
      <form action={analyticsFormAction}>
        <VStack gap={3}>
          {analytics.inferred && (
            <InferredNote source={analytics.source}>
              Analytics are {analytics.enabled ? "on" : "off"} because a ClickHouse password is
              {analytics.hasPassword ? " " : " not "}set. Saving makes the choice explicit.
            </InferredNote>
          )}
          {analyticsState?.message && (
            <StatusAlert message={analyticsState.message} success={analyticsState.success} />
          )}
          <CheckboxInput
            label="Collect analytics"
            description="Record every proxied request and every WAF event, and show them on the Analytics page. With this off, no events are written and the agents stop reading Caddy's logs."
            htmlName="analyticsEnabled"
            value={enabled}
            onChange={setEnabled}
          />
          {canManageServices ? (
            <InfoAlert title="The agent starts and stops ClickHouse for you">
              No <Code>COMPOSE_PROFILES</Code> entry is needed. The first start pulls the ClickHouse
              image, which can take several minutes; turning analytics off stops the container and
              leaves its data volume intact.
            </InfoAlert>
          ) : (
            <WarnAlert title="No agent is answering, so the container cannot be managed from here">
              These settings still decide whether analytics run. Starting ClickHouse itself needs
              <Code>clickhouse</Code> in <Code>COMPOSE_PROFILES</Code> on the host.
            </WarnAlert>
          )}
          {/* Tells the action a password already exists, so "enabled with an empty field" is a
              keep-what-is-stored rather than a misconfiguration to refuse. */}
          <input type="hidden" name="hasPassword" value={analytics.hasPassword ? "yes" : "no"} />
          <TextInput
            {...AUTOFILL_OFF}
            label="ClickHouse URL"
            description="Where the analytics database is reachable."
            htmlName="clickhouseUrl"
            value={url}
            onChange={setUrl}
          />
          <TextInput
            {...AUTOFILL_OFF}
            label="ClickHouse user"
            htmlName="clickhouseUser"
            value={user}
            onChange={setUser}
          />
          <TextInput
            {...AUTOFILL_NEW_PASSWORD}
            label="ClickHouse password"
            type="password"
            isOptional={analytics.hasPassword}
            description={
              analytics.hasPassword
                ? "A password is stored. Leave this empty to keep it."
                : "Required — the ClickHouse container refuses to start without one."
            }
            htmlName="clickhousePassword"
            value={password}
            onChange={setPassword}
          />
          <TextInput
            {...AUTOFILL_OFF}
            label="ClickHouse database"
            htmlName="clickhouseDb"
            value={database}
            onChange={setDatabase}
          />
          <NumberInput
            label="Retention (days)"
            description="How long events are kept. Lowering it migrates the existing tables' TTL, which rewrites their parts."
            htmlName="clickhouseRetentionDays"
            value={retentionDays}
            onChange={setRetentionDays}
            isIntegerOnly
            min={1}
            max={3650}
          />
          <SaveButton label="Save analytics settings" />
        </VStack>
      </form>
    </FormCard>
  );
}

// ─── Section: GeoIP ──────────────────────────────────────────────────────────

function GeoipSection({
  geoip,
  canManageServices,
  geoipState,
  geoipFormAction,
}: {
  geoip: GeoipView;
  canManageServices: boolean;
  geoipState: { success: boolean; message?: string } | null;
  geoipFormAction: (payload: FormData) => void;
}) {
  const [enabled, setEnabled] = useState(geoip.enabled);
  const [accountId, setAccountId] = useState(geoip.accountId);
  const [licenseKey, setLicenseKey] = useState("");

  return (
    <FormCard title="MaxMind GeoLite2">
      <form action={geoipFormAction}>
        <VStack gap={3}>
          {geoip.inferred && (
            <InferredNote source={geoip.source}>
              GeoIP is {geoip.enabled ? "on" : "off"} because the databases are
              {geoip.installedEditions.length > 0 ? " " : " not "}present on disk. Saving makes the
              choice explicit.
            </InferredNote>
          )}
          {geoipState?.message && (
            <StatusAlert message={geoipState.message} success={geoipState.success} />
          )}
          <CheckboxInput
            label="Use GeoIP"
            description="Country lookups for analytics, and the country matching that geo blocking is built on. With this off, geo block fields are not offered and no country is recorded against an event."
            htmlName="geoipEnabled"
            value={enabled}
            onChange={setEnabled}
          />
          {canManageServices ? (
            <InfoAlert title="The agent starts and stops geoipupdate for you">
              No <Code>COMPOSE_PROFILES</Code> entry is needed. It downloads the databases on a
              schedule using the credentials below, and agents on other hosts fetch them from this
              controller rather than each holding a licence key.
            </InfoAlert>
          ) : (
            <WarnAlert title="No agent is answering, so the container cannot be managed from here">
              These settings still decide whether GeoIP is used. Downloading the databases needs
              <Code>geoipupdate</Code> in <Code>COMPOSE_PROFILES</Code> on the host.
            </WarnAlert>
          )}
          <Text size="sm" color="secondary">
            {geoip.installedEditions.length > 0
              ? `Installed: ${geoip.installedEditions.join(", ")}.`
              : "No databases are installed yet."}
          </Text>
          <input type="hidden" name="hasLicenseKey" value={geoip.hasLicenseKey ? "yes" : "no"} />
          <TextInput
            {...AUTOFILL_OFF}
            label="MaxMind account ID"
            isOptional
            description="From your MaxMind account. Without a subscription the databases cannot be downloaded, though GeoIP still works if you supply the files another way."
            htmlName="geoipAccountId"
            value={accountId}
            onChange={setAccountId}
          />
          <TextInput
            {...AUTOFILL_NEW_PASSWORD}
            label="MaxMind licence key"
            type="password"
            isOptional
            description={
              geoip.hasLicenseKey
                ? "A licence key is stored. Leave this empty to keep it."
                : "Issued alongside the account ID at maxmind.com."
            }
            htmlName="geoipLicenseKey"
            value={licenseKey}
            onChange={setLicenseKey}
          />
          <SaveButton label="Save GeoIP settings" />
        </VStack>
      </form>
    </FormCard>
  );
}

// ─── Section: Agent ──────────────────────────────────────────────────────────

/** Human date for a timestamp the agent or the pairing recorded. */
function whenText(iso: string | null): string {
  if (!iso) return "never";
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? "never" : parsed.toLocaleString();
}

/** One agent's line in the fleet list: what it is, and whether it is answering. */
function AgentRow({
  name,
  address,
  status,
  error,
  lastSeenAt,
  onRemove,
}: {
  name: string;
  address: string | null;
  status: AgentStatus | null;
  error: string | null;
  lastSeenAt: string | null;
  onRemove: ReactNode;
}) {
  return (
    <VStack gap={2}>
      <HStack gap={2} align="center" justify="between">
        <VStack gap={1}>
          <HStack gap={2} align="center">
            <Text size="sm" weight="semibold">
              {name}
            </Text>
            {status ? (
              <Text size="xsm" color="secondary">
                v{status.version} · {status.mode} · project {status.composeProject}
              </Text>
            ) : (
              <Badge variant="error" label="Not answering" />
            )}
          </HStack>
          <Text size="xsm" color="secondary">
            {address ? `${address} — ` : ""}last reached {whenText(lastSeenAt)}
          </Text>
          {status && (
            <Text size="xsm" color="secondary">
              {status.l4Ports.applied.length} published port(s) · ports:{" "}
              {status.l4Ports.status.state} · build: {status.caddyBuild.status.state}
            </Text>
          )}
        </VStack>
        {onRemove}
      </HStack>
      {error && <WarnAlert title={`${name} is not reachable`}>{error}</WarnAlert>}
    </VStack>
  );
}

function AgentSection({
  agents,
  pairState,
  pairFormAction,
}: {
  agents: Props["agents"];
  pairState: { success: boolean; message?: string } | null;
  pairFormAction: (payload: FormData) => void;
}) {
  const [address, setAddress] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");

  const { paired, statuses } = agents;
  const usingPaired = paired.length > 0;
  const statusFor = (agentName: string) => statuses.find((entry) => entry.agent === agentName);
  const answering = statuses.filter((entry) => entry.ok).length;

  return (
    <>
      <FormCard title={usingPaired ? "Agents" : "Current agent"}>
        <VStack gap={3}>
          <Text size="sm" color="secondary">
            An agent recreates, rebuilds and configures the Caddy container on its host. The
            controller has no Docker access of its own, and no address for any Caddy — everything
            reaches a proxy through its agent.
          </Text>

          {usingPaired && paired.length > 1 && (
            <InfoAlert title="Every agent runs the same configuration">
              Proxy hosts, certificates and published ports belong to this controller, not to a
              host. A change is applied to all {paired.length} agents or to none of them, so the
              fleet cannot drift apart.
            </InfoAlert>
          )}

          {statuses.length === 0 ? (
            <WarnAlert title="No agent is answering">
              {usingPaired
                ? "Nothing was reached. Layer-4 ports, Caddy rebuilds and config changes will all fail until an agent answers."
                : "Start the agent container, or pair a remote one below. Everything else keeps working without it."}
            </WarnAlert>
          ) : (
            <VStack gap={3}>
              {!usingPaired && (
                <>
                  <InfoAlert title="This is the local agent">
                    It is reached over a socket on the shared data volume and needs no pairing. Pair
                    a remote agent below only if Caddy runs on a different host from this
                    controller.
                  </InfoAlert>
                  <AgentRow
                    name="Local agent"
                    address={null}
                    status={statuses[0]?.ok ? statuses[0].value : null}
                    error={statuses[0]?.ok ? null : (statuses[0]?.error ?? null)}
                    lastSeenAt={null}
                    onRemove={null}
                  />
                </>
              )}

              {paired.map((agent) => {
                const entry = statusFor(agent.name);
                return (
                  <AgentRow
                    key={agent.id}
                    name={agent.name}
                    address={agent.address}
                    status={entry?.ok ? entry.value : null}
                    error={entry && !entry.ok ? entry.error : agent.lastError}
                    lastSeenAt={agent.lastSeenAt}
                    onRemove={
                      <form action={unpairAgentAction}>
                        <input type="hidden" name="agentId" value={agent.id} />
                        <Button type="submit" size="sm" variant="secondary" label="Unpair" />
                      </form>
                    }
                  />
                );
              })}
            </VStack>
          )}

          {usingPaired && (
            <Text size="xsm" color="secondary">
              {answering} of {paired.length} answering. Unpairing forgets this side only — the agent
              keeps the secret until it is restarted or paired again, so restart it too if you are
              removing an agent you no longer trust.
            </Text>
          )}
        </VStack>
      </FormCard>

      <FormCard title="Pair an agent">
        <form action={pairFormAction}>
          <VStack gap={3}>
            <Text size="sm" color="secondary">
              Start the agent with <Code>AGENT_MODE=managed</Code>. It prints a six-letter code to
              its logs — <Code>docker logs caddy-proxy-manager-agent</Code> — which is valid for
              five minutes and works once. The two exchange a secret; the code is never used again.
            </Text>
            {pairState?.message && (
              <StatusAlert message={pairState.message} success={pairState.success} />
            )}
            <TextInput
              {...NATIVE_REQUIRED}
              label="Agent address"
              description="Host and port, e.g. agent.example.com:3100. Defaults to port 3100."
              htmlName="address"
              value={address}
              onChange={setAddress}
              placeholder="agent.example.com:3100"
              isRequired
            />
            <TextInput
              {...NATIVE_REQUIRED}
              {...AUTOFILL_OFF}
              label="Pairing code"
              description="Six letters, from the agent's logs."
              htmlName="code"
              value={code}
              onChange={setCode}
              placeholder="ABCDEF"
              isRequired
            />
            <TextInput
              label="Name"
              description="What to call this agent here. Defaults to its hostname."
              htmlName="name"
              value={name}
              onChange={setName}
              isOptional
            />
            <SaveButton label="Pair agent" />
          </VStack>
        </form>
      </FormCard>
    </>
  );
}

// ─── Section: Caddy Build ────────────────────────────────────────────────────

/**
 * Not offered as an agent override: the module list describes a binary built on this host, so
 * inheriting a controller's would tell an agent its Caddy has plugins it never compiled.
 */
function CaddyBuildSection({
  caddyBuild,
  caddyBuildState,
  caddyBuildFormAction,
}: {
  caddyBuild: CaddyBuildSettings | null;
  caddyBuildState: { success: boolean; message?: string } | null;
  caddyBuildFormAction: (formData: FormData) => void;
}) {
  return (
    <form action={caddyBuildFormAction}>
      <VStack gap={4}>
        {caddyBuildState?.message && (
          <StatusAlert
            message={caddyBuildState.message}
            success={Boolean(caddyBuildState.success)}
          />
        )}
        <CaddyBuildFields
          initialModules={caddyBuild?.modules ?? {}}
          initialCustomModules={caddyBuild?.customModules ?? []}
        />
        <SaveButton label="Save Module Selection" />
      </VStack>
    </form>
  );
}

// ─── Section: Metrics & Monitoring ───────────────────────────────────────────

function MetricsSection({
  metrics,
  metricsState,
  metricsFormAction,
}: {
  metrics: MetricsSettings | null;
  metricsState: { success: boolean; message?: string } | null;
  metricsFormAction: (payload: FormData) => void;
}) {
  const [enabled, setEnabled] = useState(metrics?.enabled ?? false);
  const [port, setPort] = useState(metrics?.port ?? 9090);

  return (
    <>
      <FormCard>
        <form action={metricsFormAction}>
          <VStack gap={3}>
            {metricsState?.message && (
              <StatusAlert message={metricsState.message} success={metricsState.success} />
            )}
            <CheckboxInput
              label="Enable metrics endpoint"
              description="Prometheus-compatible scrape endpoint, exposed on a dedicated port."
              htmlName="enabled"
              value={enabled}
              onChange={setEnabled}
            />
            <NumberInput
              label="Port"
              description="Separate from admin API on port 2019."
              htmlName="port"
              value={port}
              onChange={setPort}
              isIntegerOnly
              min={1}
              max={65535}
              width={160}
            />
            <SaveButton label="Save metrics settings" />
          </VStack>
        </form>
      </FormCard>
      <InfoAlert title="Point your monitoring tool at the metrics endpoint">
        {`Scrape http://caddy-proxy-manager-caddy:${metrics?.port ?? 9090}/metrics from within the Docker network.`}
      </InfoAlert>
    </>
  );
}

// ─── Section: Access Logging ─────────────────────────────────────────────────

const LOG_FORMAT_OPTIONS = [
  { value: "json", label: "JSON" },
  { value: "console", label: "Console (Common Log Format)" },
];

function LoggingSection({
  logging,
  loggingState,
  loggingFormAction,
}: {
  logging: LoggingSettings | null;
  loggingState: { success: boolean; message?: string } | null;
  loggingFormAction: (payload: FormData) => void;
}) {
  const [enabled, setEnabled] = useState(logging?.enabled ?? false);
  const [format, setFormat] = useState<string>(logging?.format ?? "json");

  return (
    <>
      <FormCard>
        <form action={loggingFormAction}>
          <VStack gap={3}>
            {loggingState?.message && (
              <StatusAlert message={loggingState.message} success={loggingState.success} />
            )}
            <CheckboxInput
              label="Enable access logging"
              htmlName="enabled"
              value={enabled}
              onChange={setEnabled}
            />
            <Selector
              label="Format"
              htmlName="format"
              options={LOG_FORMAT_OPTIONS}
              value={format}
              onChange={setFormat}
              width={280}
            />
            <SaveButton label="Save logging settings" />
          </VStack>
        </form>
      </FormCard>
      <InfoAlert title="Access logs live in the caddy-logs Docker volume">
        View with: docker exec caddy-proxy-manager-caddy tail -f /logs/access.log
      </InfoAlert>
    </>
  );
}
