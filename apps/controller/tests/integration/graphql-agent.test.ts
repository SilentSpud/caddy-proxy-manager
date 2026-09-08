/**
 * The agent protocol, as GraphQL.
 *
 * The transport changed; the conversation did not. An agent subscribes and receives `hello`, then
 * desired state, then commands and pings; it reports back with mutations. These tests drive the
 * schema directly rather than over HTTP, because what is worth pinning is the protocol and the
 * gate — the SSE framing belongs to the GraphQL server and is its to get right.
 *
 * The gate is the part that would be quiet if it broke. Agent fields and operator fields live in
 * one schema, separated only by which credential the resolver insists on, so "a user token cannot
 * drive an agent field" and "a signed agent cannot read proxy hosts" are asserted rather than
 * assumed.
 */
import { describe, it, expect, afterEach } from 'bun:test';
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

// The signature check belongs to agent/verify and is tested there. What these tests vary is its
// answer, so they can drive a verified agent and an unverified one.
const verified = { ok: true as const, agent: { id: 1, agentId: 'a1', name: 'edge' } };
let verifyResult: unknown = verified;
vi.mock('../../src/lib/agent/verify', () => ({
  verifyAgentRequest: async () => verifyResult,
}));

// Desired state is built from the database; what it contains is agent-fleet's business.
vi.mock('../../src/lib/agent/desired-state', () => ({
  buildDesiredState: async () => ({
    l4Ports: [],
    caddyModules: [],
    services: { services: { clickhouse: false, geoipupdate: false }, env: {} },
    fleetConfig: { clickhouse: null, geoip: null },
    caddyEnabled: true,
  }),
}));

import { graphql, subscribe, parse } from 'graphql';
import type { ExecutionResult } from 'graphql';
import { schema } from '../../src/lib/graphql/schema';
import type { GraphQLContext } from '../../src/lib/graphql/context';
import { AGENT_OPERATIONS } from '@cpm/shared';
import { connectedAgents, detach, isConnected } from '../../src/lib/agent/registry';

function agentContext(): GraphQLContext {
  return {
    // An agent presents no user credential at all; every operator field must refuse it.
    viewer: async () => {
      throw new Error('Unauthorized');
    },
    access: async () => {
      throw new Error('Unauthorized');
    },
    rawBody: async () => '{}',
    request: { headers: new Headers() } as never,
  };
}

function userContext(role: string): GraphQLContext {
  return {
    viewer: async () => ({ userId: 1, role, authMethod: 'bearer' as const }),
    access: async () => ({
      userId: 1,
      role,
      isAdmin: role === 'admin',
      isOperator: false,
      grants: { proxyHosts: new Map(), l4ProxyHosts: new Map(), agents: new Map() },
    }),
    rawBody: async () => '{}',
    request: { headers: new Headers() } as never,
  };
}

afterEach(() => {
  verifyResult = verified;
  detach('a1');
});

describe('the agent subscription', () => {
  it('opens with hello and the desired state, in that order', async () => {
    const result = await subscribe({
      schema,
      document: parse(AGENT_OPERATIONS.events),
      contextValue: agentContext(),
    });

    // A refusal would come back as a single ExecutionResult rather than an iterator.
    expect(Symbol.asyncIterator in result).toBe(true);
    const iterator = result as AsyncIterableIterator<ExecutionResult>;

    const first = (await iterator.next()).value?.data?.agentEvents as { type: string };
    const second = (await iterator.next()).value?.data?.agentEvents as { type: string };

    expect(first.type).toBe('hello');
    expect(second.type).toBe('desired-state');

    // Ending the consumer is what detaches the agent, which is how a disconnect is noticed at all.
    expect(isConnected('a1')).toBe(true);
    await iterator.return?.();
    expect(isConnected('a1')).toBe(false);
  });

  it('refuses an agent whose signature does not verify', async () => {
    verifyResult = { ok: false, status: 401, error: 'Unknown agent' };

    const result = (await subscribe({
      schema,
      document: parse(AGENT_OPERATIONS.events),
      contextValue: agentContext(),
    })) as ExecutionResult;

    expect(result.errors?.[0]?.message).toBe('Unknown agent');
    expect(isConnected('a1')).toBe(false);
  });
});

describe('the agent mutations', () => {
  async function connect() {
    const result = (await subscribe({
      schema,
      document: parse(AGENT_OPERATIONS.events),
      contextValue: agentContext(),
    })) as AsyncIterableIterator<ExecutionResult>;
    await result.next();
    return result;
  }

  const status = {
    agentId: 'a1',
    version: 'test',
    mode: 'standalone',
    composeProject: 'cpm',
    l4Ports: { applied: [], status: { state: 'idle' } },
    caddyBuild: { applied: null, status: { state: 'idle' } },
    services: { applied: null, status: { state: 'idle' } },
    analytics: { enabled: false, accessLogPresent: false },
  };

  it('records a status from a connected agent', async () => {
    const iterator = await connect();

    const result = await graphql({
      schema,
      source: AGENT_OPERATIONS.status,
      contextValue: agentContext(),
      variableValues: { status },
    });

    expect(result.errors).toBeUndefined();
    expect(connectedAgents().find((a) => a.agentId === 'a1')?.status).toMatchObject({
      agentId: 'a1',
    });
    await iterator.return?.();
  });

  it('refuses a status from an agent with no open subscription', async () => {
    // Accepting it would let the dashboard report a host as reachable when nothing can reach it.
    const result = await graphql({
      schema,
      source: AGENT_OPERATIONS.status,
      contextValue: agentContext(),
      variableValues: { status },
    });

    expect(result.errors?.[0]?.message).toContain('not connected');
  });
});

describe('the two credentials do not cross over', () => {
  it('refuses agent fields to a user token', async () => {
    // A signed agent is the only thing that may drive these, however privileged the user is.
    verifyResult = { ok: false, status: 401, error: 'Unknown agent' };

    const result = await graphql({
      schema,
      source: AGENT_OPERATIONS.status,
      contextValue: userContext('admin'),
      variableValues: { status: {} },
    });

    expect(result.errors?.[0]?.message).toBe('Unknown agent');
  });

  it('refuses operator fields to an agent', async () => {
    // The agent context carries no user at all, so the ordinary API is closed to it — an agent
    // secret is not a way to read the configuration of every host.
    const result = await graphql({
      schema,
      source: '{ proxyHosts { id } }',
      contextValue: agentContext(),
    });

    expect(result.errors?.[0]?.message).toContain('Unauthorized');
  });
});
