import AuditLogClient from "./AuditLogClient";
import {
  listAuditEvents,
  countAuditEvents,
  auditActivityByHour,
  auditActivitySummary,
} from "@/src/lib/models/audit";
import { listUsers } from "@/src/lib/models/user";
import { requireAdmin } from "@/src/lib/auth";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

const PER_PAGE = 50;

interface PageProps {
  searchParams: Promise<{ page?: string; search?: string }>;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("auditLog") };
}

export default async function AuditLogPage({ searchParams }: PageProps) {
  await requireAdmin();
  const { page: pageParam, search: searchParam } = await searchParams;
  const page = Math.max(1, parseInt(pageParam ?? "1", 10) || 1);
  const search = searchParam?.trim() || undefined;
  const offset = (page - 1) * PER_PAGE;

  // The strip and the tiles describe the last 24 hours of the whole log, deliberately ignoring the
  // search: they are context for what you are about to read, not a summary of it.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const sinceIso = since.toISOString();

  const [events, total, users, activity, summary] = await Promise.all([
    listAuditEvents(PER_PAGE, offset, search),
    countAuditEvents(search),
    listUsers(),
    auditActivityByHour(sinceIso).catch(() => []),
    auditActivitySummary(sinceIso).catch(() => ({ events: 0, actors: 0, entityTypes: 0 })),
  ]);

  // Fill the gaps the query leaves out, so the strip always has 24 bars and a quiet hour reads as
  // a quiet hour rather than as a missing one.
  const counts = new Map(activity.map((bucket) => [bucket.hour, bucket.count]));
  const buckets = Array.from({ length: 24 }, (_, index) => {
    const at = new Date(since.getTime() + index * 60 * 60 * 1000);
    const key = at.toISOString().slice(0, 13);
    return { label: `${key.slice(11)}:00 UTC`, count: counts.get(key) ?? 0 };
  });

  const userMap = new Map(users.map((user) => [user.id, user]));

  return (
    <AuditLogClient
      events={events.map((event) => ({
        id: event.id,
        createdAt: event.createdAt,
        action: event.action,
        entityType: event.entityType,
        summary: event.summary ?? `${event.action} on ${event.entityType}`,
        user: event.userId
          ? (userMap.get(event.userId)?.name ?? userMap.get(event.userId)?.email ?? "System")
          : "System",
      }))}
      pagination={{ total, page, perPage: PER_PAGE }}
      initialSearch={search ?? ""}
      activity={buckets}
      summary={summary}
    />
  );
}
