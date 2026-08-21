"use client";

import { useState, useEffect, useCallback } from "react";
import { LockKeyhole, Plus, Pencil, Trash2, Ban } from "lucide-react";
import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { CheckboxInput } from "@astryxdesign/core/CheckboxInput";
import { CheckboxList, CheckboxListItem } from "@astryxdesign/core/CheckboxList";
import { Divider } from "@astryxdesign/core/Divider";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { NumberInput } from "@astryxdesign/core/NumberInput";
import { Spinner } from "@astryxdesign/core/Spinner";
import { Switch } from "@astryxdesign/core/Switch";
import { TextArea } from "@astryxdesign/core/TextArea";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Text } from "@astryxdesign/core/Text";
import { Token } from "@astryxdesign/core/Token";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { AppDialog } from "@/components/ui/AppDialog";
import type { CaCertificate } from "@/lib/models/ca-certificates";
import type { MtlsConfig } from "@/lib/models/proxy-hosts";
import type { MtlsAccessRule } from "@/lib/models/mtls-access-rules";
import type { MtlsRole } from "@/lib/models/mtls-roles";
import type { IssuedClientCertificate } from "@/lib/models/issued-client-certificates";

type Props = {
  value?: MtlsConfig | null;
  caCertificates: CaCertificate[];
  issuedClientCerts?: IssuedClientCertificate[];
  proxyHostId?: number;
  mtlsRoles?: MtlsRole[];
};

