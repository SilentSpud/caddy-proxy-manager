import { and, eq } from "drizzle-orm";
import db from "../db";
import { sessions } from "../db/schema";

/**
 * Active management-UI session for a user, as shown in the profile. (Forward-auth `_cpm_fa`
 * sessions are tracked separately.)
 */
export interface UserSession {
  id: number;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  ipAddress: string | null;
  userAgent: string | null;
}

/** List a user's non-expired sessions, newest first. */
export async function listUserSessions(userId: number): Promise<UserSession[]> {
  const now = Date.now();
  const rows = await db
    .select({
      id: sessions.id,
      createdAt: sessions.createdAt,
      updatedAt: sessions.updatedAt,
      expiresAt: sessions.expiresAt,
      ipAddress: sessions.ipAddress,
      userAgent: sessions.userAgent,
    })
    .from(sessions)
    .where(eq(sessions.userId, userId));

  return rows
    .filter((r) => {
      const exp = new Date(r.expiresAt).getTime();
      return Number.isNaN(exp) || exp > now;
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

/** Revoke one session, only if it belongs to the user. False when none, so callers can 404. */
export async function revokeUserSession(userId: number, sessionId: number): Promise<boolean> {
  const [existing] = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)));
  if (!existing) return false;
  await db.delete(sessions).where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)));
  return true;
}

/** Revoke all a user's sessions except `exceptSessionId`. Returns the number revoked. */
export async function revokeOtherUserSessions(
  userId: number,
  exceptSessionId: number | null,
): Promise<number> {
  const rows = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(eq(sessions.userId, userId));
  const toRevoke = rows.map((r) => r.id).filter((id) => id !== exceptSessionId);
  for (const id of toRevoke) {
    await db.delete(sessions).where(and(eq(sessions.id, id), eq(sessions.userId, userId)));
  }
  return toRevoke.length;
}
