"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/src/lib/auth";
import {
  createCaCertificate,
  deleteCaCertificate,
  updateCaCertificate,
  getCaCertificatePrivateKey,
} from "@/src/lib/models/ca-certificates";
import {
  createIssuedClientCertificate,
  revokeIssuedClientCertificate,
} from "@/src/lib/models/issued-client-certificates";
import { generateKeyPair as generateKeyPairCb, X509Certificate } from "node:crypto";
import { promisify } from "node:util";
import { passwordPolicyError } from "@/src/lib/password-policy";
import forge from "node-forge";

const generateKeyPairAsync = promisify(generateKeyPairCb);

/** The declared options plus `prfAlgorithm`, which forge honours but does not type. */
type Pkcs12ExportOptions = NonNullable<Parameters<typeof forge.pkcs12.toPkcs12Asn1>[3]> & {
  prfAlgorithm?: "sha1" | "sha256" | "sha384" | "sha512";
};

/**
 * RSA keygen on the crypto threadpool rather than forge's pure-JS version, which blocks the event
 * loop for the whole generation (~150-450ms at 4096 bits). Returns forge key objects, so the built
 * certificate and stored PEM stay byte-identical.
 */
async function generateForgeKeyPair(bits: number) {
  const { privateKey, publicKey } = await generateKeyPairAsync("rsa", {
    modulusLength: bits,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return {
    privateKey: forge.pki.privateKeyFromPem(privateKey),
    publicKey: forge.pki.publicKeyFromPem(publicKey),
  };
}

function validatePem(pem: string): void {
  try {
    new X509Certificate(pem);
  } catch {
    throw new Error("Invalid certificate PEM: could not parse as X.509 certificate");
  }
}

export async function createCaCertificateAction(formData: FormData) {
  const session = await requireAdmin();
  const userId = Number(session.user.id);
  const name = String(formData.get("name") ?? "").trim();
  const certificatePem = String(formData.get("certificate_pem") ?? "").trim();

  if (!name) throw new Error("Name is required");
  if (!certificatePem) throw new Error("Certificate PEM is required");
  validatePem(certificatePem);

  await createCaCertificate({ name, certificatePem: certificatePem }, userId);
  revalidatePath("/certificates");
}

export async function updateCaCertificateAction(id: number, formData: FormData) {
  const session = await requireAdmin();
  const userId = Number(session.user.id);
  const name = formData.get("name") ? String(formData.get("name")).trim() : undefined;
  const certificatePem = formData.get("certificate_pem")
    ? String(formData.get("certificate_pem")).trim()
    : undefined;

  if (certificatePem) {
    validatePem(certificatePem);
  }

  await updateCaCertificate(
    id,
    {
      ...(name ? { name } : {}),
      ...(certificatePem ? { certificatePem: certificatePem } : {}),
    },
    userId,
  );
  revalidatePath("/certificates");
}

export async function deleteCaCertificateAction(
  id: number,
): Promise<{ success: boolean; error?: string }> {
  const session = await requireAdmin();
  const userId = Number(session.user.id);
  try {
    await deleteCaCertificate(id, userId);
    revalidatePath("/certificates");
    return { success: true };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "Failed to delete CA certificate",
    };
  }
}

export async function generateCaCertificateAction(formData: FormData): Promise<{ id: number }> {
  const session = await requireAdmin();
  const userId = Number(session.user.id);
  const name = String(formData.get("name") ?? "").trim();
  const commonName = String(formData.get("common_name") ?? name).trim() || name;
  const validityDays = Math.min(
    3650,
    Math.max(1, parseInt(String(formData.get("validity_days") ?? "3650"), 10) || 3650),
  );

  if (!name) throw new Error("Name is required");

  const keypair = await generateForgeKeyPair(4096);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keypair.publicKey;
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setDate(cert.validity.notBefore.getDate() + validityDays);

  const attrs = [
    { name: "commonName", value: commonName },
    { name: "organizationName", value: "Caddy Proxy Manager" },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: "basicConstraints", cA: true, critical: true },
    { name: "keyUsage", keyCertSign: true, cRLSign: true, critical: true },
    { name: "subjectKeyIdentifier" },
  ]);

  cert.sign(keypair.privateKey, forge.md.sha256.create());

  const certificatePem = forge.pki.certificateToPem(cert);
  const privateKeyPem = forge.pki.privateKeyToPem(keypair.privateKey);

  const record = await createCaCertificate(
    { name, certificatePem: certificatePem, privateKeyPem: privateKeyPem },
    userId,
  );
  revalidatePath("/certificates");
  return { id: record.id };
}

