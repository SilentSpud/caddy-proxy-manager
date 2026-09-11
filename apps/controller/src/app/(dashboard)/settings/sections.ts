/**
 * Every settings section, in the order the navigation shows them.
 *
 * Lives outside SettingsClient because two things now render from it: the sidebar, which the
 * dashboard layout owns while a settings route is open, and the section pane itself. One list
 * keeps a section from appearing in the nav and nowhere else, or the reverse.
 */

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

export type SettingItem = {
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

export type SettingsGroup = {
  id: string;
  label: string;
  items: SettingItem[];
};

export const SETTINGS_GROUPS: SettingsGroup[] = [
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

/** Flat lookup for a route segment, so an unknown section can fall back rather than 404. */
export const SETTINGS_ITEMS: SettingItem[] = SETTINGS_GROUPS.flatMap((group) => group.items);

export function findSettingsItem(id: string): SettingItem | undefined {
  return SETTINGS_ITEMS.find((item) => item.id === id);
}

/** The group a section belongs to, for the breadcrumb the content pane renders. */
export function groupForSection(id: string): SettingsGroup | undefined {
  return SETTINGS_GROUPS.find((group) => group.items.some((item) => item.id === id));
}
