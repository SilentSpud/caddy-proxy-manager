import { Badge } from "@astryxdesign/core/Badge";
import { Text } from "@astryxdesign/core/Text";
import { DataTable, type Column } from "@cpm/controller/src/components/ui/DataTable";
import { StatusChip } from "@cpm/controller/src/components/ui/StatusChip";
import { DemoSurface } from "../DemoSurface";

type Row = {
  id: number;
  domain: string;
  issuer: string;
  challenge: string;
  expires: string;
  status: "active" | "warning" | "error";
};

/** One healthy, one close to expiry, one that has failed — what the page is watched for. */
const CERTS: Row[] = [
  {
    id: 1,
    domain: "app.example.com",
    issuer: "Let's Encrypt",
    challenge: "HTTP-01",
    expires: "in 68 days",
    status: "active",
  },
  {
    id: 2,
    domain: "*.internal.example.com",
    issuer: "Let's Encrypt",
    challenge: "DNS-01 · Cloudflare",
    expires: "in 9 days",
    status: "warning",
  },
  {
    id: 3,
    domain: "vpn.example.com",
    issuer: "Internal CA",
    challenge: "—",
    expires: "expired",
    status: "error",
  },
];

export default function CertificatesTableDemo() {
  const columns: Column<Row>[] = [
    {
      id: "domain",
      label: "Domain",
      render: (r) => (
        <Text type="body" size="sm" weight="semibold">
          {r.domain}
        </Text>
      ),
    },
    { id: "issuer", label: "Issuer", render: (r) => <Badge label={r.issuer} /> },
    {
      id: "challenge",
      label: "Challenge",
      render: (r) => (
        <Text type="body" size="sm" color="secondary">
          {r.challenge}
        </Text>
      ),
    },
    {
      id: "expires",
      label: "Expires",
      render: (r) => (
        <Text type="body" size="sm" color="secondary">
          {r.expires}
        </Text>
      ),
    },
    {
      id: "status",
      label: "Status",
      render: (r) => (
        <StatusChip
          status={r.status}
          label={
            r.status === "warning" ? "Renewing soon" : r.status === "error" ? "Expired" : "Valid"
          }
        />
      ),
    },
  ];

  return (
    <DemoSurface>
      <DataTable columns={columns} data={CERTS} keyField="id" emptyMessage="No certificates yet" />
    </DemoSurface>
  );
}
