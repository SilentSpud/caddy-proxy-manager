"use client";

import { AlertTriangle, FileKey, Plus } from "lucide-react";
import { useState, useTransition } from "react";
import { AlertDialog } from "@astryxdesign/core/AlertDialog";
import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Icon } from "@astryxdesign/core/Icon";
import { MoreMenu } from "@astryxdesign/core/MoreMenu";
import { Text } from "@astryxdesign/core/Text";
import { Tooltip } from "@astryxdesign/core/Tooltip";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { DataTable } from "@/components/ui/DataTable";
import { deleteCertificateAction } from "../actions";
import type { CertExpiryStatus, ImportedCertView, ManagedCertView } from "../page";
import { RelativeTime } from "./RelativeTime";
import { ImportCertDrawer } from "./ImportCertDrawer";

type Props = {
  importedCerts: ImportedCertView[];
  managedCerts: ManagedCertView[];
  search: string;
  statusFilter: string | null;
};

/** Icon tint tracks expiry, matching the badge shown in the Expires column. */
function expiryIconColor(status: CertExpiryStatus | null) {
  if (status === "expired") return "error" as const;
  if (status === "expiring_soon") return "warning" as const;
  return "success" as const;
}

function DomainsCell({ domains }: { domains: string[] }) {
  const visible = domains.slice(0, 2);
  const rest = domains.slice(2);
  return (
    <HStack gap={1} wrap="wrap">
      {visible.map((d) => (
        <Badge key={d} variant="info" label={d} />
      ))}
      {rest.length > 0 && (
        <Tooltip content={rest.join(", ")}>
          <Badge label={`+${rest.length}`} />
        </Tooltip>
      )}
    </HStack>
  );
}

function ActionsMenu({ cert, onEdit }: { cert: ImportedCertView; onEdit: () => void }) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      try {
        await deleteCertificateAction(cert.id);
        setDeleteOpen(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to delete certificate");
      }
    });
  }

  return (
    <>
      <MoreMenu
        label={`Actions for certificate ${cert.name}`}
        size="sm"
        alignment="end"
        items={[
          { label: "Edit", onClick: onEdit },
          {
            label: "Delete",
            variant: "destructive",
            onClick: () => {
              setError(null);
              setDeleteOpen(true);
            },
          },
        ]}
      />

      {/* AlertDialog has no body slot, so a failed delete is appended to the
          description, which is what aria-describedby announces. */}
      <AlertDialog
        isOpen={deleteOpen}
        onOpenChange={(open) => {
          if (isPending) return;
          setDeleteOpen(open);
          if (!open) setError(null);
        }}
        title="Delete Imported Certificate"
        description={
          error
            ? `Delete imported certificate ${cert.name}? This cannot be undone. ${error}`
            : `Delete imported certificate ${cert.name}? This cannot be undone.`
        }
        actionLabel="Delete Certificate"
        onAction={handleDelete}
        isActionLoading={isPending}
      />
    </>
  );
}

function importedMobileCard(c: ImportedCertView, onEdit: () => void) {
  return (
    <Card>
      <VStack gap={2}>
        <HStack justify="between" vAlign="center" gap={2}>
          <HStack gap={2} vAlign="center">
            <Icon icon={FileKey} size="sm" color={expiryIconColor(c.expiryStatus)} />
            <Text type="body" size="sm" weight="semibold">
              {c.name}
            </Text>
          </HStack>
          <ActionsMenu cert={c} onEdit={onEdit} />
        </HStack>
        <Text type="code" size="xsm" color="secondary">
          {c.domains.slice(0, 2).join(", ")}
          {c.domains.length > 2 ? ` +${c.domains.length - 2}` : ""}
        </Text>
        <RelativeTime validTo={c.validTo} status={c.expiryStatus} />
      </VStack>
    </Card>
  );
}

