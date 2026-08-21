import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';
import { resolve, sep } from 'node:path';

const root = resolve(__dirname, '..');

/**
 * Builds an absolute test-discovery pattern rooted at this directory.
 *
 * Glob syntax is POSIX on every platform: a backslash is an escape character,
 * not a separator. A pattern built with `resolve()` alone therefore matches
 * nothing on Windows — `tests\unit\**\*.test.ts` reads as escaped literals — and
 * Vitest exits with "No test files found" having silently run zero tests.
 * Normalising the separators is a no-op on POSIX.
 */
const testGlob = (pattern: string) => resolve(__dirname, pattern).split(sep).join('/');

export default defineConfig({
  plugins: [tsconfigPaths({ root })],
  resolve: {
    alias: {
      // bun:sqlite is a Bun built-in unavailable in Node.js/Vitest. Redirect both
      // the protocol import and the drizzle bun-sqlite adapter to their better-sqlite3
      // equivalents so tests that transitively import src/lib/db.ts don't crash.
      // Tests that need a real database use tests/helpers/db.ts (better-sqlite3 directly).
      'bun:sqlite': resolve(__dirname, 'helpers/bun-sqlite-compat.ts'),
      'drizzle-orm/bun-sqlite/migrator': 'drizzle-orm/better-sqlite3/migrator',
      'drizzle-orm/bun-sqlite': 'drizzle-orm/better-sqlite3',
    },
  },
  test: {
    environment: 'node',
    setupFiles: [resolve(__dirname, 'setup.vitest.ts')],
    env: {
      DATABASE_URL: ':memory:',
      SESSION_SECRET: 'test-session-secret-for-vitest-unit-tests-12345',
      NODE_ENV: 'test',
    },
    include: [
      testGlob('unit/**/*.test.ts'),
      testGlob('integration/**/*.test.ts'),
    ],
    // Suppress console output from production code during tests (e.g. expected
    // warn/error calls when intentionally feeding bad input to parsers).
    // Tests that need to assert on console calls can still use vi.spyOn(console, ...).
    onConsoleLog() {
      return false;
    },
  },
});
