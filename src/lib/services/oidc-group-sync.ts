/**
 * Applies an IdP's group claim to a CPM user: role assignment, and optionally
 * membership of CPM groups mirrored from the IdP.
 *
 * The claims are read during the OAuth callback (in the provider's
 * `mapProfileToUser`), but the user row may not exist yet at that moment and
 * the callback has no user id to hand us. So the mapping result is parked in a
 * short-lived registry keyed by provider + subject, and consumed once the
 * sign-in reaches session creation — by which point better-auth has created
 * both the user and the account row that ties the subject to the user id.
 */

import { and, eq } from "drizzle-orm";
import db, { nowIso } from "../db";
import { accounts, groupMembers, groups, users } from "../db/schema";
import { logAuditEvent } from "../audit";
import type { AppRole } from "../oidc-groups";

export type PendingOidcSync = {
  providerId: string;
  subject: string;
  providerName: string;
  /** Role the claims resolved to, or null when role mapping is off. */
  role: AppRole | null;
  /** CPM group names mirrored from the claim, empty when group sync is off. */
  localGroups: string[];
  syncGroups: boolean;
};

/** A sign-in consumes its entry within seconds; this is only a leak guard. */
const PENDING_TTL_MS = 5 * 60 * 1000;

const pending = new Map<string, { entry: PendingOidcSync; expiresAt: number }>();

function pendingKey(providerId: string, subject: string): string {
  return `${providerId}\u0000${subject}`;
}

function prunePending(now: number): void {
  for (const [key, value] of pending) {
    if (value.expiresAt <= now) pending.delete(key);
  }
}

export function recordPendingOidcSync(entry: PendingOidcSync): void {
  const now = Date.now();
  prunePending(now);
  pending.set(pendingKey(entry.providerId, entry.subject), {
    entry,
    expiresAt: now + PENDING_TTL_MS,
  });
}

export function consumePendingOidcSync(providerId: string, subject: string): PendingOidcSync | null {
  const key = pendingKey(providerId, subject);
  const found = pending.get(key);
  pending.delete(key);
  if (!found || found.expiresAt <= Date.now()) return null;
  return found.entry;
}

/** Exposed for tests — the registry is process-wide state. */
export function clearPendingOidcSyncs(): void {
  pending.clear();
}

async function countOtherActiveAdmins(userId: number): Promise<number> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "admin"), eq(users.status, "active")));
  return rows.filter((row) => row.id !== userId).length;
}

async function applyRole(userId: number, entry: PendingOidcSync): Promise<void> {
  if (entry.role === null) return;

  const current = await db.query.users.findFirst({
    where: (table, { eq: equals }) => equals(table.id, userId),
  });
  if (!current || current.role === entry.role) return;

  // Never let a claim change lock the instance out of its last administrator.
  if (current.role === "admin" && (await countOtherActiveAdmins(userId)) === 0) {
    console.warn(
      `[oidc-group-sync] Skipping demotion of user ${userId} to "${entry.role}": they are the last active admin.`
    );
    logAuditEvent({
      userId,
      action: "oidc_role_sync_skipped",
      entityType: "user",
      entityId: userId,
      summary: `Kept admin role for user ${userId}: ${entry.providerName} groups mapped to "${entry.role}" but no other active admin exists`,
    });
    return;
  }

  await db.update(users).set({ role: entry.role, updatedAt: nowIso() }).where(eq(users.id, userId));

  logAuditEvent({
    userId,
    action: "oidc_role_sync",
    entityType: "user",
    entityId: userId,
    summary: `Role for user ${userId} set to "${entry.role}" from ${entry.providerName} groups (was "${current.role}")`,
  });
}

async function applyGroups(userId: number, entry: PendingOidcSync): Promise<void> {
  if (!entry.syncGroups) return;

  const desired = new Map(entry.localGroups.map((name) => [name.toLowerCase(), name]));

  const existingGroups = await db.select().from(groups);
  const groupsByName = new Map(existingGroups.map((group) => [group.name.toLowerCase(), group]));

  const memberships = await db
    .select({ groupId: groupMembers.groupId, memberId: groupMembers.id })
    .from(groupMembers)
    .where(eq(groupMembers.userId, userId));
  const memberGroupIds = new Set(memberships.map((m) => m.groupId));

  const added: string[] = [];
  for (const [key, name] of desired) {
    let group = groupsByName.get(key);
    if (!group) {
      const now = nowIso();
      const [created] = await db
        .insert(groups)
        .values({
          name,
          description: `Synced from ${entry.providerName}`,
          createdBy: null,
          source: "oidc",
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!created) continue;
      group = created;
      groupsByName.set(key, created);
    }
    if (memberGroupIds.has(group.id)) continue;
    await db.insert(groupMembers).values({ groupId: group.id, userId, createdAt: nowIso() });
    added.push(group.name);
  }

  // Only IdP-owned groups are reconciled: a group an operator created in the UI
  // keeps whatever membership they gave it.
  const removed: string[] = [];
  for (const membership of memberships) {
    const group = existingGroups.find((g) => g.id === membership.groupId);
    if (!group || group.source !== "oidc") continue;
    if (desired.has(group.name.toLowerCase())) continue;
    await db.delete(groupMembers).where(eq(groupMembers.id, membership.memberId));
    removed.push(group.name);
  }

  if (added.length === 0 && removed.length === 0) return;

  const parts: string[] = [];
  if (added.length) parts.push(`added to ${added.join(", ")}`);
  if (removed.length) parts.push(`removed from ${removed.join(", ")}`);
  logAuditEvent({
    userId,
    action: "oidc_group_sync",
    entityType: "user",
    entityId: userId,
    summary: `Group membership for user ${userId} synced from ${entry.providerName}: ${parts.join("; ")}`,
    data: { added, removed },
  });
}

export async function applyOidcSync(userId: number, entry: PendingOidcSync): Promise<void> {
  await applyRole(userId, entry);
  await applyGroups(userId, entry);
}

/**
 * Called after better-auth creates a session. Finds the pending mapping that
 * belongs to this user by matching their linked accounts against the registry,
 * so concurrent sign-ins can never pick up each other's claims.
 */
export async function reconcileOidcUserAfterSignIn(userId: number): Promise<void> {
  if (pending.size === 0 || !Number.isFinite(userId)) return;

  const linked = await db
    .select({ providerId: accounts.providerId, accountId: accounts.accountId })
    .from(accounts)
    .where(eq(accounts.userId, userId));

  for (const account of linked) {
    const entry = consumePendingOidcSync(account.providerId, account.accountId);
    if (!entry) continue;
    await applyOidcSync(userId, entry);
    return;
  }
}
