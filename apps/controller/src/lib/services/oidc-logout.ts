/**
 * The two halves of OIDC back-channel logout that touch the database: remembering which IdP
 * session a CPM session came from, and ending sessions when the IdP says that one is over.
 *
 * Binding has the same shape as the group sync next door, and for the same reason: the `sid` is a
 * claim in the ID token, which is written with the account row, while the thing it has to be
 * stored on is the session row created moments later. So the account hook parks it and the session
 * hook consumes it.
 */

import { and, eq, inArray } from "drizzle-orm";
import db from "../db";
import { accounts, sessions } from "../db/schema";
import { logAuditEvent } from "../audit";
import { decodeJwtPayload } from "../oidc-claims";
import { decryptSecret, isEncryptedSecret } from "../secret";
import { deleteUserForwardAuthSessions } from "../models/forward-auth";

export type PendingSessionBinding = {
  userId: number;
  providerId: string;
  sid: string;
};

/** A sign-in consumes its entry within milliseconds; this is only a leak guard. */
const PENDING_TTL_MS = 5 * 60 * 1000;

const pending = new Map<number, { entry: PendingSessionBinding; expiresAt: number }>();

function prunePending(now: number): void {
  for (const [key, value] of pending) {
    if (value.expiresAt <= now) pending.delete(key);
  }
}

export function recordPendingSessionBinding(entry: PendingSessionBinding): void {
  const now = Date.now();
  prunePending(now);
  pending.set(entry.userId, { entry, expiresAt: now + PENDING_TTL_MS });
}

export function consumePendingSessionBinding(userId: number): PendingSessionBinding | null {
  const found = pending.get(userId);
  pending.delete(userId);
  if (!found || found.expiresAt <= Date.now()) return null;
  return found.entry;
}

/** Exposed for tests — the registry is process-wide state. */
export function clearPendingSessionBindings(): void {
  pending.clear();
}

/**
 * Park the `sid` from an ID token being written to an account row.
 *
 * Called from the account hooks, where the token is still in hand. Providers that issue no `sid`
 * park nothing, and their sessions stay unbound — a logout token from one of those can only be
 * honoured by subject, which is what the spec expects of it anyway.
 */
export function recordSessionBindingFromIdToken(
  userId: number,
  providerId: string,
  idToken: string | null | undefined,
): void {
  if (!Number.isFinite(userId) || !idToken) return;
  const raw = isEncryptedSecret(idToken) ? decryptSecret(idToken, "OIDC id_token") : idToken;
  const claims = decodeJwtPayload(raw);
  const sid = claims?.sid;
  if (typeof sid !== "string" || !sid) return;
  recordPendingSessionBinding({ userId, providerId, sid });
}

/** Called after better-auth creates a session: stamp it with the IdP session it belongs to. */
export async function bindSessionToIdpSession(userId: number, sessionId: number): Promise<void> {
  if (pending.size === 0 || !Number.isFinite(userId) || !Number.isFinite(sessionId)) return;
  const entry = consumePendingSessionBinding(userId);
  if (!entry) return;

  await db
    .update(sessions)
    .set({ oidcProviderId: entry.providerId, oidcSid: entry.sid })
    .where(eq(sessions.id, sessionId));
}

export type RevocationTarget = {
  providerId: string;
  /** The IdP subject, when the logout token named one. */
  subject: string | null;
  /** The IdP session id, when the logout token named one. */
  sessionId: string | null;
};

export type RevocationResult = {
  /** CPM sessions deleted. Zero is a success: the user may simply not have been signed in. */
  sessions: number;
  /** Users whose sessions were ended, for the audit trail. */
  userIds: number[];
};

/**
 * End the sessions a logout token names.
 *
 * A `sid` ends exactly the session it names, which is the whole point of the claim. A token with
 * only a `sub` ends every session that subject has, because there is nothing finer to go on.
 *
 * Forward-auth sessions go either way. They are minted from a CPM session but outlive it, so a
 * proxied host would keep letting the user in after their SSO session ended — and unlike CPM's own
 * sessions they carry no `sid` to narrow by, so all of the user's are dropped.
 */
export async function revokeSessionsForLogoutToken(
  target: RevocationTarget,
): Promise<RevocationResult> {
  const userIds = new Set<number>();
  let deleted = 0;

  if (target.sessionId) {
    const rows = await db
      .delete(sessions)
      .where(
        and(eq(sessions.oidcProviderId, target.providerId), eq(sessions.oidcSid, target.sessionId)),
      )
      .returning({ userId: sessions.userId });
    deleted += rows.length;
    for (const row of rows) userIds.add(row.userId);
  }

  if (target.subject) {
    const owners = await db
      .select({ userId: accounts.userId })
      .from(accounts)
      .where(
        and(eq(accounts.providerId, target.providerId), eq(accounts.accountId, target.subject)),
      );
    const ids = owners.map((row) => row.userId);
    if (ids.length > 0) {
      const rows = await db
        .delete(sessions)
        .where(inArray(sessions.userId, ids))
        .returning({ userId: sessions.userId });
      deleted += rows.length;
      for (const id of ids) userIds.add(id);
    }
  }

  for (const userId of userIds) {
    await deleteUserForwardAuthSessions(userId);
    await logAuditEvent({
      userId,
      action: "oidc_backchannel_logout",
      entityType: "user",
      entityId: userId,
      summary: `Sessions for user ${userId} ended by a back-channel logout from ${target.providerId}`,
      data: { providerId: target.providerId, bySessionId: target.sessionId !== null },
    });
  }

  return { sessions: deleted, userIds: [...userIds] };
}
