import db, { toIso } from "@/src/lib/db";
import { requireUser } from "@/src/lib/auth";
import OverviewClient from "./OverviewClient";
import { accessLists, auditEvents, certificates, proxyHosts, users } from "@/src/lib/db/schema";
import { count, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { getAnalyticsSummary } from "@/src/lib/analytics-db";
import { isDomainCoveredByCert } from "@/src/lib/cert-domain-match";
import type { Metadata } from "next";

import type { StatCard } from "./OverviewClient";
import { getTranslations } from "next-intl/server";

async function loadStats(): Promise<StatCard[]> {
  const [
    proxyHostCountResult,
    proxyHostEnabledResult,
    acmeRows,
    certRows,
    importedCertCountResult,
    accessListCountResult,
  ] = await Promise.all([
    db.select({ value: count() }).from(proxyHosts),
    db.select({ value: count() }).from(proxyHosts).where(eq(proxyHosts.enabled, true)),
    // All proxy hosts with no explicit cert (for ACME deduplication)
    db
      .select({ domains: proxyHosts.domains })
      .from(proxyHosts)
      .where(isNull(proxyHosts.certificateId)),
    // All certs (for wildcard coverage check)
    db
      .select({
        id: certificates.id,
        type: certificates.type,
        domainNames: certificates.domainNames,
        certificatePem: certificates.certificatePem,
      })
      .from(certificates),
    // Imported certs with actual PEM data (valid, user-managed)
    db
      .select({ value: count() })
      .from(certificates)
      .where(sql`${certificates.type} = 'imported' AND ${certificates.certificatePem} IS NOT NULL`),
    db.select({ value: count() }).from(accessLists),
  ]);

  // Build cert domain map for wildcard coverage checks
  const certDomainMap = new Map<number, string[]>();
  for (const cert of certRows) {
    certDomainMap.set(cert.id, JSON.parse(cert.domainNames) as string[]);
  }

  // Deduplicate ACME hosts: remove those covered by a cert's wildcard or another ACME wildcard
  const acmeHostDomains = acmeRows.map((r) => JSON.parse(r.domains) as string[]);
  const wildcardAcmeDomainSets = acmeHostDomains.filter((domains) =>
    domains.some((d: string) => d.startsWith("*.")),
  );

  let acmeCount = 0;
  for (const domains of acmeHostDomains) {
    // Check if covered by an existing certificate's wildcard
    let covered = false;
    for (const [, certDomains] of certDomainMap) {
      if (domains.every((d: string) => isDomainCoveredByCert(d, certDomains))) {
        covered = true;
        break;
      }
    }
    // Check if this non-wildcard host is covered by a wildcard ACME host
    if (!covered && !domains.some((d: string) => d.startsWith("*."))) {
      covered = wildcardAcmeDomainSets.some((wcDomains) =>
        domains.every((d: string) => isDomainCoveredByCert(d, wcDomains)),
      );
    }
    if (!covered) acmeCount++;
  }

  const proxyHostsCount = proxyHostCountResult[0]?.value ?? 0;
  const certificatesCount = acmeCount + (importedCertCountResult[0]?.value ?? 0);
  const accessListsCount = accessListCountResult[0]?.value ?? 0;

  // The icon travels as a name, not an element: a component cannot cross the
  // server/client boundary, and an element would carry its styling with it.
  return [
    {
      label: "Proxy Hosts",
      icon: "proxyHosts",
      // A disabled host still holds its domain and still shows in the list, so the
      // headline is what is actually being served and the total sits beside it.
      count: proxyHostEnabledResult[0]?.value ?? 0,
      total: proxyHostsCount,
      href: "/proxy-hosts",
    },
    {
      label: "Certificates",
      icon: "certificates",
      count: certificatesCount,
      href: "/certificates",
    },
    { label: "Access Lists", icon: "accessLists", count: accessListsCount, href: "/access-lists" },
  ];
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("overview") };
}

export default async function OverviewPage() {
  const session = await requireUser();
  const isAdmin = session.user.role === "admin";

  // Non-admin users see a minimal welcome page
  if (!isAdmin) {
    return (
      <OverviewClient
        userName={session.user.name ?? session.user.email ?? "User"}
        stats={[]}
        trafficSummary={null}
        recentEvents={[]}
        isAdmin={false}
      />
    );
  }

  const [stats, trafficSummary, recentEventsRaw, serverEventCountRows] = await Promise.all([
    loadStats(),
    getAnalyticsSummary(
      Math.floor(Date.now() / 1000) - 86400,
      Math.floor(Date.now() / 1000),
      [],
    ).catch(() => null),
    // The server-event log. Rendered on the server because it is the one band that does
    // not follow the range control - and the one with something to show on an install
    // where access logging was never switched on.
    db
      .select({
        id: auditEvents.id,
        userId: auditEvents.userId,
        action: auditEvents.action,
        entityType: auditEvents.entityType,
        summary: auditEvents.summary,
        createdAt: auditEvents.createdAt,
      })
      .from(auditEvents)
      .orderBy(desc(auditEvents.createdAt))
      .limit(12),
    // The Server log tile's number. Counted rather than taken from the list above,
    // which is capped at a paneful.
    db
      .select({ value: count() })
      .from(auditEvents)
      .where(gte(auditEvents.createdAt, new Date(Date.now() - 86_400_000).toISOString())),
  ]);

  const actorNames = await loadActorNames(recentEventsRaw.map((event) => event.userId));

  return (
    <OverviewClient
      userName={session.user.name ?? session.user.email ?? "Admin"}
      stats={stats}
      trafficSummary={trafficSummary}
      isAdmin={true}
      serverEventCount={serverEventCountRows[0]?.value ?? 0}
      recentEvents={recentEventsRaw.map((event) => ({
        id: event.id,
        action: event.action,
        entityType: event.entityType,
        actor: event.userId === null ? null : (actorNames.get(event.userId) ?? null),
        summary: event.summary ?? `${event.action} on ${event.entityType}`,
        createdAt: toIso(event.createdAt)!,
      }))}
    />
  );
}

/**
 * Names for the audit rows' actors, in one query.
 *
 * `audit_events.userId` is nullable and set null on user deletion, so a row can name
 * an account that no longer exists; those fall back to the system actor in the UI
 * rather than showing a bare id.
 */
async function loadActorNames(userIds: (number | null)[]): Promise<Map<number, string>> {
  const ids = [...new Set(userIds.filter((id): id is number => id !== null))];
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(inArray(users.id, ids));
  return new Map(rows.map((row) => [row.id, row.name ?? row.email ?? String(row.id)]));
}
