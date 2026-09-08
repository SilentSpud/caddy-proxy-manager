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
  Network,
  RefreshCw,
  MonitorSmartphone,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Badge } from "@astryxdesign/core/Badge";
import { Breadcrumbs, BreadcrumbItem } from "@astryxdesign/core/Breadcrumbs";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Code } from "@astryxdesign/core/Code";
import { AppDialog } from "@/src/components/ui/AppDialog";
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
import type { TailscaleSettingsView } from "@/src/lib/caddy-tailscale";
import type { DashboardDnsCheck, DashboardHostSettings } from "@/src/lib/dashboard-host";
import type { UpdateStatus } from "@/src/lib/updates";
import { CaddyBuildFields } from "@/components/caddy-modules/CaddyBuildFields";
import { dnsModuleId } from "@/src/lib/caddy-modules";
import {
  ModuleGated,
  useDisabledReason,
  useModuleGate,
} from "@/components/caddy-modules/ModuleGate";
import { GeoBlockFields } from "@/components/proxy-hosts/GeoBlockFields";
import { ErrorPagesFields } from "@/components/proxy-hosts/ErrorPagesFields";
import { useMediaQuery } from "@astryxdesign/core/hooks";
import OAuthProvidersSection from "./OAuthProvidersSection";
import { CheckboxInput } from "@/src/components/ui/FormBooleanControls";
import { GeneratedPasswordField } from "@/src/components/ui/GeneratedPasswordField";
import type { OAuthProviderView } from "@/src/lib/oauth-provider-view";
import type { AgentStatus } from "@cpm/shared";
import type { AgentResult } from "@/src/lib/agent/client";
import type { PairedAgent } from "@/src/lib/models/agents";
import { useTranslations } from "next-intl";
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
  updateUpdateSettingsAction,
  checkForUpdatesAction,
  updatePasswordPolicySettingsAction,
  updateLoggingSettingsAction,
  updateDnsSettingsAction,
  updateUpstreamDnsResolutionSettingsAction,
  updateGeoBlockSettingsAction,
  updateErrorPagesSettingsAction,
  updateTrustedProxiesSettingsAction,
  updateCaddyBuildSettingsAction,
  updateDefaultResponseSettingsAction,
  updateDashboardSettingsAction,
  checkDashboardDnsAction,
  updateTailscaleSettingsAction,
  pairingCodeAction,
  unpairAgentAction,
} from "./actions";

// ─── Settings navigation catalog ─────────────────────────────────────────────

