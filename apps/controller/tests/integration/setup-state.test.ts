/**
 * The first-run setup state machine.
 *
 * The stage is derived from what exists rather than counted, so the cases worth pinning are the
 * ones where "what exists" is ambiguous: an operator halfway through, an upgrade from a release
 * that had no setup flow, and a restart in the middle of either.
 */
import { beforeEach, describe, expect, it } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
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

const {
  backfillSetupCompletion,
  declineMigration,
  getSetupState,
  hasAnySignIn,
  isSetupCompleted,
  markSetupCompleted,
} = await import('@/src/lib/setup');

const TOUCHED_ENV = ['ADMIN_USERNAME', 'ADMIN_PASSWORD', 'OAUTH_ENABLED', 'LEGACY_SQLITE_PATH'];

async function addUser(email: string) {
  const now = new Date().toISOString();
  await ctx.db.insert(schemaModule.users).values({
    email,
    name: email,
    passwordHash: 'x',
    role: 'admin',
    provider: 'credentials',
    subject: email,
    username: email,
    displayUsername: email,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  });
}

beforeEach(async () => {
  for (const name of TOUCHED_ENV) delete process.env[name];
  await ctx.db.delete(schemaModule.settings);
  await ctx.db.delete(schemaModule.users);
  await ctx.db.delete(schemaModule.oauthProviders);
});

describe('stage', () => {
  it('asks for an account when nothing can sign in', async () => {
    expect(await getSetupState(false)).toEqual({ stage: 'account', required: true });
  });

  it('asks for a sign-in once an account exists', async () => {
    await addUser('admin@localhost');
    expect(await getSetupState(false)).toEqual({ stage: 'verify', required: true });
  });

  it('moves to the settings step once the sign-in is proven', async () => {
    await addUser('admin@localhost');
    expect(await getSetupState(true)).toEqual({ stage: 'settings', required: true });
  });

  it('is finished once the flag is set, whoever is signed in', async () => {
    await addUser('admin@localhost');
    await markSetupCompleted();

    expect(await getSetupState(false)).toEqual({ stage: 'complete', required: false });
    expect(await getSetupState(true)).toEqual({ stage: 'complete', required: false });
  });

  it('does not go back to account creation after the settings step', async () => {
    // The operator created an account and is on the settings step. Nothing about a page reload,
    // a new tab, or a signed-out session may send them back to creating a second account.
    await addUser('admin@localhost');
    expect((await getSetupState(true)).stage).toBe('settings');
    expect((await getSetupState(false)).stage).not.toBe('account');
  });
});

describe('what counts as a way in', () => {
  it('counts a local account', async () => {
    expect(await hasAnySignIn()).toBe(false);
    await addUser('admin@localhost');
    expect(await hasAnySignIn()).toBe(true);
  });

  it('counts an enabled OAuth provider with no local accounts at all', async () => {
    const now = new Date().toISOString();
    await ctx.db.insert(schemaModule.oauthProviders).values({
      id: 'idp',
      name: 'IdP',
      type: 'oidc',
      clientId: 'id',
      clientSecret: 'secret',
      issuer: 'https://idp.example',
      scopes: 'openid email profile',
      autoLink: false,
      enabled: true,
      source: 'ui',
      createdAt: now,
      updatedAt: now,
    });

    expect(await hasAnySignIn()).toBe(true);
    expect((await getSetupState(false)).stage).toBe('verify');
  });

  it('does not count a disabled provider', async () => {
    const now = new Date().toISOString();
    await ctx.db.insert(schemaModule.oauthProviders).values({
      id: 'off',
      name: 'Disabled',
      type: 'oidc',
      clientId: 'id',
      clientSecret: 'secret',
      issuer: 'https://idp.example',
      scopes: 'openid email profile',
      autoLink: false,
      enabled: false,
      source: 'ui',
      createdAt: now,
      updatedAt: now,
    });

    expect(await hasAnySignIn()).toBe(false);
    expect((await getSetupState(false)).stage).toBe('account');
  });
});

