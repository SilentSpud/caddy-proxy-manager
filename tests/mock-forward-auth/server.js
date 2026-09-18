/**
 * Mock forward-auth server for the generic forward-auth functional tests
 * (tests/e2e/functional/forward-auth-generic.spec.ts).
 *
 * Mimics the two Authelia authorization behaviors plus a "generic" provider
 * that always redirects:
 *
 *  - /api/authz/forward-auth  — Authelia-style: 200 + Remote-* identity
 *    headers for a valid session cookie; otherwise 302 to the portal for
 *    browser-shaped requests (Accept contains text/html, no X-Requested-With)
 *    and 401 for API-shaped requests.
 *  - /api/always-redirect     — generic provider whose single endpoint always
 *    302-redirects unauthenticated callers (valid sessions still get 200 + headers).
 *
 * Reachable inside the test docker network as "mock-forward-auth:9091".
 */
/* eslint-disable @typescript-eslint/no-require-imports, no-undef */
const http = require('node:http');

const PORT = 9091;
const PORTAL_URL = 'http://auth-portal.test:9091/';
const VALID_COOKIE = 'authelia_session=valid-session';

function identityHeaders() {
  return {
    'Remote-User': 'alice',
    'Remote-Groups': 'admins,users',
    'Remote-Email': 'alice@example.com',
    'Remote-Name': 'Alice Example',
    'Remote-IP': '10.0.0.1'
  };
}

function isBrowserRequest(req) {
  const accept = req.headers['accept'] || '';
  const xhr = req.headers['x-requested-with'] || '';
  return accept.includes('text/html') && xhr.length === 0;
}

function send(res, status, headers, body) {
  res.writeHead(status, headers);
  res.end(body || '');
}

function handleAuth(req, res, mode) {
  const cookie = req.headers['cookie'] || '';
  if (cookie.includes(VALID_COOKIE)) {
    send(res, 200, identityHeaders());
    return;
  }

  if (mode === 'always-redirect') {
    const target = `${PORTAL_URL}?rd=${encodeURIComponent(`http://${req.headers['x-forwarded-host'] || 'unknown'}${req.headers['x-forwarded-uri'] || '/'}`)}`;
    send(res, 302, { Location: target }, 'Redirecting to portal');
    return;
  }

  if (isBrowserRequest(req)) {
    const target = `${PORTAL_URL}?rd=${encodeURIComponent(`http://${req.headers['x-forwarded-host'] || 'unknown'}${req.headers['x-forwarded-uri'] || '/'}`)}`;
    send(res, 302, { Location: target }, 'Redirecting to portal');
    return;
  }

  send(res, 401, { 'Content-Type': 'application/json' }, JSON.stringify({ status: '401', message: 'Unauthenticated' }));
}

const server = http.createServer((req, res) => {
  const path = (req.url || '/').split('?')[0];
  if (path === '/api/authz/forward-auth') {
    handleAuth(req, res, 'authelia');
    return;
  }
  if (path === '/api/always-redirect') {
    handleAuth(req, res, 'always-redirect');
    return;
  }
  if (path === '/health') {
    send(res, 200, { 'Content-Type': 'application/json' }, JSON.stringify({ status: 'ok' }));
    return;
  }
  send(res, 404, {}, 'not found');
});

server.listen(PORT, () => {
  console.log(`mock-forward-auth listening on :${PORT}`);
});