type SettingItem = {
  id: string;
  name: string;
  desc: string;
  icon: LucideIcon;
  /**
   * Environment variables that configure this section, shown as tokens beside its name.
   *
   * An operator arrives here from a `.env` file, so the variable name is the handle they already
   * have. Only variables that set a value this section shows belong here: a near-miss sends
   * someone to a page that cannot change what they came to change. `DASHBOARD_DOMAIN` belongs to
   * Dashboard Host and not to General, whose default domain is a starting value for new proxy
   * hosts and is configured nowhere but the database. The ones a database setting supersedes are
   * in `src/lib/settings/registry.ts`, which is where their precedence is defined.
   */
  env?: readonly string[];
  /**
   * Variables the search should match that are not worth showing. For a section configured by a
   * whole family of variables, `env` carries the prefix and this carries the members, so typing
   * any one of them still lands on the section.
   */
  envSearch?: readonly string[];
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
        env: ["ACME_CA_ROOT_DIR"],
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
        env: ["AVATAR_GRAVATAR"],
      },
      {
        id: "branding",
        name: "Branding",
        desc: "The favicon browsers show for this instance",
        icon: Image,
      },
      {
        id: "updates",
        name: "Updates",
        desc: "Whether to check the registry for a newer release, and which one",
        icon: RefreshCw,
        env: ["UPDATE_CHECK_ENABLED", "UPDATE_IMAGE_REPOSITORY"],
      },
      {
        id: "caddy-build",
        name: "Caddy Build",
        desc: "Which plugins the Caddy image is compiled with",
        icon: Package,
        env: ["CADDY_BUILD_TIMEOUT"],
      },
      {
        id: "dashboard",
        name: "Dashboard Host",
        desc: "Serve this dashboard through Caddy, on a domain of its own",
        icon: MonitorSmartphone,
        env: ["DASHBOARD_DOMAIN"],
      },
      {
        id: "agent",
        name: "Agent",
        desc: "The service that recreates and rebuilds the Caddy container",
        icon: Cpu,
        env: ["CONTROLLER_URL", "AGENT_MODE", "PAIRING_CODE", "CADDY_API_URL"],
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
      {
        id: "tailscale",
        name: "Tailscale",
        desc: "Node defaults for hosts served on, or reached over, your tailnet",
        icon: Network,
        env: ["TS_AUTHKEY"],
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
        env: ["GEOIP_ENABLED", "GEOIPUPDATE_ACCOUNT_ID", "GEOIPUPDATE_LICENSE_KEY"],
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
        env: ["FORWARD_AUTH_INTERNAL_URL"],
      },
      {
        id: "oauth",
        name: "OAuth Providers",
        desc: "OAuth/OIDC SSO providers",
        icon: KeyRound,
        // A provider's whole configuration is one family of variables, and `runEnvProviderSync`
        // reads every one of them into `oauth_providers` at startup. Nineteen tokens under the
        // heading would drown it, so the prefix is shown and the members stay searchable.
        env: ["OAUTH_*"],
        envSearch: [
          "OAUTH_ENABLED",
          "OAUTH_PROVIDER_NAME",
          "OAUTH_ISSUER",
          "OAUTH_CLIENT_ID",
          "OAUTH_CLIENT_SECRET",
          "OAUTH_AUTHORIZATION_URL",
          "OAUTH_TOKEN_URL",
          "OAUTH_USERINFO_URL",
          "OAUTH_SCOPES",
          "OAUTH_ALLOW_AUTO_LINKING",
          "OAUTH_DEFAULT_ROLE",
          "OAUTH_ROLE_MAPPING",
          "OAUTH_SYNC_GROUPS",
          "OAUTH_GROUPS_CLAIM",
          "OAUTH_GROUP_PREFIX",
          "OAUTH_ADMIN_GROUP",
          "OAUTH_OPERATOR_GROUP",
          "OAUTH_USER_GROUP",
          "OAUTH_VIEWER_GROUP",
        ],
      },
      {
        id: "password-policy",
        name: "Password Policy",
        desc: "Migrate users off older password hashes",
        icon: KeyRound,
        env: ["AUTH_REQUIRE_PASSWORD_CHANGE_ON_LEGACY_HASH"],
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
        env: [
          "ANALYTICS_ENABLED",
          "CLICKHOUSE_URL",
          "CLICKHOUSE_USER",
          "CLICKHOUSE_PASSWORD",
          "CLICKHOUSE_DB",
          "CLICKHOUSE_RETENTION_DAYS",
        ],
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
  auxiliaryData: { desc: string; group: string; env: readonly string[] };
};

const PALETTE_ITEMS: PaletteItem[] = ALL_ITEMS.map((item) => ({
  id: item.id,
  label: item.name,
  auxiliaryData: {
    desc: item.desc,
    group: item.groupLabel,
    env: [...(item.env ?? []), ...(item.envSearch ?? [])],
  },
}));

// Keywords let a search match a setting's description or its group, as the old CommandItem
// `value` string concatenation did — and its environment variables, so an operator who knows a
// setting only as the line in their `.env` can search for that name and land on the page that
// owns it.
const PALETTE_SOURCE = createStaticSource(PALETTE_ITEMS, {
  keywords: (item) => [
    item.auxiliaryData.desc,
    item.auxiliaryData.group,
    ...item.auxiliaryData.env,
  ],
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
  const t = useTranslations("settings");
  return (
    <CommandPalette
      isOpen={open}
      onOpenChange={onOpenChange}
      label={t("settingsSearchLabel")}
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
  const t = useTranslations("settings");
  return (
    <VStack gap={2} padding={3}>
      <Button
        variant="secondary"
        size="sm"
        width="100%"
        icon={<Search />}
        label={t("settingsSearchButtonLabel")}
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
  const t = useTranslations("settings");
  return (
    <VStack gap={2} data-testid="mobile-settings-nav">
      <Button
        variant="secondary"
        size="sm"
        width="100%"
        icon={<Search />}
        label={t("settingsSearchButtonLabel")}
        onClick={onSearchClick}
      />
      <Selector
        label={t("settingsSection")}
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

/**
 * The environment variables a section is configured by, as tokens beside its name.
 *
 * Named rather than explained: an operator holding a `.env` line recognises `CLICKHOUSE_URL`
 * faster than any sentence about it, and the same string is what the search matches on.
 */
function EnvTokens({ names }: { names?: readonly string[] }) {
  const t = useTranslations("settings");
  if (!names || names.length === 0) return null;
  return (
    // A bare div with an aria-label is not exposed; the role is what gives the tokens a name
    // instead of reading them out as loose words after the heading.
    <HStack
      gap={1}
      vAlign="center"
      wrap="wrap"
      role="group"
      aria-label={t("environmentVariablesLabel")}
    >
      {names.map((name) => (
        <Code key={name} size="inherit" color="secondary">
          {name}
        </Code>
      ))}
    </HStack>
  );
}

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
      <HStack gap={2} vAlign="center" wrap="wrap">
        <Heading level={1}>{item.name}</Heading>
        <EnvTokens names={item.env} />
      </HStack>
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
  agentBuildTargets?: { id: number; name: string; connected: boolean }[];
  agentBuildSelections?: Record<number, CaddyBuildSettings | null>;
  /** How the dashboard is served through Caddy. Always a value: unset reads as off. */
  dashboard: DashboardHostSettings;
  /** Tailscale node defaults, with the auth key replaced by whether one is stored. */
  tailscale: TailscaleSettingsView;
  /** Whether a custom favicon is stored. The bytes are served by its route, never sent here. */
  hasFavicon: boolean;
  updates: UpdateStatus;
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
  agentBuildTargets,
  agentBuildSelections,
  dashboard,
  tailscale,
  hasFavicon,
  updates,
  analytics,
  geoip,
  canManageServices,
  baseUrl,
  agents,
}: Props) {
  const t = useTranslations("settings");
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
  const [dashboardState, dashboardFormAction] = useActionState(updateDashboardSettingsAction, null);
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
  const [updatesState, updatesFormAction] = useActionState(updateUpdateSettingsAction, null);
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
  const [tailscaleState, tailscaleFormAction] = useActionState(updateTailscaleSettingsAction, null);

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
            <LayoutPanel width={260} hasDivider role="navigation" label={t("settingsNavigation")}>
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
                {active === "dashboard" && (
                  <DashboardHostSection
                    dashboard={dashboard}
                    dashboardState={dashboardState}
                    dashboardFormAction={dashboardFormAction}
                  />
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
                {active === "tailscale" && (
                  <TailscaleSection
                    tailscale={tailscale}
                    tailscaleState={tailscaleState}
                    tailscaleFormAction={tailscaleFormAction}
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
                {active === "updates" && (
                  <UpdatesSection
                    updates={updates}
                    updatesState={updatesState}
                    updatesFormAction={updatesFormAction}
                  />
                )}
                {active === "caddy-build" && (
                  <CaddyBuildSection
                    caddyBuild={caddyBuild}
                    caddyBuildState={caddyBuildState}
                    caddyBuildFormAction={caddyBuildFormAction}
                    agents={agentBuildTargets}
                    agentBuildSelections={agentBuildSelections}
                  />
                )}
                {active === "agent" && <AgentSection agents={agents} />}
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
  const t = useTranslations("settings");
  const [defaultDomain, setDefaultDomain] = useState(
    general?.defaultDomain ?? "caddyproxymanager.com",
  );
  const [acmeEmail, setAcmeEmail] = useState(general?.acmeEmail ?? "");

  return (
    <FormCard title={t("defaults")}>
      <form action={generalFormAction}>
        <VStack gap={3}>
          {generalState?.message && (
            <StatusAlert message={generalState.message} success={generalState.success} />
          )}
          <TextInput
            {...NATIVE_REQUIRED}
            label={t("defaultDomain")}
            description={t("defaultDomainHelp")}
            htmlName="defaultDomain"
            value={defaultDomain}
            onChange={setDefaultDomain}
            isRequired
          />
          <TextInput
            label={t("acmeContactEmail")}
            description={t("acmeEmailHelp")}
            type="email"
            htmlName="acmeEmail"
            value={acmeEmail}
            onChange={setAcmeEmail}
          />
          <SaveButton label={t("saveGeneralSettings")} />
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
  const t = useTranslations("settings");
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
      <FormCard title={t("unknownHostHandling")}>
        <form action={defaultResponseFormAction}>
          <VStack gap={3}>
            {defaultResponseState?.message && (
              <StatusAlert
                message={defaultResponseState.message}
                success={defaultResponseState.success}
              />
            )}
            <Selector
              label={t("behavior")}
              description={t("defaultResponseBehaviorHelp")}
              htmlName="mode"
              options={DEFAULT_RESPONSE_MODES}
              value={mode}
              onChange={(v) => setMode(v as DefaultResponseSettings["mode"])}
            />

            {mode === "respond" && (
              <>
                <NumberInput
                  label={t("statusCode")}
                  description={t("defaultResponseStatusHelp")}
                  htmlName="status"
                  min={200}
                  max={599}
                  isIntegerOnly
                  value={status}
                  onChange={setStatus}
                />
                <TextArea
                  label={t("responseBody")}
                  isOptional
                  description={t("defaultResponseBodyHelp")}
                  htmlName="body"
                  value={body}
                  onChange={setBody}
                  rows={8}
                  placeholder={t("notFound")}
                />
              </>
            )}

            {mode === "redirect" && (
              <>
                <Selector
                  label={t("redirectStatus")}
                  description={t("defaultRedirectStatusHelp")}
                  htmlName="status"
                  options={REDIRECT_STATUS_OPTIONS}
                  value={redirectStatus}
                  onChange={setRedirectStatus}
                />
                <TextInput
                  label={t("redirectUrl")}
                  isRequired
                  description={t("defaultRedirectUrlHelp")}
                  htmlName="redirectUrl"
                  value={redirectUrl}
                  onChange={setRedirectUrl}
                  placeholder="https://example.com{http.request.uri}"
                />
              </>
            )}

            {(mode === "respond" || mode === "redirect") && (
              <TextArea
                label={t("responseHeaders")}
                isOptional
                description={t("defaultResponseHeadersHelp")}
                htmlName="headers"
                value={headers}
                onChange={setHeaders}
                rows={4}
                placeholder={"Content-Type: text/html; charset=utf-8\nCache-Control: no-store"}
              />
            )}

            {mode === "abort" && (
              <WarnAlert title={t("abortResponseTitle")}>{t("abortResponseDescription")}</WarnAlert>
            )}

            <SaveButton label={t("saveDefaultResponse")} />
          </VStack>
        </form>
      </FormCard>
      <InfoAlert title={t("defaultResponsePriorityTitle")}>
        {t("defaultResponseTlsDescription")}
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
  const t = useTranslations("settings");
  const [caUrl, setCaUrl] = useState(acme?.caUrl ?? "");
  const [caRootPem, setCaRootPem] = useState(acme?.caRootPem ?? "");

  return (
    <FormCard title={t("customAcmeDirectory")}>
      <form action={acmeFormAction}>
        <VStack gap={3}>
          {acmeState?.message && (
            <StatusAlert message={acmeState.message} success={acmeState.success} />
          )}
          <TextInput
            label={t("acmeDirectoryUrl")}
            isOptional
            description={t("acmeDirectoryHelp")}
            htmlName="caUrl"
            value={caUrl}
            onChange={setCaUrl}
            placeholder="https://ca.internal.example.com/acme/acme/directory"
          />
          <TextArea
            label={t("caRootCertificatePem")}
            isOptional
            description={t("acmeRootCertificateHelp")}
            htmlName="caRootPem"
            value={caRootPem}
            onChange={setCaRootPem}
            placeholder={"-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----"}
            rows={6}
          />
          <SaveButton label={t("saveAcmeSettings")} />
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
  const t = useTranslations("settings");
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
        <FormCard title={t("configuredProviders")}>
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
                      {isDefault && <Badge variant="info" label={t("default")} />}
                    </HStack>
                    <HStack gap={2}>
                      {!isDefault && (
                        <form action={dnsProviderFormAction}>
                          <input type="hidden" name="action" value="set-default" />
                          <input type="hidden" name="provider" value={name} />
                          <Button
                            type="submit"
                            variant="secondary"
                            size="sm"
                            label={t("setDefault")}
                          />
                        </form>
                      )}
                      <form action={dnsProviderFormAction}>
                        <input type="hidden" name="action" value="remove" />
                        <input type="hidden" name="provider" value={name} />
                        <Button type="submit" variant="destructive" size="sm" label={t("remove")} />
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
                <Button type="submit" variant="ghost" size="sm" label={t("clearDefaultHttp01")} />
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
              label={t("provider")}
              description={
                unavailableCount > 0
                  ? `${dnsProviderDefinitions.length} providers supported — ${unavailableCount} unavailable because their Caddy module is disabled`
                  : `${dnsProviderDefinitions.length} providers supported`
              }
              htmlName="provider"
              options={providerOptions}
              value={selectedProvider}
              onChange={setSelectedProvider}
              placeholder={t("dnsProviderPlaceholder")}
              hasSearch
            />

            {selectedUnavailable && (
              <WarnAlert title={t("dnsProviderModuleDisabledTitle")}>
                {t("dnsProviderModuleDisabledDescription")}
              </WarnAlert>
            )}

            {hasProvider && providerDef && (
              <>
                <DnsProviderCredentialFields key={providerDef.name} providerDef={providerDef} />
                {isUpdate && (
                  <InfoAlert title={t("credentialsAreAlreadyConfigured")}>
                    {t("storedCredentialsHelp")}
                  </InfoAlert>
                )}
                {providerDef.docsUrl && (
                  <Link href={providerDef.docsUrl} target="_blank">
                    {t("providerDocumentation")}
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
  const t = useTranslations("settings");
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
              label={t("enableCustomDnsResolvers")}
              htmlName="enabled"
              value={enabled}
              onChange={setEnabled}
            />
            <TextArea
              label={t("primaryResolvers")}
              isOptional
              htmlName="resolvers"
              value={resolvers}
              onChange={setResolvers}
              placeholder={"1.1.1.1\n9.9.9.9"}
              rows={2}
            />
            <TextArea
              label={t("fallbackResolvers")}
              isOptional
              htmlName="fallbacks"
              value={fallbacks}
              onChange={setFallbacks}
              placeholder={"1.0.0.1\n149.112.112.112"}
              rows={2}
            />
            <TextInput
              label={t("queryTimeout")}
              isOptional
              description={t("dnsQueryTimeoutHelp")}
              htmlName="timeout"
              value={timeout}
              onChange={setTimeoutValue}
              placeholder="5s"
              width={160}
            />
            <SaveButton label={t("saveDnsSettings")} />
          </VStack>
        </form>
      </FormCard>
      <InfoAlert title={t("dnsResolversInfoTitle")}>{t("dnsResolversInfoDescription")}</InfoAlert>
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
  const t = useTranslations("settings");
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
              label={t("enableUpstreamDnsPinning")}
              description={t("dnsPinningHelp")}
              htmlName="enabled"
              value={enabled}
              onChange={setEnabled}
            />
            <Selector
              label={t("addressFamily")}
              description={t("dnsAddressFamilyHelp")}
              htmlName="family"
              options={FAMILY_OPTIONS}
              value={family}
              onChange={setFamily}
              width={280}
            />
            <SaveButton label={t("saveUpstreamDnsPinning")} />
          </VStack>
        </form>
      </FormCard>
      <InfoAlert title={t("authentikDefaultsHelp")}>{t("dnsPinningInfoDescription")}</InfoAlert>
    </>
  );
}

// ─── Section: Trusted Proxies ────────────────────────────────────────────────

/**
 * How this dashboard is served through the Caddy it manages.
 *
 * Two things make this section different from the rest of the page. Turning it off can remove the
 * route the reader is using right now, so it asks first when it can tell that is the case — the
 * page is being served on the very domain about to stop being claimed. And TLS is a question about
 * the world rather than a preference, so the DNS check is offered inline: forcing HTTPS on a name
 * that does not resolve here yet buys nothing but a failing certificate order.
 */
function DashboardHostSection({
  dashboard,
  dashboardState,
  dashboardFormAction,
}: {
  dashboard: DashboardHostSettings;
  dashboardState: { success: boolean; message?: string } | null;
  dashboardFormAction: (payload: FormData) => void;
}) {
  const t = useTranslations("settings");
  const [enabled, setEnabled] = useState(dashboard.enabled);
  const [domain, setDomain] = useState(dashboard.domain);
  const [tls, setTls] = useState(dashboard.tls);
  const [check, setCheck] = useState<DashboardDnsCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [confirmDisable, setConfirmDisable] = useState(false);

  // Whether this page arrived through the route in question. Read after mount rather than during
  // render: the server has no window to ask, so deciding it inline would render one button on the
  // server and a different one in the browser, which is a hydration mismatch. Until it resolves
  // the form behaves normally, which is the safe way round — the worst case is the dialog not
  // appearing for the first instant, not a warning that never appears.
  //
  // Compared against what is stored rather than what is typed: the saved domain is what Caddy is
  // serving right now, and a half-typed replacement says nothing about how the reader got here.
  const [servedThroughProxy, setServedThroughProxy] = useState(false);
  useEffect(() => {
    setServedThroughProxy(
      dashboard.enabled &&
        dashboard.domain.trim().toLowerCase() === window.location.hostname.toLowerCase(),
    );
  }, [dashboard.enabled, dashboard.domain]);

  const losingOwnAccess = servedThroughProxy && !enabled;

  async function runCheck() {
    setChecking(true);
    try {
      const result = await checkDashboardDnsAction(domain);
      setCheck(result);
      // The check is the whole reason to trust the answer, so let it set the toggle rather than
      // leaving the operator to read a warning and reproduce its conclusion by hand.
      setTls(result.ok);
    } finally {
      setChecking(false);
    }
  }

  function submit() {
    (document.getElementById("dashboard-host-form") as HTMLFormElement)?.requestSubmit();
  }

  return (
    <>
      <FormCard title={t("dashboardHostTitle")}>
        <form id="dashboard-host-form" action={dashboardFormAction}>
          <VStack gap={3}>
            {dashboardState?.message && (
              <StatusAlert message={dashboardState.message} success={dashboardState.success} />
            )}
            <CheckboxInput
              label={t("dashboardEnabledLabel")}
              description={t("dashboardEnabledHelp")}
              htmlName="enabled"
              value={enabled}
              onChange={setEnabled}
            />
            <TextInput
              label={t("dashboardDomainLabel")}
              description={t("dashboardDomainHelp")}
              htmlName="domain"
              value={domain}
              onChange={setDomain}
              isRequired
            />
            <HStack gap={2} vAlign="end" wrap="wrap">
              <Button
                variant="secondary"
                type="button"
                onClick={runCheck}
                isDisabled={checking || domain.trim() === ""}
                label={checking ? t("dashboardDnsChecking") : t("dashboardDnsCheckLabel")}
              />
            </HStack>
            {check && <DnsCheckResult check={check} />}
            <CheckboxInput
              label={t("dashboardTlsLabel")}
              description={t("dashboardTlsHelp")}
              htmlName="tls"
              value={tls}
              onChange={setTls}
            />
            {tls && check && !check.ok && (
              <WarnAlert title={t("dashboardTlsUnverifiedTitle")}>
                {t("dashboardTlsUnverifiedDescription")}
              </WarnAlert>
            )}
            {/*
              A plain SaveButton would submit before anything could be said about it, so when the
              reader is about to cut their own route the button asks first and the dialog submits.
            */}
            {losingOwnAccess ? (
              <HStack>
                <Button
                  variant="primary"
                  type="button"
                  onClick={() => setConfirmDisable(true)}
                  label={t("saveDashboardHost")}
                />
              </HStack>
            ) : (
              <SaveButton label={t("saveDashboardHost")} />
            )}
          </VStack>
        </form>
      </FormCard>
      <InfoAlert title={t("dashboardPortEscapeTitle")}>
        {t("dashboardPortEscapeDescription")}
      </InfoAlert>
      <AppDialog
        open={confirmDisable}
        onClose={() => setConfirmDisable(false)}
        title={t("dashboardDisableConfirmTitle")}
        submitLabel={t("dashboardDisableConfirmAction")}
        onSubmit={() => {
          setConfirmDisable(false);
          submit();
        }}
      >
        <VStack gap={3}>
          <WarnAlert title={t("dashboardDisableConfirmTitle")}>
            {t("dashboardDisableConfirmBody", { domain: dashboard.domain })}
          </WarnAlert>
          <Text type="body" size="sm" color="secondary">
            {t("dashboardDisableConfirmRecovery")}
          </Text>
        </VStack>
      </AppDialog>
    </>
  );
}

/** What the reachability check found, in the terms the toggle above it is decided by. */
function DnsCheckResult({ check }: { check: DashboardDnsCheck }) {
  const t = useTranslations("settings");

  if (check.reason === "reached") {
    return (
      <InfoAlert title={t("dashboardDnsMatchTitle")}>{t("dashboardDnsMatchDescription")}</InfoAlert>
    );
  }
  return (
    <WarnAlert
      title={
        check.reason === "unresolved"
          ? t("dashboardDnsUnresolvedTitle")
          : t("dashboardDnsMismatchTitle")
      }
    >
      {check.reason === "unresolved"
        ? t("dashboardDnsUnresolvedDescription")
        : t("dashboardDnsMismatchDescription", { resolved: check.resolved.join(", ") })}
    </WarnAlert>
  );
}

function TrustedProxiesSection({
  trustedProxies,
  trustedProxiesState,
  trustedProxiesFormAction,
}: {
  trustedProxies: TrustedProxiesSettings | null;
  trustedProxiesState: { success: boolean; message?: string } | null;
  trustedProxiesFormAction: (payload: FormData) => void;
}) {
  const t = useTranslations("settings");
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
              label={t("trustedProxyRanges")}
              isOptional
              description={t("trustedProxyRangesHelp")}
              htmlName="ranges"
              value={ranges}
              onChange={setRanges}
              rows={3}
              placeholder={"private_ranges\n172.21.0.1/32"}
            />
            <TextArea
              label={t("clientIpHeaders")}
              isOptional
              description={t("clientIpHeadersHelp")}
              htmlName="clientIpHeaders"
              value={clientIpHeaders}
              onChange={setClientIpHeaders}
              rows={2}
              placeholder={t("clientIpHeadersPlaceholder")}
            />
            <CheckboxInput
              label={t("enableStrictTrustedProxies")}
              description={t("strictTrustedProxiesHelp")}
              htmlName="strict"
              value={strict}
              onChange={setStrict}
            />
            <CheckboxInput
              label={t("defaultGeoblockTrustedProxies")}
              description={t("geoblockTrustedProxiesHelp")}
              htmlName="defaultGeoblock"
              value={defaultGeoblock}
              onChange={setDefaultGeoblock}
            />
            <SaveButton label={t("saveTrustedProxiesSettings")} />
          </VStack>
        </form>
      </FormCard>
      <InfoAlert title={t("trustedProxiesScopeDescription")}>
        {t("trustedProxiesInfoDescription")}
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
  const t = useTranslations("settings");
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
          <SaveButton label={t("saveGeoblockingSettings")} />
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
  const t = useTranslations("settings");
  return (
    <FormCard>
      <form action={errorPagesFormAction}>
        <VStack gap={3}>
          {errorPagesState?.message && (
            <StatusAlert message={errorPagesState.message} success={errorPagesState.success} />
          )}
          <Text type="body" size="sm" color="secondary">
            {t("globalErrorPagesHelp")}
          </Text>
          <ErrorPagesFields initialData={globalErrorPages?.rules ?? []} />
          <SaveButton label={t("saveErrorPages")} />
        </VStack>
      </form>
    </FormCard>
  );
}

// ─── Section: Tailscale ──────────────────────────────────────────────────────

function TailscaleSection({
  tailscale,
  tailscaleState,
  tailscaleFormAction,
}: {
  tailscale: TailscaleSettingsView;
  tailscaleState: { success: boolean; message?: string } | null;
  tailscaleFormAction: (payload: FormData) => void;
}) {
  const t = useTranslations("settings");
  const [enabled, setEnabled] = useState(tailscale.enabled);
  const [authKey, setAuthKey] = useState("");
  const [defaultNode, setDefaultNode] = useState(tailscale.defaultNode);
  const [controlUrl, setControlUrl] = useState(tailscale.controlUrl);
  const [stateDir, setStateDir] = useState(tailscale.stateDir);
  const [tags, setTags] = useState(tailscale.tags.join(", "));
  const [ephemeral, setEphemeral] = useState(tailscale.ephemeral);
  const [validateAuthKey, setValidateAuthKey] = useState(tailscale.validateAuthKey);
  const [apiAccessToken, setApiAccessToken] = useState("");
  const [apiTailnet, setApiTailnet] = useState(tailscale.apiTailnet);
  const moduleDisabledReason = useDisabledReason("tailscale");

  return (
    <FormCard title={t("tailscale")}>
      <form action={tailscaleFormAction}>
        <VStack gap={3}>
          {tailscaleState?.message && (
            <StatusAlert message={tailscaleState.message} success={tailscaleState.success} />
          )}
          {moduleDisabledReason && (
            <WarnAlert title={t("tailscaleModuleDisabledTitle")}>
              {moduleDisabledReason} These settings still save, but no host is served on the tailnet
              until the module is compiled in.
            </WarnAlert>
          )}
          <ModuleGated feature="tailscale">
            <CheckboxInput
              label={t("useTailscale")}
              description={t("tailscaleHelp")}
              htmlName="tailscaleEnabled"
              value={enabled}
              onChange={setEnabled}
              isDisabled={Boolean(moduleDisabledReason)}
            />
          </ModuleGated>
          <InfoAlert title={t("trustedProxiesInfoTitle")}>
            The node runs in userspace inside the Caddy container — no <Code>tailscaled</Code>, no
            TUN device, no extra ports published. Its identity is kept in the state directory below,
            so it survives a container recreate.
          </InfoAlert>
          <TextInput
            {...AUTOFILL_NEW_PASSWORD}
            label={t("authKey")}
            type="password"
            isOptional
            description={
              tailscale.hasAuthKey
                ? "An auth key is stored. Leave this empty to keep it."
                : "A reusable auth key from the Tailscale admin console. A Caddy placeholder such as {env.TS_AUTHKEY} works too, and keeps the key out of the database."
            }
            htmlName="tailscaleAuthKey"
            value={authKey}
            onChange={setAuthKey}
          />
          <TextInput
            {...AUTOFILL_OFF}
            label={t("defaultNodeName")}
            description={t("tailscaleDefaultNodeHelp")}
            htmlName="tailscaleDefaultNode"
            value={defaultNode}
            onChange={setDefaultNode}
            placeholder="caddy"
          />
          <TextInput
            {...AUTOFILL_OFF}
            label={t("tags")}
            isOptional
            description='ACL tags applied when a node registers, comma-separated. Most reusable auth keys require at least one, e.g. "tag:caddy".'
            htmlName="tailscaleTags"
            value={tags}
            onChange={setTags}
            placeholder="tag:caddy"
          />
          <TextInput
            {...AUTOFILL_OFF}
            label={t("controlServerUrl")}
            isOptional
            description={t("tailscaleControlServerHelp")}
            htmlName="tailscaleControlUrl"
            value={controlUrl}
            onChange={setControlUrl}
            placeholder="https://headscale.example.com"
          />
          <TextInput
            {...AUTOFILL_OFF}
            label={t("stateDirectory")}
            isOptional
            description={t("tailscaleStateDirectoryHelp")}
            htmlName="tailscaleStateDir"
            value={stateDir}
            onChange={setStateDir}
            placeholder="/data/tailscale"
          />
          <CheckboxInput
            label={t("registerNodesAsEphemeral")}
            description={t("ephemeralNodesHelp")}
            htmlName="tailscaleEphemeral"
            value={ephemeral}
            onChange={setEphemeral}
          />
          <CheckboxInput
            label={t("tailscaleKeyValidationLabel")}
            description={t("tailscaleKeyValidationHelp")}
            htmlName="tailscaleValidateAuthKey"
            value={validateAuthKey}
            onChange={setValidateAuthKey}
          />
          {validateAuthKey ? (
            <>
              <TextInput
                {...AUTOFILL_NEW_PASSWORD}
                label={t("apiAccessToken")}
                type="password"
                isOptional
                description={
                  tailscale.hasApiAccessToken
                    ? "A token is stored. Leave this empty to keep it."
                    : "A tskey-api-… token from the Tailscale admin console. Read access to keys is enough."
                }
                htmlName="tailscaleApiAccessToken"
                value={apiAccessToken}
                onChange={setApiAccessToken}
              />
              <TextInput
                {...AUTOFILL_OFF}
                label={t("tailnet")}
                isOptional
                description={
                  'Which tailnet to ask. "-" means the token\'s own, which is right unless you administer several.'
                }
                htmlName="tailscaleApiTailnet"
                value={apiTailnet}
                onChange={setApiTailnet}
                placeholder="-"
              />
            </>
          ) : (
            <WarnAlert title={t("tailscaleKeyValidationDisabledTitle")}>
              Nothing here can tell a revoked or expired key from a working one — that is only
              discovered when Caddy tries to register the node, and a node that will not come up
              makes Caddy reject the <em>entire</em> configuration. Until the key is fixed, no proxy
              host on any agent can be updated.
            </WarnAlert>
          )}
          <SaveButton label={t("saveTailscaleSettings")} />
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
  const t = useTranslations("settings");
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
            label={t("outpostDomain")}
            htmlName="outpostDomain"
            value={outpostDomain}
            onChange={setOutpostDomain}
            placeholder="outpost.goauthentik.io"
            isRequired
          />
          <TextInput
            {...NATIVE_REQUIRED}
            label={t("outpostUpstream")}
            htmlName="outpostUpstream"
            value={outpostUpstream}
            onChange={setOutpostUpstream}
            placeholder="http://authentik-server:9000"
            isRequired
          />
          <TextInput
            label={t("authEndpoint")}
            isOptional
            htmlName="authEndpoint"
            value={authEndpoint}
            onChange={setAuthEndpoint}
            placeholder="/outpost.goauthentik.io/auth/caddy"
          />
          <SaveButton label={t("saveAuthentikDefaults")} />
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
  const t = useTranslations("settings");
  const [requireChange, setRequireChange] = useState(passwordPolicy.requireChangeOnLegacyHash);

  return (
    <FormCard title={t("legacyPasswordHashes")}>
      <form action={passwordPolicyFormAction}>
        <VStack gap={3}>
          {passwordPolicy.fromEnv && (
            <InfoAlert title={t("passwordPolicyEnvironmentOverrideTitle")}>
              {t("environmentOverrideDescription")}
            </InfoAlert>
          )}
          {passwordPolicyState?.message && (
            <StatusAlert
              message={passwordPolicyState.message}
              success={passwordPolicyState.success}
            />
          )}
          <CheckboxInput
            label={t("legacyPasswordResetLabel")}
            description={t("legacyPasswordResetHelp")}
            htmlName="requireChangeOnLegacyHash"
            value={requireChange}
            onChange={setRequireChange}
            isDisabled={passwordPolicy.fromEnv}
          />
          <SaveButton label={t("savePasswordPolicy")} isDisabled={passwordPolicy.fromEnv} />
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
  const t = useTranslations("settings");
  const [gravatarEnabled, setGravatarEnabled] = useState(avatars.gravatarEnabled);

  return (
    <FormCard title={t("fallbackIcon")}>
      <form action={avatarsFormAction}>
        <VStack gap={3}>
          {avatars.fromEnv && (
            <InfoAlert title={t("gravatarEnvironmentOverrideTitle")}>
              {t("environmentOverrideDescription")}
            </InfoAlert>
          )}
          {avatarsState?.message && (
            <StatusAlert message={avatarsState.message} success={avatarsState.success} />
          )}
          <CheckboxInput
            label={t("gravatarLabel")}
            description={t("gravatarHelp")}
            htmlName="gravatarEnabled"
            value={gravatarEnabled}
            onChange={setGravatarEnabled}
            isDisabled={avatars.fromEnv}
          />
          <SaveButton label={t("saveAvatarSettings")} isDisabled={avatars.fromEnv} />
        </VStack>
      </form>
    </FormCard>
  );
}

// ─── Section: Branding ───────────────────────────────────────────────────────

/**
 * An object URL for a file the operator just picked, or null if it is not one.
 *
 * `URL.createObjectURL` is specified to return `blob:<this origin>/<uuid>` — a name the browser
 * mints, carrying no byte of the file's name or contents — so the guard cannot fail at runtime.
 * It is here because the value still *derives* from a file the user chose, and that is enough for
 * a scanner tracing it into an attribute to call it attacker-controlled text (js/xss-through-dom
 * did). Narrowing to the one scheme this may ever be turns the invariant into something both a
 * reader and an analyser can see, instead of a claim in a comment.
 *
 * Null rather than a throw: a preview that cannot be shown is not a reason to break the form, and
 * the field still submits the file either way.
 */
function objectUrlForPreview(file: File): string | null {
  const url = URL.createObjectURL(file);
  if (url.startsWith("blob:")) return url;
  URL.revokeObjectURL(url);
  return null;
}

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
  const t = useTranslations("settings");
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
    <FormCard title={t("favicon")}>
      <form action={faviconFormAction}>
        <VStack gap={3}>
          {faviconState?.message && (
            <StatusAlert message={faviconState.message} success={faviconState.success} />
          )}
          <InfoAlert title={t("faviconDescription")}>{t("faviconUploadHelp")}</InfoAlert>

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
              setPreview(file ? objectUrlForPreview(file) : null);
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
                label={t("removeFavicon")}
              />
            )}
            <Button type="submit" size="sm" label={t("saveFavicon")} isDisabled={!preview} />
          </HStack>
        </VStack>
      </form>
    </FormCard>
  );
}

// ─── Section: Updates ────────────────────────────────────────────────────────

/** "3 hours ago", for a timestamp whose exact minute nobody needs. */
function timeAgo(iso: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  const units: Array<[number, Intl.RelativeTimeFormatUnit]> = [
    [60, "second"],
    [60, "minute"],
    [24, "hour"],
    [7, "day"],
  ];
  let value = seconds;
  let unit: Intl.RelativeTimeFormatUnit = "second";
  for (const [step, next] of units) {
    if (value < step) break;
    value = Math.round(value / step);
    unit = next;
  }
  return new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(-value, unit);
}

function UpdatesSection({
  updates,
  updatesState,
  updatesFormAction,
}: {
  updates: UpdateStatus;
  updatesState: { success: boolean; message?: string } | null;
  updatesFormAction: (payload: FormData) => void;
}) {
  const t = useTranslations("settings");
  const [enabled, setEnabled] = useState(updates.enabled);
  const [repository, setRepository] = useState(updates.repository);
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<{ success: boolean; message?: string } | null>(
    null,
  );

  return (
    <FormCard title={t("releaseUpdates")}>
      <form action={updatesFormAction}>
        <VStack gap={3}>
          {updatesState?.message && (
            <StatusAlert message={updatesState.message} success={updatesState.success} />
          )}
          {checkResult?.message && (
            <StatusAlert message={checkResult.message} success={checkResult.success} />
          )}

          {updates.updateAvailable ? (
            <WarnAlert title={`Version ${updates.latest} has been published`}>
              You are running {updates.current}. Pull the new images and recreate the stack to move
              to it.
            </WarnAlert>
          ) : (
            <InfoAlert title={`Running ${updates.current}`}>
              {updates.error
                ? `The last check did not complete: ${updates.error}`
                : updates.latest
                  ? `${updates.latest} is the newest release published, so this is up to date.`
                  : updates.enabled
                    ? "No check has completed yet. Save or check now to run one."
                    : "Update checks are off, so nothing is known about newer releases."}
            </InfoAlert>
          )}

          <CheckboxInput
            label={t("checkForUpdates")}
            description={t("updateCheckHelp")}
            htmlName="updateCheckEnabled"
            value={enabled}
            onChange={setEnabled}
          />

          <TextInput
            {...AUTOFILL_OFF}
            label={t("imageRepository")}
            description={t("imageRepositoryHelp")}
            placeholder={t("imageRepositoryPlaceholder")}
            htmlName="updateImageRepository"
            value={repository}
            onChange={setRepository}
            isDisabled={!enabled}
          />

          <Text size="xsm" color="secondary">
            {!updates.enabled
              ? "Not checking."
              : updates.checkedAt
                ? `Last checked ${timeAgo(updates.checkedAt)}.`
                : "Never checked."}
          </Text>

          <HStack gap={2} justify="end">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              label={checking ? "Checking…" : "Check now"}
              isDisabled={!enabled || checking}
              onClick={async () => {
                setChecking(true);
                setCheckResult(null);
                try {
                  setCheckResult(await checkForUpdatesAction());
                } finally {
                  setChecking(false);
                }
              }}
            />
            <SaveButton label={t("saveUpdateSettings")} />
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
  const t = useTranslations("settings");
  if (source === "environment") {
    return (
      <InfoAlert title={t("environmentOverrideTitle")}>
        Saving here stores the value in the database, which takes precedence from then on. The
        variable can be removed from your <Code>.env</Code> afterwards.
      </InfoAlert>
    );
  }
  return <InfoAlert title={t("credentialsMissingStatus")}>{children}</InfoAlert>;
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
  const t = useTranslations("settings");
  const [enabled, setEnabled] = useState(analytics.enabled);
  const [url, setUrl] = useState(analytics.url);
  const [user, setUser] = useState(analytics.user);
  const [password, setPassword] = useState("");
  const [database, setDatabase] = useState(analytics.database);
  const [retentionDays, setRetentionDays] = useState(analytics.retentionDays);

  return (
    <FormCard title={t("trafficAndWafEvents")}>
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
            label={t("collectAnalytics")}
            description={t("analyticsCollectionHelp")}
            htmlName="analyticsEnabled"
            value={enabled}
            onChange={setEnabled}
          />
          {canManageServices ? (
            <InfoAlert title={t("managedAnalyticsTitle")}>
              No <Code>COMPOSE_PROFILES</Code> entry is needed. The first start pulls the ClickHouse
              image, which can take several minutes; turning analytics off stops the container and
              leaves its data volume intact.
            </InfoAlert>
          ) : (
            <WarnAlert title={t("agentManagementUnavailableTitle")}>
              These settings still decide whether analytics run. Starting ClickHouse itself needs
              <Code>clickhouse</Code> in <Code>COMPOSE_PROFILES</Code> on the host.
            </WarnAlert>
          )}
          {/* Tells the action a password already exists, so "enabled with an empty field" is a
              keep-what-is-stored rather than a misconfiguration to refuse. */}
          <input type="hidden" name="hasPassword" value={analytics.hasPassword ? "yes" : "no"} />
          <TextInput
            {...AUTOFILL_OFF}
            label={t("clickhouseUrl")}
            description={t("clickhouseUrlHelp")}
            htmlName="clickhouseUrl"
            value={url}
            onChange={setUrl}
          />
          <TextInput
            {...AUTOFILL_OFF}
            label={t("clickhouseUser")}
            htmlName="clickhouseUser"
            value={user}
            onChange={setUser}
          />
          <GeneratedPasswordField
            label={t("clickhousePassword")}
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
            label={t("clickhouseDatabase")}
            htmlName="clickhouseDb"
            value={database}
            onChange={setDatabase}
          />
          <NumberInput
            label={t("retentionDays")}
            description={t("analyticsRetentionHelp")}
            htmlName="clickhouseRetentionDays"
            value={retentionDays}
            onChange={setRetentionDays}
            isIntegerOnly
            min={1}
            max={3650}
          />
          <SaveButton label={t("saveAnalyticsSettings")} />
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
  const t = useTranslations("settings");
  const [enabled, setEnabled] = useState(geoip.enabled);
  const [accountId, setAccountId] = useState(geoip.accountId);
  const [licenseKey, setLicenseKey] = useState("");

  return (
    <FormCard title={t("maxmindGeolite2")}>
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
            label={t("useGeoip")}
            description={t("geoipHelp")}
            htmlName="geoipEnabled"
            value={enabled}
            onChange={setEnabled}
          />
          {canManageServices ? (
            <InfoAlert title={t("managedGeoipTitle")}>
              No <Code>COMPOSE_PROFILES</Code> entry is needed. It downloads the databases on a
              schedule using the credentials below, and agents on other hosts fetch them from this
              controller rather than each holding a licence key.
            </InfoAlert>
          ) : (
            <WarnAlert title={t("agentManagementUnavailableTitle")}>
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
            label={t("maxmindAccountId")}
            isOptional
            description={t("maxmindCredentialsHelp")}
            htmlName="geoipAccountId"
            value={accountId}
            onChange={setAccountId}
          />
          <TextInput
            {...AUTOFILL_NEW_PASSWORD}
            label={t("maxmindLicenceKey")}
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
          <SaveButton label={t("saveGeoipSettings")} />
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
  status,
  error,
  lastSeenAt,
  onRemove,
}: {
  name: string;
  status: AgentStatus | null;
  error: string | null;
  lastSeenAt: string | null;
  onRemove: ReactNode;
}) {
  const t = useTranslations("settings");
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
              <Badge variant="error" label={t("notAnswering")} />
            )}
          </HStack>
          <Text size="xsm" color="secondary">
            last reported {whenText(lastSeenAt)}
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

function AgentSection({ agents }: { agents: Props["agents"] }) {
  const t = useTranslations("settings");
  const [code, setCode] = useState<{ code: string; expiresAt: number } | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);

  const { paired, statuses } = agents;
  const usingPaired = paired.length > 0;
  const statusFor = (agentName: string) => statuses.find((entry) => entry.agent === agentName);
  const answering = statuses.filter((entry) => entry.ok).length;

  return (
    <>
      <FormCard title={usingPaired ? "Agents" : "Current agent"}>
        <VStack gap={3}>
          <Text size="sm" color="secondary">
            {t("agentsDescription")}
          </Text>

          {usingPaired && paired.length > 1 && (
            <InfoAlert title={t("sharedAgentConfigTitle")}>
              Proxy hosts, certificates and published ports belong to this controller, not to a
              host. A change is applied to all {paired.length} agents or to none of them, so the
              fleet cannot drift apart.
            </InfoAlert>
          )}

          {statuses.length === 0 ? (
            <WarnAlert title={t("agentsUnavailableTitle")}>
              {usingPaired
                ? "Nothing was reached. Layer-4 ports, Caddy rebuilds and config changes will all fail until an agent answers."
                : "Start the agent container, or pair a remote one below. Everything else keeps working without it."}
            </WarnAlert>
          ) : (
            <VStack gap={3}>
              {!usingPaired && (
                <>
                  <InfoAlert title={t("localAgentTitle")}>{t("localAgentDescription")}</InfoAlert>
                  <AgentRow
                    name="Local agent"
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
                    status={entry?.ok ? entry.value : null}
                    error={entry && !entry.ok ? entry.error : agent.lastError}
                    lastSeenAt={agent.lastSeenAt}
                    onRemove={
                      <form action={unpairAgentAction}>
                        <input type="hidden" name="agentId" value={agent.id} />
                        <Button type="submit" size="sm" variant="secondary" label={t("unpair")} />
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

      <FormCard title={t("pairAnAgent")}>
        <VStack gap={3}>
          <Text size="sm" color="secondary">
            {t("pairingCodeHelp")}
          </Text>
          {codeError && <StatusAlert message={codeError} success={false} />}
          {code ? (
            <VStack gap={2}>
              <Text size="xl" weight="semibold">
                {code.code}
              </Text>
              <Text size="xsm" color="secondary">
                {t("pairingCodeExpires", {
                  minutes: Math.max(1, Math.round((code.expiresAt - Date.now()) / 60000)),
                })}
              </Text>
              <Text size="sm" color="secondary">
                {t("pairingCodeRun")}
              </Text>
              <Code>{`cpm-agent --pair --host <this-controller> --code ${code.code}`}</Code>
            </VStack>
          ) : (
            <Button
              type="button"
              size="sm"
              label={t("generatePairingCode")}
              onClick={() => {
                setCodeError(null);
                pairingCodeAction()
                  .then(setCode)
                  .catch(() => setCodeError(t("pairingCodeFailed")));
              }}
            />
          )}
        </VStack>
      </FormCard>
    </>
  );
}

// ─── Section: Caddy Build ────────────────────────────────────────────────────

/**
 * One selection per agent, on top of a fleet default the rest follow.
 *
 * The module list describes a binary built on a particular host, so an agent that needs a plugin
 * the others do not — a DNS provider only it can reach — should not force that plugin into every
 * other image. What an agent without its own selection follows is the fleet default, which is what
 * this page edited before and what every agent starts on.
 */
function CaddyBuildSection({
  caddyBuild,
  caddyBuildState,
  caddyBuildFormAction,
  agents,
  agentBuildSelections,
}: {
  caddyBuild: CaddyBuildSettings | null;
  caddyBuildState: { success: boolean; message?: string } | null;
  caddyBuildFormAction: (formData: FormData) => void;
  agents?: { id: number; name: string; connected: boolean }[];
  agentBuildSelections?: Record<number, CaddyBuildSettings | null>;
}) {
  const t = useTranslations("settings");
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
          agents={agents ?? []}
          agentSelections={agentBuildSelections ?? {}}
        />
        <SaveButton label={t("saveModuleSelection")} />
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
  const t = useTranslations("settings");
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
              label={t("enableMetricsEndpoint")}
              description={t("metricsEndpointHelp")}
              htmlName="enabled"
              value={enabled}
              onChange={setEnabled}
            />
            <NumberInput
              label={t("port")}
              description={t("metricsPortHelp")}
              htmlName="port"
              value={port}
              onChange={setPort}
              isIntegerOnly
              min={1}
              max={65535}
              width={160}
            />
            <SaveButton label={t("saveMetricsSettings")} />
          </VStack>
        </form>
      </FormCard>
      <InfoAlert title={t("metricsInfoTitle")}>
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
  const t = useTranslations("settings");
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
              label={t("enableAccessLogging")}
              htmlName="enabled"
              value={enabled}
              onChange={setEnabled}
            />
            <Selector
              label={t("format")}
              htmlName="format"
              options={LOG_FORMAT_OPTIONS}
              value={format}
              onChange={setFormat}
              width={280}
            />
            <SaveButton label={t("saveLoggingSettings")} />
          </VStack>
        </form>
      </FormCard>
      <InfoAlert title={t("accessLogsInfoTitle")}>{t("accessLogsCommand")}</InfoAlert>
    </>
  );
}
