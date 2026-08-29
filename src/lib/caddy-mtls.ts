/** mTLS helpers for Caddy TLS connection policies and HTTP-layer RBAC routes. */

/**
 * Normalise a fingerprint to Caddy's format — lowercase hex, no colons. Node gives "AB:CD:EF:…";
 * Caddy's placeholder gives "abcdef…".
 */
export function normalizeFingerprint(fp: string): string {
  return fp.replace(/:/g, "").toLowerCase();
}

/** Minimal MtlsAccessRule, redeclared here to avoid importing models (which pulls in db.ts). */
export type MtlsAccessRuleLike = {
  pathPattern: string;
  allowedRoleIds: number[];
  allowedCertIds: number[];
  denyAll: boolean;
};

/** PEM → base64 DER, the form `trusted_ca_certs` and `trusted_leaf_certs` expect. */
export function pemToBase64Der(pem: string): string {
  return pem
    .replace(/-----BEGIN CERTIFICATE-----/, "")
    .replace(/-----END CERTIFICATE-----/, "")
    .replace(/\s+/g, "");
}

/**
 * Builds a Caddy `client_authentication` block for the given domains, unioning their CA cert IDs —
 * so callers must pre-group domains sharing a CA config (`groupMtlsDomainsByCaSet`). Per CA:
 * unmanaged → trust anything it signed; managed with active certs → CA plus active leaves in
 * `trusted_leaf_certs`; all revoked → excluded. Null when no CA certs are left to trust.
 */
export function buildClientAuthentication(
  domains: string[],
  mTlsDomainMap: Map<string, number[]>,
  caCertMap: Map<number, { id: number; certificatePem: string }>,
  issuedClientCertMap: Map<number, string[]>,
  cAsWithAnyIssuedCerts: Set<number>,
  mTlsDomainLeafOverride?: Map<string, string[]>,
  mode: "require_and_verify" | "verify_if_given" | "request" = "require_and_verify",
): Record<string, unknown> | null {
  if (mode === "request") {
    return { mode: "request" };
  }

  const caCertIds = new Set<number>();
  for (const domain of domains) {
    const ids = mTlsDomainMap.get(domain.toLowerCase());
    if (ids) {
      for (const id of ids) caCertIds.add(id);
    }
  }
  if (caCertIds.size === 0) return null;

  // Check if any domain in this group uses the new cert-based model (has leaf override)
  const leafOverridePems = new Set<string>();
  let hasLeafOverride = false;
  if (mTlsDomainLeafOverride) {
    for (const domain of domains) {
      const pems = mTlsDomainLeafOverride.get(domain.toLowerCase());
      if (pems) {
        hasLeafOverride = true;
        for (const pem of pems) leafOverridePems.add(pem);
      }
    }
  }

  const trustedCaCerts: string[] = [];
  const trustedLeafCerts: string[] = [];

  if (hasLeafOverride) {
    // New cert-based model: CAs derived from the selected certs. Add them for chain
    // validation, pin to only the explicitly selected leaf certs.
    for (const id of caCertIds) {
      const ca = caCertMap.get(id);
      if (ca) trustedCaCerts.push(pemToBase64Der(ca.certificatePem));
    }
    for (const pem of leafOverridePems) {
      trustedLeafCerts.push(pemToBase64Der(pem));
    }
  } else {
    // Legacy CA-based model
    for (const id of caCertIds) {
      const ca = caCertMap.get(id);
      if (!ca) continue;

      if (cAsWithAnyIssuedCerts.has(id)) {
        const activeLeafCerts = issuedClientCertMap.get(id) ?? [];
        trustedCaCerts.push(pemToBase64Der(ca.certificatePem));
        if (activeLeafCerts.length === 0) {
          // All certs revoked — pin the CA cert itself as a leaf. No client cert can hash-match a
          // CA cert, so this rejects everyone while keeping a valid client_authentication block.
          trustedLeafCerts.push(pemToBase64Der(ca.certificatePem));
        } else {
          for (const certPem of activeLeafCerts) {
            trustedLeafCerts.push(pemToBase64Der(certPem));
          }
        }
      } else {
        trustedCaCerts.push(pemToBase64Der(ca.certificatePem));
      }
    }
  }

  if (trustedCaCerts.length === 0) return null;

  const result: Record<string, unknown> = {
    mode,
    trusted_ca_certs: trustedCaCerts,
  };
  if (trustedLeafCerts.length > 0) result.trusted_leaf_certs = trustedLeafCerts;
  return result;
}

export function buildValidClientCertCelExpression(): string {
  return "{http.request.tls.client.fingerprint} != ''";
}

/**
 * Groups mTLS domains by sorted CA ID fingerprint, so each group gets its own TLS policy with an
 * isolated trust set — a cert from CA_B cannot authenticate against a host that configured CA_A.
 */
