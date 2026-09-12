/**
 * Every place the dashboard navigation can take you, in one list, so the desktop rail, the mobile
 * tab bar, the More drawer and the More page cannot disagree about what exists or who may see it.
 *
 * No React here: the server reads it to validate a user's saved More drawer, so icons are attached
 * by the client components that draw them.
 */

export type DestinationId =
  | "overview"
  | "proxy-hosts"
  | "l4-proxy-hosts"
  | "agents"
  | "analytics"
  | "access-lists"
  | "groups"
  | "users"
  | "certificates"
  | "waf"
  | "audit-log"
  | "api-docs"
  | "settings"
  | "profile";

/** How the More page groups what the tab bar cannot hold. */
export type MoreGroup = "access" | "security" | "reference" | "instance";

/**
 * A key in the `nav` message namespace. Spelled out rather than `string` so next-intl's typed
 * keys still catch a typo here as a build error.
 */
export type NavLabelKey =
  | "overview"
  | "proxyHosts"
  | "l4ProxyHosts"
  | "agents"
  | "analytics"
  | "accessLists"
  | "groups"
  | "users"
  | "certificates"
  | "waf"
  | "auditLog"
  | "apiDocs"
  | "settings"
  | "profile";

export type Destination = {
  id: DestinationId;
  href: string;
  labelKey: NavLabelKey;
  /** Answers for the whole instance, so only admins see it. */
  adminOnly: boolean;
  /**
   * An operator can open it too: it shows only what their groups were granted, and an operator
   * with no grants sees it empty rather than not at all, because "you have no hosts yet" explains
   * itself and a missing menu item does not.
   */
  operator: boolean;
  /** Set for the pages that live behind More on a phone; unset for the ones the tab bar names. */
  moreGroup?: MoreGroup;
};

export const DESTINATIONS: readonly Destination[] = [
  { id: "overview", href: "/", labelKey: "overview", adminOnly: false, operator: false },
  {
    id: "proxy-hosts",
    href: "/proxy-hosts",
    labelKey: "proxyHosts",
    adminOnly: true,
    operator: true,
  },
  {
    id: "l4-proxy-hosts",
    href: "/l4-proxy-hosts",
    labelKey: "l4ProxyHosts",
    adminOnly: true,
    operator: true,
  },
  { id: "agents", href: "/agents", labelKey: "agents", adminOnly: true, operator: true },
  {
    id: "access-lists",
    href: "/access-lists",
    labelKey: "accessLists",
    adminOnly: true,
    operator: false,
    moreGroup: "access",
  },
  {
    id: "groups",
    href: "/groups",
    labelKey: "groups",
    adminOnly: true,
    operator: false,
    moreGroup: "access",
  },
  {
    id: "users",
    href: "/users",
    labelKey: "users",
    adminOnly: true,
    operator: false,
    moreGroup: "access",
  },
  {
    id: "certificates",
    href: "/certificates",
    labelKey: "certificates",
    adminOnly: true,
    operator: false,
    moreGroup: "security",
  },
  {
    id: "waf",
    href: "/waf",
    labelKey: "waf",
    adminOnly: true,
    operator: false,
    moreGroup: "security",
  },
  { id: "analytics", href: "/analytics", labelKey: "analytics", adminOnly: true, operator: false },
  {
    id: "audit-log",
    href: "/audit-log",
    labelKey: "auditLog",
    adminOnly: true,
    operator: false,
    moreGroup: "reference",
  },
  {
    id: "api-docs",
    href: "/api-docs",
    labelKey: "apiDocs",
    adminOnly: true,
    operator: false,
    moreGroup: "reference",
  },
  {
    id: "settings",
    href: "/settings",
    labelKey: "settings",
    adminOnly: true,
    operator: false,
    moreGroup: "instance",
  },
  // Not in the desktop rail, which reaches Profile from its footer. On a phone there is no footer,
  // so Profile has to be somewhere a thumb can find it.
  {
    id: "profile",
    href: "/profile",
    labelKey: "profile",
    adminOnly: false,
    operator: false,
    moreGroup: "instance",
  },
];

export const MORE_GROUPS: readonly MoreGroup[] = ["access", "security", "reference", "instance"];

/**
 * Eight, because the drawer is a three-by-three grid and the ninth slot always belongs to All
 * pages. A whole number of rows means that route can never be pushed out by a pin.
 */
export const MORE_DRAWER_SLOTS = 8;

export function canSee(destination: Destination, role: string | undefined): boolean {
  if (!destination.adminOnly) return true;
  if (role === "admin") return true;
  return role === "operator" && destination.operator;
}

export function visibleDestinations(role: string | undefined): Destination[] {
  return DESTINATIONS.filter((d) => canSee(d, role));
}

/** The pages behind More that this role may open, in canonical order. */
export function moreDestinations(role: string | undefined): Destination[] {
  return visibleDestinations(role).filter((d) => d.moreGroup !== undefined);
}

export function isDestinationId(value: unknown): value is DestinationId {
  return typeof value === "string" && DESTINATIONS.some((d) => d.id === value);
}

/**
 * What the drawer holds for this role. Before a user has chosen, that is the first eight in
 * canonical order. After, it is their own choice with anything they can no longer open removed -
 * a demoted admin keeps a saved drawer that names Settings, and must not be shown a door that
 * would only refuse them.
 */
export function resolveDrawer(
  saved: readonly DestinationId[] | null,
  role: string | undefined,
): Destination[] {
  const available = moreDestinations(role);
  if (saved === null) return available.slice(0, MORE_DRAWER_SLOTS);
  return saved
    .map((id) => available.find((d) => d.id === id))
    .filter((d): d is Destination => d !== undefined)
    .slice(0, MORE_DRAWER_SLOTS);
}
