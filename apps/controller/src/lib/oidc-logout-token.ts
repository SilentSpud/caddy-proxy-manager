/**
 * Validation of an OIDC Back-Channel Logout token (OpenID Connect Back-Channel Logout 1.0, §2.4).
 *
 * The IdP POSTs this JWT to CPM when it ends a session its own way — an admin revoking access, a
 * sign-out at another relying party, an account being disabled. It arrives server-to-server with
 * no browser and no cookie, so the token's signature is the only thing vouching for it: every
 * check below is load-bearing, and a token failing any of them tells us nothing about who to log
 * out. That is why this returns a reason rather than throwing — the caller answers 400 and says
 * which check failed, which is the difference between debugging an IdP integration in minutes and
 * staring at an opaque rejection.
 */

import { createRemoteJWKSet, jwtVerify } from "jose";
import { resolveJwksUri } from "./oidc-claims";

/** The event URI a logout token must carry, per §2.4. */
const BACKCHANNEL_LOGOUT_EVENT = "http://schemas.openid.net/event/backchannel-logout";

/** How far in the past an `iat` may be. The token is delivered immediately; this is clock slack. */
const MAX_TOKEN_AGE_SECONDS = 5 * 60;

export type LogoutTokenClaims = {
  issuer: string;
  /** The IdP's subject. Absent when the token identifies a session and not a user. */
  subject: string | null;
  /** The IdP's session id. Absent when the token identifies a user and not one session. */
  sessionId: string | null;
  jti: string;
};

export type LogoutTokenResult =
  | { ok: true; claims: LogoutTokenClaims }
  | { ok: false; reason: string };

/** JWKS fetching is cached by `jose`; one set per URI keeps that cache alive across requests. */
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

/** Exposed for tests — the JWKS sets are process-wide state. */
export function clearJwksCache(): void {
  jwksCache.clear();
}

function jwksFor(uri: string): ReturnType<typeof createRemoteJWKSet> {
  let set = jwksCache.get(uri);
  if (!set) {
    set = createRemoteJWKSet(new URL(uri));
    jwksCache.set(uri, set);
  }
  return set;
}

function hasLogoutEvent(events: unknown): boolean {
  // A JSON object whose single member is the event URI. The value is required to be an object too,
  // but providers vary on what they put in it, so only the key is checked.
  if (!events || typeof events !== "object" || Array.isArray(events)) return false;
  return Object.hasOwn(events as Record<string, unknown>, BACKCHANNEL_LOGOUT_EVENT);
}

/**
 * Verify a logout token against one provider's issuer, client id and signing keys.
 *
 * `issuer` and `clientId` come from the CPM provider row, never from the token: they are what the
 * operator configured, and checking a token against values it supplied itself would check nothing.
 */
export async function verifyLogoutToken(
  token: string,
  provider: { issuer: string | null; clientId: string },
): Promise<LogoutTokenResult> {
  if (!token) return { ok: false, reason: "no logout_token was supplied" };
  if (!provider.issuer) return { ok: false, reason: "the provider has no issuer configured" };

  const jwksUri = await resolveJwksUri(provider.issuer);
  if (!jwksUri) {
    return { ok: false, reason: "the provider's discovery document exposes no jwks_uri" };
  }

  let payload: Record<string, unknown>;
  try {
    const verified = await jwtVerify(token, jwksFor(jwksUri), {
      // Exactly as configured, trailing slash and all. An issuer identifier is compared by simple
      // string equality (OIDC Core §2), and several providers — Authentik among them — issue an
      // `iss` that ends in one: trimming it here rejected every token they send.
      issuer: provider.issuer,
      audience: provider.clientId,
      maxTokenAge: MAX_TOKEN_AGE_SECONDS,
      // Signed, never encrypted, and never unsecured: `alg: "none"` is rejected by `jose` already,
      // but pinning the family keeps a provider from downgrading to a MAC over a shared secret.
      algorithms: ["RS256", "RS384", "RS512", "ES256", "ES384", "ES512", "PS256", "PS384", "PS512"],
    });
    payload = verified.payload as Record<string, unknown>;
  } catch (error) {
    return { ok: false, reason: `signature or claim check failed: ${describe(error)}` };
  }

  // §2.6: a logout token carrying a nonce is a rejected token, not a tolerated one. The claim is
  // how an ID token is bound to an authentication request, and its presence here means whoever
  // built this was replaying one.
  if (payload.nonce !== undefined) {
    return { ok: false, reason: "a logout token must not carry a nonce" };
  }

  if (!hasLogoutEvent(payload.events)) {
    return { ok: false, reason: "the events claim does not name a back-channel logout" };
  }

  if (typeof payload.iat !== "number") {
    return { ok: false, reason: "the token has no iat" };
  }

  const subject = typeof payload.sub === "string" && payload.sub ? payload.sub : null;
  const sessionId = typeof payload.sid === "string" && payload.sid ? payload.sid : null;
  if (!subject && !sessionId) {
    return { ok: false, reason: "the token identifies neither a subject nor a session" };
  }

  // Replay protection needs something to key on, and `jti` is what the spec provides.
  const jti = typeof payload.jti === "string" && payload.jti ? payload.jti : null;
  if (!jti) return { ok: false, reason: "the token has no jti" };

  return {
    ok: true,
    claims: { issuer: provider.issuer, subject, sessionId, jti },
  };
}

/**
 * Replay protection (§2.6): a `jti` is accepted once per issuer, for as long as the token it came
 * on could still verify.
 *
 * In memory, like the discovery and pending-sync caches beside it. Replaying a logout token can
 * only log someone out a second time — it grants nothing — so the cost of a second app instance
 * keeping its own set is a duplicated revocation, not a hole. Returns false when the jti was
 * already seen.
 */
const seenJtis = new Map<string, number>();

export function rememberLogoutJti(issuer: string, jti: string): boolean {
  const now = Date.now();
  for (const [key, expiresAt] of seenJtis) {
    if (expiresAt <= now) seenJtis.delete(key);
  }
  const key = `${issuer}\u0000${jti}`;
  if (seenJtis.has(key)) return false;
  seenJtis.set(key, now + MAX_TOKEN_AGE_SECONDS * 1000);
  return true;
}

/** Exposed for tests — the replay set is process-wide state. */
export function clearLogoutJtis(): void {
  seenJtis.clear();
}

function describe(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return error instanceof Error ? error.message : "unknown error";
}
