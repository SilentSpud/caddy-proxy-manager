import db, { nowIso } from "./db";
import { auditEvents } from "./db/schema";

/**
 * Await this. It was synchronous while SQLite was the only backend; PostgreSQL writes are
 * asynchronous, and an un-awaited call would let the request finish before the row lands.
 */
export async function logAuditEvent(params: {
  userId?: number | null;
  action: string;
  entityType: string;
  entityId?: number | null;
  summary?: string | null;
  data?: unknown;
}): Promise<void> {
  try {
    await db.insert(auditEvents).values({
      userId: params.userId ?? null,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId ?? null,
      summary: params.summary ?? null,
      data: params.data ? JSON.stringify(params.data) : null,
      createdAt: nowIso(),
    });
  } catch (error) {
    // Log error but don't throw to avoid breaking the main flow
    console.error("Failed to log audit event:", error);
  }
}