export function groupMtlsDomainsByCaSet(
  domains: string[],
  mTlsDomainMap: Map<string, number[]>,
): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const domain of domains) {
    const ids = mTlsDomainMap.get(domain.toLowerCase()) ?? [];
    const key = [...ids].sort((a, b) => a - b).join(",");
    const group = groups.get(key) ?? [];
    group.push(domain);
    groups.set(key, group);
  }
  return groups;
}

// ── mTLS RBAC HTTP-layer route enforcement ───────────────────────────

/**
 * One access rule's allowed fingerprints: the union of active certs holding an allowed role and
 * directly-allowed cert IDs.
 */
export function resolveAllowedFingerprints(
  rule: MtlsAccessRuleLike,
  roleFingerprintMap: Map<number, Set<string>>,
  certFingerprintMap: Map<number, string>,
): Set<string> {
  const allowed = new Set<string>();

  for (const roleId of rule.allowedRoleIds) {
    const fps = roleFingerprintMap.get(roleId);
    if (fps) {
      for (const fp of fps) allowed.add(fp);
    }
  }

  for (const certId of rule.allowedCertIds) {
    const fp = certFingerprintMap.get(certId);
    if (fp) allowed.add(fp);
  }

  return allowed;
}

/** A CEL expression testing the client fingerprint against the allowed set. */
export function buildFingerprintCelExpression(fingerprints: Set<string>): string {
  const fps = Array.from(fingerprints).sort();
  const quoted = fps.map((fp) => `'${fp}'`).join(", ");
  return `{http.request.tls.client.fingerprint} in [${quoted}]`;
}

/**
 * Subroutes enforcing a host's path-based mTLS RBAC at the HTTP layer; null when there are no
 * rules. Per rule: a path+fingerprint allow route, then a path-only 403. A catch-all afterwards
 * admits any valid cert.
 */
export function buildMtlsRbacSubroutes(
  accessRules: MtlsAccessRuleLike[],
  roleFingerprintMap: Map<number, Set<string>>,
  certFingerprintMap: Map<number, string>,
  baseHandlers: Record<string, unknown>[],
  reverseProxyHandler: Record<string, unknown>,
  requireValidClientCertByDefault = false,
  defaultAllowedFingerprints?: Set<string>,
): Record<string, unknown>[] | null {
  if (accessRules.length === 0) return null;

  const subroutes: Record<string, unknown>[] = [];

  // Rules are already sorted by priority desc, path asc
  for (const rule of accessRules) {
    if (rule.denyAll) {
      // Explicit deny: any request matching this path gets 403
      subroutes.push({
        match: [{ path: [rule.pathPattern] }],
        handle: [
          {
            handler: "static_response",
            status_code: "403",
            body: "mTLS access denied",
          },
        ],
        terminal: true,
      });
      continue;
    }

    const allowedFps = resolveAllowedFingerprints(rule, roleFingerprintMap, certFingerprintMap);

    if (allowedFps.size === 0) {
      // Rule exists but no certs match → deny all for this path
      subroutes.push({
        match: [{ path: [rule.pathPattern] }],
        handle: [
          {
            handler: "static_response",
            status_code: "403",
            body: "mTLS access denied",
          },
        ],
        terminal: true,
      });
      continue;
    }

    // Allow route: path + fingerprint CEL match
    const celExpr = buildFingerprintCelExpression(allowedFps);
    subroutes.push({
      match: [{ path: [rule.pathPattern], expression: celExpr }],
      handle: [...baseHandlers, reverseProxyHandler],
      terminal: true,
    });

    // Deny route: path matches but fingerprint didn't → 403
    subroutes.push({
      match: [{ path: [rule.pathPattern] }],
      handle: [
        {
          handler: "static_response",
          status_code: "403",
          body: "mTLS access denied",
        },
      ],
      terminal: true,
    });
  }

  if (requireValidClientCertByDefault) {
    const defaultExpression =
      defaultAllowedFingerprints && defaultAllowedFingerprints.size > 0
        ? buildFingerprintCelExpression(defaultAllowedFingerprints)
        : buildValidClientCertCelExpression();

    subroutes.push({
      match: [{ expression: defaultExpression }],
      handle: [...baseHandlers, reverseProxyHandler],
      terminal: true,
    });
    subroutes.push({
      handle: [
        {
          handler: "static_response",
          status_code: "403",
          body: "mTLS access denied",
        },
      ],
      terminal: true,
    });
  } else {
    // Catch-all: paths without explicit rules → any valid cert gets through
    subroutes.push({
      handle: [...baseHandlers, reverseProxyHandler],
      terminal: true,
    });
  }

  return subroutes;
}
