/**
 * A forward-auth server for the generic forward-auth functional tests, standing in for Authelia.
 *
 * Two endpoints, because the two behaviours a real auth server has are what the routes are built
 * around:
 *
 *  - /api/authz/forward-auth answers like Authelia: 200 with the Remote-* identity headers for a
 *    valid session cookie, a 302 to its portal for a browser without one, and 401 for anything
 *    else. A host with the API split off relies on this to tell the two apart at all.
 *  - /api/always-redirect answers every unauthenticated caller with the 302, whatever it looks
 *    like. That is the case the split exists for: turning that redirect into a 401 is CPM's job,
 *    not the auth server's.
 *
 * Reachable inside the test network as "mock-forward-auth:9091".
 */
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
    'Remote-IP': '10.0.0.1',
  };
}

function isBrowserRequest(req) {
  const accept = req.headers.accept || '';
  const requestedWith = req.headers['x-requested-with'] || '';
  return accept.includes('text/html') && requestedWith.length === 0;
}

function redirectTarget(req) {
  const original = `http://${req.headers['x-forwarded-host'] || 'unknown'}${req.headers['x-forwarded-uri'] || '/'}`;
  return `${PORTAL_URL}?rd=${encodeURIComponent(original)}`;
}

function send(res, status, headers, body) {
  res.writeHead(status, headers);
  res.end(body || '');
}

function handleAuth(req, res, mode) {
  if ((req.headers.cookie || '').includes(VALID_COOKIE)) {
    send(res, 200, identityHeaders());
    return;
  }
  if (mode === 'always-redirect' || isBrowserRequest(req)) {
    send(res, 302, { Location: redirectTarget(req) }, 'Redirecting to portal');
    return;
  }
  send(
    res,
    401,
    { 'Content-Type': 'application/json' },
    JSON.stringify({ status: '401', message: 'Unauthenticated' }),
  );
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
