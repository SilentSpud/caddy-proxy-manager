"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import {
  Globe,
  ArrowRight,
  Shield,
  Bug,
  MapPin,
  Scale,
  KeyRound,
  UserCheck,
  CornerRightDown,
  Replace,
  Ban,
  GitBranch,
  ShieldCheck,
  LogIn,
  Network,
} from "lucide-react";
import { Badge } from "@astryxdesign/core/Badge";
import { Card } from "@astryxdesign/core/Card";
import { TabList, Tab } from "@astryxdesign/core/TabList";
import { Icon } from "@astryxdesign/core/Icon";
import { MoreMenu } from "@astryxdesign/core/MoreMenu";
import { Switch } from "@astryxdesign/core/Switch";
import { Text } from "@astryxdesign/core/Text";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import type { AccessList } from "@/lib/models/access-lists";
import type { CertificatePickerOption } from "@/lib/certificate-api";
import type { ProxyHost } from "@/lib/models/proxy-hosts";
import type { CaCertificate } from "@/lib/models/ca-certificates";
import type { AuthentikSettings } from "@/lib/settings";
import type { TailscaleHostDefaults } from "@/components/proxy-hosts/TailscaleFields";
import type { MtlsRole } from "@/lib/models/mtls-roles";
import type { IssuedClientCertificate } from "@/lib/models/issued-client-certificates";
import { toggleProxyHostAction } from "./actions";
import { ListPageHeader } from "@/components/ui/ListPageHeader";
import { SearchField } from "@/components/ui/SearchField";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { StatusChip } from "@/components/ui/StatusChip";
import { useTranslations } from "next-intl";
import {
  CreateHostDialog,
  EditHostDialog,
  DeleteHostDialog,
} from "@/components/proxy-hosts/HostDialogs";
import type { AgentOption } from "@/components/agents/AgentAssignmentFields";
import { StatTiles } from "@/components/ui/StatTiles";

type ForwardAuthUser = { id: number; email: string; name: string | null; role: string };
type ForwardAuthGroup = {
  id: number;
  name: string;
  description: string | null;
  member_count: number;
};
type ForwardAuthAccessMap = Record<number, { userIds: number[]; groupIds: number[] }>;

type Props = {
  hosts: ProxyHost[];
  certificates: CertificatePickerOption[];
  accessLists: AccessList[];
  caCertificates: CaCertificate[];
  authentikDefaults: AuthentikSettings | null;
  /** Prefilled into a new host's domains field. Empty means there is nothing to offer. */
  defaultDomain: string;
  tailscaleDefaults: TailscaleHostDefaults | null;
  pagination: { total: number; page: number; perPage: number };
  initialSearch: string;
  initialSort?: { sortBy: string; sortDir: "asc" | "desc" };
  mtlsRoles?: MtlsRole[];
  issuedClientCerts?: IssuedClientCertificate[];
  forwardAuthUsers?: ForwardAuthUser[];
  forwardAuthGroups?: ForwardAuthGroup[];
  forwardAuthAccessMap?: ForwardAuthAccessMap;
  agents?: AgentOption[];
  /** Host id → the agent rows it is pinned to. A host absent from here is served by every agent. */
  agentAssignments?: Record<number, number[]>;
  /** Enabled/disabled totals across everything visible, so the tabs do not count only this page. */
  counts: { total: number; enabled: number; disabled: number };
  /** Host id → requests in the last 24h. A host with no entry took no traffic in the window. */
  hostTraffic: Record<number, { total: number; blocked: number }>;
  /** False when analytics is off or unreachable - then there are no numbers to show at all. */
  trafficAvailable: boolean;
  /** Which list tab the URL asked for. */
  activeState: "all" | "enabled" | "disabled";
  /** False for an operator: a grant names a host that already exists, so creating one is an
   * admin's job. The dialogs and the duplicate action go with the button. */
  canCreate?: boolean;
};

