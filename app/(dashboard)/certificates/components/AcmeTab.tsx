"use client";

import { Lock } from "lucide-react";
import { Card } from "@astryxdesign/core/Card";
import { Icon } from "@astryxdesign/core/Icon";
import { Text } from "@astryxdesign/core/Text";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { DataTable } from "@/components/ui/DataTable";
import { StatusChip } from "@/components/ui/StatusChip";
import type { AcmeHost } from "../page";

type Props = {
  acmeHosts: AcmeHost[];
  acmePagination: { total: number; page: number; perPage: number };
  search: string;
  statusFilter: string | null;
};

/** "example.com +2" — the primary domain plus a count of the rest. */
function domainSummary(r: AcmeHost) {
  return r.domains.length > 1 ? `${r.domains[0]} +${r.domains.length - 1}` : r.domains[0];
}

const columns = [
  {
    id: "name",
    label: "Proxy Host",
    render: (r: AcmeHost) => (
      <HStack gap={3} vAlign="center">
        <Icon icon={Lock} size="sm" color={r.enabled ? "success" : "disabled"} />
        <VStack gap={0}>
          <Text type="body" size="sm" weight="semibold">
            {r.name}
          </Text>
          <Text type="code" size="xsm" color="secondary">
            {domainSummary(r)}
          </Text>
        </VStack>
      </HStack>
    ),
  },
  {
    id: "status",
    label: "Status",
    width: 110,
    render: (r: AcmeHost) => <StatusChip status={r.enabled ? "active" : "inactive"} />,
  },
];

function acmeMobileCard(r: AcmeHost) {
  return (
    <Card>
      <VStack gap={2}>
        <Text type="body" size="sm" weight="semibold">
          {r.name}
        </Text>
        <Text type="code" size="xsm" color="secondary">
          {domainSummary(r)}
        </Text>
        <StatusChip status={r.enabled ? "active" : "inactive"} />
      </VStack>
    </Card>
  );
}

export function AcmeTab({ acmeHosts, acmePagination, search, statusFilter }: Props) {
  const filtered = acmeHosts.filter((h) => {
    if (statusFilter && statusFilter !== "ok") return false;
    if (statusFilter === "ok" && !h.enabled) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        h.name.toLowerCase().includes(q) ||
        h.domains.some((d) => d.toLowerCase().includes(q))
      );
    }
    return true;
  });

  const pagination =
    search || statusFilter
      ? { total: filtered.length, page: 1, perPage: filtered.length || 1 }
      : acmePagination;

  return (
    <DataTable
      columns={columns}
      data={filtered}
      keyField="id"
      emptyMessage="No ACME certificates match"
      pagination={pagination}
      mobileCard={acmeMobileCard}
      rowStatus={(r) => (r.enabled ? null : { color: "gray", label: "Disabled" })}
    />
  );
}
