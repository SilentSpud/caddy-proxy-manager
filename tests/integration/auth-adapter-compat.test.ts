/**
 * Better Auth reads and writes the auth tables through drizzle now, not through its own Kysely
 * adapter driving a raw bun:sqlite handle. Two things had to keep working across that switch, and
 * neither is covered by the other auth tests — those stub `betterAuth` itself and only assert the
 * options object, so no adapter code runs in them at all.
 *
 * 1. Rows already on disk stay usable. Existing deployments' users and accounts were written by
 *    the Kysely path; this seeds that exact on-disk shape (camelCase columns, integer ids, ISO
 *    text timestamps) and signs in against it.
 *
 * 2. Sign-in can write a session. This is the regression the switch actually caused: Better Auth's
 *    drizzle adapter hands Date objects to columns declared `text`, and bun:sqlite refuses to bind
 *    a Date — every sign-in failed with "Binding expected string, TypedArray, boolean, number,
 *    bigint or null". PostgreSQL did not fail, because Bun.SQL serializes Dates on its own, so the
 *    bug existed on one backend only. src/lib/db/columns.sqlite.ts is the fix.
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import * as sqliteSchema from '@/src/lib/db/schema.sqlite';
import { reloadDbModule } from '@/tests/helpers/fresh-db';
import { hashPassword } from '@/src/lib/password';
import { CREDENTIAL_ISSUER } from '@/src/lib/account-issuer';

const PASSWORD = 'LegacyRowPassword2026!';
const USERNAME = 'legacyuser';

function resetDbModuleState() {
  delete (globalThis as typeof globalThis & { __DRIZZLE_DB__?: unknown }).__DRIZZLE_DB__;
  delete (globalThis as typeof globalThis & { __DB_CLIENT__?: unknown }).__DB_CLIENT__;
  delete (globalThis as typeof globalThis & { __MIGRATIONS_RAN__?: boolean }).__MIGRATIONS_RAN__;
}

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
  process.env.DATABASE_URL = ':memory:';
  resetDbModuleState();
});

/**
 * A database holding one credential user in the shape the pre-drizzle Better Auth left behind:
 * integer ids, camelCase columns and ISO-8601 text timestamps.
 */
async function seedLegacyAuthDatabase(): Promise<string> {
  const directory = mkdtempSync(join(tmpdir(), 'cpm-auth-compat-'));
  const databasePath = join(directory, 'auth.db');
  cleanups.push(() => {
    Bun.gc(true);
    rmSync(directory, { recursive: true, force: true });
  });

  const raw = new Database(databasePath);
  migrate(drizzle(raw, { schema: sqliteSchema }), {
    migrationsFolder: resolve(process.cwd(), 'drizzle'),
  });

  const now = '2026-01-01T00:00:00.000Z';
  const passwordHash = await hashPassword(PASSWORD);

  raw
    .prepare(
      `INSERT INTO "users"
       ("id","email","name","passwordHash","role","provider","subject","status","username","displayUsername","emailVerified","createdAt","updatedAt")
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      1,
      `${USERNAME}@localhost`,
      'Legacy User',
      passwordHash,
      'admin',
      'credentials',
      USERNAME,
      'active',
      USERNAME,
      USERNAME,
      1,
      now,
      now,
    );

  raw
    .prepare(
      `INSERT INTO "accounts"
       ("id","userId","issuer","accountId","providerId","password","createdAt","updatedAt")
       VALUES (?,?,?,?,?,?,?,?)`,
    )
    .run(1, 1, CREDENTIAL_ISSUER, '1', 'credential', passwordHash, now, now);

  raw.close();
  return databasePath;
}

/** Boot the app's real Better Auth against `databasePath`. */
async function bootAuth(databasePath: string) {
  process.env.DATABASE_URL = `file:${databasePath}`;
  process.env.ADMIN_USERNAME = USERNAME;
  process.env.ADMIN_PASSWORD = PASSWORD;
  resetDbModuleState();

  const { dbModule, schema } = await reloadDbModule();
  cleanups.push(() => (dbModule.client as { close?: () => void })?.close?.());

  const authServer = await import(`@/src/lib/auth-server?adapter-compat=${Date.now()}`);
  const auth = (await authServer.getAuth()) as any;
  return { auth, db: dbModule.default, schema };
}

describe('Better Auth drizzle adapter against legacy on-disk rows', () => {
  it('signs in a user whose rows predate the adapter switch', async () => {
    const databasePath = await seedLegacyAuthDatabase();
    const { auth } = await bootAuth(databasePath);

    const result = await auth.api.signInUsername({
      body: { username: USERNAME, password: PASSWORD },
    });

    expect(result?.user?.id).toBeDefined();
    expect(result?.token).toBeTruthy();
  });

  it('writes the session row that sign-in creates', async () => {
    // The Date-binding regression surfaced exactly here: the sign-in itself resolved far enough to
    // insert a session, and that insert was what bun:sqlite rejected.
    const databasePath = await seedLegacyAuthDatabase();
    const { auth, db, schema } = await bootAuth(databasePath);

    expect(await db.select().from(schema.sessions)).toHaveLength(0);
    await auth.api.signInUsername({ body: { username: USERNAME, password: PASSWORD } });

    const sessions = await db.select().from(schema.sessions);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].userId).toBe(1);
  });

  it('stores session timestamps as ISO strings, not driver-specific values', async () => {
    const databasePath = await seedLegacyAuthDatabase();
    const { auth, db, schema } = await bootAuth(databasePath);
    await auth.api.signInUsername({ body: { username: USERNAME, password: PASSWORD } });

    const [session] = await db.select().from(schema.sessions);
    // Written by Better Auth as a Date and normalized by isoTimestamp. Everything else in the app
    // reads these columns as ISO text.
    expect(typeof session.expiresAt).toBe('string');
    expect(session.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(Number.isNaN(Date.parse(session.expiresAt))).toBe(false);
    expect(typeof session.createdAt).toBe('string');
    expect(session.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('rejects a wrong password against a legacy row', async () => {
    const databasePath = await seedLegacyAuthDatabase();
    const { auth } = await bootAuth(databasePath);

    await expect(
      auth.api.signInUsername({ body: { username: USERNAME, password: 'WrongPassword2026!' } }),
    ).rejects.toBeDefined();
  });
});
