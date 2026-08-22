import { vi } from 'vitest';

// Keep the real Caddy builder implementation available to unit tests.
// The Caddy container and the web container are separate runtime boundaries, so
// tests that exercise the config builder should use a spoofed "Caddy instance"
// by stubbing only the network apply path where needed, rather than replacing the
// entire module at global scope.

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
