"use client";

import { KeyRound, Plus, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Icon } from "@astryxdesign/core/Icon";
import { List, ListItem } from "@astryxdesign/core/List";
import { MoreMenu } from "@astryxdesign/core/MoreMenu";
import { Text } from "@astryxdesign/core/Text";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { DataTable, type Column } from "@/components/ui/DataTable";
import {
  DeleteCaCertDialog,
  IssueClientCertDialog,
  ManageIssuedClientCertsDialog,
} from "@/components/ca-certificates/CaCertDialogs";
import type { CaCertificateView } from "../page";
import { CaCertDrawer } from "./CaCertDrawer";

type Props = {
  caCertificates: CaCertificateView[];
  search: string;
  statusFilter: string | null;
};

function formatRelativeDate(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86400000);
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(months / 12);
  return `${years}y ago`;
}

function IssuedCertsPanel({ ca }: { ca: CaCertificateView }) {
  const [issueCaOpen, setIssueCaOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);

  const active = ca.issuedCerts.filter((c) => !c.revokedAt);

  return (
    <VStack gap={3} padding={4}>
      <HStack justify="between" vAlign="center" gap={2} wrap="wrap">
        <HStack gap={2} vAlign="center">
          <Text type="label" size="xsm" weight="semibold" color="secondary">
            Issued Client Certificates
          </Text>
          <Badge variant="success" label={`${active.length} active`} />
        </HStack>
        <HStack gap={2}>
          {ca.hasPrivateKey && (
            <Button
              size="sm"
              variant="secondary"
              label="Issue Cert"
              onClick={() => setIssueCaOpen(true)}
            />
          )}
          {ca.issuedCerts.length > 0 && (
            <Button
              size="sm"
              variant="secondary"
              label="Manage"
              onClick={() => setManageOpen(true)}
            />
          )}
        </HStack>
      </HStack>

      {active.length === 0 ? (
        <Text type="body" size="sm" color="secondary">
          No active client certificates for this CA.
        </Text>
      ) : (
        <List hasDividers>
          {active.slice(0, 5).map((issued) => {
            const expired = new Date(issued.validTo).getTime() < Date.now();
            return (
              <ListItem
                key={issued.id}
                label={issued.commonName}
                endContent={
                  <Badge
                    variant={expired ? "error" : "success"}
                    label={expired ? "Expired" : "Active"}
                  />
                }
              />
            );
          })}
          {active.length > 5 && (
            <ListItem
              label={`+${active.length - 5} more`}
              description={'Use "Manage" to view all'}
            />
          )}
        </List>
      )}

      <ManageIssuedClientCertsDialog
        open={manageOpen}
        cert={ca}
        issuedCerts={ca.issuedCerts}
        onClose={() => setManageOpen(false)}
      />
      <IssueClientCertDialog open={issueCaOpen} cert={ca} onClose={() => setIssueCaOpen(false)} />
    </VStack>
  );
}