export function MtlsFields({
  value,
  caCertificates,
  issuedClientCerts = [],
  proxyHostId,
  mtlsRoles = [],
}: Props) {
  const [enabled, setEnabled] = useState(value?.enabled ?? false);
  const [selectedCertIds, setSelectedCertIds] = useState<number[]>(
    value?.trusted_client_cert_ids ?? []
  );
  const [selectedRoleIds, setSelectedRoleIds] = useState<number[]>(value?.trusted_role_ids ?? []);
  const [protectedPaths, setProtectedPaths] = useState(value?.protected_paths?.join(", ") ?? "");
  const [excludedPaths, setExcludedPaths] = useState(value?.excluded_paths?.join(", ") ?? "");

  const [rules, setRules] = useState<MtlsAccessRule[]>([]);
  const [rulesLoaded, setRulesLoaded] = useState(false);
  const [addRuleOpen, setAddRuleOpen] = useState(false);
  const [editRule, setEditRule] = useState<MtlsAccessRule | null>(null);

  const isEditMode = !!proxyHostId;
  // Only consider certs that are not revoked AND whose issuing CA still exists.
  // Deleting a CA should remove its issued certs, but legacy/orphaned rows must
  // never resurface as selectable here.
  const knownCaIds = new Set(caCertificates.map((c) => c.id));
  const activeCerts = issuedClientCerts.filter(
    (c) => !c.revokedAt && knownCaIds.has(c.caCertificateId)
  );

  const certsByCA = new Map<number, IssuedClientCertificate[]>();
  for (const cert of activeCerts) {
    const list = certsByCA.get(cert.caCertificateId) ?? [];
    list.push(cert);
    certsByCA.set(cert.caCertificateId, list);
  }

  const loadRules = useCallback(() => {
    if (!proxyHostId) return;
    fetch(`/api/v1/proxy-hosts/${proxyHostId}/mtls-access-rules`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data: MtlsAccessRule[]) => {
        setRules(data);
        setRulesLoaded(true);
      })
      .catch(() => {
        setRules([]);
        setRulesLoaded(true);
      });
  }, [proxyHostId]);

  useEffect(() => {
    if (isEditMode && enabled) loadRules();
  }, [isEditMode, enabled, loadRules]);

  function toggleAllFromCA(caId: number) {
    const caIds = (certsByCA.get(caId) ?? []).map((c) => c.id);
    const allSelected = caIds.every((id) => selectedCertIds.includes(id));
    setSelectedCertIds((prev) =>
      allSelected ? prev.filter((id) => !caIds.includes(id)) : [...new Set([...prev, ...caIds])]
    );
  }

  async function deleteRule(ruleId: number) {
    try {
      const res = await fetch(
        `/api/v1/proxy-hosts/${proxyHostId}/mtls-access-rules/${ruleId}`,
        { method: "DELETE" }
      );
      if (res.ok) setRules((prev) => prev.filter((r) => r.id !== ruleId));
    } catch {
      /* silent */
    }
  }

  const hasTrust = selectedCertIds.length > 0 || selectedRoleIds.length > 0;

  return (
    <Card>
      <input type="hidden" name="mtlsPresent" value="1" />
      <input type="hidden" name="mtlsEnabled" value={enabled ? "true" : "false"} />
      {enabled &&
        selectedCertIds.map((id) => (
          <input key={`c${id}`} type="hidden" name="mtlsCertId" value={String(id)} />
        ))}
      {enabled &&
        selectedRoleIds.map((id) => (
          <input key={`r${id}`} type="hidden" name="mtlsRoleId" value={String(id)} />
        ))}

      <VStack gap={4}>
        <HStack justify="between" vAlign="start" gap={2}>
          <HStack gap={3} vAlign="start">
            <Icon icon={LockKeyhole} size="md" color="warning" />
            <VStack gap={1}>
              <Text type="body" size="sm" weight="bold">
                Mutual TLS (mTLS)
              </Text>
              <Text type="body" size="sm" color="secondary">
                Require clients to present a trusted certificate to connect
              </Text>
            </VStack>
          </HStack>
          <Switch label="Enable mTLS" isLabelHidden value={enabled} onChange={setEnabled} />
        </HStack>

        {enabled && (
          <VStack gap={4}>
            <Banner
              status="info"
              title="mTLS requires TLS on this host"
              description="A certificate must be set. Select roles and/or individual certificates to allow."
            />

            <TextArea
              label="Protected Paths"
              isOptional
              htmlName="mtlsProtectedPaths"
              placeholder="/admin/*, /internal/*"
              value={protectedPaths}
              onChange={setProtectedPaths}
              rows={2}
              description="Leave empty to require mTLS for the entire domain. Comma-separated paths to require client certificates on specific routes only."
            />
            <TextArea
              label="Excluded Paths"
              isOptional
              htmlName="mtlsExcludedPaths"
              placeholder="/health, /public/*"
              value={excludedPaths}
              onChange={setExcludedPaths}
              rows={2}
              description="Paths to exclude from mTLS. These paths bypass client certificate enforcement while all other paths remain protected. Ignored if Protected Paths is set."
            />

            {mtlsRoles.length > 0 && (
              <CheckboxList
                label="Trusted Roles"
                hasDividers
                value={selectedRoleIds.map(String)}
                onChange={(values) => setSelectedRoleIds(values.map(Number))}
              >
                {mtlsRoles.map((role) => (
                  <CheckboxListItem
                    key={role.id}
                    value={String(role.id)}
                    label={role.name}
                    description={role.description ?? undefined}
                    endContent={<Badge label={`${role.certificateCount} certs`} />}
                  />
                ))}
              </CheckboxList>
            )}

            <VStack gap={2}>
              <Text type="body" size="sm" weight="semibold">
                Trusted Certificates
              </Text>

              {activeCerts.length === 0 ? (
                <EmptyState
                  title="No client certificates issued yet"
                  description="Issue certificates from a CA on the Certificates page."
                  isCompact
                />
              ) : (
                <VStack gap={2}>
                  {Array.from(certsByCA.entries()).map(([caId, certs]) => {
                    const ca = caCertificates.find((c) => c.id === caId);
                    const caName = ca?.name ?? `CA #${caId}`;
                    const allSelected = certs.every((c) => selectedCertIds.includes(c.id));
                    const someSelected = certs.some((c) => selectedCertIds.includes(c.id));
                    const selectedCount = certs.filter((c) =>
                      selectedCertIds.includes(c.id)
                    ).length;

                    return (
                      <Card key={caId} variant="muted">
                        <VStack gap={2}>
                          <HStack justify="between" vAlign="center" gap={2}>
                            <CheckboxInput
                              label={caName}
                              // Indeterminate communicates a partial CA selection,
                              // which the old markup faked with opacity.
                              value={allSelected ? true : someSelected ? "indeterminate" : false}
                              onChange={() => toggleAllFromCA(caId)}
                            />
                            <Text type="body" size="xsm" color="secondary">
                              {selectedCount}/{certs.length}
                            </Text>
                          </HStack>
                          <Divider />
                          <CheckboxList
                            label={`Certificates issued by ${caName}`}
                            isLabelHidden
                            value={certs
                              .filter((c) => selectedCertIds.includes(c.id))
                              .map((c) => String(c.id))}
                            onChange={(values) => {
                              const idsInThisCa = certs.map((c) => c.id);
                              const nowSelected = values.map(Number);
                              setSelectedCertIds((prev) => [
                                ...prev.filter((id) => !idsInThisCa.includes(id)),
                                ...nowSelected,
                              ]);
                            }}
                          >
                            {certs.map((cert) => (
                              <CheckboxListItem
                                key={cert.id}
                                value={String(cert.id)}
                                label={cert.commonName}
                                endContent={
                                  <Text type="body" size="xsm" color="secondary">
                                    expires {new Date(cert.validTo).toLocaleDateString()}
                                  </Text>
                                }
                              />
                            ))}
                          </CheckboxList>
                        </VStack>
                      </Card>
                    );
                  })}
                </VStack>
              )}
            </VStack>

            {!hasTrust && activeCerts.length > 0 && (
              <Banner
                status="error"
                title="mTLS will block all connections"
                description="No roles or certificates are selected."
              />
            )}

            {isEditMode && (
              <>
                <Divider />
                <HStack justify="between" vAlign="center" gap={2}>
                  <VStack gap={1}>
                    <Text type="body" size="sm" weight="semibold">
                      Path-Based Access Rules
                    </Text>
                    <Text type="body" size="xsm" color="secondary">
                      Restrict specific paths to certain roles or certificates. Paths without rules
                      allow any trusted cert/role above.
                    </Text>
                  </VStack>
                  <Button
                    size="sm"
                    variant="secondary"
                    label="Add Rule"
                    icon={<Plus />}
                    onClick={() => setAddRuleOpen(true)}
                  />
                </HStack>

                {!rulesLoaded ? (
                  <HStack justify="center">
                    <Spinner label="Loading access rules" />
                  </HStack>
                ) : rules.length === 0 ? (
                  <EmptyState
                    title="No access rules configured"
                    description="All trusted certificates and roles have equal access to every path."
                    isCompact
                  />
                ) : (
                  <VStack gap={2}>
                    {rules.map((rule) => (
                      <Card key={rule.id} variant="muted">
                        <HStack gap={2} vAlign="center" wrap="wrap">
                          <Token size="sm" label={rule.pathPattern} />
                          {rule.denyAll ? (
                            <Badge label="Deny" icon={<Ban />} variant="error" />
                          ) : (
                            <HStack gap={1} wrap="wrap">
                              {rule.allowedRoleIds.map((roleId) => {
                                const role = mtlsRoles.find((r) => r.id === roleId);
                                return (
                                  <Badge
                                    key={`r-${roleId}`}
                                    label={role?.name ?? `#${roleId}`}
                                  />
                                );
                              })}
                              {rule.allowedCertIds.map((certId) => {
                                const cert = issuedClientCerts.find((c) => c.id === certId);
                                return (
                                  <Badge
                                    key={`c-${certId}`}
                                    label={cert?.commonName ?? `#${certId}`}
                                  />
                                );
                              })}
                              {rule.allowedRoleIds.length === 0 &&
                                rule.allowedCertIds.length === 0 && (
                                  <Text type="body" size="xsm" color="secondary">
                                    No roles/certs — effectively denied
                                  </Text>
                                )}
                            </HStack>
                          )}
                          {/* Always visible: the old controls only appeared on
                              hover, so keyboard users could not reach them. */}
                          <HStack gap={1}>
                            <IconButton
                              variant="ghost"
                              size="sm"
                              label={`Edit rule ${rule.pathPattern}`}
                              icon={<Pencil />}
                              onClick={() => setEditRule(rule)}
                            />
                            <IconButton
                              variant="ghost"
                              size="sm"
                              label={`Delete rule ${rule.pathPattern}`}
                              icon={<Trash2 />}
                              onClick={() => deleteRule(rule.id)}
                            />
                          </HStack>
                        </HStack>
                      </Card>
                    ))}
                  </VStack>
                )}

                {addRuleOpen && (
                  <RuleDialog
                    onClose={() => setAddRuleOpen(false)}
                    proxyHostId={proxyHostId!}
                    roles={mtlsRoles}
                    activeCerts={activeCerts}
                    title="Add Access Rule"
                    submitLabel="Add Rule"
                    onSaved={loadRules}
                  />
                )}
                {editRule && (
                  <RuleDialog
                    onClose={() => setEditRule(null)}
                    proxyHostId={proxyHostId!}
                    roles={mtlsRoles}
                    activeCerts={activeCerts}
                    title="Edit Access Rule"
                    submitLabel="Save"
                    existing={editRule}
                    onSaved={loadRules}
                  />
                )}
              </>
            )}
          </VStack>
        )}
      </VStack>
    </Card>
  );
}

