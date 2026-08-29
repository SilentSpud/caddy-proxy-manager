/**
 * Claim resolution for OIDC providers driving group-based roles. better-auth's `getUserInfo` stops
 * once the ID token has `sub` and `email`, so groups exposed only on userinfo never surface — with
 * group mapping on we read the ID token and fall back to userinfo.
 */

import { readClaim } from "./oidc-groups";

export type OidcTokens = {
  idToken?: string | null;
  accessToken?: string | null;
};

export type ClaimSourceConfig = {
  issuer: string | null;
  userinfoUrl: string | null;
};

/** Discovery documents change rarely; cache them briefly to avoid a fetch per sign-in. */
const DISCOVERY_TTL_MS = 10 * 60 * 1000;
const discoveryCache = new Map<string, { userinfoUrl: string | null; expiresAt: number }>();

/** Exposed for tests — discovery results are process-wide state. */
export function clearDiscoveryCache(): void {
  discoveryCache.clear();
}

/** Decodes a JWT payload without verifying it. */
export function decodeJwtPayload(token: string | null | undefined): Record<string, unknown> | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
    const decoded = Buffer.from(padded, "base64").toString("utf8");
    const parsed: unknown = JSON.parse(decoded);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Decoded, never verified — it came over the back-channel exchange, as better-auth trusts it. */
async function discoverUserinfoUrl(issuer: string): Promise<string | null> {
  const discoveryUrl = `${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`;
  const cached = discoveryCache.get(discoveryUrl);
  if (cached && cached.expiresAt > Date.now()) return cached.userinfoUrl;

  let userinfoUrl: string | null = null;
  try {
    const response = await fetch(discoveryUrl, { headers: { Accept: "application/json" } });
    if (response.ok) {
      const doc = (await response.json()) as Record<string, unknown>;
      const endpoint = doc.userinfo_endpoint;
      if (typeof endpoint === "string" && endpoint) userinfoUrl = endpoint;
    }
  } catch (error) {
    console.warn("[oidc-claims] OIDC discovery failed for", discoveryUrl, error);
  }

  discoveryCache.set(discoveryUrl, { userinfoUrl, expiresAt: Date.now() + DISCOVERY_TTL_MS });
  return userinfoUrl;
}

export async function resolveUserinfoUrl(cfg: ClaimSourceConfig): Promise<string | null> {
  if (cfg.userinfoUrl) return cfg.userinfoUrl;
  if (cfg.issuer) return discoverUserinfoUrl(cfg.issuer);
  return null;
}

async function fetchUserinfoClaims(
  cfg: ClaimSourceConfig,
  accessToken: string,
): Promise<Record<string, unknown> | null> {
  const url = await resolveUserinfoUrl(cfg);
  if (!url) return null;
  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    });
    if (!response.ok) {
      console.warn(`[oidc-claims] userinfo request failed with status ${response.status}`);
      return null;
    }
    const body: unknown = await response.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) return null;
    return body as Record<string, unknown>;
  } catch (error) {
    console.warn("[oidc-claims] userinfo request failed:", error);
    return null;
  }
}

/**
 * The full claim set for a sign-in: ID token claims, plus userinfo when the group claim is absent.
 * userinfo wins on conflict, being the fresher profile.
 */
export async function fetchOidcClaims(
  cfg: ClaimSourceConfig,
  tokens: OidcTokens,
  groupsClaim: string,
): Promise<Record<string, unknown> | null> {
  const idTokenClaims = decodeJwtPayload(tokens.idToken) ?? {};
  let claims: Record<string, unknown> = { ...idTokenClaims };

  const hasGroups = readClaim(claims, groupsClaim) !== undefined;
  const needsUserinfo = !hasGroups || !claims.sub || !claims.email;
  if (needsUserinfo && tokens.accessToken) {
    const userinfo = await fetchUserinfoClaims(cfg, tokens.accessToken);
    if (userinfo) claims = { ...claims, ...userinfo };
  }

  if (!claims.sub || typeof claims.email !== "string") return null;
  return claims;
}

/** Shapes claims for better-auth's generic-OAuth plugin, keeping the raw claims alongside. */
export function toOAuthUserInfo(claims: Record<string, unknown>): Record<string, unknown> {
  return {
    ...claims,
    id: String(claims.sub),
    email: claims.email,
    emailVerified: claims.email_verified === true,
    image: typeof claims.picture === "string" ? claims.picture : undefined,
    name:
      typeof claims.name === "string"
        ? claims.name
        : typeof claims.preferred_username === "string"
          ? claims.preferred_username
          : undefined,
  };
}
