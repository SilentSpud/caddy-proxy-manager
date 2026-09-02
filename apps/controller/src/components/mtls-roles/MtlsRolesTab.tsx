"use client";

import { ShieldCheck, Plus, UserPlus } from "lucide-react";
import { useState, useEffect, useCallback, useRef } from "react";
import { AlertDialog } from "@astryxdesign/core/AlertDialog";
import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { CheckboxInput } from "@astryxdesign/core/CheckboxInput";
import { Divider } from "@astryxdesign/core/Divider";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Grid } from "@astryxdesign/core/Grid";
import { Icon } from "@astryxdesign/core/Icon";
import { List, ListItem } from "@astryxdesign/core/List";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import type { MtlsRole, MtlsRoleWithCertificates } from "@/lib/models/mtls-roles";
import type { IssuedClientCertificate } from "@/lib/models/issued-client-certificates";

/** Per-position card tints. Decorative only, so they use the theme's non-semantic variants. */
const CARD_VARIANTS = ["orange", "cyan", "purple", "green", "red"] as const;

type Props = {
  roles: MtlsRole[];
  issuedCerts: IssuedClientCertificate[];
  search: string;
};

export function MtlsRolesTab({ roles, issuedCerts, search }: Props) {
  const [createOpen, setCreateOpen] = useState(false);
  const activeCerts = issuedCerts.filter((c) => !c.revokedAt);

  const filtered = roles.filter(
    (r) =>
      !search ||
      r.name.toLowerCase().includes(search.toLowerCase()) ||
      r.description?.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <VStack gap={4}>
      {/* Create inline form */}
      {createOpen ? (
        <CreateRoleCard onClose={() => setCreateOpen(false)} />
      ) : (
        <Button
          variant="secondary"
          width="100%"
          icon={<Plus />}
          label="Create New Role"
          onClick={() => setCreateOpen(true)}
        />
      )}

      {filtered.length === 0 && !createOpen && (
        <EmptyState
          icon={<ShieldCheck />}
          title={search ? "No roles match your search." : "No mTLS roles yet."}
          description="Roles group client certificates for access control on proxy hosts."
        />
      )}

      {filtered.map((role, idx) => (
        <RoleCard
          key={role.id}
          role={role}
          variant={CARD_VARIANTS[idx % CARD_VARIANTS.length]}
          activeCerts={activeCerts}
        />
      ))}
    </VStack>
  );
}

/* ── Create role inline card ── */

function CreateRoleCard({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleCreate() {
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/v1/mtls-roles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), description: description.trim() || null }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error || `Failed (${res.status})`);
        setSubmitting(false);
        return;
      }
      onClose();
      window.location.reload();
    } catch {
      setError("Network error");
      setSubmitting(false);
    }
  }

  return (
    <Card padding={5}>
      <VStack gap={3}>
        {error && <Banner status="error" title="Could not create role" description={error} />}
        <Grid columns={{ minWidth: 200, max: 2 }} gap={3}>
          <TextInput
            label="Name"
            size="sm"
            value={name}
            onChange={setName}
            placeholder="e.g. admin"
            hasAutoFocus
          />
          <TextInput
            label="Description"
            isOptional
            size="sm"
            value={description}
            onChange={setDescription}
            placeholder="Optional"
          />
        </Grid>
        <HStack justify="end" gap={2}>
          <Button variant="ghost" size="sm" label="Cancel" onClick={onClose} />
          <Button
            size="sm"
            label="Create Role"
            onClick={handleCreate}
            isLoading={submitting}
            isDisabled={submitting}
          />
        </HStack>
      </VStack>
    </Card>
  );
}

/* ── Single role card ── */