export type IssuedClientCert = {
  pkcs12Base64: string;
  passwordProtected: boolean;
};

export async function issueClientCertificateAction(
  caCertId: number,
  formData: FormData,
): Promise<IssuedClientCert> {
  const session = await requireAdmin();
  const userId = Number(session.user.id);
  const commonName = String(formData.get("common_name") ?? "").trim();
  const validityDays = Math.min(
    3650,
    Math.max(1, parseInt(String(formData.get("validity_days") ?? "365"), 10) || 365),
  );
  const exportPassword = String(formData.get("export_password") ?? "");

  if (!commonName) throw new Error("Common name is required");
  if (!exportPassword) throw new Error("Export password is required");

  // The .p12 leaves this deployment as a file, and forge's PKCS#12 MAC is still SHA-1, so this
  // password is the only thing between whoever holds the bundle and the client private key. Hold
  // it to the same bar as a login password rather than accepting anything non-empty.
  const exportPasswordError = passwordPolicyError(exportPassword, "Export password");
  if (exportPasswordError) throw new Error(exportPasswordError);

  const caPrivateKeyPem = await getCaCertificatePrivateKey(caCertId);
  if (!caPrivateKeyPem)
    throw new Error("This CA has no stored private key — cannot issue client certificates");

  const caCertRecord = await import("@/src/lib/models/ca-certificates").then((m) =>
    m.getCaCertificate(caCertId),
  );
  if (!caCertRecord) throw new Error("CA certificate not found");

  const caKey = forge.pki.privateKeyFromPem(caPrivateKeyPem);
  const caCert = forge.pki.certificateFromPem(caCertRecord.certificatePem);

  const keypair = await generateForgeKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keypair.publicKey;
  cert.serialNumber = Date.now().toString(16);
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setDate(cert.validity.notBefore.getDate() + validityDays);

  cert.setSubject([{ name: "commonName", value: commonName }]);
  cert.setIssuer(caCert.subject.attributes);
  cert.setExtensions([
    { name: "basicConstraints", cA: false },
    { name: "keyUsage", digitalSignature: true, keyEncipherment: true },
    { name: "extKeyUsage", clientAuth: true },
  ]);

  cert.sign(caKey, forge.md.sha256.create());
  const certificatePem = forge.pki.certificateToPem(cert);
  const certificate = new X509Certificate(certificatePem);

  await createIssuedClientCertificate(
    {
      caCertificateId: caCertId,
      commonName: commonName,
      serialNumber: cert.serialNumber.toUpperCase(),
      fingerprintSha256: certificate.fingerprint256,
      certificatePem: certificatePem,
      validFrom: new Date(certificate.validFrom).toISOString(),
      validTo: new Date(certificate.validTo).toISOString(),
    },
    userId,
  );
  revalidatePath("/certificates");

  // AES-256 unconditionally, with forge's weak defaults (2048 iterations, 8-byte salt, SHA-1 PRF)
  // all raised: this bundle leaves the deployment as a file. `prfAlgorithm` is undeclared in
  // @types/node-forge but forwarded to pki.encryptPrivateKeyInfo; client-cert-p12-export.test.ts
  // pins the emitted PRF. The outer PKCS#12 MAC stays SHA-1 — pkcs12.js hardcodes it.
  const pkcs12Options = {
    algorithm: "aes256",
    friendlyName: commonName,
    count: 100000,
    saltSize: 16,
    prfAlgorithm: "sha256",
  } satisfies Pkcs12ExportOptions;

  const pkcs12Asn1 = forge.pkcs12.toPkcs12Asn1(
    keypair.privateKey,
    [cert, caCert],
    exportPassword,
    pkcs12Options,
  );
  const pkcs12Der = forge.asn1.toDer(pkcs12Asn1).getBytes();

  return {
    pkcs12Base64: forge.util.encode64(pkcs12Der),
    passwordProtected: true,
  };
}

export async function revokeIssuedClientCertificateAction(
  id: number,
): Promise<{ revokedAt: string }> {
  const session = await requireAdmin();
  const userId = Number(session.user.id);
  const record = await revokeIssuedClientCertificate(id, userId);
  revalidatePath("/certificates");
  return { revokedAt: record.revokedAt! };
}
