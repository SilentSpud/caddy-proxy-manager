import { defineConfig } from 'vitest/config';
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
  resolve: {
    // Vite 8 resolves tsconfig `paths` natively, so the vite-tsconfig-paths
    // plugin is no longer needed. Root is the repo root (where tsconfig.json
    // lives), which is also the cwd `bun run test` starts from.
    tsconfigPaths: true,
  },
  test: {
    // Vitest's environment names the global set (no DOM), not the interpreter.
    // The interpreter is Bun — the test scripts in package.json run Vitest with
    // `bun --bun` so that bun:sqlite and the other Bun built-ins resolve.
    environment: 'node',
    setupFiles: [resolve(moduleDir, 'setup.vitest.ts')],
    // The suite's environment is set by clearDotEnv() in tests/setup.vitest.ts
    // rather than by `test.env` here. Bun loads the repository's .env before
    // Vitest starts, and anything `test.env` set would have to be re-applied
    // after that is stripped back out — so it is defined in one place instead,
    // as VITEST_ENV in tests/helpers/env.ts.
    include: [testGlob('unit/**/*.test.ts'), testGlob('integration/**/*.test.ts')],
    // Suppress console output from production code during tests (e.g. expected
    // warn/error calls when intentionally feeding bad input to parsers).
    // Tests that need to assert on console calls can still use vi.spyOn(console, ...).
    onConsoleLog() {
      return false;
    },
    coverage: {
      // istanbul rather than v8: the v8 provider merges raw coverage through
      // @bcoe/v8-coverage, whose range-tree merge recurses per range and blows
      // Bun's stack on a graph this size — the run dies with "Maximum call
      // stack size exceeded" after every test has already passed. istanbul
      // instruments at transform time instead, so there is nothing to merge.
      provider: 'istanbul',
      reportsDirectory: resolve(root, 'coverage'),
      reporter: [
        ['text', { maxCols: 120 }], // terminal summary
        'html', // coverage/index.html, line-by-line
        'lcov', // for CI annotations / external tools
        'json-summary', // coverage/coverage-summary.json, for badges
      ],

      // Scoped to the code this suite is responsible for: the server-side
      // library and the API route handlers. The dashboard UI is deliberately
      // out of scope — it is exercised by Playwright (`bun run test:e2e`) and by
      // the docker suite, and folding hundreds of untested component lines in
      // here would turn the number into noise rather than a signal.
      include: ['src/lib/**/*.{ts,tsx}', 'src/instrumentation.ts', 'app/api/**/*.ts'],
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
      // suite actually achieves today (54.7 / 50.3 / 56.2 / 54.8), so a real
      // drop fails the run while ordinary churn does not. Raise them as
      // coverage improves; do not lower them to make a build pass.
      //
      // Rebaselined when the provider moved from v8 to istanbul. The two count
      // differently — istanbul counts the statements it instruments, v8 counts
      // executed byte ranges — so the numbers are not comparable across that
      // change, and neither are these thresholds to the ones before it.
      thresholds: {
        statements: 54,
        branches: 49,
        functions: 55,
        lines: 54,
      },
    },
  },
});