export function ImportedTab({ importedCerts, managedCerts, search, statusFilter }: Props) {
  const [drawerCert, setDrawerCert] = useState<ImportedCertView | null | false>(false);
  const mobileCardRenderer = (c: ImportedCertView) => importedMobileCard(c, () => setDrawerCert(c));

  const filtered = importedCerts.filter((c) => {
    if (statusFilter && c.expiryStatus !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        c.name.toLowerCase().includes(q) ||
        c.domains.some((d) => d.toLowerCase().includes(q))
      );
    }
    return true;
  });

  const columns = [
    {
      id: "name",
      label: "Name",
      render: (c: ImportedCertView) => (
        <HStack gap={3} vAlign="center">
          <Icon icon={FileKey} size="sm" color={expiryIconColor(c.expiryStatus)} />
          <Text type="body" size="sm" weight="semibold">
            {c.name}
          </Text>
        </HStack>
      ),
    },
    {
      id: "domains",
      label: "Domains",
      render: (c: ImportedCertView) => <DomainsCell domains={c.domains} />,
    },
    {
      id: "expiry",
      label: "Expires",
      render: (c: ImportedCertView) => <RelativeTime validTo={c.validTo} status={c.expiryStatus} />,
    },
    {
      id: "usedBy",
      label: "Used by",
      render: (c: ImportedCertView) =>
        c.usedBy.length === 0 ? (
          <Text type="body" size="sm" color="secondary">
            &mdash;
          </Text>
        ) : (
          <HStack gap={1} wrap="wrap">
            {c.usedBy.map((h) => (
              <Badge key={h.id} label={h.name} />
            ))}
          </HStack>
        ),
    },
    {
      id: "actions",
      label: "",
      align: "right" as const,
      render: (c: ImportedCertView) => <ActionsMenu cert={c} onEdit={() => setDrawerCert(c)} />,
    },
  ];

  return (
    <VStack gap={4}>
      <HStack justify="end">
        <Button
          variant="secondary"
          size="sm"
          label="Import Certificate"
          icon={<Plus />}
          onClick={() => setDrawerCert(null)}
        />
      </HStack>

      <DataTable
        columns={columns}
        data={filtered}
        keyField="id"
        emptyMessage="No imported certificates match"
        mobileCard={mobileCardRenderer}
        rowStatus={(c) =>
          c.expiryStatus === "expired"
            ? { color: "error", icon: "error", label: "Expired" }
            : c.expiryStatus === "expiring_soon"
              ? { color: "warning", icon: "warning", label: "Expiring soon" }
              : null
        }
      />

      {managedCerts.length > 0 && (
        <VStack gap={2}>
          <Banner
            status="warning"
            icon={<AlertTriangle />}
            title="Legacy managed certificate entries detected"
            description="These are redundant. Caddy handles HTTPS automatically, so consider deleting them."
          />
          <LegacyManagedTable managedCerts={managedCerts} />
        </VStack>
      )}

      <ImportCertDrawer
        open={drawerCert !== false}
        cert={drawerCert || null}
        onClose={() => setDrawerCert(false)}
      />
    </VStack>
  );
}

function LegacyManagedTable({ managedCerts }: { managedCerts: ManagedCertView[] }) {
  const [isPending, startTransition] = useTransition();

  const columns = [
    {
      id: "name",
      label: "Name",
      render: (c: ManagedCertView) => (
        <Text type="body" size="sm" weight="semibold">
          {c.name}
        </Text>
      ),
    },
    {
      id: "domains",
      label: "Domains",
      render: (c: ManagedCertView) => (
        <Text type="code" size="sm" color="secondary">
          {c.domainNames.join(", ")}
        </Text>
      ),
    },
    {
      id: "actions",
      label: "",
      align: "right" as const,
      render: (c: ManagedCertView) => (
        <Button
          size="sm"
          variant="destructive"
          label="Delete"
          isDisabled={isPending}
          onClick={() =>
            startTransition(async () => {
              await deleteCertificateAction(c.id);
            })
          }
        />
      ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={managedCerts}
      keyField="id"
      emptyMessage="No legacy managed certificates"
    />
  );
}