function CaActionsMenu({
  ca,
  onEdit,
  onDelete,
}: {
  ca: CaCertificateView;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [issuedOpen, setIssuedOpen] = useState(false);

  return (
    <>
      <MoreMenu
        label={`Actions for CA certificate ${ca.name}`}
        size="sm"
        alignment="end"
        items={[
          ...(ca.hasPrivateKey
            ? [{ label: "Issue Client Cert", onClick: () => setIssuedOpen(true) }]
            : []),
          { label: "Edit", onClick: onEdit },
          { label: "Delete", variant: "destructive" as const, onClick: onDelete },
        ]}
      />
      <IssueClientCertDialog open={issuedOpen} cert={ca} onClose={() => setIssuedOpen(false)} />
    </>
  );
}

function activeCount(ca: CaCertificateView) {
  return ca.issuedCerts.filter((c) => !c.revokedAt).length;
}

export function CaTab({ caCertificates, search, statusFilter }: Props) {
  const [drawerCert, setDrawerCert] = useState<CaCertificateView | null | false>(false);
  const [deleteCert, setDeleteCert] = useState<CaCertificateView | null>(null);

  const filtered = caCertificates.filter((ca) => {
    if (statusFilter) return false;
    if (search) return ca.name.toLowerCase().includes(search.toLowerCase());
    return true;
  });

  const columns: Column<CaCertificateView>[] = [
    {
      id: "name",
      label: "Name",
      render: (ca) => (
        <HStack gap={3} vAlign="center">
          <Icon icon={ShieldCheck} size="sm" color="accent" />
          <Text type="body" size="sm" weight="semibold">
            {ca.name}
          </Text>
        </HStack>
      ),
    },
    {
      id: "privateKey",
      label: "Private Key",
      width: 140,
      render: (ca) =>
        ca.hasPrivateKey ? (
          <Badge variant="success" icon={<KeyRound />} label="Stored" />
        ) : (
          <Text type="body" size="sm" color="secondary">
            &mdash;
          </Text>
        ),
    },
    {
      id: "issued",
      label: "Issued Certs",
      width: 140,
      render: (ca) =>
        ca.issuedCerts.length === 0 ? (
          <Text type="body" size="sm" color="secondary">
            None
          </Text>
        ) : (
          <Badge
            variant={activeCount(ca) > 0 ? "info" : "neutral"}
            label={`${activeCount(ca)}/${ca.issuedCerts.length} active`}
          />
        ),
    },
    {
      id: "added",
      label: "Added",
      width: 120,
      render: (ca) => (
        <Text type="body" size="sm" color="secondary">
          {formatRelativeDate(ca.createdAt)}
        </Text>
      ),
    },
    {
      id: "actions",
      label: "",
      align: "right",
      width: 64,
      render: (ca) => (
        <CaActionsMenu
          ca={ca}
          onEdit={() => setDrawerCert(ca)}
          onDelete={() => setDeleteCert(ca)}
        />
      ),
    },
  ];

  function caMobileCard(ca: CaCertificateView) {
    return (
      <Card>
        <VStack gap={2}>
          <HStack justify="between" vAlign="center" gap={2}>
            <HStack gap={2} vAlign="center">
              <Icon icon={ShieldCheck} size="sm" color="accent" />
              <Text type="body" size="sm" weight="semibold">
                {ca.name}
              </Text>
            </HStack>
            <CaActionsMenu
              ca={ca}
              onEdit={() => setDrawerCert(ca)}
              onDelete={() => setDeleteCert(ca)}
            />
          </HStack>
          <HStack gap={2} wrap="wrap" vAlign="center">
            {ca.hasPrivateKey && <Badge variant="success" icon={<KeyRound />} label="Key stored" />}
            {ca.issuedCerts.length > 0 && (
              <Badge
                variant={activeCount(ca) > 0 ? "info" : "neutral"}
                label={`${activeCount(ca)}/${ca.issuedCerts.length} active`}
              />
            )}
            <Text type="body" size="xsm" color="secondary">
              {formatRelativeDate(ca.createdAt)}
            </Text>
          </HStack>
          {/* The desktop table expands in place; on mobile the panel simply
              follows the card, since there is no row to expand into. */}
          <IssuedCertsPanel ca={ca} />
        </VStack>
      </Card>
    );
  }

  return (
    <VStack gap={4}>
      <HStack justify="end">
        <Button
          variant="secondary"
          size="sm"
          label="Add CA Certificate"
          icon={<Plus />}
          onClick={() => setDrawerCert(null)}
        />
      </HStack>

      {filtered.length === 0 ? (
        <Card>
          <EmptyState
            title={
              search || statusFilter ? "No CA certificates match" : "No CA certificates configured"
            }
          />
        </Card>
      ) : (
        <DataTable
          columns={columns}
          data={filtered}
          keyField="id"
          emptyMessage="No CA certificates match"
          mobileCard={caMobileCard}
          expandedRow={(ca) => <IssuedCertsPanel ca={ca} />}
        />
      )}

      <CaCertDrawer
        open={drawerCert !== false}
        cert={drawerCert || null}
        onClose={() => setDrawerCert(false)}
      />
      {deleteCert && (
        <DeleteCaCertDialog
          open={!!deleteCert}
          cert={deleteCert}
          onClose={() => setDeleteCert(null)}
        />
      )}
    </VStack>
  );
}
