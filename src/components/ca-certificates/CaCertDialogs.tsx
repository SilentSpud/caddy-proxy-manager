"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { Download } from "lucide-react";
import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { NumberInput } from "@astryxdesign/core/NumberInput";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { NATIVE_REQUIRED } from "@/components/ui/native-input-attrs";
import { AppDialog } from "@/components/ui/AppDialog";
import type { CaCertificate } from "@/lib/models/ca-certificates";
import type { IssuedClientCertificate } from "@/lib/models/issued-client-certificates";
import { Switch } from "@/src/components/ui/FormBooleanControls";
import {
  deleteCaCertificateAction,
  issueClientCertificateAction,
  revokeIssuedClientCertificateAction,
} from "@/app/(dashboard)/certificates/ca-actions";

function downloadFile(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function decodeBase64(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes.buffer;
}

function sanitizeFilenameSegment(value: string): string {
  return (
    value
      .trim()
      .replace(/[^a-z0-9._-]+/gi, "_")
      .replace(/^_+|_+$/g, "") || "client"
  );
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString();
}

function formatFingerprint(value: string): string {
  return value.match(/.{1,2}/g)?.join(":") ?? value;
}

export function IssueClientCertDialog({
  open,
  cert,
  onClose,
}: {
  open: boolean;
  cert: CaCertificate;
  onClose: () => void;
}) {
  const router = useRouter();
  // One of these dialogs is mounted per CA row, and a closed native <dialog>
  // stays in the DOM — so a shared form id would appear many times over. The
  // submit button associates by `form={id}`, which resolves through
  // getElementById and would therefore target the *first* form in the
  // document: a different, empty dialog whose required fields then block
  // submission. With more than one CA, "Issue Certificate" silently did
  // nothing. useId gives every instance its own form.
  const issueFormId = useId();
  const [isPending, startTransition] = useTransition();
  const [issued, setIssued] = useState<{
    pkcs12Base64: string;
    name: string;
    passwordProtected: boolean;
    exportAlgorithm: "3des" | "aes256";
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [commonName, setCommonName] = useState("");
  const [validityDays, setValidityDays] = useState(365);
  const [exportPassword, setExportPassword] = useState("");
  const [compatibilityMode, setCompatibilityMode] = useState(true);
  const formRef = useRef<HTMLFormElement>(null);

  // Controlled fields, so a reopened dialog starts clean rather than showing
  // the previous issuance's export password.
  useEffect(() => {
    if (!open) return;
    setCommonName("");
    setValidityDays(365);
    setExportPassword("");
    setCompatibilityMode(true);
  }, [open]);

  function handleClose() {
    setIssued(null);
    setError(null);
    onClose();
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const formData = new FormData(formRef.current!);
    setError(null);
    startTransition(async () => {
      try {
        const result = await issueClientCertificateAction(cert.id, formData);
        setIssued({
          ...result,
          name: sanitizeFilenameSegment(String(formData.get("common_name") ?? "client")),
        });
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to issue certificate");
      }
    });
  }

  const actions = issued ? (
    <Button label="Done" onClick={handleClose} />
  ) : (
    <>
      <Button variant="secondary" label="Cancel" onClick={handleClose} isDisabled={isPending} />
      <Button
        type="submit"
        form={issueFormId}
        label="Issue Certificate"
        isLoading={isPending}
        isDisabled={isPending}
      />
    </>
  );

  return (
    <AppDialog
      open={open}
      onClose={handleClose}
      title="Issue Client Certificate"
      maxWidth="sm"
      actions={actions}
    >
      {issued ? (
        <VStack gap={4}>
          <Banner
            status="success"
            title="Client certificate issued"
            description="Download the .p12 bundle now. It contains the client certificate, private key, and CA chain, and the private key will not be stored."
          />
          <Text type="body" size="sm" color="secondary">
            Export format:{" "}
            {issued.exportAlgorithm === "3des" ? "Compatibility mode (3DES)" : "AES-256"}.
          </Text>
          <Button
            variant="secondary"
            icon={<Download />}
            label="Download Client Certificate (.p12)"
            onClick={() =>
              downloadFile(
                `${issued.name}.p12`,
                new Blob([decodeBase64(issued.pkcs12Base64)], { type: "application/x-pkcs12" }),
              )
            }
          />
          {issued.passwordProtected && (
            <Text type="body" size="sm" color="secondary">
              Import it using the export password you entered during issuance.
            </Text>
          )}
        </VStack>
      ) : (
        <form id={issueFormId} ref={formRef} onSubmit={handleSubmit}>
          <VStack gap={4}>
            <TextInput
              {...NATIVE_REQUIRED}
              label="Common Name (CN)"
              htmlName="common_name"
              value={commonName}
              onChange={setCommonName}
              isRequired
              hasAutoFocus
              placeholder="alice"
              description="Identifies this client (e.g. a username or device name)"
            />
            <NumberInput
              label="Validity"
              htmlName="validity_days"
              value={validityDays}
              onChange={setValidityDays}
              min={1}
              max={3650}
              isIntegerOnly
              units="days"
            />
            <TextInput
              {...NATIVE_REQUIRED}
              label="Export Password"
              type="password"
              htmlName="export_password"
              value={exportPassword}
              onChange={setExportPassword}
              isRequired
              description="Used to protect the .p12 bundle when importing it into operating systems and browsers"
            />
            <Switch
              label="Compatibility mode"
              htmlName="compatibility_mode"
              value={compatibilityMode}
              onChange={setCompatibilityMode}
              description="Enabled uses 3DES for broader OS/browser import compatibility. Disabled uses AES-256."
            />
            {error && (
              <Banner status="error" title="Could not issue certificate" description={error} />
            )}
          </VStack>
        </form>
      )}
    </AppDialog>
  );
}

export function ManageIssuedClientCertsDialog({
  open,
  cert,
  issuedCerts,
  onClose,
}: {
  open: boolean;
  cert: CaCertificate;
  issuedCerts: IssuedClientCertificate[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [items, setItems] = useState<IssuedClientCertificate[]>(issuedCerts);
  const [error, setError] = useState<string | null>(null);
  const [showRevoked, setShowRevoked] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }
    setItems(issuedCerts);
    setError(null);
  }, [issuedCerts, open]);

  function handleRevoke(id: number) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await revokeIssuedClientCertificateAction(id);
        setItems((current) =>
          current.map((item) =>
            item.id === id
              ? { ...item, revokedAt: result.revokedAt, updatedAt: result.revokedAt }
              : item,
          ),
        );
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to revoke certificate");
      }
    });
  }

  const visibleItems = showRevoked ? items : items.filter((i) => !i.revokedAt);
  const revokedCount = items.filter((i) => i.revokedAt).length;

  return (
    <AppDialog
      open={open}
      onClose={onClose}
      title="Issued Client Certificates"
      maxWidth="md"
      actions={
        <Button variant="secondary" label="Close" onClick={onClose} isDisabled={isPending} />
      }
    >
      <VStack gap={4}>
        <Banner
          status="info"
          title="Revoking removes trust"
          description={`Revoking a client certificate removes it from the trusted mTLS client certificate pool for hosts using ${cert.name}.`}
        />
        {error && (
          <Banner status="error" title="Could not revoke certificate" description={error} />
        )}
        {revokedCount > 0 && (
          <Switch
            label={`Show revoked (${revokedCount})`}
            value={showRevoked}
            onChange={setShowRevoked}
          />
        )}
        {visibleItems.length === 0 ? (
          <Text type="body" size="sm" color="secondary">
            {items.length === 0
              ? "No issued client certificates are currently tracked for this CA. Certificates issued from this UI will appear here and can then be revoked individually."
              : 'No active client certificates. Enable "Show revoked" to view revoked certificates.'}
          </Text>
        ) : (
          visibleItems.map((item) => {
            const expired = new Date(item.validTo).getTime() < Date.now();
            return (
              <Card key={item.id}>
                <VStack gap={3}>
                  <HStack justify="between" gap={4} vAlign="start">
                    <VStack gap={0}>
                      <Text type="body" weight="semibold">
                        {item.commonName}
                      </Text>
                      <Text type="body" size="sm" color="secondary">
                        Serial {item.serialNumber}
                      </Text>
                    </VStack>
                    <HStack gap={1} wrap="wrap" justify="end">
                      <Badge
                        variant={item.revokedAt ? "neutral" : "success"}
                        label={item.revokedAt ? "Revoked" : "Active"}
                      />
                      <Badge
                        variant={expired ? "error" : "neutral"}
                        label={
                          expired
                            ? `Expired ${formatDateTime(item.validTo)}`
                            : `Expires ${formatDateTime(item.validTo)}`
                        }
                      />
                    </HStack>
                  </HStack>
                  <Text type="body" size="sm" color="secondary">
                    Issued {formatDateTime(item.createdAt)}
                  </Text>
                  <Text type="code" size="sm" color="secondary">
                    SHA-256 {formatFingerprint(item.fingerprintSha256)}
                  </Text>
                  {item.revokedAt ? (
                    <Text type="body" size="sm" color="secondary">
                      Revoked {formatDateTime(item.revokedAt)}
                    </Text>
                  ) : (
                    <HStack justify="end">
                      <Button
                        variant="destructive"
                        label="Revoke"
                        isLoading={isPending}
                        isDisabled={isPending}
                        onClick={() => handleRevoke(item.id)}
                      />
                    </HStack>
                  )}
                </VStack>
              </Card>
            );
          })
        )}
      </VStack>
    </AppDialog>
  );
}

export function DeleteCaCertDialog({
  open,
  cert,
  onClose,
}: {
  open: boolean;
  cert: CaCertificate;
  onClose: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      const result = await deleteCaCertificateAction(cert.id);
      if (result.success) {
        onClose();
      } else {
        setError(result.error ?? "Failed to delete");
      }
    });
  }

  return (
    <AppDialog
      open={open}
      onClose={onClose}
      title="Delete CA Certificate"
      maxWidth="sm"
      actions={
        <>
          <Button variant="secondary" label="Cancel" onClick={onClose} isDisabled={isPending} />
          <Button
            variant="destructive"
            label="Delete"
            onClick={handleDelete}
            isLoading={isPending}
            isDisabled={isPending}
          />
        </>
      }
    >
      <VStack gap={4}>
        <Text type="body" size="sm" color="secondary">
          Delete CA certificate <strong>{cert.name}</strong>? This cannot be undone. Proxy hosts
          using this CA for mTLS will stop requiring client certificates.
        </Text>
        {error && (
          <Banner status="error" title="Could not delete certificate" description={error} />
        )}
      </VStack>
    </AppDialog>
  );
}
