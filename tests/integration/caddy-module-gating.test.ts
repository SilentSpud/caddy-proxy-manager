/**
 * What buildCaddyDocument emits once a module is switched off. Caddy validates a posted config as
 * one document, so a handler naming an absent module takes every host offline — the handler must
 * not appear at all. The Caddyfile escape hatch is covered too: an unadaptable snippet is skipped.
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import { vi } from '@/tests/helpers/vi';
import { fresh } from '@/tests/helpers/fresh';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TestDb } from '../helpers/db';

const ctx = vi.hoisted(() => {
  const { mkdirSync } = require('node:fs');
  const { join: joinPath } = require('node:path');
  const { tmpdir } = require('node:os');
  const dir = joinPath(tmpdir(), `caddy-gating-test-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  process.env.L4_PORTS_DIR = dir;
  return { db: null as unknown as TestDb, tmpDir: dir };
});

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

// caddy-build resolves its data directory once, when the module is first
// evaluated — before this file's body sets L4_PORTS_DIR above. Evaluate a
// second copy now and point the plain specifier at it, so buildCaddyDocument
// gates on the applied-module record this test writes.
const freshCaddyBuild = await import(`../../src/lib/caddy-build${fresh()}`);
vi.mock('../../src/lib/caddy-build', () => ({ ...freshCaddyBuild }));

import { setCaddyAdminTransport, type CaddyAdminRequest } from '../../src/lib/caddy-admin';
import { buildCaddyDocument } from '../../src/lib/caddy';
import { CADDY_MODULES } from '../../src/lib/caddy-modules';
import {
  saveCaddyBuildSettings,
  saveGeoBlockSettings,
  saveWafSettings,
  type GeoBlockSettings,
} from '../../src/lib/settings';
import { createProxyHost } from '../../src/lib/models/proxy-hosts';
import { createL4ProxyHost } from '../../src/lib/models/l4-proxy-hosts';
import * as schema from '../../src/lib/db/schema';

const APPLIED_PATH = join(ctx.tmpDir, 'caddy-build.applied.json');
const ALL_MODULE_PATHS = CADDY_MODULES.map((m) => m.modulePath);

const GEOBLOCK: GeoBlockSettings = {
  enabled: true,
  block_countries: ['CN'],
  block_continents: [],
  block_asns: [],
  block_cidrs: [],
  block_ips: [],
  allow_countries: [],
  allow_continents: [],
  allow_asns: [],
  allow_cidrs: [],
  allow_ips: [],
  trusted_proxies: [],
  fail_closed: false,
  response_status: 403,
  response_body: 'Forbidden',
  response_headers: {},
  redirect_url: '',
};

/**
 * Pretend a rebuild already completed with exactly these module paths — i.e.
 * write the sidecar's post-build record, not the pre-build compose override.
 */
function setAppliedModules(specs: string[]) {
  writeFileSync(APPLIED_PATH, JSON.stringify({ modules: specs.join(' ') }), 'utf-8');
}

/** Select every catalog module except the named ids. */
async function selectAllModulesExcept(...disabledIds: string[]) {
  await saveCaddyBuildSettings({
    modules: Object.fromEntries(CADDY_MODULES.map((m) => [m.id, !disabledIds.includes(m.id)])),
    customModules: [],
  });
}

let adaptRequests: CaddyAdminRequest[] = [];

/** Answer /adapt with one static_response route; other paths behave as Caddy would. */
function installAdapter(options: { failAdapt?: boolean } = {}) {
  adaptRequests = [];
  setCaddyAdminTransport(async (request) => {
    if (request.path === '/adapt') {
      adaptRequests.push(request);
      if (options.failAdapt) {
        return {
          status: 400,
          text: JSON.stringify({ error: 'unrecognized directive: madeup' }),
          headers: {},
        };
      }
      return {
        status: 200,
        text: JSON.stringify({
          result: {
            apps: {
              http: {
                servers: {
                  srv0: {
                    routes: [
                      {
                        match: [{ path: ['/status*'] }],
                        handle: [{ handler: 'static_response', body: 'ok' }],
                      },
                    ],
                  },
                },
              },
            },
          },
        }),
        headers: {},
      };
    }
    return { status: 200, text: '{}', headers: {} };
  });
}

/** Every handler name appearing anywhere in the document. */
function handlerNames(document: unknown): string[] {
  const found: string[] = [];
  const walk = (node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node && typeof node === 'object') {
      const record = node as Record<string, unknown>;
      if (typeof record.handler === 'string') found.push(record.handler);
      Object.values(record).forEach(walk);
    }
  };
  walk(document);
  return found;
}

