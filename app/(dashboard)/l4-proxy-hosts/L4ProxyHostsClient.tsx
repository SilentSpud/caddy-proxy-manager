"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Network, ArrowRight } from "lucide-react";
import { Badge } from "@astryxdesign/core/Badge";
import { Card } from "@astryxdesign/core/Card";
import { Icon } from "@astryxdesign/core/Icon";
import { MoreMenu } from "@astryxdesign/core/MoreMenu";
import { Switch } from "@astryxdesign/core/Switch";
import { Text } from "@astryxdesign/core/Text";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import type { L4ProxyHost } from "@/src/lib/models/l4-proxy-hosts";
import { toggleL4ProxyHostAction } from "./actions";
import { PageHeader } from "@/components/ui/PageHeader";
import { SearchField } from "@/components/ui/SearchField";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { StatusChip } from "@/components/ui/StatusChip";
import {
  CreateL4HostDialog,
  EditL4HostDialog,
  DeleteL4HostDialog,
} from "@/components/l4-proxy-hosts/L4HostDialogs";
import { L4PortsApplyBanner } from "@/components/l4-proxy-hosts/L4PortsApplyBanner";
import { useDisabledReason } from "@/components/caddy-modules/ModuleGate";
import { Banner } from "@astryxdesign/core/Banner";

type Props = {
  hosts: L4ProxyHost[];
  pagination: { total: number; page: number; perPage: number };
  initialSearch: string;
  initialSort?: { sortBy: string; sortDir: "asc" | "desc" };
};

function formatMatcher(host: L4ProxyHost): string {
  switch (host.matcherType) {
    case "tls_sni":
      return `SNI: ${host.matcherValue.join(", ")}`;
    case "http_host":
      return `Host: ${host.matcherValue.join(", ")}`;
    case "proxy_protocol":
      return "Proxy Protocol";
    default:
      return "None";
  }
}

function ProtocolBadge({ protocol }: { protocol: string }) {
  return <Badge variant={protocol === "tcp" ? "info" : "warning"} label={protocol.toUpperCase()} />;
}

/** "10.0.0.1:443 +2" — the primary upstream plus a count of the rest. */
function summarizeUpstreams(upstreams: string[]) {
  return upstreams.length > 1 ? `${upstreams[0]} +${upstreams.length - 1}` : upstreams[0];
}

/**
 * The enable switch plus the row menu, shared by the table and the cards.
 * Declared at module scope: nested inside the page component it would be a new
 * component type on every render, remounting the menu and closing it mid-use.
 */
