/**
 * Pure mapping logic that turns an OIDC provider's group claim into a CPM role
 * and a set of CPM group names. No I/O and no database access lives here so the
 * rules stay independently testable — the side effects are in
 * services/oidc-group-sync.ts.
 */

export type AppRole = "admin" | "user" | "viewer";

export const APP_ROLES: readonly AppRole[] = ["admin", "user", "viewer"] as const;

/** Privilege order, most privileged first. The first match wins. */
const ROLE_PRECEDENCE: readonly AppRole[] = ["admin", "user", "viewer"] as const;

/** Suffix appended to `groupPrefix` when no explicit group name is configured. */
const ROLE_SUFFIX: Record<AppRole, string> = {
  admin: "Admin",
  user: "User",
  viewer: "Viewer",
};

export function isAppRole(value: unknown): value is AppRole {
  return typeof value === "string" && (APP_ROLES as readonly string[]).includes(value);
}

/** The subset of an OAuth provider row that drives group mapping. */
export type GroupMappingConfig = {
  groupsClaim: string;
  groupPrefix: string | null;
  roleMappingEnabled: boolean;
  adminGroup: string | null;
  userGroup: string | null;
  viewerGroup: string | null;
  defaultRole: AppRole;
  syncGroups: boolean;
};

export function toGroupMappingConfig(provider: {
  groupsClaim?: string | null;
  groupPrefix?: string | null;
  roleMappingEnabled?: boolean | null;
  adminGroup?: string | null;
  userGroup?: string | null;
  viewerGroup?: string | null;
  defaultRole?: string | null;
  syncGroups?: boolean | null;
}): GroupMappingConfig {
  return {
    groupsClaim: provider.groupsClaim?.trim() || "groups",
    groupPrefix: provider.groupPrefix?.trim() || null,
    roleMappingEnabled: provider.roleMappingEnabled === true,
    adminGroup: provider.adminGroup?.trim() || null,
    userGroup: provider.userGroup?.trim() || null,
    viewerGroup: provider.viewerGroup?.trim() || null,
    defaultRole: isAppRole(provider.defaultRole) ? provider.defaultRole : "user",
    syncGroups: provider.syncGroups === true,
  };
}

/** True when the provider needs the group claim resolved at sign-in time. */
export function needsGroupClaims(cfg: GroupMappingConfig): boolean {
  return cfg.roleMappingEnabled || cfg.syncGroups;
}

/**
 * Groups are compared case-insensitively and with any Keycloak-style path
 * prefix ("/Parent/CPM_Admin" → "CPM_Admin") removed, because IdPs are
 * inconsistent about both.
 */
export function normalizeGroupName(value: string): string {
  const trimmed = value.trim();
  const lastSegment = trimmed.includes("/") ? trimmed.slice(trimmed.lastIndexOf("/") + 1) : trimmed;
  return lastSegment.trim();
}

function comparableGroupName(value: string): string {
  return normalizeGroupName(value).toLowerCase();
}

/**
 * Reads a (possibly nested) claim. `path` is dot-separated so providers that
 * bury groups — Keycloak's `resource_access.<client>.roles`, for example — work
 * without a bespoke option.
 */
export function readClaim(claims: Record<string, unknown>, path: string): unknown {
  if (!path) return undefined;
  let current: unknown = claims;
  for (const segment of path.split(".")) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function coerceGroupEntry(entry: unknown): string | null {
  if (typeof entry === "string") return entry.trim() || null;
  if (entry && typeof entry === "object") {
    // Some IdPs return objects rather than plain strings.
    const record = entry as Record<string, unknown>;
    for (const key of ["name", "displayName", "path", "id"]) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }
  return null;
}

/**
 * Normalises the many shapes a group claim can take: an array of strings, an
 * array of objects, a comma-separated string, or a JSON-encoded array.
 *
 * Only commas separate a string-valued claim — group names commonly contain
 * spaces, so splitting on whitespace would shred them.
 */
export function extractGroups(claims: Record<string, unknown>, groupsClaim: string): string[] {
  const raw = readClaim(claims, groupsClaim);
  if (raw === undefined || raw === null) return [];

  let entries: unknown[];
  if (Array.isArray(raw)) {
    entries = raw;
  } else if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith("[")) {
      try {
        const parsed: unknown = JSON.parse(trimmed);
        entries = Array.isArray(parsed) ? parsed : [trimmed];
      } catch {
        entries = trimmed.split(",");
      }
    } else {
      entries = trimmed.split(",");
    }
  } else {
    return [];
  }

  const seen = new Set<string>();
  const groups: string[] = [];
  for (const entry of entries) {
    const value = coerceGroupEntry(entry);
    if (!value) continue;
    const normalized = normalizeGroupName(value);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    groups.push(normalized);
  }
  return groups;
}

