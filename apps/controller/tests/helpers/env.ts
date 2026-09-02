import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// apps/controller — the dotenv files Bun reads sit at the repo root, two levels further up.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

/**
 * The environment every test run must see. Applied by clearDotEnv() below,
 * which the preload calls before any test file is imported.
 */
export const TEST_ENV: Record<string, string> = {
  // src/lib/db/connection.ts resolves this at module load and throws on anything but PostgreSQL,
  // so it has to be set before the first import — not in a beforeEach. scripts/with-test-db.ts
  // provides the server.
  DATABASE_URL: process.env.TEST_POSTGRES_URL ?? '',
  // What `:memory:` used to signal: a database with no deployment history, so the one-time data
  // migrations in src/lib/db.ts have nothing to migrate.
  CPM_EPHEMERAL_DB: 'true',
  // Read by the backstop in src/lib/caddy-admin.ts, which refuses to open a real socket when it is
  // set. `bun test` sets no marker of its own beyond NODE_ENV=test, so the suite declares one.
  CPM_TEST: '1',
  SESSION_SECRET: 'test-session-secret-for-unit-tests-12345',
  NODE_ENV: 'test',
};

/** The dotenv files Bun reads on startup, in the order it applies them. */
const DOTENV_FILES = ['.env', '.env.local', '.env.test', '.env.test.local'];

/** `KEY=`, `export KEY=` — enough to recover the names, which is all we need. */
const ASSIGNMENT = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/;

/**
 * Removes the repository's dotenv values from process.env. Bun loads .env automatically where Node
 * did not, so a developer's local .env changes the defaults under test —
 * AUTH_ALLOW_OAUTH_REGISTRATION alone fails config-local-users-disabled.test.ts. `--env-file` does
 * not help: `bun run test` already loaded it. What the suite needs is in TEST_ENV.
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
  Object.assign(process.env, TEST_ENV);
}