function HostActions({
  host,
  onToggle,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  host: L4ProxyHost;
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

export default function L4ProxyHostsClient({
  hosts,
  pagination,
  initialSearch,
  initialSort,
}: Props) {
  const [createOpen, setCreateOpen] = useState(false);
  const [duplicateHost, setDuplicateHost] = useState<L4ProxyHost | null>(null);
  const [editHost, setEditHost] = useState<L4ProxyHost | null>(null);
  const [deleteHost, setDeleteHost] = useState<L4ProxyHost | null>(null);
  const [searchTerm, setSearchTerm] = useState(initialSearch);
  const [bannerRefresh, setBannerRefresh] = useState(0);
  // The whole layer4 app comes from caddy-l4; with it off, nothing on this page
  // reaches the running proxy.
  const l4DisabledReason = useDisabledReason("l4");

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const signalBannerRefresh = () => setBannerRefresh((n) => n + 1);

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
    await toggleL4ProxyHostAction(id, enabled);
    signalBannerRefresh();
  };

  function openDuplicate(host: L4ProxyHost) {
    setDuplicateHost(host);
    setCreateOpen(true);
  }

  const actionsFor = (host: L4ProxyHost) => (
    <HostActions
      host={host}
      onToggle={(enabled) => handleToggleEnabled(host.id, enabled)}
      onEdit={() => setEditHost(host)}
      onDuplicate={() => openDuplicate(host)}
      onDelete={() => setDeleteHost(host)}
    />
  );

  const columns: Column<L4ProxyHost>[] = [
    {
      id: "name",
      label: "Name / Matcher",
      sortKey: "name",
      render: (host) => (
        <HStack gap={3} vAlign="center">
          <Icon icon={Network} size="sm" color={host.protocol === "tcp" ? "accent" : "warning"} />
          <VStack gap={0}>
            <Text type="body" size="sm" weight="semibold">
              {host.name}
            </Text>
            <Text type="body" size="xsm" color="secondary">
              {formatMatcher(host)}
            </Text>
          </VStack>
        </HStack>
      ),
    },
    {
      id: "protocol",
      label: "Protocol",
      sortKey: "protocol",
      width: 90,
      render: (host) => <ProtocolBadge protocol={host.protocol} />,
    },
    {
      id: "listen",
      label: "Listen",
      sortKey: "listenAddress",
      render: (host) => (
        <Text type="code" size="sm" weight="medium" hasTabularNumbers>
          {host.listenAddress}
        </Text>
      ),
    },
    {
      id: "upstreams",
      label: "Upstreams",
      render: (host) => (
        <HStack gap={2} vAlign="center">
          <Icon icon={ArrowRight} size="xsm" color="secondary" />
          <Text type="code" size="sm" weight="medium">
            {summarizeUpstreams(host.upstreams)}
          </Text>
        </HStack>
      ),
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
      render: (host) => actionsFor(host),
    },
  ];

  const mobileCard = (host: L4ProxyHost) => (
    <Card>
      <HStack justify="between" vAlign="start" gap={2}>
        <VStack gap={1}>
          <HStack gap={2} vAlign="center">
            <Text type="body" size="sm" weight="semibold" maxLines={1}>
              {host.name}
            </Text>
            <ProtocolBadge protocol={host.protocol} />
          </HStack>
          <Text type="code" size="xsm" color="secondary" maxLines={1}>
            {host.listenAddress} &rarr; {summarizeUpstreams(host.upstreams)}
          </Text>
          <StatusChip status={host.enabled ? "active" : "inactive"} />
        </VStack>
        {actionsFor(host)}
      </HStack>
    </Card>
  );

  return (
    <VStack gap={6}>
      {/* Existing hosts stay listed and editable while the module is off — they
          are simply not emitted into the config. Hiding them would make hosts
          that still exist look deleted. */}
      {l4DisabledReason && (
        <Banner
          status="warning"
          title="Layer 4 proxying is switched off"
          description={`${l4DisabledReason} Hosts below are saved but are not being served.`}
        />
      )}

      {!l4DisabledReason && <L4PortsApplyBanner refreshSignal={bannerRefresh} />}

      <PageHeader
        title="L4 Proxy Hosts"
        description="Define TCP/UDP stream proxies powered by caddy-l4. Port mappings are applied automatically."
        action={{
          label: "Create L4 Host",
          onClick: () => setCreateOpen(true),
          isDisabled: Boolean(l4DisabledReason),
        }}
      />

      <HStack gap={2} vAlign="center">
        <SearchField
          value={searchTerm}
          onChange={handleSearchChange}
          placeholder="Search L4 hosts..."
        />
      </HStack>

      <DataTable
        columns={columns}
        data={hosts}
        keyField="id"
        emptyMessage={searchTerm ? "No L4 hosts match your search" : "No L4 proxy hosts found"}
        pagination={pagination}
        sort={initialSort}
        mobileCard={mobileCard}
        rowStatus={(host) => (host.enabled ? null : { color: "gray", label: "Disabled" })}
      />

      <CreateL4HostDialog
        open={createOpen}
        onClose={() => {
          setCreateOpen(false);
          setTimeout(() => setDuplicateHost(null), 200);
          signalBannerRefresh();
        }}
        initialData={duplicateHost}
      />

      {editHost && (
        <EditL4HostDialog
          open={!!editHost}
          host={editHost}
          onClose={() => {
            setEditHost(null);
            signalBannerRefresh();
          }}
        />
      )}

      {deleteHost && (
        <DeleteL4HostDialog
          open={!!deleteHost}
          host={deleteHost}
          onClose={() => {
            setDeleteHost(null);
            signalBannerRefresh();
          }}
        />
      )}
    </VStack>
  );
}
