import { afterEach, beforeEach } from 'bun:test';
import { installFakeCaddy } from './helpers/caddy-admin';
import { cleanupTestDbs, markTestBoundary } from './helpers/db';
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
 * `onConsoleLog() { return false }`. spyOn still works; TEST_LOG=1 restores the output.
 */
if (!process.env.TEST_LOG) {
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    console[method] = () => {};
  }
}

/**
 * Caddy network guard. The stubbed seam is the admin-API transport, not the whole caddy module, so
 * every builder stays real and only the socket is a spoofed Caddy. Reinstalled before each test; a
 * test asserting on what was sent calls installFakeCaddy() from beforeEach or the body, not
 * beforeAll. If anything swaps the real transport back, the HTTP adapter throws.
 */
installFakeCaddy();
beforeEach(() => {
  installFakeCaddy();
  // Registered from the preload, so it runs before any hook the test file declares — which is what
  // makes a database created in the file's own beforeEach count as belonging to the test.
  markTestBoundary();
});

/**
 * Every schema createTestDb() opened during the test, dropped along with its connection. Without
 * it a file's tests accumulate one connection each and the suite exhausts max_connections.
 */
afterEach(async () => {
  await cleanupTestDbs();
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
