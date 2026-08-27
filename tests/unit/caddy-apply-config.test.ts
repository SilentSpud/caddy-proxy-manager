/**
 * End-to-end coverage of the apply path against a spoofed Caddy instance.
 *
 * Nothing here is mocked except the admin-API socket: buildCaddyDocument runs
 * for real, applyCaddyConfig runs for real, and the fake Caddy records what it
 * was sent. Before the transport seam existed these tests were impossible —
 * applyCaddyConfig could only be replaced wholesale, so its status handling and
 * error mapping had no coverage at all.
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import { vi } from '@/tests/helpers/vi';
import type { TestDb } from '../helpers/db';

const ctx = vi.hoisted(() => ({ db: null as unknown as TestDb }));

const { createTestDb } = await import('../helpers/db');
const schemaModule = await import('../../src/lib/db/schema');

vi.mock('../../src/lib/db', () => {
  ctx.db = createTestDb();
  return {
    default: ctx.db,
    sqlite: undefined,
    schema: schemaModule,
    nowIso: () => new Date().toISOString(),
    toIso: (value: string | Date | null | undefined): string | null => {
      if (!value) return null;
      return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
    },
  };
});

vi.mock('../../src/lib/audit', () => ({ logAuditEvent: vi.fn() }));

import { installFakeCaddy, type FakeCaddy } from '../helpers/caddy-admin';
import { caddyAdminRequest } from '../../src/lib/caddy-admin';
import { applyCaddyConfig } from '../../src/lib/caddy';
import { createProxyHost } from '../../src/lib/models/proxy-hosts';
import * as schema from '../../src/lib/db/schema';

let caddy: FakeCaddy;

beforeEach(async () => {
  caddy = installFakeCaddy();
  await ctx.db.delete(schema.proxyHosts);
  await ctx.db.delete(schema.users).catch(() => {});
  await ctx.db.insert(schema.users).values({
    id: 1,
    email: 'admin@example.com',
    name: 'Admin',
    role: 'admin',
    provider: 'credentials',
    subject: 'admin',
    status: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
});

describe('applyCaddyConfig against a spoofed Caddy', () => {
  it('POSTs the built document to /load', async () => {
    await createProxyHost(
      { name: 'apply', domains: ['apply.example.com'], upstreams: ['10.0.0.5:8080'] },
      1,
    );
    caddy.reset();

    await applyCaddyConfig();

    expect(caddy.loads).toHaveLength(1);
    expect(caddy.loads[0]).toMatchObject({ path: '/load', method: 'POST' });

    // The payload is the real document, not a stub: the host we just created
    // must be routable in it.
    const config = caddy.lastConfig() as never as {
      apps: { http: { servers: { cpm: { routes: { match?: { host?: string[] }[] }[] } } } };
    };
    const hosts = config.apps.http.servers.cpm.routes
      .flatMap((r) => r.match ?? [])
      .flatMap((m) => m.host ?? []);
    expect(hosts).toContain('apply.example.com');
  });

  it('throws when Caddy rejects the config', async () => {
    caddy.failWith(400, 'invalid handler');

    await expect(applyCaddyConfig()).rejects.toThrow(/Caddy config load failed: 400/);
  });

  it('maps a refused connection to an actionable error', async () => {
    caddy.failWithNetworkError('ECONNREFUSED');

    await expect(applyCaddyConfig()).rejects.toThrow(/Unable to reach Caddy API/);
  });

  it('surfaces the failure rather than swallowing it on a 5xx', async () => {
    caddy.failWith(500, 'boom');

    await expect(applyCaddyConfig()).rejects.toThrow(/Caddy config load failed: 500 boom/);
    expect(caddy.requests.some((r) => r.path === '/load')).toBe(true);
  });
});

describe('fake Caddy serves back what was loaded', () => {
  it('returns the applied config on GET /config/', async () => {
    await applyCaddyConfig();

    const response = await caddyAdminRequest({ path: '/config/', method: 'GET' });

    expect(response.status).toBe(200);
    expect(JSON.parse(response.text)).toHaveProperty('apps');
  });

  it('serves the ETag used for restart detection', async () => {
    caddy.setConfigEtag('"abc123"');

    const response = await caddyAdminRequest({ path: '/config/', method: 'GET' });

    expect(response.headers.etag).toBe('"abc123"');
  });
});

describe('the network guard', () => {
  it('refuses to use the real HTTP transport inside tests', async () => {
    const { httpCaddyAdminTransport } = await import('../../src/lib/caddy-admin');

    await expect(
      httpCaddyAdminTransport({ path: '/load', method: 'POST', body: '{}' }),
    ).rejects.toThrow(/real Caddy admin transport was used inside a test/);
  });
});
