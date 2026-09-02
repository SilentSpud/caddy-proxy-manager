/**
 * Email self-registration through Better Auth, against a real PostgreSQL database.
 *
 * The e2e suite covers this at :3001 and was the only thing that did, so a failure took a full
 * stack build to see and produced nothing but a 422 — Better Auth reports an adapter error and the
 * underlying database message never reaches the response. Booting the same code here surfaces it.
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { createTestDatabase } from '@/tests/helpers/db';
import { TEST_ENV } from '@/tests/helpers/env';
import { fresh } from '@/tests/helpers/fresh';
import { reloadDbModule } from '@/tests/helpers/fresh-db';
import { vi } from '@/tests/helpers/vi';

const cleanups: Array<() => void | Promise<void>> = [];

/**
 * The status as a string, or `status: body` when it is not 200. Bun's `expect` takes no message
 * argument, so carrying the body into the compared value is what puts Better Auth's reason in the
 * failure output instead of a bare number.
 */
async function statusAndBody(response: Response): Promise<string> {
  if (response.status === 200) return '200';
  return `${response.status}: ${await response.text()}`;
}

function resetDbModuleState() {
  delete (globalThis as typeof globalThis & { __DRIZZLE_DB__?: unknown }).__DRIZZLE_DB__;
  delete (globalThis as typeof globalThis & { __DB_CLIENT__?: unknown }).__DB_CLIENT__;
  delete (globalThis as typeof globalThis & { __MIGRATIONS_RAN__?: boolean }).__MIGRATIONS_RAN__;
}

afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
  process.env.DATABASE_URL = TEST_ENV.DATABASE_URL;
  process.env.CPM_EPHEMERAL_DB = TEST_ENV.CPM_EPHEMERAL_DB;
  delete process.env.AUTH_ALLOW_SELF_REGISTRATION;
  delete process.env.ADMIN_USERNAME;
  delete process.env.ADMIN_PASSWORD;
  resetDbModuleState();
});

/**
 * Boot the app against a fresh database with credential signup open, as :3001 runs in e2e.
 *
 * `seedAdmin` runs the bootstrap that instrumentation.ts performs at server startup. It is what
 * separates this from a bare empty schema, and the reason the e2e failure did not reproduce here
 * until it was added: the admin is inserted with an explicit id.
 */
async function bootWithSelfRegistration({ seedAdmin = false } = {}) {
  const database = await createTestDatabase();
  cleanups.push(() => database.drop());

  process.env.DATABASE_URL = database.url;
  // The admin bootstrap and the other startup migrations have to run: this asserts on what a real
  // deployment does on its first request, not on an empty schema.
  delete process.env.CPM_EPHEMERAL_DB;
  process.env.AUTH_ALLOW_SELF_REGISTRATION = 'true';
  process.env.AUTH_RATE_LIMIT_ENABLED = 'false';
  resetDbModuleState();

  // config.ts snapshots the environment at module load, so it has to be re-evaluated after the
  // variables above are set or auth-server reads a stale copy and signup stays disabled.
  const config = await import(`@/src/lib/config${fresh()}`);
  vi.mock('@/src/lib/config', () => ({ ...config }));

  const { dbModule, schema } = await reloadDbModule();
  cleanups.push(() => (dbModule.client as { close?: () => Promise<void> })?.close?.());

  if (seedAdmin) {
    process.env.ADMIN_USERNAME = 'testadmin';
    process.env.ADMIN_PASSWORD = 'TestPassword2026!';
    const initDb = await import(`@/src/lib/init-db${fresh()}`);
    await initDb.ensureAdminUser();
  }

  const authServer = await import(`@/src/lib/auth-server${fresh()}`);
  // betterAuth's instance type is generated from its config; the test tree allows `any`.
  const auth = (await authServer.getAuth()) as any;
  return { auth, db: dbModule.default, schema };
}

describe('email self-registration', () => {
  it('creates the user and its credential account', async () => {
    const { auth, db, schema } = await bootWithSelfRegistration();
    const email = `self-registration-${Date.now()}@test.invalid`;

    const response = await auth.api.signUpEmail({
      body: { name: 'Self Registration Test', email, password: 'SelfRegistration2026!' },
      asResponse: true,
    });

    // Read the body before asserting: it carries the adapter's complaint, and a bare status code
    // is exactly what made the e2e failure opaque.
    expect(await statusAndBody(response)).toBe('200');

    const users = await db.select().from(schema.users);
    const created = users.find((user: { email: string }) => user.email === email);
    expect(created, 'signup should have created the user').toBeDefined();
    expect(created?.role).toBe('user');
    expect(created?.status).toBe('active');

    const accounts = await db.select().from(schema.accounts);
    const credential = accounts.find(
      (account: { userId: number; providerId: string }) =>
        account.userId === created?.id && account.providerId === 'credential',
    );
    expect(credential, 'signup should have written a credential account').toBeDefined();
    expect(credential?.password).toBeTruthy();
  });

  it('creates a user alongside the bootstrap admin', async () => {
    // The e2e case exactly: a deployment whose admin was seeded at startup, taking its first
    // self-registration. PostgreSQL leaves the users sequence at 1 after that explicit-id insert,
    // so without ensureAdminUser resyncing it this signup collides on the primary key and Better
    // Auth answers 422.
    const { auth, db, schema } = await bootWithSelfRegistration({ seedAdmin: true });
    const email = `after-admin-${Date.now()}@test.invalid`;

    const response = await auth.api.signUpEmail({
      body: { name: 'After Admin', email, password: 'SelfRegistration2026!' },
      asResponse: true,
    });
    expect(await statusAndBody(response)).toBe('200');

    const users = await db.select().from(schema.users);
    const created = users.find((user: { email: string }) => user.email === email);
    expect(created, 'signup should have created the user').toBeDefined();
    expect(created?.id).not.toBe(1);
    expect(users.find((user: { id: number }) => user.id === 1)?.role).toBe('admin');
  });

  it('refuses a second signup for the same address', async () => {
    const { auth } = await bootWithSelfRegistration();
    const email = `duplicate-${Date.now()}@test.invalid`;
    const body = { name: 'Duplicate', email, password: 'SelfRegistration2026!' };

    const first = await auth.api.signUpEmail({ body, asResponse: true });
    expect(await statusAndBody(first)).toBe('200');

    const second = await auth.api.signUpEmail({ body, asResponse: true });
    expect(second.status).not.toBe(200);
  });
});
