/**
 * Migrating a real pre-3.1 SQLite database into PostgreSQL.
 *
 * The fixture is built by running the SQLite migrations every 3.0 deployment ran, then seeding it
 * the way that release would have — so this exercises the actual shapes an upgrade meets rather
 * than a hand-written approximation of them.
 *
 * This is also where two tests deleted in the PostgreSQL move get their successors. They used to
 * assert that legacy `accounts` rows stayed readable by booting the app on the old database, which
 * is no longer a thing that can happen; the same guarantees now belong to the import.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { eq, sql } from 'drizzle-orm';
import { vi } from '@/tests/helpers/vi';
import { createTestDb, currentDb, type TestDb } from '@/tests/helpers/db';

const ctx = vi.hoisted(() => ({ db: null as unknown as TestDb }));

const schemaModule = await import('@/src/lib/db/schema');

// Hoisted out of the factory below: createTestDb is async, and a Bun mock factory must be
// synchronous — an async one never resolves and the file hangs.
ctx.db = await createTestDb();

vi.mock('@/src/lib/db', () => ({
  default: currentDb(() => ctx.db),
  db: currentDb(() => ctx.db),
  client: undefined,
  schema: schemaModule,
  nowIso: () => new Date().toISOString(),
  toIso: (value: string | Date | null | undefined): string | null =>
    !value ? null : value instanceof Date ? value.toISOString() : new Date(value).toISOString(),
}));

const { importLegacyDatabase } = await import('@/src/lib/migration/import');
const { inspectLegacyDatabase, scanForLegacyDatabases } = await import(
  '@/src/lib/migration/legacy-database'
);

const LEGACY_MIGRATIONS = resolve(process.cwd(), 'drizzle', 'legacy-sqlite');
const NOW = '2026-01-01T00:00:00.000Z';

let directory: string;

/** A SQLite database with the 3.0 schema and a realistic set of rows. */
function buildLegacyDatabase(): string {
  const path = join(directory, 'caddy-proxy-manager.db');
  const raw = new Database(path);
  migrate(drizzle(raw), { migrationsFolder: LEGACY_MIGRATIONS });

  raw.run(
    `INSERT INTO users (id, email, name, passwordHash, role, provider, subject, username,
                        displayUsername, status, createdAt, updatedAt)
     VALUES (1, 'admin@localhost', 'admin', '$argon2id$hash', 'admin', 'credentials', 'admin',
             'admin', 'admin', 'active', ?, ?),
            (2, 'viewer@localhost', 'viewer', '$argon2id$hash', 'viewer', 'credentials', 'viewer',
             'viewer', 'viewer', 'active', ?, ?)`,
    [NOW, NOW, NOW, NOW],
  );

  // The credential account row Better Auth reads. This is the shape the deleted compatibility
  // tests were guarding.
  raw.run(
    `INSERT INTO accounts (userId, accountId, providerId, issuer, password, createdAt, updatedAt)
     VALUES (1, '1', 'credential', 'local:credential', '$argon2id$hash', ?, ?)`,
    [NOW, NOW],
  );

  // sslForced/hstsEnabled and friends are 0/1 here and boolean in PostgreSQL.
  raw.run(
    `INSERT INTO proxy_hosts (id, name, domains, upstreams, sslForced, hstsEnabled,
                              hstsSubdomains, allowWebsocket, preserveHostHeader, enabled,
                              skipHttpsHostnameValidation, createdAt, updatedAt)
     VALUES (1, 'app', '["app.example.com"]', '["10.0.0.5:8080"]', 1, 1, 0, 1, 1, 1, 0, ?, ?),
            (2, 'api', '["api.example.com"]', '["10.0.0.6:8080"]', 0, 0, 0, 1, 1, 0, 1, ?, ?)`,
    [NOW, NOW, NOW, NOW],
  );

  raw.run(
    `INSERT INTO settings (key, value, updatedAt)
     VALUES ('general', '{"primaryDomain":"example.com"}', ?),
            ('avatars', '{"gravatarEnabled":false}', ?)`,
    [NOW, NOW],
  );

  raw.close();
  return path;
}

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'cpm-legacy-'));
  for (const table of [
    schemaModule.accounts,
    schemaModule.proxyHosts,
    schemaModule.settings,
    schemaModule.users,
  ]) {
    await ctx.db.delete(table);
  }
});

afterEach(() => {
  delete process.env.LEGACY_SQLITE_PATH;
  Bun.gc(true);
  rmSync(directory, { recursive: true, force: true });
});

