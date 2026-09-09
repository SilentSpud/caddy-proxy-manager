/**
 * The GraphQL API, executed against a real database.
 *
 * Two things are worth proving here and nowhere else.
 *
 * **Parity.** A GraphQL mutation and the `/api/v1/` route it stands beside call the same model
 * function, so they must produce the same row. The tests below write through GraphQL and read back
 * through the model the REST route uses - if a resolver ever starts doing its own validation or
 * shaping, that is where it shows up.
 *
 * **The gate.** Management is admin-only, including for an operator, because a group grant
 * delegates the dashboard and not the API. That rule is one line in each resolver and exactly the
 * kind of line that gets forgotten on the next one added, so it is asserted per operation rather
 * than once.
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import { vi } from '@/tests/helpers/vi';
import type { TestDb } from '../helpers/db';

const ctx = vi.hoisted(() => ({ db: null as unknown as TestDb }));

const { createTestDb } = await import('../helpers/db');
const schemaModule = await import('../../src/lib/db/schema');

ctx.db = await createTestDb();

vi.mock('../../src/lib/db', () => {
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

import { graphql } from 'graphql';
import { schema } from '../../src/lib/graphql/schema';
import type { GraphQLContext } from '../../src/lib/graphql/context';
import { listProxyHosts } from '../../src/lib/models/proxy-hosts';
import * as dbSchema from '../../src/lib/db/schema';

/**
 * A context with the viewer already decided.
 *
 * The real one authenticates a Bearer token or a session; that path belongs to api-auth and is
 * tested there. What these tests need is the answer, so they can vary the role.
 */
function contextFor(role: string | null): GraphQLContext {
  const viewer = async () => {
    if (!role) throw new Error('Unauthorized');
    return { userId: 1, role, authMethod: 'bearer' as const };
  };
  return {
    viewer,
    access: async () => ({
      userId: 1,
      role: role ?? '',
      isAdmin: role === 'admin',
      isOperator: role === 'operator',
      grants: { proxyHosts: new Map(), l4ProxyHosts: new Map(), agents: new Map() },
    }),
    // Nothing here signs a request; the agent fields are covered by their own tests.
    rawBody: async () => '',
    request: {} as never,
  };
}

async function run(
  document: string,
  role: string | null,
  variableValues?: Record<string, unknown>,
) {
  return await graphql({
    schema,
    source: document,
    contextValue: contextFor(role),
    variableValues,
  });
}

