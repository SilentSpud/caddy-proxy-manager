/**
 * Verification of an OIDC back-channel logout token.
 *
 * Every case here is a check standing between an unauthenticated POST and other people's sessions
 * being deleted, so the tokens are really signed and really verified against a JWKS rather than
 * stubbed at the module boundary — a mock of `jwtVerify` would pass whatever the implementation
 * asked it to.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { vi } from '@/tests/helpers/vi';
import { clearDiscoveryCache } from '@/src/lib/oidc-claims';
import {
  clearJwksCache,
  clearLogoutJtis,
  rememberLogoutJti,
  verifyLogoutToken,
} from '@/src/lib/oidc-logout-token';

const ISSUER = 'https://idp.example';
const CLIENT_ID = 'cpm';
const LOGOUT_EVENT = 'http://schemas.openid.net/event/backchannel-logout';

const { privateKey, publicKey } = await generateKeyPair('RS256');
const jwk = { ...(await exportJWK(publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' };

const other = await generateKeyPair('RS256');

const originalFetch = globalThis.fetch;

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

/** Discovery and JWKS both come over fetch; serve them from the one stub. */
function serveIdp(): void {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes('.well-known/openid-configuration')) {
      return jsonResponse({ jwks_uri: `${ISSUER}/jwks`, userinfo_endpoint: `${ISSUER}/userinfo` });
    }
    if (url.includes('/jwks')) return jsonResponse({ keys: [jwk] });
    throw new Error(`unexpected fetch: ${url}`);
  }) as unknown as typeof fetch;
}

type Claims = Record<string, unknown>;

async function signLogoutToken(claims: Claims = {}, key = privateKey): Promise<string> {
  const {
    iss = ISSUER,
    aud = CLIENT_ID,
    events = { [LOGOUT_EVENT]: {} },
    iat,
    ...rest
  } = claims as Claims & { iss?: string; aud?: string; events?: unknown; iat?: number };

  let builder = new SignJWT({ events, ...rest })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer(iss)
    .setAudience(aud)
    .setExpirationTime('2m');
  builder = iat === undefined ? builder.setIssuedAt() : builder.setIssuedAt(iat);
  return builder.sign(key);
}

const provider = { issuer: ISSUER, clientId: CLIENT_ID };

beforeEach(() => {
  clearDiscoveryCache();
  clearJwksCache();
  clearLogoutJtis();
  serveIdp();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('verifyLogoutToken', () => {
  it('accepts a well-formed token and returns what it names', async () => {
    const token = await signLogoutToken({ sub: 'user-1', sid: 'session-9', jti: 'jti-1' });

    const result = await verifyLogoutToken(token, provider);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.claims).toEqual({
      issuer: ISSUER,
      subject: 'user-1',
      sessionId: 'session-9',
      jti: 'jti-1',
    });
  });

  it('accepts a token naming only a subject', async () => {
    const token = await signLogoutToken({ sub: 'user-1', jti: 'jti-1' });
    const result = await verifyLogoutToken(token, provider);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.claims.sessionId).toBeNull();
  });

  it('accepts a token naming only a session', async () => {
    const token = await signLogoutToken({ sid: 'session-9', jti: 'jti-1' });
    const result = await verifyLogoutToken(token, provider);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.claims.subject).toBeNull();
  });

  it('rejects a token signed by a key the issuer does not publish', async () => {
    const token = await signLogoutToken({ sub: 'user-1', jti: 'jti-1' }, other.privateKey);

    expect((await verifyLogoutToken(token, provider)).ok).toBe(false);
  });

  it('rejects a token minted for another client', async () => {
    const token = await signLogoutToken({ sub: 'user-1', jti: 'jti-1', aud: 'someone-else' });

    expect((await verifyLogoutToken(token, provider)).ok).toBe(false);
  });

  it('rejects a token from another issuer', async () => {
    const token = await signLogoutToken({
      sub: 'user-1',
      jti: 'jti-1',
      iss: 'https://evil.example',
    });

    expect((await verifyLogoutToken(token, provider)).ok).toBe(false);
  });

  it('rejects an ID token replayed as a logout token', async () => {
    // The nonce is what gives it away: it binds an ID token to an authentication request, so a
    // logout token carrying one was not minted as a logout token.
    const token = await signLogoutToken({ sub: 'user-1', jti: 'jti-1', nonce: 'n-1' });
    const result = await verifyLogoutToken(token, provider);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('nonce');
  });

  it('rejects a token whose events claim names no logout', async () => {
    const token = await signLogoutToken({ sub: 'user-1', jti: 'jti-1', events: {} });
    const result = await verifyLogoutToken(token, provider);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('events');
  });

  it('rejects a token naming neither a subject nor a session', async () => {
    const token = await signLogoutToken({ jti: 'jti-1' });
    const result = await verifyLogoutToken(token, provider);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('neither');
  });

  it('rejects a token with no jti to protect against replay with', async () => {
    const token = await signLogoutToken({ sub: 'user-1' });
    const result = await verifyLogoutToken(token, provider);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('jti');
  });

  it('rejects a token issued too long ago to still be in flight', async () => {
    const hourAgo = Math.floor(Date.now() / 1000) - 3600;
    const token = await signLogoutToken({ sub: 'user-1', jti: 'jti-1', iat: hourAgo });

    expect((await verifyLogoutToken(token, provider)).ok).toBe(false);
  });

  it('rejects a provider with no issuer to verify against', async () => {
    const token = await signLogoutToken({ sub: 'user-1', jti: 'jti-1' });
    const result = await verifyLogoutToken(token, { issuer: null, clientId: CLIENT_ID });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('issuer');
  });

  it('rejects when discovery exposes no jwks_uri', async () => {
    globalThis.fetch = (async () =>
      jsonResponse({ userinfo_endpoint: `${ISSUER}/userinfo` })) as unknown as typeof fetch;
    const token = await signLogoutToken({ sub: 'user-1', jti: 'jti-1' });
    const result = await verifyLogoutToken(token, provider);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('jwks_uri');
  });

  it('tolerates a trailing slash on the configured issuer', async () => {
    const token = await signLogoutToken({ sub: 'user-1', jti: 'jti-1' });

    expect((await verifyLogoutToken(token, { issuer: `${ISSUER}/`, clientId: CLIENT_ID })).ok).toBe(
      true,
    );
  });
});

describe('rememberLogoutJti', () => {
  it('accepts a jti once and refuses it thereafter', () => {
    expect(rememberLogoutJti(ISSUER, 'jti-1')).toBe(true);
    expect(rememberLogoutJti(ISSUER, 'jti-1')).toBe(false);
  });

  it('scopes the jti to its issuer', () => {
    expect(rememberLogoutJti(ISSUER, 'jti-1')).toBe(true);
    expect(rememberLogoutJti('https://other.example', 'jti-1')).toBe(true);
  });
});
