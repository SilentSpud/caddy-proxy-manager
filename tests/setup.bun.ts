import { beforeEach } from 'bun:test';
import { installFakeCaddy } from './helpers/caddy-admin';
import { clearDotEnv } from './helpers/env';
import { vi } from './helpers/vi';

/**
 * Preloaded by `[test] preload` in bunfig.toml, so it runs once per test file
 * before that file is imported. Under `--isolate` each file gets a fresh global
 * and module registry, so everything installed here is re-installed per file
 * and nothing leaks between them — which is what `bun test` needs in order to
 * behave like Vitest's per-file isolation.
 */

/**
 * Runs before any test file is imported, so no module reads a value the
 * repository's .env put there. See tests/helpers/env.ts for why this is needed.
 */
clearDotEnv();

/**
 * Suppress console output from production code during tests (e.g. expected
 * warn/error calls when intentionally feeding bad input to parsers). This is
 * the Bun equivalent of Vitest's `onConsoleLog() { return false }`.
 *
 * Tests that assert on console calls still work: spyOn replaces the property on
 * this same object. Set TEST_LOG=1 to get the output back while debugging.
 */
if (!process.env.TEST_LOG) {
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    console[method] = () => {};
  }
}

/**
 * Caddy network guard.
 *
 * The Caddy container and the web container are separate runtime boundaries, so
 * the seam we stub is the admin-API transport (src/lib/caddy-admin.ts) — not the
 * whole caddy module. Every builder stays real and fully testable; only the
 * socket is replaced, by a spoofed Caddy instance that accepts config loads and
 * serves them back.
 *
 * Installed here for every test file, and reinstalled before each test so state
 * never leaks between them. A test that wants to assert on what was sent, or to
 * simulate Caddy failing, should call installFakeCaddy() itself and keep the
 * handle — from beforeEach or the test body, not beforeAll, since this hook runs
 * before each test and would otherwise replace it. Should anything swap the real
 * transport back in, the HTTP adapter throws rather than opening a socket — see
 * httpCaddyAdminTransport.
 */
installFakeCaddy();
beforeEach(() => {
  installFakeCaddy();
});

/**
 * Mock the auth entry point so API route tests can control session state.
 *
 * Only `auth` is replaced; the rest of the module is passed through. Vitest
 * could get away with a factory returning `auth` alone because it linked
 * mocked modules lazily — a route importing `checkSameOrigin` only failed if it
 * called it. Bun links eagerly, so a missing name is a SyntaxError at import
 * time for every route that imports one. Spreading the real module also means
 * route tests exercise the genuine same-origin and role guards rather than
 * holes in a stub.
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
