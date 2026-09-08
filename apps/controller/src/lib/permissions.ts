/**
 * Who may see and change what.
 *
 * Three roles managed nothing and one managed everything, which is fine until an operator wants to
 * hand one team its own hosts. `operator` is the fourth: a role whose baseline is **nothing**, and
 * whose reach is exactly what its groups were granted.
 *
 * The shape of the rule matters more than the mechanism:
 *
 * - `admin` ignores grants entirely. Adding a grant can never take anything away from an admin,
 *   and no arrangement of groups can produce an instance nobody can administer.
 * - `user` and `viewer` are unchanged. They are forward-auth identities: they sign in, see their
 *   own profile, and manage nothing. A grant does not reach them, so shipping this changes no
 *   existing user's access.
 * - `operator` starts with nothing and gains only what a group it belongs to was granted.
 *
 * So grants are additive in the strict sense — every existing account keeps exactly the access it
 * had, and an operator is something someone has to deliberately create.
 */

import type { Session } from "./auth";
import {
  type EffectiveGrants,
  type GrantCapability,
  emptyGrants,
  grantsForUser,
} from "./models/group-grants";

export type ResourceKind = "proxyHost" | "l4ProxyHost" | "agent";

/** What the current viewer may do, resolved once per request. */
export type Access = {
  userId: number;
  role: string;
  /** True for an admin: every check below short-circuits to allowed. */
  isAdmin: boolean;
  /** True for an operator — the only non-admin role grants apply to. */
  isOperator: boolean;
  grants: EffectiveGrants;
};

export class ForbiddenError extends Error {
  constructor(message = "You do not have access to that.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

function bucket(access: Access, kind: ResourceKind): Map<number, GrantCapability> {
  if (kind === "proxyHost") return access.grants.proxyHosts;
  if (kind === "l4ProxyHost") return access.grants.l4ProxyHosts;
  return access.grants.agents;
}

/**
 * Resolve what this session may do.
 *
 * Grants are only loaded for an operator. For everyone else the answer does not depend on them,
 * and a query per request for a value nothing reads is a query per request for nothing.
 */
export async function resolveAccess(session: Session): Promise<Access> {
  const userId = Number(session.user.id);
  const role = session.user.role;
  const isAdmin = role === "admin";
  const isOperator = role === "operator";

  return {
    userId,
    role,
    isAdmin,
    isOperator,
    grants: isOperator ? await grantsForUser(userId) : emptyGrants(),
  };
}

/** Whether this viewer may see the resource at all. A manage grant implies view. */
export function canView(access: Access, kind: ResourceKind, id: number): boolean {
  if (access.isAdmin) return true;
  if (!access.isOperator) return false;
  return bucket(access, kind).has(id);
}

/** Whether this viewer may change the resource. */
export function canManage(access: Access, kind: ResourceKind, id: number): boolean {
  if (access.isAdmin) return true;
  if (!access.isOperator) return false;
  return bucket(access, kind).get(id) === "manage";
}

/**
 * Whether this viewer may create resources of a kind, or reach anything not tied to one — global
 * settings, certificates, users.
 *
 * Admins only, and deliberately so: a grant names a resource that already exists, so there is
 * nothing for it to say about one that does not. An operator who needs a new host asks an admin,
 * which is a smaller surface than inventing a "may create, in this shape" grant nobody asked for.
 */
export function canCreate(access: Access): boolean {
  return access.isAdmin;
}

/** Narrow a list to what this viewer may see. */
export function visibleIds(access: Access, kind: ResourceKind, ids: number[]): number[] {
  if (access.isAdmin) return ids;
  if (!access.isOperator) return [];
  const granted = bucket(access, kind);
  return ids.filter((id) => granted.has(id));
}

/** The ids this viewer may see, or null meaning "no restriction" — an admin. */
export function visibleIdFilter(access: Access, kind: ResourceKind): Set<number> | null {
  if (access.isAdmin) return null;
  if (!access.isOperator) return new Set();
  return new Set(bucket(access, kind).keys());
}

/** Throw unless this viewer may change the resource. */
export function assertCanManage(access: Access, kind: ResourceKind, id: number): void {
  if (canManage(access, kind, id)) return;
  throw new ForbiddenError();
}

/** Throw unless this viewer may see the resource. */
export function assertCanView(access: Access, kind: ResourceKind, id: number): void {
  if (canView(access, kind, id)) return;
  throw new ForbiddenError();
}

/** The access for the current session, requiring a role that manages something. */
export async function requireAccess(): Promise<Access> {
  const { requireManager } = await import("./auth");
  return resolveAccess(await requireManager());
}

/**
 * Whether this role has any management surface at all.
 *
 * What the dashboard navigation is gated on. An operator with no grants still gets the pages —
 * empty — rather than a redirect, because "you have no hosts yet" is a more useful answer than a
 * missing menu item they cannot explain.
 */
export function hasManagementSurface(role: string | undefined): boolean {
  return role === "admin" || role === "operator";
}
