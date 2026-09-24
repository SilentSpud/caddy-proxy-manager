/**
 * Every settings page, in the order the navigation shows them, and the blocks each one carries.
 *
 * A page is a list of blocks rather than one form because most settings are two fields: as its own
 * route each was a title, a breadcrumb and an acre of empty pane. A block keeps the name that page
 * had - it is the heading inside the page, the anchor a link lands on, and the id its catalog
 * entry and its staged-change label are still keyed by - so nothing an operator learned is lost by
 * the merge.
 *
 * Lives outside SettingsClient because several things render from it: the sidebar, which the
 * dashboard layout owns while a settings route is open, the page itself, and the command palette.
 * One list keeps a page from appearing in the nav and nowhere else, or the reverse.
 */

import {
  BarChart2,
  Cloud,
  Cpu,
  KeyRound,
  MapPin,
  MonitorSmartphone,
  Package,
  Server,
  Settings2,
  UserCheck,
  Waypoints,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { useTranslations } from "next-intl";

/**
 * One block of a settings page: what used to be a page of its own.
 *
 * `id` is that page's id, unchanged. It is the block's anchor (`/settings/dns#dns-resolvers`), the
 * key of its `settings.blocks.*` heading, and what `LEGACY_SECTION_PAGES` redirects an old link to.
 */
export type SettingsBlock = {
  id: string;
  /** The heading inside the page: the name this block's page had. */
  name: string;
  /** The line under that heading, which was that page's description. */
  desc: string;
  /**
   * Environment variables that configure this block, shown as tokens beside its heading.
   *
   * Beside the heading rather than the page's title: a page holds several blocks now, and a token
   * under the title would claim the variable configures all of them. A variable that sets one
   * field alone is rendered next to that field by the block itself; what is listed here is what
   * governs the block as a whole.
   *
   * An operator arrives from a `.env` file, so the variable name is the handle they already have.
   * Only variables that set a value this block shows belong here: a near-miss sends someone to a
   * screen that cannot change what they came to change. The ones a database setting supersedes are
   * in `src/lib/settings/registry.ts`, which is where their precedence is defined.
   */
  env?: readonly string[];
  /**
   * Variables the search should match that are not worth showing. For a block configured by a
   * whole family of variables, `env` carries the prefix and this carries the members, so typing
   * any one of them still lands on the page.
   */
  envSearch?: readonly string[];
};

export type SettingItem = {
  id: string;
  name: string;
  desc: string;
  icon: LucideIcon;
  blocks: readonly SettingsBlock[];
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
        desc: "Domain, ACME contact, updates, branding and avatars",
        icon: Settings2,
        blocks: [
          { id: "general", name: "General", desc: "Primary domain and ACME contact email" },
          {
            id: "acme",
            name: "ACME Server",
            desc: "Custom ACME directory URL for internal CAs",
            envSearch: ["ACME_CA_ROOT_DIR"],
          },
          {
            id: "updates",
            name: "Updates",
            desc: "Whether to check the registry for a newer release, and which one",
            envSearch: ["UPDATE_CHECK_ENABLED", "UPDATE_IMAGE_REPOSITORY"],
          },
          { id: "branding", name: "Branding", desc: "The favicon browsers show for this instance" },
          {
            id: "instance",
            name: "Instance",
            desc: "Names this instance and the address it is reached at",
            envSearch: ["APP_NAME", "BASE_URL"],
          },
          {
            id: "avatars",
            name: "User Avatars",
            desc: "Gravatar fallback for users without an icon",
            envSearch: ["AVATAR_GRAVATAR"],
          },
        ],
      },
      {
        id: "responses",
        name: "Responses",
        desc: "What Caddy answers for an unknown host, and when a host fails",
        icon: Server,
        blocks: [
          {
            id: "default-response",
            name: "Default Response",
            desc: "Handle requests for unknown hosts and direct IP access",
          },
          {
            id: "error-pages",
            name: "Error Pages",
            desc: "Global custom error responses (fallback for all hosts)",
          },
        ],
      },
      {
        id: "caddy-build",
        name: "Caddy Build",
        desc: "Which plugins the Caddy image is compiled with",
        icon: Package,
        blocks: [
          {
            id: "caddy-build",
            name: "Caddy Build",
            desc: "Which plugins the Caddy image is compiled with",
            env: ["CADDY_BUILD_TIMEOUT"],
          },
        ],
      },
      {
        id: "dashboard",
        name: "Dashboard Host",
        desc: "Serve this dashboard through Caddy, on a domain of its own",
        icon: MonitorSmartphone,
        blocks: [
          {
            id: "dashboard",
            name: "Dashboard Host",
            desc: "Serve this dashboard through Caddy, on a domain of its own",
            envSearch: ["DASHBOARD_DOMAIN"],
          },
        ],
      },
      {
        id: "agent",
        name: "Agent",
        desc: "The service that recreates and rebuilds the Caddy container",
        icon: Cpu,
        blocks: [
          {
            id: "agent",
            name: "Agent",
            desc: "The service that recreates and rebuilds the Caddy container",
            env: ["CONTROLLER_URL", "AGENT_MODE", "PAIRING_CODE", "CADDY_API_URL"],
            envSearch: ["CADDY_MONITOR_ENABLED"],
          },
        ],
      },
    ],
  },
  {
    id: "networking",
    label: "Networking",
    items: [
      {
        id: "dns",
        name: "DNS",
        desc: "Provider credentials, challenge resolvers and upstream pinning",
        icon: Cloud,
        blocks: [
          {
            id: "dns-providers",
            name: "DNS Providers",
            desc: "Provider credentials for ACME DNS-01",
          },
          {
            id: "dns-resolvers",
            name: "DNS Resolvers",
            desc: "Custom resolvers for challenge verification",
          },
          {
            id: "upstream-dns",
            name: "Upstream DNS Pinning",
            desc: "Pin upstream IPs at config-apply time",
          },
        ],
      },
      {
        id: "network",
        name: "Network",
        desc: "Trusted proxies, and the tailnet hosts are served on",
        icon: Waypoints,
        blocks: [
          {
            id: "trusted-proxies",
            name: "Trusted Proxies",
            desc: "Resolve real client IP behind an upstream proxy",
          },
          {
            id: "tailscale",
            name: "Tailscale",
            desc: "Node defaults for hosts served on, or reached over, your tailnet",
            envSearch: ["TS_AUTHKEY"],
          },
        ],
      },
    ],
  },
  {
    id: "security",
    label: "Security",
    items: [
      {
        id: "authentication",
        name: "Authentication",
        desc: "How people sign in to this dashboard",
        icon: KeyRound,
        blocks: [
          {
            id: "oauth",
            name: "OAuth Providers",
            desc: "OAuth/OIDC SSO providers",
            // A provider's whole configuration is one family of variables, and `runEnvProviderSync`
            // reads every one of them into `oauth_providers` at startup. Nineteen tokens beside the
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
            id: "sign-in",
            name: "Sign-in",
            desc: "Who may sign in or sign up, and how hard the door is to knock on",
            envSearch: [
              "AUTH_ALLOW_SELF_REGISTRATION",
              "AUTH_ALLOW_OAUTH_REGISTRATION",
              "AUTH_ALLOW_OAUTH_ROLE_FROM_CLAIMS",
              "AUTH_DISABLE_LOCAL_USERS",
              "AUTH_TRUST_HOST",
              "AUTH_RATE_LIMIT_ENABLED",
              "AUTH_RATE_LIMIT_WINDOW",
              "AUTH_RATE_LIMIT_MAX",
              "LOGIN_MAX_ATTEMPTS",
              "LOGIN_WINDOW_MS",
              "LOGIN_BLOCK_MS",
            ],
          },
          {
            id: "password-policy",
            name: "Password Policy",
            desc: "Migrate users off older password hashes",
            envSearch: ["AUTH_REQUIRE_PASSWORD_CHANGE_ON_LEGACY_HASH"],
          },
        ],
      },
      {
        id: "forward-auth",
        name: "Forward Auth",
        desc: "Defaults a new proxy host inherits for an external authenticator",
        icon: UserCheck,
        blocks: [
          {
            id: "authentik",
            name: "Authentik Defaults",
            desc: "Forward-auth defaults for new proxy hosts",
            env: ["FORWARD_AUTH_INTERNAL_URL"],
          },
          {
            id: "forward-auth",
            name: "Forward Auth Defaults",
            desc: "Defaults for hosts authenticating through an external auth server",
          },
        ],
      },
      {
        id: "geo",
        name: "Geo-blocking",
        desc: "Country lookups, and the default rules every host merges with",
        icon: MapPin,
        blocks: [
          {
            id: "geoip",
            name: "GeoIP Databases",
            desc: "MaxMind subscription and whether country lookups run at all",
            envSearch: [
              "GEOIP_ENABLED",
              "GEOIPUPDATE_ACCOUNT_ID",
              "GEOIPUPDATE_LICENSE_KEY",
              "GEOIP_UPDATE_INTERVAL_HOURS",
            ],
          },
          {
            id: "geoblock",
            name: "Global Geoblocking",
            desc: "Default geoblock rules across all hosts",
          },
        ],
      },
    ],
  },
  {
    id: "observability",
    label: "Observability",
    items: [
      {
        id: "observability",
        name: "Observability",
        desc: "Analytics collection, the metrics endpoint and the access log",
        icon: BarChart2,
        blocks: [
          {
            id: "analytics",
            name: "Analytics",
            desc: "Traffic and WAF event collection, and the ClickHouse it writes to",
            envSearch: [
              "ANALYTICS_ENABLED",
              "CLICKHOUSE_URL",
              "CLICKHOUSE_USER",
              "CLICKHOUSE_PASSWORD",
              "CLICKHOUSE_DB",
              "CLICKHOUSE_RETENTION_DAYS",
            ],
          },
          { id: "metrics", name: "Metrics & Monitoring", desc: "Prometheus metrics endpoint" },
          { id: "logging", name: "Access Logging", desc: "HTTP access log for proxied requests" },
        ],
      },
    ],
  },
];

