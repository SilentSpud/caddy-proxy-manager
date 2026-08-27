/**
 * Regression: the identity headers a forward-auth host copies from the verify
 * response onto the upstream request must be read back with a placeholder
 * spelled in Go's canonical MIME casing.
 *
 * Caddy resolves `{http.reverse_proxy.header.<name>}` by indexing the response
 * header map with the literal name from the placeholder, and Go stores that map
 * under the canonical key. So `{http.reverse_proxy.header.X-CPM-User}` resolves
 * to nothing while `{...X-Cpm-User}` resolves to the value. Because each copy
 * route is guarded by `not vars <placeholder> ""`, an unresolvable placeholder
 * does not merely copy the wrong text — the guard matches the empty string, the
 * route is skipped, and the header is never set at all.
 *
 * The symptom is silent and total: every application behind CPM forward auth
 * receives an anonymous request. Found by the docker integration suite
 * (docker-tests/suite/tests/60-forward-auth.sh), which asserts it end to end.
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

import { createProxyHost } from '../../src/lib/models/proxy-hosts';
import { buildCaddyDocument } from '../../src/lib/caddy';
import { canonicalHeaderName } from '../../src/lib/caddy-utils';
import * as schema from '../../src/lib/db/schema';

const UPSTREAM = '10.0.0.5:8080';
const PLACEHOLDER = /\{http\.reverse_proxy\.header\.([^}]+)\}/g;

/** Every `{http.reverse_proxy.header.X}` name appearing anywhere in the doc. */
function placeholderNames(doc: unknown): string[] {
  const names: string[] = [];
  const json = JSON.stringify(doc);
  for (const match of json.matchAll(PLACEHOLDER)) {
    names.push(match[1]);
  }
  return names;
}

/** Every `handle_response` copy route: its set-key and the two placeholders. */
type CopyRoute = { setKey: string; setValue: string; matchKey: string };

function copyRoutes(node: unknown, out: CopyRoute[] = []): CopyRoute[] {
  if (Array.isArray(node)) {
    for (const item of node) copyRoutes(item, out);
    return out;
  }
  if (!node || typeof node !== 'object') return out;

  const obj = node as Record<string, unknown>;
  const handle = obj.handle as Array<Record<string, unknown>> | undefined;
  const match = obj.match as Array<Record<string, unknown>> | undefined;
  const set = handle?.[0]?.request as { set?: Record<string, string[]> } | undefined;
  const notClause = match?.[0]?.not as Array<{ vars?: Record<string, string[]> }> | undefined;
  const vars = notClause?.[0]?.vars;

  if (set?.set && vars) {
    const [setKey, setValues] = Object.entries(set.set)[0] ?? [];
    const [matchKey] = Object.keys(vars);
    if (setKey && setValues && matchKey) {
      out.push({ setKey, setValue: setValues[0], matchKey });
    }
  }

  for (const value of Object.values(obj)) copyRoutes(value, out);
  return out;
}

beforeEach(async () => {
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

describe('canonicalHeaderName', () => {
  it('folds an all-caps segment to Go MIME casing', () => {
    expect(canonicalHeaderName('X-CPM-User')).toBe('X-Cpm-User');
    expect(canonicalHeaderName('X-CPM-User-Id')).toBe('X-Cpm-User-Id');
  });

  it('leaves an already canonical name alone', () => {
    expect(canonicalHeaderName('X-Authentik-Meta-Jwks')).toBe('X-Authentik-Meta-Jwks');
  });

  it('normalises lower-case and mixed input', () => {
    expect(canonicalHeaderName('x-forwarded-for')).toBe('X-Forwarded-For');
    expect(canonicalHeaderName('X-fOrWaRdEd-hOsT')).toBe('X-Forwarded-Host');
  });

  it('tolerates empty segments rather than dropping them', () => {
    expect(canonicalHeaderName('X--Weird')).toBe('X--Weird');
  });
});

describe('CPM forward auth — identity header copy', () => {
  it('reads every header back through a canonically spelled placeholder', async () => {
    await createProxyHost(
      {
        name: 'fa-copy',
        domains: ['app.example.com'],
        upstreams: [UPSTREAM],
        cpmForwardAuth: { enabled: true },
      },
      1,
    );

    const doc = await buildCaddyDocument();
    const names = placeholderNames(doc);

    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(name).toBe(canonicalHeaderName(name));
    }
  });

  it('copies all four identity headers', async () => {
    await createProxyHost(
      {
        name: 'fa-copy-all',
        domains: ['app.example.com'],
        upstreams: [UPSTREAM],
        cpmForwardAuth: { enabled: true },
      },
      1,
    );

    const routes = copyRoutes(await buildCaddyDocument());
    const copied = routes.map((r) => r.setKey.toLowerCase()).sort();

    expect(copied).toEqual(['x-cpm-email', 'x-cpm-groups', 'x-cpm-user', 'x-cpm-user-id']);
  });

  it('guards each copy with the same placeholder it copies', async () => {
    await createProxyHost(
      {
        name: 'fa-copy-guard',
        domains: ['app.example.com'],
        upstreams: [UPSTREAM],
        cpmForwardAuth: { enabled: true },
      },
      1,
    );

    const routes = copyRoutes(await buildCaddyDocument());
    expect(routes.length).toBe(4);

    for (const route of routes) {
      // A guard that reads a different placeholder from the value it protects
      // would drop the header whenever the two disagree.
      expect(route.matchKey).toBe(route.setValue);
      expect(route.setValue).toBe(`{http.reverse_proxy.header.${route.setKey}}`);
    }
  });
});

describe('Authentik forward auth — identity header copy', () => {
  it('canonicalises operator-supplied header names', async () => {
    await createProxyHost(
      {
        name: 'authentik-copy',
        domains: ['app.example.com'],
        upstreams: [UPSTREAM],
        authentik: {
          enabled: true,
          outpostDomain: 'outpost.goauthentik.io',
          outpostUpstream: 'authentik:9000',
          // Deliberately non-canonical: an operator typing the header the way
          // Authentik's docs write it must not silently lose the value.
          copyHeaders: ['X-AUTHENTIK-USERNAME', 'x-authentik-email'],
        },
      },
      1,
    );

    const doc = await buildCaddyDocument();
    for (const name of placeholderNames(doc)) {
      expect(name).toBe(canonicalHeaderName(name));
    }

    const routes = copyRoutes(doc);
    const copied = routes.map((r) => r.setKey).sort();
    expect(copied).toEqual(['X-Authentik-Email', 'X-Authentik-Username']);
    for (const route of routes) {
      expect(route.matchKey).toBe(route.setValue);
    }
  });
});
