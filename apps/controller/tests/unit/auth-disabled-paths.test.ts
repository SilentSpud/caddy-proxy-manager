/**
 * Better Auth serves every endpoint it has unless told otherwise, and several of them change a
 * credential behind the app's back: its change-password updates `accounts` but not the
 * `users.passwordHash` sign-in verifies, with only its own 8-character minimum. The username probe
 * enumerates accounts for anyone. Driven through a real instance, so the paths are proven to match
 * the way Better Auth normalizes them rather than merely listed.
 */
import { describe, expect, it } from 'bun:test';
import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { username } from 'better-auth/plugins';
import { DISABLED_AUTH_PATHS } from '@/src/lib/auth-disabled-paths';

const ORIGIN = 'http://localhost:3000';

const auth = betterAuth({
  database: memoryAdapter({}),
  secret: 'test-secret-long-enough-for-better-auth-0123456789abcdef',
  baseURL: ORIGIN,
  basePath: '/api/auth',
  emailAndPassword: { enabled: true },
  disabledPaths: DISABLED_AUTH_PATHS,
  plugins: [username()],
});

function call(path: string, method: 'GET' | 'POST' = 'POST') {
  return auth.handler(
    new Request(`${ORIGIN}/api/auth${path}`, {
      method,
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      body:
        method === 'POST'
          ? JSON.stringify({ username: 'admin', currentPassword: 'a', newPassword: 'b' })
          : undefined,
    }),
  );
}

describe('Better Auth endpoints the app replaces', () => {
  it('answers 404 for each of them', async () => {
    for (const path of DISABLED_AUTH_PATHS) {
      expect((await call(path)).status, path).toBe(404);
    }
  });

  it('covers the password, profile, unlink and enumeration endpoints', () => {
    for (const path of [
      '/change-password',
      '/update-user',
      '/change-email',
      '/delete-user',
      '/unlink-account',
      '/is-username-available',
    ]) {
      expect(DISABLED_AUTH_PATHS).toContain(path);
    }
  });

  it('still serves an endpoint left enabled', async () => {
    // Guards the first case: an instance answering 404 to everything would pass it too.
    expect((await call('/ok', 'GET')).status).toBe(200);
  });
});