function RuleDialog({
  onClose,
  proxyHostId,
  roles,
  activeCerts,
  title,
  submitLabel,
  existing,
  onSaved,
}: {
  onClose: () => void;
  proxyHostId: number;
  roles: MtlsRole[];
  activeCerts: IssuedClientCertificate[];
  title: string;
  submitLabel: string;
  existing?: MtlsAccessRule;
  onSaved: () => void;
}) {
  const [pathPattern, setPathPattern] = useState(existing?.pathPattern ?? "*");
  const [priority, setPriority] = useState<number | null>(existing?.priority ?? 0);
  const [description, setDescription] = useState(existing?.description ?? "");
  const [selectedRoleIds, setSelectedRoleIds] = useState<number[]>(existing?.allowedRoleIds ?? []);
  const [selectedCertIds, setSelectedCertIds] = useState<number[]>(existing?.allowedCertIds ?? []);
  const [denyAll, setDenyAll] = useState(existing?.denyAll ?? false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit() {
    if (!pathPattern.trim()) {
      setError("Path pattern is required");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const url = existing
        ? `/api/v1/proxy-hosts/${proxyHostId}/mtls-access-rules/${existing.id}`
        : `/api/v1/proxy-hosts/${proxyHostId}/mtls-access-rules`;
      const res = await fetch(url, {
        method: existing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path_pattern: pathPattern.trim(),
          priority: priority ?? 0,
          description: description || null,
          allowed_role_ids: selectedRoleIds,
          allowed_cert_ids: selectedCertIds,
          deny_all: denyAll,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || `Failed (${res.status})`);
        setSubmitting(false);
        return;
      }
      onSaved();
      onClose();
    } catch {
      setError("Network error");
      setSubmitting(false);
    }
  }

  return (
    <AppDialog
      open
      onClose={onClose}
      title={title}
      maxWidth="md"
      submitLabel={submitLabel}
      onSubmit={handleSubmit}
      isSubmitting={submitting}
    >
      <VStack gap={4}>
        {error && <Banner status="error" title={error} />}

        <HStack gap={3} vAlign="start">
          <TextInput
            label="Path Pattern"
            value={pathPattern}
            onChange={setPathPattern}
            placeholder="*"
            description="Use * for all paths, /admin/* for prefix match"
          />
          <NumberInput
            label="Priority"
            value={priority}
            onChange={setPriority}
            isIntegerOnly
            width={100}
          />
        </HStack>

        <TextInput
          label="Description"
          isOptional
          value={description}
          onChange={setDescription}
        />

        <Switch
          label="Deny all access to this path"
          value={denyAll}
          onChange={setDenyAll}
        />

        {/* Unmounted rather than dimmed to 30% opacity, so these are not
            reachable while the rule denies everything. */}
        {!denyAll && (
          <VStack gap={4}>
            {roles.length === 0 ? (
              <Text type="body" size="sm" color="secondary">
                No mTLS roles yet. Create roles on the Certificates page.
              </Text>
            ) : (
              <CheckboxList
                label="Allowed Roles"
                value={selectedRoleIds.map(String)}
                onChange={(values) => setSelectedRoleIds(values.map(Number))}
              >
                {roles.map((role) => (
                  <CheckboxListItem
                    key={role.id}
                    value={String(role.id)}
                    label={role.name}
                    description={role.description ?? undefined}
                  />
                ))}
              </CheckboxList>
            )}

            {activeCerts.length === 0 ? (
              <Text type="body" size="sm" color="secondary">
                No active client certificates.
              </Text>
            ) : (
              <CheckboxList
                label="Allowed Specific Certificates"
                description="These bypass role checks for this path"
                value={selectedCertIds.map(String)}
                onChange={(values) => setSelectedCertIds(values.map(Number))}
              >
                {activeCerts.map((cert) => (
                  <CheckboxListItem
                    key={cert.id}
                    value={String(cert.id)}
                    label={cert.commonName}
                  />
                ))}
              </CheckboxList>
            )}
          </VStack>
        )}
      </VStack>
    </AppDialog>
  );
}
