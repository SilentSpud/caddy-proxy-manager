import { Badge } from "@astryxdesign/core/Badge";
import { Text } from "@astryxdesign/core/Text";
import { DataTable, type Column } from "@cpm/controller/src/components/ui/DataTable";
import { StatusChip } from "@cpm/controller/src/components/ui/StatusChip";
import { DemoSurface } from "../DemoSurface";

type Row = {
  id: number;
  name: string;
  listen: string;
  matcher: string;
  upstream: string;
  status: "active" | "inactive" | "warning";
};

/** One of each thing the page can show: a plain port, an SNI split, and a port pending a recreate. */
const HOSTS: Row[] = [
  {
    id: 1,
    name: "postgres",
    listen: "5432/tcp",
    matcher: "-",
    upstream: "db:5432",
    status: "active",
  },
  {
    id: 2,
    name: "minecraft",
    listen: "25565/tcp",
    matcher: "-",
    upstream: "mc:25565",
    status: "active",
  },
  {
    id: 3,
    name: "mqtt",
    listen: "8883/tcp",
    matcher: "SNI mqtt.example.com",
    upstream: "mosquitto:8883",
    status: "active",
  },
  {
    id: 4,
    name: "wireguard",
    listen: "51820/udp",
    matcher: "-",
    upstream: "wg:51820",
    status: "warning",
  },
];

export default function L4HostsTableDemo() {
  const columns: Column<Row>[] = [
    {
      id: "name",
      label: "Name",
      render: (r) => (
        <Text type="body" size="sm" weight="semibold">
          {r.name}
        </Text>
      ),
    },
    { id: "listen", label: "Listening", render: (r) => <Badge label={r.listen} /> },
    {
      id: "matcher",
      label: "Matcher",
      render: (r) => (
        <Text type="body" size="sm" color="secondary">
          {r.matcher}
        </Text>
      ),
    },
    {
      id: "upstream",
      label: "Upstream",
      render: (r) => (
        <Text type="body" size="sm" color="secondary">
          {r.upstream}
        </Text>
      ),
    },
    {
      id: "status",
      label: "Status",
      render: (r) => (
        <StatusChip status={r.status} label={r.status === "warning" ? "Port pending" : undefined} />
      ),
    },
  ];

  return (
    <DemoSurface>
      <DataTable columns={columns} data={HOSTS} keyField="id" emptyMessage="No L4 hosts yet" />
    </DemoSurface>
  );
}
