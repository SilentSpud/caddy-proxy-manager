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
} from "lucide-react";
import { Badge } from "@astryxdesign/core/Badge";
import { Card } from "@astryxdesign/core/Card";
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
import type { MtlsRole } from "@/lib/models/mtls-roles";
import type { IssuedClientCertificate } from "@/lib/models/issued-client-certificates";
import { toggleProxyHostAction } from "./actions";
import { PageHeader } from "@/components/ui/PageHeader";
import { SearchField } from "@/components/ui/SearchField";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { StatusChip } from "@/components/ui/StatusChip";
import {
  CreateHostDialog,
  EditHostDialog,
  DeleteHostDialog,
} from "@/components/proxy-hosts/HostDialogs";

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
  pagination: { total: number; page: number; perPage: number };
  initialSearch: string;
  initialSort?: { sortBy: string; sortDir: "asc" | "desc" };
  mtlsRoles?: MtlsRole[];
  issuedClientCerts?: IssuedClientCertificate[];
  forwardAuthUsers?: ForwardAuthUser[];
  forwardAuthGroups?: ForwardAuthGroup[];
  forwardAuthAccessMap?: ForwardAuthAccessMap;
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

/** "example.com +2" — the primary entry plus a count of the rest. */
function summarize(values: string[]) {
  return values.length > 1 ? `${values[0]} +${values.length - 1}` : values[0];
}

/**
 * The enable switch plus the row menu, shared by table and cards. At module scope — nesting it
 * would make a new component type each render, remounting the menu mid-use.
 */
function HostActions({
  host,
  onToggle,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  host: ProxyHost;
  onToggle: (enabled: boolean) => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
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
          { label: "Duplicate", onClick: onDuplicate },
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
  pagination,
  initialSearch,
  initialSort,
  mtlsRoles,
  issuedClientCerts,
  forwardAuthUsers,
  forwardAuthGroups,
  forwardAuthAccessMap,
}: Props) {
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

  const handleToggleEnabled = async (id: number, enabled: boolean) => {
    await toggleProxyHostAction(id, enabled);
  };

  function openDuplicate(host: ProxyHost) {
    setDuplicateHost(host);
    setDialogKey((k) => k + 1);
    setCreateOpen(true);
  }

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
      id: "features",
      label: "Features",
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
            {host.certificateId && <Badge variant="info" label="TLS" />}
          </HStack>
        </VStack>
        <HostActions
          host={host}
          onToggle={(enabled) => handleToggleEnabled(host.id, enabled)}
          onEdit={() => setEditHost(host)}
          onDuplicate={() => openDuplicate(host)}
          onDelete={() => setDeleteHost(host)}
        />
      </HStack>
    </Card>
  );

  return (
    <VStack gap={6}>
      <PageHeader
        title="Proxy Hosts"
        description="Define HTTP(S) reverse proxies orchestrated by Caddy with automated certificates."
        action={{
          label: "Create Host",
          onClick: () => {
            setDialogKey((k) => k + 1);
            setCreateOpen(true);
          },
        }}
      />

      <HStack gap={2} vAlign="center">
        <SearchField
          value={searchTerm}
          onChange={handleSearchChange}
          placeholder="Search hosts..."
        />
      </HStack>

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
        caCertificates={caCertificates}
        mtlsRoles={mtlsRoles ?? []}
        issuedClientCerts={issuedClientCerts ?? []}
        forwardAuthUsers={forwardAuthUsers ?? []}
        forwardAuthGroups={forwardAuthGroups ?? []}
      />

      {editHost && (
        <EditHostDialog
          open={!!editHost}
          host={editHost}
          onClose={() => setEditHost(null)}
          certificates={certificates}
          accessLists={accessLists}
          authentikDefaults={authentikDefaults}
          caCertificates={caCertificates}
          mtlsRoles={mtlsRoles ?? []}
          issuedClientCerts={issuedClientCerts ?? []}
          forwardAuthUsers={forwardAuthUsers ?? []}
          forwardAuthGroups={forwardAuthGroups ?? []}
          forwardAuthAccess={forwardAuthAccessMap?.[editHost.id] ?? null}
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
