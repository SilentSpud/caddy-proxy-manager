import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * The environment every Vitest run must see. Consumed by `test.env` in
 * tests/vitest.config.ts, and re-applied by clearDotEnv() below so the two
 * cannot drift apart.
 */
export const VITEST_ENV: Record<string, string> = {
  DATABASE_URL: ':memory:',
  SESSION_SECRET: 'test-session-secret-for-vitest-unit-tests-12345',
  NODE_ENV: 'test',
};

/** The dotenv files Bun reads on startup, in the order it applies them. */
const DOTENV_FILES = ['.env', '.env.local', '.env.test', '.env.test.local'];

/** `KEY=`, `export KEY=` — enough to recover the names, which is all we need. */
const ASSIGNMENT = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/;

/**
 * Removes the repository's dotenv values from process.env.
 *
 * Bun loads .env automatically; Node did not, so under Node the suite ran with
 * only what the shell exported and every test saw the same baseline. Now that
 * Vitest runs on Bun, a developer's local .env reaches src/lib/config.ts and
 * silently changes the defaults under test — AUTH_ALLOW_OAUTH_REGISTRATION in
 * the committed .env is enough to fail
 * tests/unit/config-local-users-disabled.test.ts.
 *
 * Passing `--env-file` to the inner `bun` does not help: `bun run test` has
 * already loaded .env into the environment the inner process inherits. So undo
 * it here instead, from a setup file, which works however the suite is
 * launched.
 *
 * Keys are dropped whether they came from the dotenv file or the shell — a test
 * suite that behaves differently depending on the developer's shell is the
 * thing being prevented. Variables the suite genuinely needs belong in
 * VITEST_ENV.
 */
export function clearDotEnv(): void {
  for (const file of DOTENV_FILES) {
    let contents: string;
    try {
      contents = readFileSync(resolve(repoRoot, file), 'utf8');
    } catch {
      continue; // Not every dotenv file exists in every checkout.
    }
    for (const line of contents.split('\n')) {
      const name = ASSIGNMENT.exec(line)?.[1];
      if (name) delete process.env[name];
    }
  }
  Object.assign(process.env, VITEST_ENV);
}
