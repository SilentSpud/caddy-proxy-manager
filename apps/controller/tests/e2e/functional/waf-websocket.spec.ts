/**
 * Issue #195, "Websockets mangled by WAF": coraza wraps the response writer, breaking the
 * `101 Switching Protocols` hijack and leaking the body out with no status line. The fix routes
 * upgrades around the handler. Upstream: traefik/whoami's /echo. Domain: func-waf-ws.test
 */
import { test, expect } from '@playwright/test';
import { createProxyHost } from '../../helpers/proxy-api';
import { httpGet, waitForRoute, wsHandshake } from '../../helpers/http';

const DOMAIN = 'func-waf-ws.test';

test.describe
  .serial('WAF + WebSocket (issue #195)', () => {
    test('setup: create proxy host with WAF enabled, websocket-capable upstream', async ({
      page,
    }) => {
      await createProxyHost(page, {
        name: 'Functional WAF WebSocket Test',
        domain: DOMAIN,
        upstream: 'whoami-server:80',
        enableWaf: true,
      });
      await waitForRoute(DOMAIN);
    });

    test('WebSocket upgrade through WAF returns 101 Switching Protocols (not mangled HTTP/0.9)', async () => {
      const res = await wsHandshake(DOMAIN, '/echo');
      // The bug produced statusCode 0 (no parseable HTTP status line) or a closed
      // connection with raw body. A correct handshake yields 101.
      expect(res.statusCode, `handshake response: ${JSON.stringify(res.raw)}`).toBe(101);
      expect(res.statusLine).toMatch(/HTTP\/1\.1 101/);
      expect(res.headers.upgrade?.toLowerCase()).toBe('websocket');
      expect(res.headers.connection?.toLowerCase()).toContain('upgrade');
      expect(res.headers['sec-websocket-accept']).toBeTruthy();
    });

    test('ordinary HTTP request through the same WAF host still passes', async () => {
      const res = await httpGet(DOMAIN, '/');
      expect(res.status).toBe(200);
    });

    test('WAF still blocks attacks on the same host (bypass is scoped to WS upgrades only)', async () => {
      // XSS <script> tag — CRS rule 941xxx. Proves the WebSocket bypass did not
      // disable WAF inspection for normal (non-upgrade) requests.
      const res = await httpGet(DOMAIN, '/page?q=%3Cscript%3Ealert(1)%3C%2Fscript%3E');
      expect(res.status).toBe(403);
    });
  });