/** Flat lookup for a route segment, so an unknown page can fall back rather than 404. */
export const SETTINGS_ITEMS: SettingItem[] = SETTINGS_GROUPS.flatMap((group) => group.items);

export function findSettingsItem(id: string): SettingItem | undefined {
  return SETTINGS_ITEMS.find((item) => item.id === id);
}

/** The group a page belongs to, for the breadcrumb the content pane renders. */
export function groupForSection(id: string): SettingsGroup | undefined {
  return SETTINGS_GROUPS.find((group) => group.items.some((item) => item.id === id));
}

/** Every block of every page, flat: what the message test and the search iterate. */
export const SETTINGS_BLOCKS: readonly SettingsBlock[] = SETTINGS_ITEMS.flatMap(
  (item) => item.blocks,
);

/**
 * Where a block lives now, for the block ids that used to be routes of their own.
 *
 * `/settings/authentik` was a page until these were merged, and it is a link in the docs and in
 * whatever an operator bookmarked. Rather than answer those with the overview, the route redirects
 * to the page that carries the block, anchored at it.
 */
export const LEGACY_SECTION_PAGES: ReadonlyMap<string, { page: string; anchor: string }> = new Map(
  SETTINGS_ITEMS.flatMap((item) =>
    item.blocks
      .filter((block) => block.id !== item.id)
      .map((block) => [block.id, { page: item.id, anchor: block.id }] as const),
  ),
);