beforeEach(async () => {
  await ctx.db.delete(dbSchema.proxyHosts);
  await ctx.db.delete(dbSchema.users).catch(() => {});
  await ctx.db.insert(dbSchema.users).values({
    id: 1,
    email: 'admin@example.com',
    name: 'Admin',
    role: 'admin',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
});

describe('the GraphQL schema', () => {
  it('exposes the resources the REST API covers', async () => {
    const result = await run('{ __schema { queryType { fields { name } } } }', 'admin');

    const names = (
      result.data as { __schema: { queryType: { fields: { name: string }[] } } }
    ).__schema.queryType.fields.map((f) => f.name);

    // Not an exhaustive list - a spot check that the big resources are reachable, so a schema that
    // silently lost a query fails here rather than in somebody's client.
    expect(names).toContain('proxyHosts');
    expect(names).toContain('l4ProxyHosts');
    expect(names).toContain('certificates');
    expect(names).toContain('users');
    expect(names).toContain('auditLog');
  });
});

describe('reading through GraphQL', () => {
  it('returns what the model returns', async () => {
    const created = await run(
      'mutation ($input: JSON!) { createProxyHost(input: $input) { id name domains } }',
      'admin',
      { input: { name: 'app', domains: ['app.example.com'], upstreams: ['backend:8080'] } },
    );
    expect(created.errors).toBeUndefined();

    const query = await run('{ proxyHosts { id name domains upstreams enabled } }', 'admin');
    const hosts = (query.data as { proxyHosts: { name: string; domains: string[] }[] }).proxyHosts;

    expect(hosts).toHaveLength(1);
    expect(hosts[0].name).toBe('app');
    expect(hosts[0].domains).toEqual(['app.example.com']);

    // The same row the REST route would have served.
    const viaModel = await listProxyHosts();
    expect(viaModel).toHaveLength(1);
    expect(viaModel[0].name).toBe(hosts[0].name);
  });

  it('puts the configuration the models validate into config', async () => {
    await run('mutation ($input: JSON!) { createProxyHost(input: $input) { id } }', 'admin', {
      input: { name: 'app', domains: ['app.example.com'], upstreams: ['backend:8080'] },
    });

    const result = await run('{ proxyHosts { config } }', 'admin');
    const config = (result.data as { proxyHosts: { config: Record<string, unknown> }[] })
      .proxyHosts[0].config;

    // Everything the type does not name is still reachable, rather than being dropped on the way
    // out - which is the whole justification for the JSON scalar.
    expect(config).toHaveProperty('locationRules');
    expect(config).toHaveProperty('geoblockMode');
    // ...and nothing promoted to a real field is duplicated inside it.
    expect(config).not.toHaveProperty('name');
    expect(config).not.toHaveProperty('domains');
  });
});

describe('writing through GraphQL', () => {
  it('validates with the model, not the resolver', async () => {
    // A host with no domains is refused by createProxyHost. The resolver adds no validation of its
    // own, so the message a GraphQL client sees is the model's.
    const result = await run(
      'mutation ($input: JSON!) { createProxyHost(input: $input) { id } }',
      'admin',
      { input: { name: 'broken', domains: [], upstreams: ['backend:8080'] } },
    );

    expect(result.errors).toBeDefined();
    expect(await listProxyHosts()).toHaveLength(0);
  });

  it('round-trips an update', async () => {
    const created = await run(
      'mutation ($input: JSON!) { createProxyHost(input: $input) { id } }',
      'admin',
      { input: { name: 'app', domains: ['app.example.com'], upstreams: ['backend:8080'] } },
    );
    const id = (created.data as { createProxyHost: { id: number } }).createProxyHost.id;

    const updated = await run(
      'mutation ($id: Int!, $input: JSON!) { updateProxyHost(id: $id, input: $input) { name } }',
      'admin',
      { id, input: { name: 'renamed', domains: ['app.example.com'], upstreams: ['backend:8080'] } },
    );

    expect(updated.errors).toBeUndefined();
    expect((await listProxyHosts())[0].name).toBe('renamed');
  });

  it('deletes', async () => {
    const created = await run(
      'mutation ($input: JSON!) { createProxyHost(input: $input) { id } }',
      'admin',
      { input: { name: 'app', domains: ['app.example.com'], upstreams: ['backend:8080'] } },
    );
    const id = (created.data as { createProxyHost: { id: number } }).createProxyHost.id;

    const result = await run('mutation ($id: Int!) { deleteProxyHost(id: $id) }', 'admin', { id });

    expect(result.errors).toBeUndefined();
    expect(await listProxyHosts()).toHaveLength(0);
  });
});

describe('the admin gate', () => {
  const cases: [string, string][] = [
    ['proxyHosts', '{ proxyHosts { id } }'],
    ['users', '{ users { id } }'],
    ['auditLog', '{ auditLog { total } }'],
    ['certificates', '{ certificates { id } }'],
    ['createProxyHost', 'mutation { createProxyHost(input: {}) { id } }'],
    ['deleteProxyHost', 'mutation { deleteProxyHost(id: 1) }'],
    ['applyCaddyConfig', 'mutation { applyCaddyConfig }'],
  ];

  for (const [name, document] of cases) {
    it(`refuses ${name} to a non-admin`, async () => {
      // An operator too: grants delegate the dashboard, not the API. That is the rule the REST
      // layer documents, and the one most likely to be forgotten on a newly added resolver.
      for (const role of ['user', 'viewer', 'operator']) {
        const result = await run(document, role);
        expect(result.errors?.[0]?.message, `${name} as ${role}`).toContain(
          'Administrator privileges required',
        );
      }
    });
  }

  it('lets any signed-in role manage its own API tokens', async () => {
    // Deliberately not admin-gated, matching /api/v1/tokens: a viewer's token is how a viewer uses
    // the API at all.
    const result = await run('{ apiTokens { id name } }', 'viewer');
    expect(result.errors).toBeUndefined();
  });

  it('refuses everything to an unauthenticated caller', async () => {
    const result = await run('{ proxyHosts { id } }', null);
    expect(result.errors?.[0]?.message).toContain('Unauthorized');
  });
});
