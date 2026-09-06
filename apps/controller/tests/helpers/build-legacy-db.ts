/**
 * Writes a pre-3.0 SQLite database for the migration e2e spec, then exits.
 *
 * A standalone script rather than a function the spec imports: Playwright runs specs under Node,
 * which cannot load `bun:sqlite` or reach `Bun.password` at all. The spec spawns this with `bun`.
 *
 * The schema comes from `drizzle/legacy-sqlite` — the migrations every 3.0 deployment actually ran
 * — so the file the browser sees is one the application discovered, not one a test invented.
 *
 *   bun tests/helpers/build-legacy-db.ts <password>
 */

import { Database } from 'bun:sqlite';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { LEGACY_FILE, LEGACY_FIXTURE, LEGACY_DIR } from './legacy-db';

const moduleDir = dirname(fileURLToPath(import.meta.url));
const LEGACY_MIGRATIONS = resolve(moduleDir, '../../drizzle/legacy-sqlite');
const NOW = '2026-01-01T00:00:00.000Z';

const password = process.argv[2];
if (!password) {
  console.error('usage: bun build-legacy-db.ts <password>');
  process.exit(1);
}

// A real argon2id hash, produced exactly as the application produces one. A placeholder would make
// the spec's sign-in step untestable, and signing in is the only thing that proves the credential
// row survived the import intact.
const passwordHash = await Bun.password.hash(password, { algorithm: 'argon2id' });

// The file only, never the directory: it is a bind-mount source, and removing it out from under a
// running container leaves the mount pointing at nothing.
mkdirSync(LEGACY_DIR, { recursive: true });
rmSync(LEGACY_FILE, { force: true });

const raw = new Database(LEGACY_FILE);
migrate(drizzle(raw), { migrationsFolder: LEGACY_MIGRATIONS });

raw.run(
  `INSERT INTO users (id, email, name, passwordHash, role, provider, subject, username,
                      displayUsername, status, createdAt, updatedAt)
   VALUES (1, 'legacyadmin@localhost', 'Legacy Admin', ?, 'admin', 'credentials', 'legacyadmin',
           ?, ?, 'active', ?, ?)`,
  [passwordHash, LEGACY_FIXTURE.adminUsername, LEGACY_FIXTURE.adminUsername, NOW, NOW],
);

// The credential account row Better Auth reads. Without it the migrated user exists but cannot
// sign in, which is the failure this whole flow exists to rule out.
raw.run(
  `INSERT INTO accounts (userId, accountId, providerId, issuer, password, createdAt, updatedAt)
   VALUES (1, '1', 'credential', 'local:credential', ?, ?, ?)`,
  [passwordHash, NOW, NOW],
);

raw.run(
  `INSERT INTO proxy_hosts (id, name, domains, upstreams, sslForced, hstsEnabled,
                            hstsSubdomains, allowWebsocket, preserveHostHeader, enabled,
                            skipHttpsHostnameValidation, createdAt, updatedAt)
   VALUES (1, ?, ?, '["10.0.0.9:8080"]', 1, 1, 0, 1, 1, 1, 0, ?, ?)`,
  [LEGACY_FIXTURE.proxyHostName, JSON.stringify([LEGACY_FIXTURE.proxyHostDomain]), NOW, NOW],
);

raw.run("INSERT INTO settings (key, value, updatedAt) VALUES ('general', ?, ?)", [
  JSON.stringify({ primaryDomain: LEGACY_FIXTURE.primaryDomain }),
  NOW,
]);

raw.close();
console.log(LEGACY_FILE);
