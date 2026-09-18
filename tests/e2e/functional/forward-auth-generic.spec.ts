/**
 * Functional tests: Generic Forward Auth provider (Authelia etc.) — issue #188.
 *
 * Creates proxy hosts backed by a mock forward-auth server (tests/mock-forward-auth)
 * and verifies through real Caddy:
 *
 *  Host A — "always redirect" provider + apiSplit + X-Api-Key bypass:
 *   - Browser requests (Accept: text/html) get the auth server's 302 portal redirect
 *   - API requests get a bare 401 (Caddy converts the auth server's 3xx redirect)
 *   - WebSocket handshakes get 401 (they cannot follow login redirects)
 *   - Requests carrying X-Api-Key skip forward auth and reach the upstream
 *   - A spoofed Remote-User header is stripped before reaching the upstream,
 *     on both bypassed and excluded routes
 *   - A valid session cookie authenticates; identity headers from the auth
 *     response reach the upstream
 *
 *  Host B — Authelia-style endpoint, unified (no apiSplit): the auth server
 *   itself negotiates browser (302) vs API (401), Caddy passes both through.
 *
 * Domain: func-fwd-auth-generic.test / func-fwd-auth-authelia.test
 */
import { test, expect } from '@playwright/test';
import { httpGet, waitForStatus, wsHandshake } from '../../helpers/http';

const BASE_URL = 'http://localhost:3000';
const API = `${BASE_URL}/api/v1`;
const HOST_A = 'func-fwd-auth-generic.test';
const HOST_B = 'func-fwd-auth-authelia.test';
const BROWSER_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
const VALID_SESSION_COOKIE = 'authelia_session=valid-session';
const PORTAL_PREFIX = 'http://auth-portal.test:9091/';

let hostAId: number;
let hostBId: number;

test.describe.serial('Generic Forward Auth', () => {
  test('setup: create split host (always-redirect provider, X-Api-Key bypass)', async ({ page }) => {
    const res = await page.request.post(`${API}/proxy-hosts`, {
      data: {
        name: 'Generic FA Split',
        domains: [HOST_A],
        upstreams: ['whoami-server:80'],
        sslForced: false,
        forwardAuth: {
          enabled: true,
          provider: 'custom',
          authUpstream: 'http://mock-forward-auth:9091',
          authEndpoint: '/api/always-redirect',
          copyHeaders: ['Remote-User', 'Remote-Groups', 'Remote-Email', 'Remote-Name', 'Remote-IP'],
          apiSplit: true,
          apiBypassHeaders: ['X-Api-Key'],
          excludedPaths: ['/public/*'],
        },
      },
      headers: { 'Content-Type': 'application/json', 'Origin': BASE_URL },
    });
    expect(res.status()).toBe(201);
    const host = await res.json();
    hostAId = host.id;
    expect(host.forwardAuth).not.toBeNull();
    expect(host.forwardAuth.apiSplit).toBe(true);

    // API-shaped requests (no Accept header) should get 401 once config lands.
    await waitForStatus(HOST_A, 401, 25_000);
  });

  test('setup: create Authelia-style host (unified, no apiSplit)', async ({ page }) => {
    const res = await page.request.post(`${API}/proxy-hosts`, {
      data: {
        name: 'Generic FA Authelia',
        domains: [HOST_B],
        upstreams: ['whoami-server:80'],
        sslForced: false,
        forwardAuth: {
          enabled: true,
          provider: 'authelia',
          authUpstream: 'http://mock-forward-auth:9091',
          authEndpoint: '/api/authz/forward-auth',
        },
      },
      headers: { 'Content-Type': 'application/json', 'Origin': BASE_URL },
    });
    expect(res.status()).toBe(201);
    const host = await res.json();
    hostBId = host.id;
    // Authelia preset defaults applied by the model.
    expect(host.forwardAuth.copyHeaders).toContain('Remote-User');

    await waitForStatus(HOST_B, 401, 25_000);
  });

  test('split host: browser request gets the portal redirect', async () => {
    const res = await httpGet(HOST_A, '/dashboard', { Accept: BROWSER_ACCEPT });
    expect(res.status).toBe(302);
    expect(String(res.headers['location'])).toContain(PORTAL_PREFIX);
  });

  test('split host: API request gets 401, not a redirect', async () => {
    const res = await httpGet(HOST_A, '/api/v1/status');
    expect(res.status).toBe(401);
    expect(res.body).toContain('Unauthorized');
    expect(res.headers['location']).toBeUndefined();
  });

  test('split host: API request carrying X-Requested-With also gets 401', async () => {
    const res = await httpGet(HOST_A, '/api/v1/status', { Accept: BROWSER_ACCEPT, 'X-Requested-With': 'XMLHttpRequest' });
    expect(res.status).toBe(401);
  });

  test('split host: WebSocket handshake gets 401 instead of a redirect', async () => {
    const ws = await wsHandshake(HOST_A, '/echo');
    expect(ws.statusCode).toBe(401);
  });

  test('split host: X-Api-Key request bypasses forward auth and reaches upstream', async () => {
    const res = await httpGet(HOST_A, '/api/machine', { 'X-Api-Key': 'secret-key-123' });
    expect(res.status).toBe(200);
    // traefik/whoami answers with a body that includes the container hostname.
    expect(res.body).toContain('Hostname:');
  });

  test('split host: spoofed Remote-User is stripped on the bypassed route', async () => {
    const res = await httpGet(HOST_A, '/api/machine', {
      'X-Api-Key': 'secret-key-123',
      'Remote-User': 'mallory',
      'Remote-Groups': 'admins',
    });
    expect(res.status).toBe(200);
    expect(res.body).toContain('Hostname:');
    expect(res.body).not.toContain('mallory');
    expect(res.body).not.toContain('Remote-Groups: admins');
  });

  test('split host: spoofed Remote-User is stripped on the excluded route', async () => {
    const res = await httpGet(HOST_A, '/public/asset', {
      'Remote-User': 'mallory',
    });
    expect(res.status).toBe(200);
    expect(res.body).not.toContain('mallory');
  });

  test('split host: valid session authenticates and identity headers reach the upstream', async () => {
    const res = await httpGet(HOST_A, '/protected', { Cookie: VALID_SESSION_COOKIE });
    expect(res.status).toBe(200);
    expect(res.body).toContain('Remote-User: alice');
    expect(res.body).toContain('Remote-Groups: admins,users');
  });

  test('authelia host: browser request gets server-side portal redirect', async () => {
    const res = await httpGet(HOST_B, '/', { Accept: BROWSER_ACCEPT });
    expect(res.status).toBe(302);
    expect(String(res.headers['location'])).toContain(PORTAL_PREFIX);
  });

  test('authelia host: API request gets server-side 401', async () => {
    const res = await httpGet(HOST_B, '/');
    expect(res.status).toBe(401);
  });

  test('authelia host: valid session authenticates and identity headers reach the upstream', async () => {
    const res = await httpGet(HOST_B, '/', { Cookie: VALID_SESSION_COOKIE });
    expect(res.status).toBe(200);
    expect(res.body).toContain('Remote-User: alice');
  });

  test('cleanup: delete both hosts', async ({ page }) => {
    for (const id of [hostAId, hostBId]) {
      if (id) {
        const res = await page.request.delete(`${API}/proxy-hosts/${id}`, {
          headers: { 'Origin': BASE_URL },
        });
        expect(res.status()).toBe(200);
      }
    }
  });
});