/** The feature badges as data. `variant` marks the two meaning "traffic is being restricted". */
const FEATURES: ReadonlyArray<{
  key: string;
  label: string;
  icon?: ReactNode;
  variant?: "info" | "warning";
  isOn: (host: ProxyHost) => boolean;
}> = [
  { key: "tls", label: "TLS", variant: "info", isOn: (h) => Boolean(h.certificateId) },
  {
    key: "auth",
    label: "Auth",
    icon: <Shield />,
    variant: "warning",
    isOn: (h) => Boolean(h.accessListId),
  },
  {
    key: "authentik",
    label: "Authentik",
    icon: <UserCheck />,
    isOn: (h) => Boolean(h.authentik?.enabled),
  },
  {
    key: "forward-auth",
    label: "Forward Auth",
    icon: <LogIn />,
    isOn: (h) => Boolean(h.cpmForwardAuth?.enabled),
  },
  {
    key: "tailscale",
    // "Tailnet only" is the one worth seeing from the list: it means the host is not reachable
    // from the public listener at all, which is otherwise invisible until you open it.
    label: "Tailnet",
    icon: <Network />,
    variant: "info",
    isOn: (h) => Boolean(h.tailscale?.serve),
  },
  { key: "waf", label: "WAF", icon: <Bug />, isOn: (h) => Boolean(h.waf?.enabled) },
  { key: "geo", label: "Geo", icon: <MapPin />, isOn: (h) => Boolean(h.geoblock?.enabled) },
  { key: "lb", label: "LB", icon: <Scale />, isOn: (h) => Boolean(h.loadBalancer?.enabled) },
  { key: "mtls", label: "mTLS", icon: <KeyRound />, isOn: (h) => Boolean(h.mtls?.enabled) },
  {
    key: "redirects",
    label: "Redirects",
    icon: <CornerRightDown />,
    isOn: (h) => h.redirects?.length > 0,
  },
  { key: "rewrite", label: "Rewrite", icon: <Replace />, isOn: (h) => Boolean(h.rewrite) },
  {
    key: "path-allows",
    label: "Allows",
    icon: <ShieldCheck />,
    isOn: (h) => h.pathAllows?.length > 0,
  },
  { key: "path-blocks", label: "Blocks", icon: <Ban />, isOn: (h) => h.pathBlocks?.length > 0 },
  {
    key: "path-rewrites",
    label: "Path Rewrites",
    icon: <GitBranch />,
    isOn: (h) => h.pathRewrites?.length > 0,
  },
];

/** "example.com +2" - the primary entry plus a count of the rest. */
function summarize(values: string[]) {
  return values.length > 1 ? `${values[0]} +${values.length - 1}` : values[0];
}

/**
 * The enable switch plus the row menu, shared by table and cards. At module scope - nesting it
 * would make a new component type each render, remounting the menu mid-use.
 */
function HostActions({
  host,
  onToggle,
  onEdit,
  onDuplicate,
  onDelete,
  canCreate,
}: {
  host: ProxyHost;
  onToggle: (enabled: boolean) => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  /** Duplicating makes a new host, so it goes with the Create button rather than with Edit. */
  canCreate: boolean;
}) {
  return (
    <HStack gap={2} vAlign="center" justify="end">
      <Switch
        label={`Enable ${host.name}`}
        isLabelHidden
        value={host.enabled}
        onChange={onToggle}
      />
      <MoreMenu
        label={`Actions for ${host.name}`}
        size="sm"
        alignment="end"
        items={[
          { label: "Edit", onClick: onEdit },
          ...(canCreate ? [{ label: "Duplicate", onClick: onDuplicate }] : []),
          { type: "divider" },
          { label: "Delete", variant: "destructive", onClick: onDelete },
        ]}
      />
    </HStack>
  );
}

