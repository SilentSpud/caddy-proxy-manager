"use client";

import { useState, useActionState, useEffect, type ReactNode } from "react";
import {
  Cloud,
  Globe,
  Network,
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
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { Breadcrumbs, BreadcrumbItem } from "@astryxdesign/core/Breadcrumbs";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { CommandPalette } from "@astryxdesign/core/CommandPalette";
import { Divider } from "@astryxdesign/core/Divider";
import { Grid } from "@astryxdesign/core/Grid";
import { Heading } from "@astryxdesign/core/Heading";
import { Kbd } from "@astryxdesign/core/Kbd";
import { Layout, LayoutContent, LayoutPanel } from "@astryxdesign/core/Layout";
import { Link } from "@astryxdesign/core/Link";
import { NumberInput } from "@astryxdesign/core/NumberInput";
import { Selector } from "@astryxdesign/core/Selector";
import { SideNav, SideNavItem, SideNavSection } from "@astryxdesign/core/SideNav";
import { Text } from "@astryxdesign/core/Text";
import { TextArea } from "@astryxdesign/core/TextArea";
import { TextInput } from "@astryxdesign/core/TextInput";
import { createStaticSource } from "@astryxdesign/core/Typeahead/utils";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { StatusChip } from "@/components/ui/StatusChip";
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
  DnsProviderSettings,
  UpstreamDnsResolutionSettings,
  GeoBlockSettings,
  ErrorPagesSettings,
  TrustedProxiesSettings,
} from "@/lib/settings";
import type { DnsProviderDefinition } from "@/src/lib/dns-providers";
import type { CaddyBuildSettings } from "@/lib/settings";
import { CaddyBuildFields } from "@/components/caddy-modules/CaddyBuildFields";
import { dnsModuleId } from "@/src/lib/caddy-modules";
import { useModuleGate } from "@/components/caddy-modules/ModuleGate";
import { GeoBlockFields } from "@/components/proxy-hosts/GeoBlockFields";
import { ErrorPagesFields } from "@/components/proxy-hosts/ErrorPagesFields";
import { useMediaQuery } from "@astryxdesign/core/hooks";
import OAuthProvidersSection from "./OAuthProvidersSection";
import type { OAuthProvider } from "@/src/lib/models/oauth-providers";
import { CheckboxInput } from "@/src/components/ui/FormBooleanControls";
import {
  updateDnsProviderSettingsAction,
  updateGeneralSettingsAction,
  updateAcmeSettingsAction,
  updateAuthentikSettingsAction,
  updateMetricsSettingsAction,
  updateAvatarSettingsAction,
  updatePasswordPolicySettingsAction,
  updateLoggingSettingsAction,
  updateDnsSettingsAction,
  updateUpstreamDnsResolutionSettingsAction,
  updateInstanceModeAction,
  updateSlaveMasterTokenAction,
  createSlaveInstanceAction,
  deleteSlaveInstanceAction,
  toggleSlaveInstanceAction,
  syncSlaveInstancesAction,
  updateGeoBlockSettingsAction,
  updateErrorPagesSettingsAction,
  updateTrustedProxiesSettingsAction,
  updateCaddyBuildSettingsAction,
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
        id: "sync",
        name: "Instance Sync",
        desc: "Standalone, master, or slave coordination",
        icon: Network,
      },
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
        id: "avatars",
        name: "User Avatars",
        desc: "Gravatar fallback for users without an icon",
        icon: UserCircle,
      },
      {
        id: "caddy-build",
        name: "Caddy Build",
        desc: "Which plugins the Caddy image is compiled with",
        icon: Package,
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

// ─── Alert helpers ───────────────────────────────────────────────────────────

function StatusAlert({ message, success }: { message: string; success: boolean }) {
  return <Banner status={success ? "success" : "error"} title={message} />;
}

function InfoAlert({ title, children }: { title: string; children?: ReactNode }) {
  return <Banner status="info" title={title} description={children} />;
}

function WarnAlert({ title, children }: { title: string; children?: ReactNode }) {
  return <Banner status="warning" title={title} description={children} />;
}

// ─── Layout primitives ───────────────────────────────────────────────────────

function FormCard({
  title,
  children,
  footer,
}: {
  title?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <Card padding={4}>
      <VStack gap={4}>
        {title && (
          <>
            <Text type="label" size="xsm" weight="semibold" color="secondary">
              {title}
            </Text>
            <Divider />
          </>
        )}
        {children}
        {footer && (
          <>
            <Divider />
            <HStack justify="end" gap={2}>
              {footer}
            </HStack>
          </>
        )}
      </VStack>
    </Card>
  );
}

/**
 * The "Override master settings" toggle a slave shows above each form. CheckboxInput carries its
 * own label, so the association is real rather than positional.
 */
function OverrideToggle({
  value,
  onChange,
  isDisabled,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  isDisabled?: boolean;
}) {
  return (
    <CheckboxInput
      label="Override master settings"
      htmlName="overrideEnabled"
      value={value}
      onChange={onChange}
      isDisabled={isDisabled}
    />
  );
}

/** Right-aligned submit button, the footer every settings form ends with. */
function SaveButton({ label, isDisabled }: { label: string; isDisabled?: boolean }) {
  return (
    <HStack justify="end">
      <Button type="submit" size="sm" label={label} isDisabled={isDisabled} />
    </HStack>
  );
}

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

/**
 * Narrow-screen navigation: a select naming the current section, replacing a horizontally
 * scrolling strip of fourteen pills.
 */
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
  dnsProvider: DnsProviderSettings | null;
  dnsProviderDefinitions: DnsProviderDefinition[];
  authentik: AuthentikSettings | null;
  metrics: MetricsSettings | null;
  logging: LoggingSettings | null;
  dns: DnsSettings | null;
  upstreamDnsResolution: UpstreamDnsResolutionSettings | null;
  trustedProxies: TrustedProxiesSettings | null;
  globalGeoBlock?: GeoBlockSettings | null;
  globalErrorPages?: ErrorPagesSettings | null;
  oauthProviders: OAuthProvider[];
  localUsersDisabled: boolean;
  avatars: { gravatarEnabled: boolean; fromEnv: boolean };
  passwordPolicy: { requireChangeOnLegacyHash: boolean; fromEnv: boolean };
  caddyBuild: CaddyBuildSettings | null;
  baseUrl: string;
  instanceSync: {
    mode: "standalone" | "master" | "slave";
    modeFromEnv: boolean;
    tokenFromEnv: boolean;
    overrides: {
      general: boolean;
      acme: boolean;
      dnsProvider: boolean;
      authentik: boolean;
      metrics: boolean;
      logging: boolean;
      dns: boolean;
      upstreamDnsResolution: boolean;
      trustedProxies: boolean;
      avatars: boolean;
    };
    slave: {
      hasToken: boolean;
      lastSyncAt: string | null;
      lastSyncError: string | null;
    } | null;
    master: {
      instances: Array<{
        id: number;
        name: string;
        baseUrl: string;
        enabled: boolean;
        lastSyncAt: string | null;
        lastSyncError: string | null;
      }>;
      envInstances: Array<{
        name: string;
        url: string;
      }>;
    } | null;
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
  globalGeoBlock,
  globalErrorPages,
  oauthProviders,
  localUsersDisabled,
  avatars,
  passwordPolicy,
  caddyBuild,
  baseUrl,
  instanceSync,
}: Props) {
  const [active, setActive] = useState("sync");
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
  const [avatarsState, avatarsFormAction] = useActionState(updateAvatarSettingsAction, null);
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
  const [instanceModeState, instanceModeFormAction] = useActionState(
    updateInstanceModeAction,
    null,
  );
  const [slaveTokenState, slaveTokenFormAction] = useActionState(
    updateSlaveMasterTokenAction,
    null,
  );
  const [slaveInstanceState, slaveInstanceFormAction] = useActionState(
    createSlaveInstanceAction,
    null,
  );
  const [syncState, syncFormAction] = useActionState(syncSlaveInstancesAction, null);
  const [geoBlockState, geoBlockFormAction] = useActionState(updateGeoBlockSettingsAction, null);
  const [errorPagesState, errorPagesFormAction] = useActionState(
    updateErrorPagesSettingsAction,
    null,
  );
  const [trustedProxiesState, trustedProxiesFormAction] = useActionState(
    updateTrustedProxiesSettingsAction,
    null,
  );

  const isSlave = instanceSync.mode === "slave";
  const isMaster = instanceSync.mode === "master";
  const [generalOverride, setGeneralOverride] = useState(instanceSync.overrides.general);
  const [acmeOverride, setAcmeOverride] = useState(instanceSync.overrides.acme);
  const [dnsProviderOverride, setDnsProviderOverride] = useState(
    instanceSync.overrides.dnsProvider,
  );
  const [authentikOverride, setAuthentikOverride] = useState(instanceSync.overrides.authentik);
  const [metricsOverride, setMetricsOverride] = useState(instanceSync.overrides.metrics);
  const [avatarsOverride, setAvatarsOverride] = useState(instanceSync.overrides.avatars);
  const [loggingOverride, setLoggingOverride] = useState(instanceSync.overrides.logging);
  const [dnsOverride, setDnsOverride] = useState(instanceSync.overrides.dns);
  const [upstreamDnsResolutionOverride, setUpstreamDnsResolutionOverride] = useState(
    instanceSync.overrides.upstreamDnsResolution,
  );
  const [trustedProxiesOverride, setTrustedProxiesOverride] = useState(
    instanceSync.overrides.trustedProxies,
  );

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
                {active === "sync" && (
                  <SyncSection
                    instanceSync={instanceSync}
                    instanceModeState={instanceModeState}
                    instanceModeFormAction={instanceModeFormAction}
                    slaveTokenState={slaveTokenState}
                    slaveTokenFormAction={slaveTokenFormAction}
                    slaveInstanceState={slaveInstanceState}
                    slaveInstanceFormAction={slaveInstanceFormAction}
                    syncState={syncState}
                    syncFormAction={syncFormAction}
                    isSlave={isSlave}
                    isMaster={isMaster}
                  />
                )}
                {active === "general" && (
                  <GeneralSection
                    general={general}
                    generalState={generalState}
                    generalFormAction={generalFormAction}
                    isSlave={isSlave}
                    generalOverride={generalOverride}
                    setGeneralOverride={setGeneralOverride}
                  />
                )}
                {active === "acme" && (
                  <AcmeSection
                    acme={acme}
                    acmeState={acmeState}
                    acmeFormAction={acmeFormAction}
                    isSlave={isSlave}
                    acmeOverride={acmeOverride}
                    setAcmeOverride={setAcmeOverride}
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
                    isSlave={isSlave}
                    dnsProviderOverride={dnsProviderOverride}
                    setDnsProviderOverride={setDnsProviderOverride}
                  />
                )}
                {active === "dns-resolvers" && (
                  <DnsResolversSection
                    dns={dns}
                    dnsState={dnsState}
                    dnsFormAction={dnsFormAction}
                    isSlave={isSlave}
                    dnsOverride={dnsOverride}
                    setDnsOverride={setDnsOverride}
                  />
                )}
                {active === "upstream-dns" && (
                  <UpstreamDnsSection
                    upstreamDnsResolution={upstreamDnsResolution}
                    upstreamDnsResolutionState={upstreamDnsResolutionState}
                    upstreamDnsResolutionFormAction={upstreamDnsResolutionFormAction}
                    isSlave={isSlave}
                    upstreamDnsResolutionOverride={upstreamDnsResolutionOverride}
                    setUpstreamDnsResolutionOverride={setUpstreamDnsResolutionOverride}
                  />
                )}
                {active === "trusted-proxies" && (
                  <TrustedProxiesSection
                    trustedProxies={trustedProxies}
                    trustedProxiesState={trustedProxiesState}
                    trustedProxiesFormAction={trustedProxiesFormAction}
                    isSlave={isSlave}
                    trustedProxiesOverride={trustedProxiesOverride}
                    setTrustedProxiesOverride={setTrustedProxiesOverride}
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
                    isSlave={isSlave}
                    authentikOverride={authentikOverride}
                    setAuthentikOverride={setAuthentikOverride}
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
                    isSlave={isSlave}
                    avatarsOverride={avatarsOverride}
                    setAvatarsOverride={setAvatarsOverride}
                  />
                )}
                {active === "caddy-build" && (
                  <CaddyBuildSection
                    caddyBuild={caddyBuild}
                    caddyBuildState={caddyBuildState}
                    caddyBuildFormAction={caddyBuildFormAction}
                  />
                )}
                {active === "metrics" && (
                  <MetricsSection
                    metrics={metrics}
                    metricsState={metricsState}
                    metricsFormAction={metricsFormAction}
                    isSlave={isSlave}
                    metricsOverride={metricsOverride}
                    setMetricsOverride={setMetricsOverride}
                  />
                )}
                {active === "logging" && (
                  <LoggingSection
                    logging={logging}
                    loggingState={loggingState}
                    loggingFormAction={loggingFormAction}
                    isSlave={isSlave}
                    loggingOverride={loggingOverride}
                    setLoggingOverride={setLoggingOverride}
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

// ─── Section: Instance Sync ──────────────────────────────────────────────────

const MODE_OPTIONS = [
  { value: "standalone", label: "Standalone" },
  { value: "master", label: "Master" },
  { value: "slave", label: "Slave" },
];

function SyncSection({
  instanceSync,
  instanceModeState,
  instanceModeFormAction,
  slaveTokenState,
  slaveTokenFormAction,
  slaveInstanceState,
  slaveInstanceFormAction,
  syncState,
  syncFormAction,
  isSlave,
  isMaster,
}: {
  instanceSync: Props["instanceSync"];
  instanceModeState: { success: boolean; message?: string } | null;
  instanceModeFormAction: (payload: FormData) => void;
  slaveTokenState: { success: boolean; message?: string } | null;
  slaveTokenFormAction: (payload: FormData) => void;
  slaveInstanceState: { success: boolean; message?: string } | null;
  slaveInstanceFormAction: (payload: FormData) => void;
  syncState: { success: boolean; message?: string } | null;
  syncFormAction: (payload: FormData) => void;
  isSlave: boolean;
  isMaster: boolean;
}) {
  const [mode, setMode] = useState<string>(instanceSync.mode);
  const [masterToken, setMasterToken] = useState("");
  const [clearToken, setClearToken] = useState(false);
  const [instName, setInstName] = useState("");
  const [instBaseUrl, setInstBaseUrl] = useState("");
  const [instApiToken, setInstApiToken] = useState("");

  return (
    <>
      <FormCard title="Mode">
        <form action={instanceModeFormAction}>
          <VStack gap={3}>
            {instanceSync.modeFromEnv && (
              <InfoAlert title="Instance mode is set by the INSTANCE_MODE environment variable">
                It cannot be changed at runtime.
              </InfoAlert>
            )}
            {instanceModeState?.message && (
              <StatusAlert
                message={instanceModeState.message}
                success={instanceModeState.success}
              />
            )}
            <Selector
              label="Instance mode"
              description="Standalone runs alone. Master pushes config to slaves. Slave pulls from a master."
              htmlName="mode"
              options={MODE_OPTIONS}
              value={mode}
              onChange={setMode}
              isDisabled={instanceSync.modeFromEnv}
            />
            <SaveButton label="Save instance mode" isDisabled={instanceSync.modeFromEnv} />
          </VStack>
        </form>
      </FormCard>

      {isSlave && (
        <FormCard title="Master Connection">
          <VStack gap={3}>
            <form action={slaveTokenFormAction}>
              <VStack gap={3}>
                {instanceSync.tokenFromEnv && (
                  <InfoAlert title="Sync token is set by the INSTANCE_SYNC_TOKEN environment variable">
                    It cannot be changed at runtime.
                  </InfoAlert>
                )}
                {slaveTokenState?.message && (
                  <StatusAlert
                    message={slaveTokenState.message}
                    success={slaveTokenState.success}
                  />
                )}
                {instanceSync.slave?.hasToken && !instanceSync.tokenFromEnv && (
                  <InfoAlert title="A master sync token is configured">
                    Leave the token field blank to keep it, or select &ldquo;Remove existing
                    token&rdquo; to delete it.
                  </InfoAlert>
                )}
                <TextInput
                  {...AUTOFILL_NEW_PASSWORD}
                  label="Master sync token"
                  type="password"
                  htmlName="masterToken"
                  value={masterToken}
                  onChange={setMasterToken}
                  placeholder="Enter new token"
                  isDisabled={instanceSync.tokenFromEnv}
                />
                <CheckboxInput
                  label="Remove existing token"
                  htmlName="clearToken"
                  value={clearToken}
                  onChange={setClearToken}
                  isDisabled={!instanceSync.slave?.hasToken || instanceSync.tokenFromEnv}
                />
                <SaveButton label="Save master token" isDisabled={instanceSync.tokenFromEnv} />
              </VStack>
            </form>
            {instanceSync.slave?.lastSyncError ? (
              <WarnAlert
                title={
                  instanceSync.slave?.lastSyncAt
                    ? `Last sync: ${instanceSync.slave.lastSyncAt}`
                    : "No sync payload has been received yet."
                }
              >
                {instanceSync.slave?.lastSyncError}
              </WarnAlert>
            ) : (
              <InfoAlert
                title={
                  instanceSync.slave?.lastSyncAt
                    ? `Last sync: ${instanceSync.slave.lastSyncAt}`
                    : "No sync payload has been received yet."
                }
              />
            )}
          </VStack>
        </FormCard>
      )}

      {isMaster && (
        <FormCard
          title={`Slave Instances (${(instanceSync.master?.instances.length ?? 0) + (instanceSync.master?.envInstances.length ?? 0)})`}
        >
          <VStack gap={3}>
            <form action={slaveInstanceFormAction}>
              <VStack gap={3}>
                {slaveInstanceState?.message && (
                  <StatusAlert
                    message={slaveInstanceState.message}
                    success={slaveInstanceState.success}
                  />
                )}
                <Grid columns={{ minWidth: 220, max: 2 }} gap={3}>
                  <TextInput
                    label="Instance name"
                    htmlName="name"
                    value={instName}
                    onChange={setInstName}
                    placeholder="Edge node EU-1"
                  />
                  <TextInput
                    label="Base URL"
                    htmlName="baseUrl"
                    value={instBaseUrl}
                    onChange={setInstBaseUrl}
                    placeholder="https://slave-1.example.com"
                  />
                </Grid>
                <TextInput
                  {...AUTOFILL_NEW_PASSWORD}
                  label="Slave API token"
                  type="password"
                  htmlName="apiToken"
                  value={instApiToken}
                  onChange={setInstApiToken}
                />
                <HStack justify="end">
                  <Button type="submit" size="sm" label="Add slave instance" />
                </HStack>
              </VStack>
            </form>

            {/* Its own form: nesting one inside the add-instance form was
                invalid HTML, and the browser silently dropped it. */}
            <form action={syncFormAction}>
              <VStack gap={2}>
                {syncState?.message && (
                  <StatusAlert message={syncState.message} success={syncState.success} />
                )}
                <HStack>
                  <Button type="submit" variant="secondary" size="sm" label="Sync now" />
                </HStack>
              </VStack>
            </form>

            {instanceSync.master?.instances.length === 0 &&
              instanceSync.master?.envInstances.length === 0 && (
                <InfoAlert title="No slave instances configured yet." />
              )}

            {instanceSync.master?.envInstances && instanceSync.master.envInstances.length > 0 && (
              <VStack gap={2}>
                <Text type="label" size="xsm" weight="semibold" color="secondary">
                  Environment-configured (INSTANCE_SLAVES)
                </Text>
                {instanceSync.master.envInstances.map((instance) => (
                  <Card key={instance.url} variant="muted" padding={3}>
                    <HStack justify="between" gap={3} wrap="wrap" vAlign="center">
                      <VStack gap={0}>
                        <Text type="body" size="sm" weight="semibold">
                          {instance.name}
                        </Text>
                        <Text type="code" size="xsm" color="secondary">
                          {instance.url}
                        </Text>
                      </VStack>
                      <StatusChip status="active" label="ENV" />
                    </HStack>
                  </Card>
                ))}
              </VStack>
            )}

            {instanceSync.master?.instances && instanceSync.master.instances.length > 0 && (
              <VStack gap={2}>
                <Text type="label" size="xsm" weight="semibold" color="secondary">
                  UI-configured instances
                </Text>
                {instanceSync.master.instances.map((instance) => (
                  <Card key={instance.id} padding={3}>
                    <HStack justify="between" gap={3} wrap="wrap" vAlign="center">
                      <VStack gap={0}>
                        <Text type="body" size="sm" weight="semibold">
                          {instance.name}
                        </Text>
                        <Text type="code" size="xsm" color="secondary">
                          {instance.baseUrl}
                        </Text>
                        <Text type="body" size="xsm" color="secondary">
                          {instance.lastSyncAt
                            ? `Last sync: ${instance.lastSyncAt}`
                            : "No sync yet"}
                        </Text>
                        {instance.lastSyncError && (
                          <Text type="body" size="xsm" color="secondary">
                            {instance.lastSyncError}
                          </Text>
                        )}
                      </VStack>
                      <HStack gap={2}>
                        <form action={toggleSlaveInstanceAction}>
                          <input type="hidden" name="instanceId" value={instance.id} />
                          <input
                            type="hidden"
                            name="enabled"
                            value={instance.enabled ? "" : "on"}
                          />
                          <Button
                            type="submit"
                            variant="secondary"
                            size="sm"
                            label={instance.enabled ? "Disable" : "Enable"}
                          />
                        </form>
                        <form action={deleteSlaveInstanceAction}>
                          <input type="hidden" name="instanceId" value={instance.id} />
                          <Button type="submit" variant="destructive" size="sm" label="Remove" />
                        </form>
                      </HStack>
                    </HStack>
                  </Card>
                ))}
              </VStack>
            )}
          </VStack>
        </FormCard>
      )}
    </>
  );
}

// ─── Section: General ────────────────────────────────────────────────────────

function GeneralSection({
  general,
  generalState,
  generalFormAction,
  isSlave,
  generalOverride,
  setGeneralOverride,
}: {
  general: GeneralSettings | null;
  generalState: { success: boolean; message?: string } | null;
  generalFormAction: (payload: FormData) => void;
  isSlave: boolean;
  generalOverride: boolean;
  setGeneralOverride: (v: boolean) => void;
}) {
  const [primaryDomain, setPrimaryDomain] = useState(
    general?.primaryDomain ?? "caddyproxymanager.com",
  );
  const [acmeEmail, setAcmeEmail] = useState(general?.acmeEmail ?? "");
  const disabled = isSlave && !generalOverride;

  return (
    <FormCard title="Defaults">
      <form action={generalFormAction}>
        <VStack gap={3}>
          {generalState?.message && (
            <StatusAlert message={generalState.message} success={generalState.success} />
          )}
          {isSlave && <OverrideToggle value={generalOverride} onChange={setGeneralOverride} />}
          <TextInput
            {...NATIVE_REQUIRED}
            label="Primary domain"
            description="Default domain shown when creating new proxy hosts."
            htmlName="primaryDomain"
            value={primaryDomain}
            onChange={setPrimaryDomain}
            isRequired
            isDisabled={disabled}
          />
          <TextInput
            label="ACME contact email"
            description="Used by Let's Encrypt for expiry notifications."
            type="email"
            htmlName="acmeEmail"
            value={acmeEmail}
            onChange={setAcmeEmail}
            isDisabled={disabled}
          />
          <SaveButton label="Save general settings" />
        </VStack>
      </form>
    </FormCard>
  );
}

// ─── Section: ACME Server ────────────────────────────────────────────────────

function AcmeSection({
  acme,
  acmeState,
  acmeFormAction,
  isSlave,
  acmeOverride,
  setAcmeOverride,
}: {
  acme: AcmeSettings | null;
  acmeState: { success: boolean; message?: string } | null;
  acmeFormAction: (payload: FormData) => void;
  isSlave: boolean;
  acmeOverride: boolean;
  setAcmeOverride: (v: boolean) => void;
}) {
  const [caUrl, setCaUrl] = useState(acme?.caUrl ?? "");
  const [caRootPem, setCaRootPem] = useState(acme?.caRootPem ?? "");
  const disabled = isSlave && !acmeOverride;

  return (
    <FormCard title="Custom ACME Directory">
      <form action={acmeFormAction}>
        <VStack gap={3}>
          {acmeState?.message && (
            <StatusAlert message={acmeState.message} success={acmeState.success} />
          )}
          {isSlave && <OverrideToggle value={acmeOverride} onChange={setAcmeOverride} />}
          <TextInput
            label="ACME directory URL"
            isOptional
            description="Leave empty to use the Let's Encrypt default. For an internal CA (OpenBao, Step-CA, Windows ADCS), paste its ACME directory URL — must be HTTPS."
            htmlName="caUrl"
            value={caUrl}
            onChange={setCaUrl}
            placeholder="https://ca.internal.example.com/acme/acme/directory"
            isDisabled={disabled}
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
            isDisabled={disabled}
          />
          <SaveButton label="Save ACME settings" isDisabled={disabled} />
        </VStack>
      </form>
    </FormCard>
  );
}

// ─── Section: DNS Providers ──────────────────────────────────────────────────

function DnsProviderCredentialFields({
  providerDef,
  isDisabled,
}: {
  providerDef: DnsProviderDefinition;
  isDisabled: boolean;
}) {
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
          isDisabled={isDisabled}
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
  isSlave,
  dnsProviderOverride,
  setDnsProviderOverride,
}: {
  dnsProvider: DnsProviderSettings | null;
  dnsProviderDefinitions: DnsProviderDefinition[];
  dnsProviderState: { success: boolean; message?: string } | null;
  dnsProviderFormAction: (payload: FormData) => void;
  selectedProvider: string;
  setSelectedProvider: (v: string) => void;
  configuredProviders: string[];
  isSlave: boolean;
  dnsProviderOverride: boolean;
  setDnsProviderOverride: (v: boolean) => void;
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
  const disabled = isSlave && !dnsProviderOverride;

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
      {isSlave && (
        /* Lives outside the form it belongs to, so its value is carried by the
           hidden field inside dnsp-add-form rather than by the control itself. */
        <CheckboxInput
          label="Override master settings"
          value={dnsProviderOverride}
          onChange={setDnsProviderOverride}
        />
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
                          {isSlave && (
                            <input
                              type="hidden"
                              name="overrideEnabled"
                              value={dnsProviderOverride ? "on" : ""}
                            />
                          )}
                          <Button type="submit" variant="secondary" size="sm" label="Set default" />
                        </form>
                      )}
                      <form action={dnsProviderFormAction}>
                        <input type="hidden" name="action" value="remove" />
                        <input type="hidden" name="provider" value={name} />
                        {isSlave && (
                          <input
                            type="hidden"
                            name="overrideEnabled"
                            value={dnsProviderOverride ? "on" : ""}
                          />
                        )}
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
                {isSlave && (
                  <input
                    type="hidden"
                    name="overrideEnabled"
                    value={dnsProviderOverride ? "on" : ""}
                  />
                )}
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
          <>
            {isSlave && (
              <input
                type="hidden"
                name="overrideEnabled"
                form="dnsp-add-form"
                value={dnsProviderOverride ? "on" : ""}
              />
            )}
            <Button
              type="submit"
              form="dnsp-add-form"
              size="sm"
              label={hasProvider && isUpdate ? "Update provider" : "Add provider"}
              isDisabled={!hasProvider}
            />
          </>
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
              isDisabled={disabled}
            />

            {selectedUnavailable && (
              <WarnAlert title="This provider's Caddy module is disabled">
                Enable it under Settings → Caddy Build and rebuild Caddy before using it for DNS-01
                challenges. Credentials saved now will not be used until then.
              </WarnAlert>
            )}

            {hasProvider && providerDef && (
              <>
                <DnsProviderCredentialFields
                  key={providerDef.name}
                  providerDef={providerDef}
                  isDisabled={disabled}
                />
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
            {isSlave && (
              <input type="hidden" name="overrideEnabled" value={dnsProviderOverride ? "on" : ""} />
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
  isSlave,
  dnsOverride,
  setDnsOverride,
}: {
  dns: DnsSettings | null;
  dnsState: { success: boolean; message?: string } | null;
  dnsFormAction: (payload: FormData) => void;
  isSlave: boolean;
  dnsOverride: boolean;
  setDnsOverride: (v: boolean) => void;
}) {
  const [enabled, setEnabled] = useState(dns?.enabled ?? false);
  const [resolvers, setResolvers] = useState(dns?.resolvers?.join("\n") ?? "");
  const [fallbacks, setFallbacks] = useState(dns?.fallbacks?.join("\n") ?? "");
  const [timeout, setTimeoutValue] = useState(dns?.timeout ?? "");
  const disabled = isSlave && !dnsOverride;

  return (
    <>
      <FormCard>
        <form action={dnsFormAction}>
          <VStack gap={3}>
            {dnsState?.message && (
              <StatusAlert message={dnsState.message} success={dnsState.success} />
            )}
            {isSlave && <OverrideToggle value={dnsOverride} onChange={setDnsOverride} />}
            <CheckboxInput
              label="Enable custom DNS resolvers"
              htmlName="enabled"
              value={enabled}
              onChange={setEnabled}
              isDisabled={disabled}
            />
            <TextArea
              label="Primary resolvers"
              isOptional
              htmlName="resolvers"
              value={resolvers}
              onChange={setResolvers}
              placeholder={"1.1.1.1\n9.9.9.9"}
              rows={2}
              isDisabled={disabled}
            />
            <TextArea
              label="Fallback resolvers"
              isOptional
              htmlName="fallbacks"
              value={fallbacks}
              onChange={setFallbacks}
              placeholder={"1.0.0.1\n149.112.112.112"}
              rows={2}
              isDisabled={disabled}
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
              isDisabled={disabled}
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
  isSlave,
  upstreamDnsResolutionOverride,
  setUpstreamDnsResolutionOverride,
}: {
  upstreamDnsResolution: UpstreamDnsResolutionSettings | null;
  upstreamDnsResolutionState: { success: boolean; message?: string } | null;
  upstreamDnsResolutionFormAction: (payload: FormData) => void;
  isSlave: boolean;
  upstreamDnsResolutionOverride: boolean;
  setUpstreamDnsResolutionOverride: (v: boolean) => void;
}) {
  const [enabled, setEnabled] = useState(upstreamDnsResolution?.enabled ?? false);
  const [family, setFamily] = useState<string>(upstreamDnsResolution?.family ?? "both");
  const disabled = isSlave && !upstreamDnsResolutionOverride;

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
            {isSlave && (
              <OverrideToggle
                value={upstreamDnsResolutionOverride}
                onChange={setUpstreamDnsResolutionOverride}
              />
            )}
            <CheckboxInput
              label="Enable upstream DNS pinning"
              description="Resolves upstream hostnames at config-apply time and writes IPs into Caddy's active config."
              htmlName="enabled"
              value={enabled}
              onChange={setEnabled}
              isDisabled={disabled}
            />
            <Selector
              label="Address family"
              description="Both resolves AAAA + A with IPv6 preferred ordering."
              htmlName="family"
              options={FAMILY_OPTIONS}
              value={family}
              onChange={setFamily}
              isDisabled={disabled}
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
  isSlave,
  trustedProxiesOverride,
  setTrustedProxiesOverride,
}: {
  trustedProxies: TrustedProxiesSettings | null;
  trustedProxiesState: { success: boolean; message?: string } | null;
  trustedProxiesFormAction: (payload: FormData) => void;
  isSlave: boolean;
  trustedProxiesOverride: boolean;
  setTrustedProxiesOverride: (v: boolean) => void;
}) {
  const [ranges, setRanges] = useState((trustedProxies?.ranges ?? []).join("\n"));
  const [clientIpHeaders, setClientIpHeaders] = useState(
    (trustedProxies?.client_ip_headers ?? []).join("\n"),
  );
  const [strict, setStrict] = useState(trustedProxies?.strict ?? false);
  const [defaultGeoblock, setDefaultGeoblock] = useState(trustedProxies?.default_geoblock ?? false);
  const disabled = isSlave && !trustedProxiesOverride;

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
            {isSlave && (
              <OverrideToggle value={trustedProxiesOverride} onChange={setTrustedProxiesOverride} />
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
              isDisabled={disabled}
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
              isDisabled={disabled}
            />
            <CheckboxInput
              label="Enable strict trusted proxies"
              description="Only trust the client IP headers from the configured proxies, rejecting spoofed values from untrusted peers."
              htmlName="strict"
              value={strict}
              onChange={setStrict}
              isDisabled={disabled}
            />
            <CheckboxInput
              label="Default geoblock trusted proxies from this list"
              description="Use these ranges as the default trusted-proxy list for global geoblocking so the two can't silently disagree. A geoblock list set explicitly wins."
              htmlName="defaultGeoblock"
              value={defaultGeoblock}
              onChange={setDefaultGeoblock}
              isDisabled={disabled}
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
  isSlave,
  authentikOverride,
  setAuthentikOverride,
}: {
  authentik: AuthentikSettings | null;
  authentikState: { success: boolean; message?: string } | null;
  authentikFormAction: (payload: FormData) => void;
  isSlave: boolean;
  authentikOverride: boolean;
  setAuthentikOverride: (v: boolean) => void;
}) {
  const [outpostDomain, setOutpostDomain] = useState(authentik?.outpostDomain ?? "");
  const [outpostUpstream, setOutpostUpstream] = useState(authentik?.outpostUpstream ?? "");
  const [authEndpoint, setAuthEndpoint] = useState(authentik?.authEndpoint ?? "");
  const disabled = isSlave && !authentikOverride;

  return (
    <FormCard>
      <form action={authentikFormAction}>
        <VStack gap={3}>
          {authentikState?.message && (
            <StatusAlert message={authentikState.message} success={authentikState.success} />
          )}
          {isSlave && <OverrideToggle value={authentikOverride} onChange={setAuthentikOverride} />}
          <TextInput
            {...NATIVE_REQUIRED}
            label="Outpost domain"
            htmlName="outpostDomain"
            value={outpostDomain}
            onChange={setOutpostDomain}
            placeholder="outpost.goauthentik.io"
            isRequired
            isDisabled={disabled}
          />
          <TextInput
            {...NATIVE_REQUIRED}
            label="Outpost upstream"
            htmlName="outpostUpstream"
            value={outpostUpstream}
            onChange={setOutpostUpstream}
            placeholder="http://authentik-server:9000"
            isRequired
            isDisabled={disabled}
          />
          <TextInput
            label="Auth endpoint"
            isOptional
            htmlName="authEndpoint"
            value={authEndpoint}
            onChange={setAuthEndpoint}
            placeholder="/outpost.goauthentik.io/auth/caddy"
            isDisabled={disabled}
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
  oauthProviders: OAuthProvider[];
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
 * Not offered as a slave override: whether to force a password reset is a local security decision,
 * and inheriting it from a master would let one instance lock another's users out.
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
  isSlave,
  avatarsOverride,
  setAvatarsOverride,
}: {
  avatars: { gravatarEnabled: boolean; fromEnv: boolean };
  avatarsState: { success: boolean; message?: string } | null;
  avatarsFormAction: (payload: FormData) => void;
  isSlave: boolean;
  avatarsOverride: boolean;
  setAvatarsOverride: (v: boolean) => void;
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
          {isSlave && !avatars.fromEnv && (
            <OverrideToggle value={avatarsOverride} onChange={setAvatarsOverride} />
          )}
          <CheckboxInput
            label="Use Gravatar when a user has no icon"
            description="For users with no icon of their own, look one up from gravatar.com by their email address. Their browser contacts gravatar.com directly, which discloses their IP and a hash of their address to a third party. Accounts with a local-only address are never looked up, and anyone without a Gravatar falls back to their initial."
            htmlName="gravatarEnabled"
            value={gravatarEnabled}
            onChange={setGravatarEnabled}
            isDisabled={avatars.fromEnv || (isSlave && !avatarsOverride)}
          />
          <SaveButton label="Save avatar settings" isDisabled={avatars.fromEnv} />
        </VStack>
      </form>
    </FormCard>
  );
}

// ─── Section: Caddy Build ────────────────────────────────────────────────────

/**
 * Not offered as a slave override: the module list describes a binary built on this host, so
 * inheriting a master's choice would tell a slave its Caddy has plugins it never compiled.
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
  isSlave,
  metricsOverride,
  setMetricsOverride,
}: {
  metrics: MetricsSettings | null;
  metricsState: { success: boolean; message?: string } | null;
  metricsFormAction: (payload: FormData) => void;
  isSlave: boolean;
  metricsOverride: boolean;
  setMetricsOverride: (v: boolean) => void;
}) {
  const [enabled, setEnabled] = useState(metrics?.enabled ?? false);
  const [port, setPort] = useState(metrics?.port ?? 9090);
  const disabled = isSlave && !metricsOverride;

  return (
    <>
      <FormCard>
        <form action={metricsFormAction}>
          <VStack gap={3}>
            {metricsState?.message && (
              <StatusAlert message={metricsState.message} success={metricsState.success} />
            )}
            {isSlave && <OverrideToggle value={metricsOverride} onChange={setMetricsOverride} />}
            <CheckboxInput
              label="Enable metrics endpoint"
              description="Prometheus-compatible scrape endpoint, exposed on a dedicated port."
              htmlName="enabled"
              value={enabled}
              onChange={setEnabled}
              isDisabled={disabled}
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
              isDisabled={disabled}
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
  isSlave,
  loggingOverride,
  setLoggingOverride,
}: {
  logging: LoggingSettings | null;
  loggingState: { success: boolean; message?: string } | null;
  loggingFormAction: (payload: FormData) => void;
  isSlave: boolean;
  loggingOverride: boolean;
  setLoggingOverride: (v: boolean) => void;
}) {
  const [enabled, setEnabled] = useState(logging?.enabled ?? false);
  const [format, setFormat] = useState<string>(logging?.format ?? "json");
  const disabled = isSlave && !loggingOverride;

  return (
    <>
      <FormCard>
        <form action={loggingFormAction}>
          <VStack gap={3}>
            {loggingState?.message && (
              <StatusAlert message={loggingState.message} success={loggingState.success} />
            )}
            {isSlave && <OverrideToggle value={loggingOverride} onChange={setLoggingOverride} />}
            <CheckboxInput
              label="Enable access logging"
              htmlName="enabled"
              value={enabled}
              onChange={setEnabled}
              isDisabled={disabled}
            />
            <Selector
              label="Format"
              htmlName="format"
              options={LOG_FORMAT_OPTIONS}
              value={format}
              onChange={setFormat}
              isDisabled={disabled}
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