/**
 * Splits a configured group setting into names. Commas separate, so several
 * groups can grant the same role — matching how a string-valued group claim is
 * parsed, and letting group names keep their spaces.
 */
export function parseGroupNames(value: string | null): string[] {
  if (!value) return [];
  const seen = new Set<string>();
  const names: string[] = [];
  for (const part of value.split(",")) {
    const name = normalizeGroupName(part);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

/**
 * The groups that grant each role: the names configured for that role when it
 * has any, otherwise `<groupPrefix><Role>` (so prefix "CPM_" yields
 * "CPM_Admin"). Naming the groups outright and using the prefix convention are
 * equally valid — a role with its own names ignores the prefix, and a role
 * without them falls back to it, so the two can be mixed.
 */
export function resolveRoleGroups(cfg: GroupMappingConfig): Record<AppRole, string[]> {
  const configured: Record<AppRole, string | null> = {
    admin: cfg.adminGroup,
    user: cfg.userGroup,
    viewer: cfg.viewerGroup,
  };
  const result = {} as Record<AppRole, string[]>;
  for (const role of APP_ROLES) {
    const names = parseGroupNames(configured[role]);
    result[role] =
      names.length > 0 ? names : cfg.groupPrefix ? [`${cfg.groupPrefix}${ROLE_SUFFIX[role]}`] : [];
  }
  return result;
}

/**
 * Maps claimed groups to a role. Returns `null` when role mapping is off, and
 * `cfg.defaultRole` when it is on but no role group matched — so an enabled
 * mapping is authoritative: losing the admin group demotes the user.
 */
export function mapGroupsToRole(groups: string[], cfg: GroupMappingConfig): AppRole | null {
  if (!cfg.roleMappingEnabled) return null;

  const claimed = new Set(groups.map(comparableGroupName));
  const roleGroups = resolveRoleGroups(cfg);
  for (const role of ROLE_PRECEDENCE) {
    // Any one of a role's groups is enough to grant it.
    if (roleGroups[role].some((name) => claimed.has(comparableGroupName(name)))) return role;
  }
  return cfg.defaultRole;
}

/**
 * The CPM group names to mirror: claimed groups that carry the prefix, with the
 * prefix stripped, minus the groups that already encode a role. Without a
 * prefix every claimed group is mirrored verbatim.
 */
export function mapGroupsToLocalGroups(groups: string[], cfg: GroupMappingConfig): string[] {
  if (!cfg.syncGroups) return [];

  const roleGroupNames = new Set(
    Object.values(resolveRoleGroups(cfg)).flat().map(comparableGroupName),
  );

  const prefix = cfg.groupPrefix;
  const seen = new Set<string>();
  const result: string[] = [];

  for (const group of groups) {
    const normalized = normalizeGroupName(group);
    if (!normalized) continue;
    if (cfg.roleMappingEnabled && roleGroupNames.has(normalized.toLowerCase())) continue;

    let name = normalized;
    if (prefix) {
      if (!normalized.toLowerCase().startsWith(prefix.toLowerCase())) continue;
      name = normalized.slice(prefix.length).trim();
      if (!name) continue;
    }

    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(name);
  }

  return result;
}
