/**
 * Regression (H5): dashboard sign-in relied on better-auth's limiter alone, keyed on whatever single
 * X-Forwarded-For value the client sent, with no per-account counter.
 */
import { beforeEach, describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { vi } from '@/tests/helpers/vi';
import { testTranslator } from '@/tests/helpers/next-intl';

const ctx = vi.hoisted(() => ({
  seen: [] as Request[],
  status: 401,
}));

vi.mock('@/src/lib/auth-server', () => ({
  getAuth: async () => ({
    handler: async (request: Request) => {
      ctx.seen.push(request);
      return new Response(null, { status: ctx.status });
    },
  }),
}));

vi.mock('next-intl/server', () => ({
  getTranslations: async (namespace?: string) => testTranslator(namespace),
}));

import { GET, POST } from '@/src/app/api/auth/[...all]/route';
import { CLIENT_IP_HEADER } from '@/src/lib/client-ip';
import { accountKey, resetAccountFailures } from '@/src/lib/rate-limit';

function signIn(body: Record<string, string>, headers: Record<string, string> = {}) {
  return POST(
    new Request('http://localhost:3000/api/auth/sign-in/username', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  ctx.seen = [];
  ctx.status = 401;
  resetAccountFailures(accountKey('alice'));
});

describe('/api/auth route', () => {
  it('replaces a client-sent client-IP header before better-auth reads it', async () => {
    await GET(
      new Request('http://localhost:3000/api/auth/get-session', {
        headers: { [CLIENT_IP_HEADER]: '6.6.6.6', 'x-forwarded-for': '203.0.113.9' },
      }),
    );
    expect(ctx.seen[0]?.headers.get(CLIENT_IP_HEADER)).toBe('203.0.113.9');

    await GET(
      new Request('http://localhost:3000/api/auth/get-session', {
        headers: { [CLIENT_IP_HEADER]: '6.6.6.6' },
      }),
    );
    expect(ctx.seen[1]?.headers.has(CLIENT_IP_HEADER)).toBe(false);
  });

  it('passes the body through intact', async () => {
    await signIn({ username: 'alice', password: 'pw' });
    expect(await ctx.seen[0]?.json()).toEqual({ username: 'alice', password: 'pw' });
  });

  it('backs off an account after repeated failures, from any address', async () => {
    for (let i = 0; i < 6; i++) {
      const response = await signIn(
        { username: 'alice', password: `wrong-${i}` },
        { 'x-forwarded-for': `203.0.113.${i}` },
      );
      expect(response.status).toBe(401);
    }

    const blocked = await signIn(
      { username: 'ALICE', password: 'another' },
      { 'x-forwarded-for': '198.51.100.99' },
    );
    expect(blocked.status).toBe(429);
    expect(ctx.seen).toHaveLength(6);
    expect(blocked.headers.get('retry-after')).toBe('1');
  });

  it('resets the account on a successful sign-in', async () => {
    for (let i = 0; i < 5; i++) await signIn({ username: 'alice', password: 'wrong' });
    ctx.status = 200;
    await signIn({ username: 'alice', password: 'right' });
    ctx.status = 401;
    expect((await signIn({ username: 'alice', password: 'wrong' })).status).toBe(401);
    expect((await signIn({ username: 'alice', password: 'wrong' })).status).toBe(401);
  });

  it('points better-auth at the header this route sets', () => {
    const source = readFileSync(`${import.meta.dir}/../../src/lib/auth-server.ts`, 'utf8');
    expect(source).toContain(`ipAddressHeaders: ["${CLIENT_IP_HEADER}"]`);
  });
});