export default function ProxyHostsClient({
  hosts,
  certificates,
  accessLists,
  caCertificates,
  authentikDefaults,
  defaultDomain,
  tailscaleDefaults,
  pagination,
  initialSearch,
  initialSort,
  mtlsRoles,
  issuedClientCerts,
  forwardAuthUsers,
  forwardAuthGroups,
  forwardAuthAccessMap,
  agents,
  agentAssignments,
  counts,
  hostTraffic,
  trafficAvailable,
  activeState,
  canCreate = true,
}: Props) {
  const t = useTranslations("proxyHosts");
  const [createOpen, setCreateOpen] = useState(false);
  const [duplicateHost, setDuplicateHost] = useState<ProxyHost | null>(null);
  const [editHost, setEditHost] = useState<ProxyHost | null>(null);
  const [deleteHost, setDeleteHost] = useState<ProxyHost | null>(null);
  // Counter forces CreateHostDialog to remount on each open, resetting useFormState
  const [dialogKey, setDialogKey] = useState(0);
  const [searchTerm, setSearchTerm] = useState(initialSearch);

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setSearchTerm(initialSearch);
  }, [initialSearch]);

  function handleSearchChange(value: string) {
    setSearchTerm(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (value.trim()) {
        params.set("search", value.trim());
      } else {
        params.delete("search");
      }
      params.set("page", "1");
      router.push(`${pathname}?${params.toString()}`);
    }, 400);
  }

  function handleStateChange(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "all") params.delete("state");
    else params.set("state", value);
    params.set("page", "1");
    router.push(`${pathname}?${params.toString()}`);
  }

  const handleToggleEnabled = async (id: number, enabled: boolean) => {
    await toggleProxyHostAction(id, enabled);
  };

  function openDuplicate(host: ProxyHost) {
    setDuplicateHost(host);
    setDialogKey((k) => k + 1);
    setCreateOpen(true);
  }

  const certificateNames = new Map(certificates.map((c) => [c.id, c.name]));
  const agentNames = new Map((agents ?? []).map((a) => [a.id, a.name]));
  const numberFormat = new Intl.NumberFormat();
  // Whether there is traffic data at all comes from the server, not from the map: with analytics on,
  // an empty map is a quiet day, and hiding the column then would read as "analytics is off".
  const trafficKnown = trafficAvailable;
  const trafficTotals = Object.values(hostTraffic).reduce(
    (sum, row) => ({ total: sum.total + row.total, blocked: sum.blocked + row.blocked }),
    { total: 0, blocked: 0 },
  );
  const blockedShare =
    trafficTotals.total > 0
      ? ((trafficTotals.blocked / trafficTotals.total) * 100).toFixed(1)
      : "0.0";
  const hostsWithTls = hosts.filter((host) => host.certificateId).length;
  const connectedAgents = (agents ?? []).filter((agent) => agent.connected).length;

  const columns: Column<ProxyHost>[] = [
    {
      id: "name",
      label: "Name / Domain",
      sortKey: "name",
      render: (host) => (
        <HStack gap={3} vAlign="center">
          <Icon icon={Globe} size="sm" color={host.enabled ? "success" : "disabled"} />
          <VStack gap={0}>
            <Text type="body" size="sm" weight="semibold">
              {host.name}
            </Text>
            <Text type="code" size="xsm" color="secondary">
              {summarize(host.domains)}
            </Text>
          </VStack>
        </HStack>
      ),
    },
    {
      id: "target",
      label: "Upstream",
      sortKey: "upstreams",
      render: (host) => (
        <HStack gap={2} vAlign="center">
          <Icon icon={ArrowRight} size="xsm" color="secondary" />
          <Text type="code" size="sm" weight="medium">
            {summarize(host.upstreams)}
          </Text>
        </HStack>
      ),
    },
    {
      id: "tls",
      label: t("tls"),
      width: 150,
      render: (host) => {
        const name = host.certificateId ? certificateNames.get(host.certificateId) : undefined;
        if (!name) {
          return (
            <Text type="body" size="xsm" color="secondary">
              &mdash;
            </Text>
          );
        }
        return (
          <Text type="body" size="sm" maxLines={1}>
            {name}
          </Text>
        );
      },
    },
    {
      id: "agents",
      label: t("assignedAgents"),
      width: 170,
      render: (host) => {
        const assigned = agentAssignments?.[host.id] ?? [];
        // An empty assignment is not "none" - it is the default, which is every agent. Saying so
        // in the list saves opening the host to find out.
        if (assigned.length === 0) {
          return (
            <Text type="body" size="xsm" color="secondary">
              {t("servedByEveryAgent")}
            </Text>
          );
        }
        return (
          <Text type="body" size="sm" color="secondary" maxLines={1}>
            {assigned.map((id) => agentNames.get(id) ?? `#${id}`).join(", ")}
          </Text>
        );
      },
    },
    ...(trafficKnown
      ? [
          {
            id: "requests",
            label: t("requests24h"),
            align: "right" as const,
            width: 110,
            render: (host: ProxyHost) => {
              const row = hostTraffic[host.id] ?? { total: 0, blocked: 0 };
              return (
                <VStack gap={0} hAlign="end">
                  <Text type="code" size="sm">
                    {numberFormat.format(row.total)}
                  </Text>
                  {row.blocked > 0 && (
                    <Text type="supporting" color="secondary">
                      {t("blockedCount", { count: numberFormat.format(row.blocked) })}
                    </Text>
                  )}
                </VStack>
              );
            },
          },
        ]
      : []),
    {
      id: "features",
      label: t("protections"),
      render: (host) => {
        const active = FEATURES.filter((f) => f.isOn(host));
        if (active.length === 0) {
          return (
            <Text type="body" size="xsm" color="secondary">
              &mdash;
            </Text>
          );
        }
        return (
          <HStack gap={1} wrap="wrap">
            {active.map((f) => (
              <Badge key={f.key} variant={f.variant} icon={f.icon} label={f.label} />
            ))}
          </HStack>
        );
      },
    },
    {
      id: "status",
      label: "Status",
      sortKey: "enabled",
      width: 110,
      render: (host) => <StatusChip status={host.enabled ? "active" : "inactive"} />,
    },
    {
      id: "actions",
      label: "",
      align: "right",
      width: 120,
      render: (host) => (
        <HostActions
          host={host}
          onToggle={(enabled) => handleToggleEnabled(host.id, enabled)}
          onEdit={() => setEditHost(host)}
          onDuplicate={() => openDuplicate(host)}
          canCreate={canCreate}
          onDelete={() => setDeleteHost(host)}
        />
      ),
    },
  ];

  const mobileCard = (host: ProxyHost) => (
    <Card>
      <HStack justify="between" vAlign="start" gap={2}>
        <VStack gap={1}>
          <Text type="body" size="sm" weight="semibold" maxLines={1}>
            {host.name}
          </Text>
          <Text type="code" size="xsm" color="secondary" maxLines={1}>
            {summarize(host.domains)} &rarr; {host.upstreams[0]}
          </Text>
          <HStack gap={2} vAlign="center">
            <StatusChip status={host.enabled ? "active" : "inactive"} />
            {host.certificateId && <Badge variant="info" label={t("tls")} />}
          </HStack>
        </VStack>
        <HostActions
          host={host}
          onToggle={(enabled) => handleToggleEnabled(host.id, enabled)}
          onEdit={() => setEditHost(host)}
          onDuplicate={() => openDuplicate(host)}
          canCreate={canCreate}
          onDelete={() => setDeleteHost(host)}
        />
      </HStack>
    </Card>
  );

  return (
    <VStack gap={6}>
      <ListPageHeader
        title={t("proxyHosts")}
        description={t("pageDescription")}
        action={
          canCreate
            ? {
                label: "Create Host",
                onClick: () => {
                  setDialogKey((k) => k + 1);
                  setCreateOpen(true);
                },
              }
            : undefined
        }
        stats={
          <StatTiles
            tiles={[
              {
                id: "hosts",
                label: t("proxyHosts"),
                value: counts.total,
                note: t("enabledDisabledNote", {
                  enabled: counts.enabled,
                  disabled: counts.disabled,
                }),
              },
              {
                id: "requests",
                label: t("requests24h"),
                value: trafficKnown ? numberFormat.format(trafficTotals.total) : t("noData"),
                note: trafficKnown
                  ? t("blockedShareNote", { percent: blockedShare })
                  : t("analyticsOffNote"),
              },
              {
                id: "certificates",
                label: t("certificates"),
                value: certificates.length,
                note: t("certificatesNote", { count: hostsWithTls }),
              },
              {
                id: "agents",
                label: t("assignedAgents"),
                value: agents?.length ?? 0,
                note: t("agentsConnectedNote", { count: connectedAgents }),
                accent:
                  (agents?.length ?? 0) > connectedAgents
                    ? { label: t("someAgentsOffline"), variant: "warning" as const }
                    : undefined,
              },
            ]}
          />
        }
        filters={
          <TabList value={activeState} onChange={handleStateChange}>
            <Tab value="all" label={t("filterAll")} endContent={<Badge label={counts.total} />} />
            <Tab
              value="enabled"
              label={t("filterEnabled")}
              endContent={<Badge label={counts.enabled} />}
            />
            <Tab
              value="disabled"
              label={t("filterDisabled")}
              endContent={<Badge label={counts.disabled} />}
            />
          </TabList>
        }
        search={
          <SearchField
            value={searchTerm}
            onChange={handleSearchChange}
            placeholder={t("searchHosts")}
          />
        }
      />

      <DataTable
        columns={columns}
        data={hosts}
        keyField="id"
        emptyMessage={searchTerm ? "No hosts match your search" : "No proxy hosts found"}
        pagination={pagination}
        sort={initialSort}
        mobileCard={mobileCard}
        rowStatus={(host) => (host.enabled ? null : { color: "gray", label: "Disabled" })}
      />

      <CreateHostDialog
        defaultDomain={defaultDomain}
        key={dialogKey}
        open={createOpen}
        onClose={() => {
          setCreateOpen(false);
          setTimeout(() => setDuplicateHost(null), 200);
        }}
        initialData={duplicateHost}
        certificates={certificates}
        accessLists={accessLists}
        authentikDefaults={authentikDefaults}
        tailscaleDefaults={tailscaleDefaults}
        caCertificates={caCertificates}
        mtlsRoles={mtlsRoles ?? []}
        issuedClientCerts={issuedClientCerts ?? []}
        forwardAuthUsers={forwardAuthUsers ?? []}
        forwardAuthGroups={forwardAuthGroups ?? []}
        agents={agents ?? []}
      />

      {editHost && (
        <EditHostDialog
          open={!!editHost}
          host={editHost}
          onClose={() => setEditHost(null)}
          certificates={certificates}
          accessLists={accessLists}
          authentikDefaults={authentikDefaults}
          tailscaleDefaults={tailscaleDefaults}
          caCertificates={caCertificates}
          mtlsRoles={mtlsRoles ?? []}
          issuedClientCerts={issuedClientCerts ?? []}
          forwardAuthUsers={forwardAuthUsers ?? []}
          forwardAuthGroups={forwardAuthGroups ?? []}
          forwardAuthAccess={forwardAuthAccessMap?.[editHost.id] ?? null}
          agents={agents ?? []}
          assignedAgentIds={agentAssignments?.[editHost.id] ?? []}
        />
      )}

      {deleteHost && (
        <DeleteHostDialog
          open={!!deleteHost}
          host={deleteHost}
          onClose={() => setDeleteHost(null)}
        />
      )}
    </VStack>
  );
}
