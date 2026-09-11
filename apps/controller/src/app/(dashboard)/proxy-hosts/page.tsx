import ProxyHostsClient from "./ProxyHostsClient";
import {
  listProxyHostsPaginated,
  countProxyHosts,
  countProxyHostsByState,
} from "@/src/lib/models/proxy-hosts";
import { getTrafficByProxyHost } from "@/src/lib/analytics-db";
import { listCertificates } from "@/src/lib/models/certificates";
import { listCaCertificates } from "@/src/lib/models/ca-certificates";
import { listAccessLists } from "@/src/lib/models/access-lists";
import { getAuthentikSettings, getGeneralSettings, getTailscaleSettings } from "@/src/lib/settings";
import { listMtlsRoles } from "@/src/lib/models/mtls-roles";
import { listIssuedClientCertificates } from "@/src/lib/models/issued-client-certificates";
import { listUsers } from "@/src/lib/models/user";
import { listGroups } from "@/src/lib/models/groups";
import { getForwardAuthAccessForHost } from "@/src/lib/models/forward-auth";
import { listAgentOptions } from "@/src/lib/agent/client";
import { agentIdsForHosts } from "@/src/lib/models/host-agents";
import { canCreate, requireAccess, visibleIdFilter } from "@/src/lib/permissions";
import type { Metadata } from "next";
import { toCertificatePickerOption } from "@/src/lib/certificate-api";
import { getTranslations } from "next-intl/server";

const PER_PAGE = 25;

interface PageProps {
  searchParams: Promise<{
    page?: string;
    search?: string;
    sortBy?: string;
    sortDir?: string;
    state?: string;
  }>;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("proxyHosts") };
}

export default async function ProxyHostsPage({ searchParams }: PageProps) {
  // An operator reaches this page too; what they see on it is decided per host. Null from
  // visibleIdFilter is an admin - no restriction - which is why it is not `?? []`.
  const access = await requireAccess();
  const visible = visibleIdFilter(access, "proxyHost");
  const visibleIds = visible === null ? null : [...visible];
  const {
    page: pageParam,
    search: searchParam,
    sortBy: sortByParam,
    sortDir: sortDirParam,
    state: stateParam,
  } = await searchParams;
  // The list tabs are a filter on the query, not on the page that came back: filtering client-side
  // would make "Disabled 2" show nothing whenever both disabled hosts sat on a later page.
  const enabled = stateParam === "enabled" ? true : stateParam === "disabled" ? false : undefined;
  const page = Math.max(1, parseInt(pageParam ?? "1", 10) || 1);
  const search = searchParam?.trim() || undefined;
  const offset = (page - 1) * PER_PAGE;
  const sortBy = sortByParam || undefined;
  const sortDir = sortDirParam === "asc" || sortDirParam === "desc" ? sortDirParam : "desc";

  const [
    hosts,
    total,
    certificates,
    caCertificates,
    accessLists,
    authentikDefaults,
    tailscaleSettings,
    generalSettings,
  ] = await Promise.all([
    listProxyHostsPaginated(PER_PAGE, offset, search, sortBy, sortDir, visibleIds, enabled),
    countProxyHosts(search, visibleIds, enabled),
    listCertificates(),
    listCaCertificates(),
    listAccessLists(),
    getAuthentikSettings(),
    getTailscaleSettings(),
    getGeneralSettings(),
  ]);
  // These are safe to fail if the RBAC migration hasn't been applied yet
  const [mtlsRoles, issuedClientCerts, allUsers, allGroups] = await Promise.all([
    listMtlsRoles().catch(() => []),
    listIssuedClientCertificates().catch(() => []),
    listUsers().catch(() => []),
    listGroups().catch(() => []),
  ]);

  // Only the hosts on this page: the map is for the edit dialog, and loading the fleet's whole
  // assignment table to fill in twenty-five rows would grow with the deployment for no gain.
  const [agents, assignments] = await Promise.all([
    listAgentOptions().catch(() => []),
    agentIdsForHosts(
      "http",
      hosts.map((host) => host.id),
    ).catch(() => new Map<number, number[]>()),
  ]);
  const agentAssignments = Object.fromEntries(assignments);

  // The header counts the whole (visible, searched) set rather than this page, and the traffic
  // column is best-effort: with analytics off, getTrafficByProxyHost returns nothing and the
  // column renders empty instead of the list failing.
  const dayAgo = Math.floor(Date.now() / 1000) - 24 * 60 * 60;
  const [counts, traffic] = await Promise.all([
    countProxyHostsByState(search, visibleIds),
    getTrafficByProxyHost(
      dayAgo,
      Math.floor(Date.now() / 1000),
      hosts.map((host) => ({ id: host.id, domains: host.domains })),
    ),
  ]);
  const hostTraffic = Object.fromEntries(traffic);

  // Build forward auth access map for hosts that have CPM forward auth enabled
  const faHosts = hosts.filter((h) => h.cpmForwardAuth?.enabled);
  const faAccessEntries = await Promise.all(
    faHosts.map((h) => getForwardAuthAccessForHost(h.id).catch(() => [])),
  );
  const forwardAuthAccessMap: Record<number, { userIds: number[]; groupIds: number[] }> = {};
  faHosts.forEach((h, i) => {
    const entries = faAccessEntries[i];
    forwardAuthAccessMap[h.id] = {
      userIds: entries.filter((e) => e.userId !== null).map((e) => e.userId!),
      groupIds: entries.filter((e) => e.groupId !== null).map((e) => e.groupId!),
    };
  });

  const forwardAuthUsers = allUsers.map((u) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
  }));
  const forwardAuthGroups = allGroups.map((g) => ({
    id: g.id,
    name: g.name,
    description: g.description,
    member_count: g.members.length,
  }));

  return (
    <ProxyHostsClient
      hosts={hosts}
      certificates={certificates.map(toCertificatePickerOption)}
      caCertificates={caCertificates}
      accessLists={accessLists}
      authentikDefaults={authentikDefaults}
      // Prefills the domains field of a new host. Empty when setup has not run, which is the
      // same as having no default: the field simply starts blank.
      defaultDomain={generalSettings?.defaultDomain ?? ""}
      // Only what the host form needs to warn accurately: whether the feature is on, whether a
      // key exists at all, and the node a host inherits. Never the key itself.
      //
      // Always a value, never null: settings that have never been saved mean Tailscale is off and
      // no key is stored, which is exactly when the form's warnings matter most. Passing null
      // there left the fields unable to tell "off" from "not known" and silenced both.
      tailscaleDefaults={{
        enabled: tailscaleSettings?.enabled ?? false,
        hasAuthKey: (tailscaleSettings?.authKey ?? "").trim().length > 0,
        defaultNode: tailscaleSettings?.defaultNode ?? "",
      }}
      pagination={{ total, page, perPage: PER_PAGE }}
      initialSearch={search ?? ""}
      activeState={stateParam === "enabled" || stateParam === "disabled" ? stateParam : "all"}
      initialSort={{ sortBy: sortBy ?? "createdAt", sortDir }}
      mtlsRoles={mtlsRoles}
      issuedClientCerts={issuedClientCerts}
      forwardAuthUsers={forwardAuthUsers}
      forwardAuthGroups={forwardAuthGroups}
      forwardAuthAccessMap={forwardAuthAccessMap}
      agents={agents}
      agentAssignments={agentAssignments}
      counts={counts}
      hostTraffic={hostTraffic}
      canCreate={canCreate(access)}
    />
  );
}
