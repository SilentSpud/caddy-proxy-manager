import { vi, beforeEach } from 'vitest';
import { clearDotEnv } from './helpers/env';
import { installFakeCaddy } from './helpers/caddy-admin';

/**
 * Runs before any test file is imported, so no module reads a value the
 * repository's .env put there. See tests/helpers/env.ts for why this is needed
 * now that the suite runs on Bun.
 */
clearDotEnv();

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

// Mock NextAuth so API route tests can control session state
vi.mock('@/src/lib/auth', () => ({
  auth: vi.fn().mockResolvedValue({
    user: { id: 1, email: 'test@example.com', name: 'Test User', role: 'admin' },
  }),
}));

// Mock audit logging to be a no-op
vi.mock('@/src/lib/audit', () => ({
  logAuditEvent: vi.fn(),
}));