describe('backfill for installations that predate setup', () => {
  it('marks an environment-configured installation complete', async () => {
    process.env.ADMIN_USERNAME = 'admin';
    process.env.ADMIN_PASSWORD = 'Strong-Admin-Passw0rd!';
    await addUser('admin@localhost');

    await backfillSetupCompletion();
    expect(await isSetupCompleted()).toBe(true);
  });

  it('leaves an operator midway through setup alone', async () => {
    // The account came from the setup form, so the environment names no credentials. Marking this
    // complete on the next restart would drop them into an unconfigured app with no way back.
    await addUser('someone@localhost');

    await backfillSetupCompletion();
    expect(await isSetupCompleted()).toBe(false);
    expect((await getSetupState(true)).stage).toBe('settings');
  });

  it('does nothing when the environment configures a sign-in but the database is empty', async () => {
    // The admin seed has not run yet. Marking setup complete here would skip the flow for a
    // deployment that has no account at all.
    process.env.ADMIN_USERNAME = 'admin';
    process.env.ADMIN_PASSWORD = 'Strong-Admin-Passw0rd!';

    await backfillSetupCompletion();
    expect(await isSetupCompleted()).toBe(false);
  });

  it('recognises an OIDC-only installation by its environment provider', async () => {
    process.env.OAUTH_ENABLED = 'true';
    await addUser('federated@localhost');

    await backfillSetupCompletion();
    expect(await isSetupCompleted()).toBe(true);
  });

  it('is idempotent', async () => {
    process.env.ADMIN_USERNAME = 'admin';
    process.env.ADMIN_PASSWORD = 'Strong-Admin-Passw0rd!';
    await addUser('admin@localhost');

    await backfillSetupCompletion();
    await backfillSetupCompletion();
    expect(await isSetupCompleted()).toBe(true);
  });
});

describe('the migration offer', () => {
  // LEGACY_SQLITE_PATH pins the scan to one file, so these do not depend on what happens to be
  // lying around the working directory.
  function pointAtLegacyDatabase(): string {
    const directory = mkdtempSync(join(tmpdir(), 'cpm-setup-legacy-'));
    const path = join(directory, 'old.db');
    const raw = new Database(path);
    migrate(drizzle(raw), { migrationsFolder: resolve(process.cwd(), 'drizzle', 'legacy-sqlite') });
    raw.close();
    process.env.LEGACY_SQLITE_PATH = path;
    return directory;
  }

  /**
   * bun:sqlite releases the file only once its statements are finalized, which happens on
   * collection — Windows refuses the removal until then, and a leftover temp directory is not
   * worth failing a test over.
   */
  function discard(directory: string): void {
    Bun.gc(true);
    try {
      rmSync(directory, { recursive: true, force: true });
    } catch {
      // Left for the operating system to clean up.
    }
  }

  it('offers migration before account creation when an old database is present', async () => {
    const directory = pointAtLegacyDatabase();
    try {
      expect((await getSetupState(false)).stage).toBe('migrate');
    } finally {
      discard(directory);
    }
  });

  it('falls through to account creation once the offer is declined', async () => {
    const directory = pointAtLegacyDatabase();
    try {
      await declineMigration();
      expect((await getSetupState(false)).stage).toBe('account');
    } finally {
      discard(directory);
    }
  });

  it('does not offer migration once the old database has been imported', async () => {
    // Users exist after an import, which moves the flow to proving the sign-in works. Offering
    // migration again here would invite a second import on top of the first.
    const directory = pointAtLegacyDatabase();
    try {
      await addUser('migrated@localhost');
      expect((await getSetupState(false)).stage).toBe('verify');
    } finally {
      discard(directory);
    }
  });

  it('goes straight to account creation when there is nothing to migrate', async () => {
    process.env.LEGACY_SQLITE_PATH = join(tmpdir(), 'definitely-not-here.db');
    expect((await getSetupState(false)).stage).toBe('account');
  });
});
