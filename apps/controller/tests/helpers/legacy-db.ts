/**
 * Where the migration e2e spec's pre-3.1 database lives, and how it gets there.
 *
 * Node-safe on purpose: Playwright runs specs under Node, which cannot load `bun:sqlite`. Building
 * the file needs Bun, so that half lives in ./build-legacy-db.ts and is spawned rather than
 * imported — everything in this module has to be loadable from a spec.
 */

import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDir = dirname(fileURLToPath(import.meta.url));

/** Bind-mounted into web-migrate at /legacy; see tests/docker-compose.test.yml. */
export const LEGACY_DIR = resolve(moduleDir, '../.legacy');
export const LEGACY_FILE = resolve(LEGACY_DIR, 'caddy-proxy-manager.db');

/** The path as the container sees it, which is what the migration screen displays. */
export const LEGACY_CONTAINER_PATH = '/legacy/caddy-proxy-manager.db';

/** What the browser should be able to see after the migration runs. */
export const LEGACY_FIXTURE = {
  adminUsername: 'legacyadmin',
  proxyHostName: 'legacy-app',
  proxyHostDomain: 'legacy-app.example.com',
  primaryDomain: 'legacy.example.com',
} as const;

/**
 * Build the database, by running the Bun half of this helper.
 *
 * Bun is not optional here — it is what the whole repository is built and tested with, and CI
 * installs it before Playwright runs — so a missing one is a broken environment, not a case to
 * degrade around.
 */
export function buildLegacyDatabase(password: string): void {
  execFileSync('bun', [resolve(moduleDir, 'build-legacy-db.ts'), password], {
    cwd: resolve(moduleDir, '../..'),
    stdio: 'pipe',
    encoding: 'utf8',
  });
}

/** Remove it, so a re-run starts from a state the container has not already migrated. */
export function removeLegacyDatabase(): void {
  try {
    rmSync(LEGACY_FILE, { force: true });
  } catch {
    /* a leftover file is not worth failing teardown over */
  }
}
