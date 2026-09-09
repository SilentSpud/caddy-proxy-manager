import { useMemo } from "react";
import { Badge } from "@astryxdesign/core/Badge";
import { Text } from "@astryxdesign/core/Text";
import { DataTable, type Column } from "@cpm/controller/src/components/ui/DataTable";
import { StatusChip } from "@cpm/controller/src/components/ui/StatusChip";
import { useSearchParams } from "../shims/next-navigation";
import { DemoSurface } from "../DemoSurface";

type Row = {
  id: number;
  domain: string;
  upstreams: string;
  certificate: string;
  status: "active" | "inactive" | "error";
};

const HOSTS: Row[] = [
  {
    id: 1,
    domain: "app.example.com",
    upstreams: "http://app-1:8080 +1",
    certificate: "Let's Encrypt",
    status: "active",
  },
  {
    id: 2,
    domain: "grafana.example.com",
    upstreams: "http://grafana:3000",
    certificate: "Let's Encrypt",
    status: "active",
  },
  {
    id: 3,
    domain: "staging.example.com",
    upstreams: "http://staging:8080",
    certificate: "Let's Encrypt",
    status: "inactive",
  },
  {
    id: 4,
    domain: "vpn.example.com",
    upstreams: "http://headscale:8080",
    certificate: "Internal CA",
    status: "error",
  },
];

/** The proxy host list: the real table, sorting for real off the query string. */
export default function ProxyHostsTableDemo() {
  const params = useSearchParams();
  const sortBy = params.get("sortBy") ?? "domain";
  const sortDir = params.get("sortDir") === "desc" ? "desc" : "asc";

  const rows = useMemo(() => {
    const key = sortBy === "status" ? "status" : "domain";
    const sorted = [...HOSTS].sort((a, b) => a[key].localeCompare(b[key]));
    return sortDir === "desc" ? sorted.reverse() : sorted;
  }, [sortBy, sortDir]);

  const columns: Column<Row>[] = [
    {
      id: "domain",
      label: "Domain",
      sortKey: "domain",
      render: (r) => (
        <Text type="body" size="sm" weight="semibold">
          {r.domain}
        </Text>
      ),
    },
    {
      id: "upstreams",
      label: "Upstreams",
      render: (r) => (
        <Text type="body" size="sm" color="secondary">
          {r.upstreams}
        </Text>
      ),
    },
    { id: "certificate", label: "Certificate", render: (r) => <Badge label={r.certificate} /> },
    {
      id: "status",
      label: "Status",
      sortKey: "status",
      render: (r) => <StatusChip status={r.status} />,
    },
  ];

  return (
    <DemoSurface>
      <DataTable
        columns={columns}
        data={rows}
        keyField="id"
        sort={{ sortBy, sortDir }}
        emptyMessage="No proxy hosts yet"
      />
    </DemoSurface>
  );
}
