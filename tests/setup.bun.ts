import { beforeEach } from 'bun:test';
import { installFakeCaddy } from './helpers/caddy-admin';
import { clearDotEnv } from './helpers/env';
import { vi } from './helpers/vi';

/**
 * Preloaded by `[test] preload` in bunfig.toml, so it runs once per test file before that file is
 * imported. Under `--isolate` everything installed here is re-installed per file and nothing leaks.
 */

/**
 * Runs before any test file is imported, so no module reads a value the
 * repository's .env put there. See tests/helpers/env.ts for why this is needed.
 */
clearDotEnv();

/**
 * Suppress console output from production code during tests — Bun's equivalent of Vitest's
 * `onConsoleLog() { return false }`. spyOn still works, since it replaces the property on this same
 * object. TEST_LOG=1 restores the output while debugging.
 */
if (!process.env.TEST_LOG) {
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    console[method] = () => {};
  }
}

/**
 * Caddy network guard. The stubbed seam is the admin-API transport (src/lib/caddy-admin.ts), not
 * the whole caddy module, so every builder stays real and only the socket is replaced by a spoofed
 * Caddy. Installed and reinstalled before each test, so state never leaks; a test that asserts on
 * what was sent calls installFakeCaddy() itself from beforeEach or the body, not beforeAll. If
 * anything swaps the real transport back in, the HTTP adapter throws rather than opening a socket.
 */
installFakeCaddy();
beforeEach(() => {
  installFakeCaddy();
});

/**
 * Mock the auth entry point so API route tests can control session state. Only `auth` is replaced;
 * the rest passes through, because Bun links eagerly and a missing name is a SyntaxError at import
 * time. Spreading the real module also keeps the genuine same-origin and role guards under test.
 */
const actualAuth = await import('@/src/lib/auth');

vi.mock('@/src/lib/auth', () => ({
  ...actualAuth,
  auth: vi.fn().mockResolvedValue({
    user: { id: 1, email: 'test@example.com', name: 'Test User', role: 'admin' },
  }),
}));

// Mock audit logging to be a no-op
vi.mock('@/src/lib/audit', () => ({
  logAuditEvent: vi.fn(),
}));
