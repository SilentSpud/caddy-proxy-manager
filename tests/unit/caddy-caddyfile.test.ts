/**
 * Per-host Caddyfile snippets, adapted through the Caddy admin API.
 *
 * The adapter itself is Caddy's, so what needs covering here is everything
 * around it: how the snippet is framed before being sent, what is extracted
 * from the result, and how failures are reported — a snippet that parses but is
 * silently dropped is the worst outcome, because the proxy rule the operator
 * wrote simply stops existing.
 */
import { describe, it, expect, beforeEach } from 'bun:test';

import { setCaddyAdminTransport, type CaddyAdminRequest } from '@/src/lib/caddy-admin';
import {
  CaddyfileAdaptError,
  adaptCaddyfileSnippet,
  buildCaddyfileSubrouteHandler,
  validateCaddyfileSnippet,
} from '@/src/lib/caddy-caddyfile';

let requests: CaddyAdminRequest[] = [];

/** Install a transport that answers /adapt with a canned response. */
function installAdapter(respond: (req: CaddyAdminRequest) => { status: number; text: string }) {
  requests = [];
  setCaddyAdminTransport(async (request) => {
    requests.push(request);
    const { status, text } = respond(request);
    return { status, text, headers: {} };
  });
}

/** The shape Caddy's /adapt returns for a `:80 { ... }` site block. */
function adaptedOk(
  routes: unknown[],
  extraApps: Record<string, unknown> = {},
  warnings: unknown[] = [],
) {
  return {
    status: 200,
    text: JSON.stringify({
      result: { apps: { http: { servers: { srv0: { routes } } }, ...extraApps } },
      warnings,
    }),
  };
}

beforeEach(() => {
  installAdapter(() => adaptedOk([]));
});

describe('adaptCaddyfileSnippet', () => {
  it('sends the snippet to /adapt as a Caddyfile, wrapped in a site block', async () => {
    // Caddy's adapter needs a complete Caddyfile; :80 is used because it
    // produces no host matcher of its own for this app to strip back out.
    await adaptCaddyfileSnippet('respond "hi" 200');

    expect(requests).toHaveLength(1);
    expect(requests[0].path).toBe('/adapt');
    expect(requests[0].method).toBe('POST');
    expect(requests[0].contentType).toBe('text/caddyfile');
    expect(requests[0].body).toBe(':80 {\nrespond "hi" 200\n}\n');
  });

  it('does not call Caddy at all for an empty snippet', async () => {
    const result = await adaptCaddyfileSnippet('   \n  ');
    expect(requests).toHaveLength(0);
    expect(result.routes).toEqual([]);
  });

  it('collects routes from every adapted server', async () => {
    installAdapter(() => ({
      status: 200,
      text: JSON.stringify({
        result: {
          apps: {
            http: {
              servers: {
                srv0: { routes: [{ handle: [{ handler: 'static_response' }] }] },
                srv1: { routes: [{ handle: [{ handler: 'headers' }] }] },
              },
            },
          },
        },
      }),
    }));

    const { routes } = await adaptCaddyfileSnippet('respond "hi" 200');
    expect(routes).toHaveLength(2);
  });

  it('reports app keys it cannot honour at host scope', async () => {
    // A `tls` directive in a per-host snippet does nothing — TLS is configured
    // at the server level. Saying so beats leaving the operator to wonder.
    installAdapter(() => adaptedOk([], { tls: { automation: {} } }));

    const { ignoredApps } = await adaptCaddyfileSnippet('tls internal');
    expect(ignoredApps).toEqual(['tls']);
  });

  it("surfaces Caddy's own parse error verbatim", async () => {
    // Caddy names the line and the directive; nothing this layer could
    // synthesise would be as useful.
    installAdapter(() => ({
      status: 400,
      text: JSON.stringify({ error: 'Caddyfile:2: unrecognized directive: respondd' }),
    }));

    await expect(adaptCaddyfileSnippet('respondd "hi"')).rejects.toThrow(
      /unrecognized directive: respondd/,
    );
    await expect(adaptCaddyfileSnippet('respondd "hi"')).rejects.toBeInstanceOf(
      CaddyfileAdaptError,
    );
  });

  it('fails clearly when the response is not JSON at all', async () => {
    installAdapter(() => ({ status: 502, text: '<html>Bad Gateway</html>' }));
    await expect(adaptCaddyfileSnippet('respond "hi" 200')).rejects.toThrow(/unreadable response/);
  });

  it('passes adapter warnings through with their line numbers', async () => {
    installAdapter(() => adaptedOk([], {}, [{ message: 'deprecated directive', line: 3 }]));
    const { warnings } = await adaptCaddyfileSnippet('something');
    expect(warnings).toEqual(['line 3: deprecated directive']);
  });
});

describe('buildCaddyfileSubrouteHandler', () => {
  it('wraps routes in a subroute so their matchers survive', () => {
    // Flattening the handlers out would drop each route's own matcher, applying
    // a path-scoped directive to every request the host serves.
    const routes = [{ match: [{ path: ['/api/*'] }], handle: [{ handler: 'headers' }] }];
    expect(buildCaddyfileSubrouteHandler(routes)).toEqual({ handler: 'subroute', routes });
  });

  it('emits nothing when the snippet produced no routes', () => {
    expect(buildCaddyfileSubrouteHandler([])).toBeNull();
  });
});

describe('validateCaddyfileSnippet', () => {
  it('accepts a snippet Caddy can adapt', async () => {
    expect(await validateCaddyfileSnippet('respond "hi" 200')).toBeNull();
  });

  it('accepts an empty snippet', async () => {
    expect(await validateCaddyfileSnippet('')).toBeNull();
  });

  it('returns the parse error as a message rather than throwing', async () => {
    installAdapter(() => ({ status: 400, text: JSON.stringify({ error: 'bad syntax' }) }));
    expect(await validateCaddyfileSnippet('nope {')).toBe('bad syntax');
  });

  it('rejects directives that reach beyond HTTP routes', async () => {
    installAdapter(() => adaptedOk([], { layer4: {} }));
    expect(await validateCaddyfileSnippet('...')).toMatch(/may only produce HTTP routes/);
  });

  it('does not blame the operator when Caddy is unreachable', async () => {
    // A transport failure is an infrastructure problem. Reporting it as a
    // syntax error would send someone hunting a typo that is not there, and
    // would block saving a host for reasons unrelated to what they typed.
    setCaddyAdminTransport(async () => {
      throw new Error('connect ECONNREFUSED');
    });
    expect(await validateCaddyfileSnippet('respond "hi" 200')).toBeNull();
  });
});