describe('inspection', () => {
  it('accepts a real database and reports what is in it', () => {
    const result = inspectLegacyDatabase(buildLegacyDatabase());
    expect('reason' in result).toBe(false);
    if ('reason' in result) return;

    expect(result.counts).toMatchObject({ users: 2, proxyHosts: 2, settings: 2 });
    expect(result.sizeBytes).toBeGreaterThan(0);
  });

  it('rejects a SQLite file that is not ours, and says which tables were missing', () => {
    const path = join(directory, 'unrelated.db');
    const other = new Database(path);
    other.run('CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT)');
    other.close();

    const result = inspectLegacyDatabase(path);
    expect('reason' in result).toBe(true);
    if (!('reason' in result)) return;
    expect(result.reason).toMatch(/users/);
    expect(result.reason).toMatch(/not a Caddy Proxy Manager database/i);
  });

  it('rejects a file that is not a database at all', async () => {
    const path = join(directory, 'notes.db');
    await Bun.write(path, 'this is not sqlite');

    const result = inspectLegacyDatabase(path);
    expect('reason' in result).toBe(true);
  });

  it('rejects a path with nothing at it', () => {
    const result = inspectLegacyDatabase(join(directory, 'missing.db'));
    expect(result).toMatchObject({ reason: 'No file at that path.' });
  });

  it('honours LEGACY_SQLITE_PATH over searching', () => {
    process.env.LEGACY_SQLITE_PATH = buildLegacyDatabase();
    const { candidates } = scanForLegacyDatabases();
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.counts.proxyHosts).toBe(2);
  });
});

describe('import', () => {
  it('copies rows across and keeps their ids', async () => {
    const report = await importLegacyDatabase(buildLegacyDatabase());
    expect(report.totalRows).toBeGreaterThan(0);

    const users = await ctx.db.select().from(schemaModule.users);
    expect(users.map((user) => user.id).sort()).toEqual([1, 2]);
    expect(users.find((user) => user.id === 1)?.role).toBe('admin');
  });

  it('converts SQLite 0/1 into real booleans', async () => {
    await importLegacyDatabase(buildLegacyDatabase());

    const hosts = await ctx.db.select().from(schemaModule.proxyHosts);
    const app = hosts.find((host) => host.name === 'app');
    const api = hosts.find((host) => host.name === 'api');

    expect(app?.sslForced).toBe(true);
    expect(app?.hstsSubdomains).toBe(false);
    expect(api?.sslForced).toBe(false);
    expect(api?.skipHttpsHostnameValidation).toBe(true);
  });

  it('carries the credential account across, so the migrated admin can still sign in', async () => {
    // The successor to the deleted auth-adapter-compat and db-compat-accounts tests: what those
    // guarded was that Better Auth could read an account row written by the old release. It can
    // only reach one now by way of this import.
    await importLegacyDatabase(buildLegacyDatabase());

    const accounts = await ctx.db
      .select()
      .from(schemaModule.accounts)
      .where(eq(schemaModule.accounts.userId, 1));

    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({
      providerId: 'credential',
      issuer: 'local:credential',
      accountId: '1',
    });
    expect(accounts[0]?.password).toBeTruthy();
  });

  it('leaves the id sequences past the copied rows', async () => {
    // Without this, the first proxy host created after an upgrade is handed id 1 and dies on the
    // primary key — the same failure the bootstrap admin caused before its sequence was resynced.
    await importLegacyDatabase(buildLegacyDatabase());

    const [created] = await ctx.db
      .insert(schemaModule.proxyHosts)
      .values({
        name: 'created-after-migrating',
        domains: '["new.example.com"]',
        upstreams: '["10.0.0.9:80"]',
        createdAt: NOW,
        updatedAt: NOW,
      })
      .returning();

    expect(created?.id).toBeGreaterThan(2);
  });

  it('brings the settings rows with it', async () => {
    await importLegacyDatabase(buildLegacyDatabase());

    const rows = await ctx.db.select().from(schemaModule.settings);
    const byKey = new Map(rows.map((row) => [row.key, row.value]));
    expect(byKey.get('general')).toContain('example.com');
    expect(byKey.get('avatars')).toContain('gravatarEnabled');
  });

  it('names the tables this version dropped rather than silently ignoring them', async () => {
    const path = buildLegacyDatabase();
    const raw = new Database(path);
    raw.run('CREATE TABLE dead_hosts (id INTEGER PRIMARY KEY, domain TEXT)');
    raw.run("INSERT INTO dead_hosts (id, domain) VALUES (1, 'gone.example.com')");
    raw.close();

    const report = await importLegacyDatabase(path);
    expect(report.droppedFromSchema).toContain('dead_hosts');
  });

  it('is safe to run twice, and says it copied nothing the second time', async () => {
    const path = buildLegacyDatabase();
    const first = await importLegacyDatabase(path);
    const second = await importLegacyDatabase(path);

    const users = await ctx.db.select().from(schemaModule.users);
    expect(users).toHaveLength(2);

    expect(first.totalRows).toBeGreaterThan(0);
    // Reporting the batch size rather than the rows actually written would claim a second run had
    // migrated everything again.
    expect(second.totalRows).toBe(0);
  });

  it('inserts users before the accounts that reference them', async () => {
    // Ordering is derived from the schema's foreign keys; if that sort regressed, the accounts
    // insert would fail outright rather than producing an orphan.
    await importLegacyDatabase(buildLegacyDatabase());

    const [{ orphans }] = await ctx.db.execute<{ orphans: number }>(
      sql`SELECT COUNT(*)::int AS orphans FROM accounts a
          LEFT JOIN users u ON u.id = a."userId" WHERE u.id IS NULL`,
    );
    expect(orphans).toBe(0);
  });
});