/**
 * The link to a page, or to a block on the page that carries it.
 *
 * Everything that used to link to `/settings/<section>` goes through this, so a caller does not
 * have to know which ids became anchors - and none of them has to be updated again if a block
 * moves to another page.
 */
export function settingsHref(id: string): string {
  const legacy = LEGACY_SECTION_PAGES.get(id);
  return legacy ? `/settings/${legacy.page}#${legacy.anchor}` : `/settings/${id}`;
}

// ─── Messages ────────────────────────────────────────────────────────────────

/*
 * The English above stays the source, and the screens render the `settings.sections.*`,
 * `settings.blocks.*` and `settings.navGroups.*` catalog entries through these instead. All three
 * are keyed by id at runtime, which TypeScript cannot check against the catalog, so
 * `tests/unit/settings-sections-messages.test.ts` asserts every page, block and group has an entry
 * that reads exactly as it does here.
 */

type SettingsTranslator = ReturnType<typeof useTranslations<"settings">>;

/** The one place the narrowing is given up, for the reason above. */
type DynamicTranslate = (key: string) => string;

function dynamic(t: SettingsTranslator): DynamicTranslate {
  return t as unknown as DynamicTranslate;
}

/** A page, block or group id as a catalog key segment: `default-response` is `defaultResponse`. */
export function sectionMessageName(id: string): string {
  return id.replace(/-([a-z0-9])/g, (_, next: string) => next.toUpperCase());
}

export function settingsSectionName(t: SettingsTranslator, item: SettingItem): string {
  return dynamic(t)(`sections.${sectionMessageName(item.id)}.name`);
}

export function settingsSectionDescription(t: SettingsTranslator, item: SettingItem): string {
  return dynamic(t)(`sections.${sectionMessageName(item.id)}.desc`);
}

/** A block's heading: the name the page it came from had. */
export function settingsBlockName(t: SettingsTranslator, id: string): string {
  return dynamic(t)(`blocks.${sectionMessageName(id)}.name`);
}

/** The line under a block's heading, which was that page's description. */
export function settingsBlockDescription(t: SettingsTranslator, id: string): string {
  return dynamic(t)(`blocks.${sectionMessageName(id)}.desc`);
}

export function settingsGroupLabel(t: SettingsTranslator, group: SettingsGroup): string {
  return dynamic(t)(`navGroups.${sectionMessageName(group.id)}`);
}
