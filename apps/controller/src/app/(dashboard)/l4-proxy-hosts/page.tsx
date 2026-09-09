import L4ProxyHostsClient from "./L4ProxyHostsClient";
import { listL4ProxyHostsPaginated, countL4ProxyHosts } from "@/src/lib/models/l4-proxy-hosts";
import { listAgentOptions } from "@/src/lib/agent/client";
import { agentIdsForHosts } from "@/src/lib/models/host-agents";
import { canCreate, requireAccess, visibleIdFilter } from "@/src/lib/permissions";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

const PER_PAGE = 25;

interface PageProps {
  searchParams: Promise<{ page?: string; search?: string; sortBy?: string; sortDir?: string }>;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("l4ProxyHosts") };
}

export default async function L4ProxyHostsPage({ searchParams }: PageProps) {
  const access = await requireAccess();
  const visible = visibleIdFilter(access, "l4ProxyHost");
  const visibleIds = visible === null ? null : [...visible];
  const {
    page: pageParam,
    search: searchParam,
    sortBy: sortByParam,
    sortDir: sortDirParam,
  } = await searchParams;
  const page = Math.max(1, parseInt(pageParam ?? "1", 10) || 1);
  const search = searchParam?.trim() || undefined;
  const offset = (page - 1) * PER_PAGE;
  const sortBy = sortByParam || undefined;
  const sortDir = sortDirParam === "asc" || sortDirParam === "desc" ? sortDirParam : "desc";

  const [hosts, total] = await Promise.all([
    listL4ProxyHostsPaginated(PER_PAGE, offset, search, sortBy, sortDir, visibleIds),
    countL4ProxyHosts(search, visibleIds),
  ]);

  // Only the hosts on this page - the map is for the edit dialog.
  const [agents, assignments] = await Promise.all([
    listAgentOptions().catch(() => []),
    agentIdsForHosts(
      "l4",
      hosts.map((host) => host.id),
    ).catch(() => new Map<number, number[]>()),
  ]);

  return (
    <L4ProxyHostsClient
      hosts={hosts}
      pagination={{ total, page, perPage: PER_PAGE }}
      initialSearch={search ?? ""}
      initialSort={{ sortBy: sortBy ?? "createdAt", sortDir }}
      agents={agents}
      agentAssignments={Object.fromEntries(assignments)}
      canCreate={canCreate(access)}
    />
  );
}