beforeEach(async () => {
  rmSync(APPLIED_PATH, { force: true });
  installAdapter();
  await ctx.db.delete(schema.proxyHosts);
  await ctx.db.delete(schema.l4ProxyHosts);
  await ctx.db.delete(schema.settings);
  await ctx.db.delete(schema.users).catch(() => {});
  await ctx.db.insert(schema.users).values({
    id: 1,
    email: 'admin@example.com',
    name: 'Admin',
    role: 'admin',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
});

async function createHost(overrides: Record<string, unknown> = {}) {
  return await createProxyHost(
    {
      name: 'app',
      domains: ['app.example.com'],
      upstreams: ['backend:8080'],
      ...overrides,
    } as never,
    1,
  );
}

describe('geoblock gating', () => {
  it('emits the blocker handler when the module is selected and built', async () => {
    setAppliedModules(ALL_MODULE_PATHS);
    await selectAllModulesExcept();
    await saveGeoBlockSettings(GEOBLOCK);
    await createHost();

    expect(handlerNames(await buildCaddyDocument())).toContain('blocker');
  });

  it('omits the blocker handler once the module is deselected', async () => {
    setAppliedModules(ALL_MODULE_PATHS);
    await selectAllModulesExcept('caddy-blocker');
    await saveGeoBlockSettings(GEOBLOCK);
    await createHost();

    expect(handlerNames(await buildCaddyDocument())).not.toContain('blocker');
  });

  it('omits the blocker handler when it is selected but not yet compiled in', async () => {
    // Enabling a module does not put it in the running binary — only a rebuild
    // does. Emitting the handler in between would fail the whole config.
    setAppliedModules(ALL_MODULE_PATHS.filter((p) => !p.includes('caddy-blocker-plugin')));
    await selectAllModulesExcept();
    await saveGeoBlockSettings(GEOBLOCK);
    await createHost();

    expect(handlerNames(await buildCaddyDocument())).not.toContain('blocker');
  });

  it('leaves the rest of the host config intact when geoblocking is dropped', async () => {
    setAppliedModules(ALL_MODULE_PATHS);
    await selectAllModulesExcept('caddy-blocker');
    await saveGeoBlockSettings(GEOBLOCK);
    await createHost();

    // The point of gating rather than failing: unrelated hosts keep serving.
    expect(handlerNames(await buildCaddyDocument())).toContain('reverse_proxy');
  });
});

describe('WAF gating', () => {
  const WAF = {
    enabled: true,
    mode: 'On' as const,
    load_owasp_crs: true,
    custom_directives: '',
  };

  it('emits the waf handler when Coraza is selected and built', async () => {
    setAppliedModules(ALL_MODULE_PATHS);
    await selectAllModulesExcept();
    await saveWafSettings(WAF);
    await createHost();

    expect(handlerNames(await buildCaddyDocument())).toContain('waf');
  });

  it('omits the waf handler once Coraza is deselected', async () => {
    setAppliedModules(ALL_MODULE_PATHS);
    await selectAllModulesExcept('coraza-waf');
    await saveWafSettings(WAF);
    await createHost();

    expect(handlerNames(await buildCaddyDocument())).not.toContain('waf');
  });
});

describe('layer 4 gating', () => {
  beforeEach(async () => {
    await createL4ProxyHost(
      {
        name: 'db',
        listenAddress: ':5432',
        protocol: 'tcp',
        upstreams: ['db:5432'],
        matcherType: 'none',
        matcherValue: [],
      } as never,
      1,
    );
  });

  it('emits the layer4 app when caddy-l4 is selected and built', async () => {
    setAppliedModules(ALL_MODULE_PATHS);
    await selectAllModulesExcept();

    const document = (await buildCaddyDocument()) as { apps: Record<string, unknown> };
    expect(document.apps.layer4).toBeDefined();
  });

  it('omits the whole layer4 app once caddy-l4 is deselected', async () => {
    // There is no partial version of this: without the plugin there is no
    // `layer4` key for Caddy to unmarshal, so the key must be absent entirely.
    setAppliedModules(ALL_MODULE_PATHS);
    await selectAllModulesExcept('caddy-l4');

    const document = (await buildCaddyDocument()) as { apps: Record<string, unknown> };
    expect(document.apps.layer4).toBeUndefined();
  });
});

describe('per-host Caddyfile', () => {
  it('adapts the snippet and nests it in a subroute before the reverse proxy', async () => {
    setAppliedModules(ALL_MODULE_PATHS);
    await selectAllModulesExcept();
    await createHost({ customCaddyfile: 'handle /status* {\n  respond "ok" 200\n}' });

    const document = await buildCaddyDocument();
    // A subroute, not flattened handlers — the adapted route carries its own
    // path matcher and flattening would apply it to every request.
    expect(handlerNames(document)).toContain('subroute');
    expect(handlerNames(document)).toContain('reverse_proxy');
    // Matched on the adapted body rather than the handler name: static_response
    // also shows up for the unrelated HTTP-to-HTTPS redirect route.
    expect(JSON.stringify(document)).toContain('"body":"ok"');
  });

  it('skips a snippet that no longer adapts instead of failing the build', async () => {
    setAppliedModules(ALL_MODULE_PATHS);
    await selectAllModulesExcept();
    // Saved while it was valid, then the plugin it used was switched off.
    await createHost({ customCaddyfile: 'handle /status* {\n  respond "ok" 200\n}' });

    installAdapter({ failAdapt: true });
    const document = await buildCaddyDocument();

    // One host's stale escape hatch must not take the other hosts down, and
    // must not block the very edit needed to fix it.
    expect(handlerNames(document)).toContain('reverse_proxy');
    expect(JSON.stringify(document)).not.toContain('"body":"ok"');
  });

  it('does not call the adapter for hosts without a snippet', async () => {
    setAppliedModules(ALL_MODULE_PATHS);
    await selectAllModulesExcept();
    await createHost();

    await buildCaddyDocument();
    expect(adaptRequests).toHaveLength(0);
  });
});