function RoleCard({
  role,
  variant,
  activeCerts,
}: {
  role: MtlsRole;
  variant: (typeof CARD_VARIANTS)[number];
  activeCerts: IssuedClientCertificate[];
}) {
  const [assignedIds, setAssignedIds] = useState<Set<number>>(new Set());
  const [loaded, setLoaded] = useState(false);
  const [toggling, setToggling] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [name, setName] = useState(role.name);
  const [description, setDescription] = useState(role.description ?? "");

  const loadAssignments = useCallback(() => {
    fetch(`/api/v1/mtls-roles/${role.id}`)
      .then((r) => (r.ok ? r.json() : { certificate_ids: [] }))
      .then((data: MtlsRoleWithCertificates) => {
        setAssignedIds(new Set(data.certificateIds));
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [role.id]);

  useEffect(() => {
    loadAssignments();
  }, [loadAssignments]);

  async function handleToggle(certId: number) {
    const isAssigned = assignedIds.has(certId);
    setToggling(certId);
    try {
      if (isAssigned) {
        await fetch(`/api/v1/mtls-roles/${role.id}/certificates/${certId}`, { method: "DELETE" });
        setAssignedIds((prev) => {
          const next = new Set(prev);
          next.delete(certId);
          return next;
        });
      } else {
        await fetch(`/api/v1/mtls-roles/${role.id}/certificates`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ certificateId: certId }),
        });
        setAssignedIds((prev) => new Set(prev).add(certId));
      }
    } catch {
      /* silent */
    }
    setToggling(null);
  }

  async function handleSave() {
    await fetch(`/api/v1/mtls-roles/${role.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), description: description.trim() || null }),
    });
    setEditing(false);
    window.location.reload();
  }

  async function handleDelete() {
    await fetch(`/api/v1/mtls-roles/${role.id}`, { method: "DELETE" });
    window.location.reload();
  }

  const certCountLabel = `${assignedIds.size} ${assignedIds.size === 1 ? "certificate" : "certificates"}`;

  return (
    <Card variant={variant} padding={5}>
      <VStack gap={4}>
        {/* Header */}
        <HStack justify="between" vAlign="center" gap={3}>
          <HStack gap={3} vAlign="center">
            <Icon icon={ShieldCheck} />
            <VStack gap={0}>
              <Text type="body" size="sm" weight="semibold" maxLines={1}>
                {role.name}
              </Text>
              <Text type="body" size="xsm" color="secondary">
                {certCountLabel}
                {role.description && ` · ${role.description}`}
              </Text>
            </VStack>
          </HStack>
          <Badge label={assignedIds.size} />
        </HStack>

        {/* Edit form */}
        {editing ? (
          <VStack gap={3}>
            <Grid columns={{ minWidth: 200, max: 2 }} gap={3}>
              <TextInput label="Name" size="sm" value={name} onChange={setName} />
              <TextInput
                label="Description"
                isOptional
                size="sm"
                value={description}
                onChange={setDescription}
                placeholder="Optional"
              />
            </Grid>
            <HStack justify="end" gap={2}>
              <Button variant="ghost" size="sm" label="Cancel" onClick={() => setEditing(false)} />
              <Button variant="secondary" size="sm" label="Save" onClick={handleSave} />
            </HStack>
          </VStack>
        ) : (
          <HStack justify="end" gap={2}>
            <Button variant="secondary" size="sm" label="Edit" onClick={() => setEditing(true)} />
            <Button
              variant="ghost"
              size="sm"
              label="Delete role"
              onClick={() => setDeleteOpen(true)}
            />
          </HStack>
        )}

        <Divider />

        {/* Certificates */}
        <VStack gap={2}>
          <Text type="label" size="xsm" weight="semibold" color="secondary">
            Certificates
          </Text>

          {!loaded ? (
            <Text type="body" size="sm" color="secondary">
              Loading...
            </Text>
          ) : activeCerts.length === 0 ? (
            <EmptyState icon={<UserPlus />} title="No client certificates issued yet." isCompact />
          ) : (
            <List hasDividers>
              {activeCerts.map((cert) => (
                <CertAssignmentRow
                  key={cert.id}
                  cert={cert}
                  isAssigned={assignedIds.has(cert.id)}
                  isLoading={toggling === cert.id}
                  onToggle={() => handleToggle(cert.id)}
                />
              ))}
            </List>
          )}
        </VStack>
      </VStack>

      {/* Replaces window.confirm, which was unstyled and not announced as a
          dialog to assistive tech. */}
      <AlertDialog
        isOpen={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete role"
        description={`Delete role "${role.name}"? Proxy hosts referencing it will lose this grouping.`}
        actionLabel="Delete role"
        onAction={handleDelete}
      />
    </Card>
  );
}

function CertAssignmentRow({
  cert,
  isAssigned,
  isLoading,
  onToggle,
}: {
  cert: IssuedClientCertificate;
  isAssigned: boolean;
  isLoading: boolean;
  onToggle: () => void;
}) {
  const checkboxRef = useRef<HTMLInputElement>(null);

  return (
    <ListItem
      // The checkbox owns the row's keyboard access, so the whole row is a
      // click target without adding a second tab stop.
      interactiveRef={checkboxRef}
      startContent={
        <CheckboxInput
          ref={checkboxRef}
          label={`Assign ${cert.commonName} to this role`}
          isLabelHidden
          value={isAssigned}
          isDisabled={isLoading}
          onChange={onToggle}
        />
      }
      label={cert.commonName}
      description={`expires ${new Date(cert.validTo).toLocaleDateString()}`}
      endContent={isAssigned ? <Badge label="Assigned" /> : undefined}
      isDisabled={isLoading}
    />
  );
}
