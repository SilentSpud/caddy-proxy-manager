import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDir = dirname(fileURLToPath(import.meta.url));

const root = resolve(moduleDir, '..');

/**
 * Builds an absolute test-discovery pattern rooted at this directory.
 *
 * Glob syntax is POSIX on every platform: a backslash is an escape character,
 * not a separator. A pattern built with `resolve()` alone therefore matches
 * nothing on Windows — `tests\unit\**\*.test.ts` reads as escaped literals — and
 * Vitest exits with "No test files found" having silently run zero tests.
 * Normalising the separators is a no-op on POSIX.
 */
const testGlob = (pattern: string) => resolve(moduleDir, pattern).split(sep).join('/');

export default defineConfig({
  plugins: [tsconfigPaths({ root })],
  resolve: {
    alias: {
      // bun:sqlite is a Bun built-in unavailable in Node.js/Vitest. Redirect both
      // the protocol import and the drizzle bun-sqlite adapter to their better-sqlite3
      // equivalents so tests that transitively import src/lib/db.ts don't crash.
      // Tests that need a real database use tests/helpers/db.ts (better-sqlite3 directly).
      'bun:sqlite': resolve(moduleDir, 'helpers/bun-sqlite-compat.ts'),
      'drizzle-orm/bun-sqlite/migrator': 'drizzle-orm/better-sqlite3/migrator',
      'drizzle-orm/bun-sqlite': 'drizzle-orm/better-sqlite3',
    },
  },
  test: {
    environment: 'node',
    setupFiles: [resolve(moduleDir, 'setup.vitest.ts')],
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
    coverage: {
      provider: 'v8',
      reportsDirectory: resolve(root, 'coverage'),
      reporter: [
        ['text', { maxCols: 120 }],   // terminal summary
        'html',                        // coverage/index.html, line-by-line
        'lcov',                        // for CI annotations / external tools
        'json-summary',                // coverage/coverage-summary.json, for badges
      ],

      // Scoped to the code this suite is responsible for: the server-side
      // library and the API route handlers. The dashboard UI is deliberately
      // out of scope — it is exercised by Playwright (`bun run test:e2e`) and by
      // the docker suite, and folding hundreds of untested component lines in
      // here would turn the number into noise rather than a signal.
      include: [
        'src/lib/**/*.{ts,tsx}',
        'src/instrumentation.ts',
        'app/api/**/*.ts',
      ],
      exclude: [
        '**/*.d.ts',
        // Type-only and generated modules have no executable statements to
        // cover; leaving them in only drags the denominator around.
        'src/lib/db/schema.ts',
        'app/api/v1/openapi.json/**',
      ],

      // Note there is no `all: true` here — Vitest 4 dropped the option because
      // `include` already governs it: every matching file is reported whether or
      // not a test imported it. That is the behaviour we want, since a module
      // with no tests at all is exactly the case worth seeing.

      // A ratchet, not an aspiration: these sit just under the numbers the
      // suite actually achieves today (54.2 / 50.6 / 54.6 / 54.5), so a real
      // drop fails the run while ordinary churn does not. Raise them as
      // coverage improves; do not lower them to make a build pass.
      thresholds: {
        statements: 53,
        branches: 49,
        functions: 53,
        lines: 53,
      },
    },
  },
});
