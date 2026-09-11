import db, { toIso, nowIso } from "../db";
import { auditEvents } from "../db/schema";
import { desc, gte, like, or, count, sql } from "drizzle-orm";

export type AuditEvent = {
  id: number;
  userId: number | null;
  action: string;
  entityType: string;
  entityId: number | null;
  summary: string | null;
  createdAt: string;
};

// Escape LIKE metacharacters so user input is treated as literal text
function escapeLikePattern(input: string): string {
  return input.replace(/[%_\\]/g, (ch) => `\\${ch}`);
}

export async function countAuditEvents(search?: string): Promise<number> {
  const where = search
    ? (() => {
        const escaped = escapeLikePattern(search);
        return or(
          like(auditEvents.summary, `%${escaped}%`),
          like(auditEvents.action, `%${escaped}%`),
          like(auditEvents.entityType, `%${escaped}%`),
        );
      })()
    : undefined;
  const [row] = await db.select({ value: count() }).from(auditEvents).where(where);
  return row?.value ?? 0;
}

export async function listAuditEvents(
  limit = 100,
  offset = 0,
  search?: string,
): Promise<AuditEvent[]> {
  const where = search
    ? (() => {
        const escaped = escapeLikePattern(search);
        return or(
          like(auditEvents.summary, `%${escaped}%`),
          like(auditEvents.action, `%${escaped}%`),
          like(auditEvents.entityType, `%${escaped}%`),
        );
      })()
    : undefined;
  const events = await db
    .select()
    .from(auditEvents)
    .where(where)
    .orderBy(desc(auditEvents.createdAt))
    .limit(limit)
    .offset(offset);

  return events.map((event) => ({
    id: event.id,
    userId: event.userId,
    action: event.action,
    entityType: event.entityType,
    entityId: event.entityId,
    summary: event.summary,
    createdAt: toIso(event.createdAt)!,
  }));
}

export async function createAuditEvent(data: {
  userId: number | null;
  action: string;
  entityType: string;
  entityId?: number | null;
  summary?: string | null;
  data?: string | null;
}): Promise<void> {
  await db.insert(auditEvents).values({
    userId: data.userId,
    action: data.action,
    entityType: data.entityType,
    entityId: data.entityId ?? null,
    summary: data.summary ?? null,
    data: data.data ?? null,
    createdAt: nowIso(),
  });
}

export type AuditActivityBucket = {
  /** Start of the hour, as an ISO string truncated to the hour (e.g. 2026-09-10T14). */
  hour: string;
  count: number;
};

/**
 * Events per hour since `sinceIso`, for the activity strip above the list.
 *
 * Grouped in SQL on the ISO string's hour prefix rather than by parsing timestamps: createdAt is
 * stored as text, the prefix is fixed-width and already UTC, and this keeps a busy day's rows out
 * of the application entirely. Hours with no events are absent - the caller fills the gaps, since
 * only it knows how wide the strip is.
 */
export async function auditActivityByHour(sinceIso: string): Promise<AuditActivityBucket[]> {
  const hour = sql<string>`substr(${auditEvents.createdAt}, 1, 13)`;
  const rows = await db
    .select({ hour, count: count() })
    .from(auditEvents)
    .where(gte(auditEvents.createdAt, sinceIso))
    .groupBy(hour);
  return rows.map((row) => ({ hour: row.hour, count: Number(row.count) }));
}

/** Distinct actors and entity types in the same window, for the tiles beside the strip. */
export async function auditActivitySummary(
  sinceIso: string,
): Promise<{ events: number; actors: number; entityTypes: number }> {
  const [row] = await db
    .select({
      events: count(),
      actors: sql<number>`count(distinct ${auditEvents.userId})`.mapWith(Number),
      entityTypes: sql<number>`count(distinct ${auditEvents.entityType})`.mapWith(Number),
    })
    .from(auditEvents)
    .where(gte(auditEvents.createdAt, sinceIso));
  return {
    events: row?.events ?? 0,
    actors: row?.actors ?? 0,
    entityTypes: row?.entityTypes ?? 0,
  };
}
