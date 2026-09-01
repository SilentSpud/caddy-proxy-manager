/**
 * A complete OAuth sign-in against a real OIDC provider, in the fast suite.
 *
 * This exists because of a regression that reached main. `advanced.database.joins` was enabled to
 * let Better Auth fetch a session and its user in one query instead of two. It worked — getSession
 * dropped to a single statement, and a test proved it. But Better Auth builds a *different* join
 * during the OAuth callback, and that one failed:
 *
 *     db.query.accounts.findFirst with: [users]     <- fine
 *     db.query.users.findFirst    with: [accountss] <- TypeError: undefined is not an object
 *                                                      (evaluating 'relation.referencedTable')
 *
 * The drizzle adapter derives the many-side join key by appending "s" to the model name. This
 * app's model names are already plural (`accounts`, configured in auth-server.ts), so it asked for
 * `accountss` and drizzle had no such relation. `usePlural: true` is not the fix — it pluralizes
 * every model name, so `verifications` becomes `verificationss` and startup fails outright. The
 * only working spelling was to name the relations `accountss`/`sessionss`, which depends on an
 * adapter quirk rather than anything documented, so joins stay off.
 *
 * Nothing in the fast suites could see it. The unit auth tests stub `betterAuth` and assert the
 * options object, so no adapter code runs; the other integration tests drive the adapter directly
 * and never build the queries a callback builds. Only the end-to-end suite caught it — after the
 * push, 14 minutes later. This closes that gap: it exercises the real callback in about a second.
 *
 * Needs the mock IdP running (see tests/helpers/mock-idp.ts); skips with a note when it is not.
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { vi } from '@/tests/helpers/vi';
import { fresh } from '@/tests/helpers/fresh';
import { reloadDbModule } from '@/tests/helpers/fresh-db';
import {
  MOCK_IDP_CLAIMS,
  MOCK_IDP_ISSUER,
  completeOAuthSignIn,
  isMockIdpReachable,
} from '@/tests/helpers/mock-idp';

const IDP_AVAILABLE = await isMockIdpReachable();
if (!IDP_AVAILABLE) {
  console.log(
    `[oauth-flow] mock IdP not reachable at ${MOCK_IDP_ISSUER} — skipping. ` +
      'See tests/helpers/mock-idp.ts for the one-line docker command.',
  );
}

const PROVIDER_ID = 'mock';
const cleanups: Array<() => void> = [];

function resetDbModuleState() {
  delete (globalThis as typeof globalThis & { __DRIZZLE_DB__?: unknown }).__DRIZZLE_DB__;
  delete (globalThis as typeof globalThis & { __DB_CLIENT__?: unknown }).__DB_CLIENT__;
  delete (globalThis as typeof globalThis & { __MIGRATIONS_RAN__?: boolean }).__MIGRATIONS_RAN__;
}

afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
  process.env.DATABASE_URL = ':memory:';
  resetDbModuleState();
});

/** Boot the app against a fresh database with the mock IdP registered as an env provider. */
async function bootWithMockProvider() {
  const directory = mkdtempSync(join(tmpdir(), 'cpm-oauth-flow-'));
  cleanups.push(() => {
    Bun.gc(true);
    rmSync(directory, { recursive: true, force: true });
  });

  process.env.DATABASE_URL = `file:${join(directory, 'oauth.db')}`;
  // runEnvProviderSync() turns these into the oauth_providers row on db load. The slugified
  // provider name becomes the provider id.
  process.env.OAUTH_ENABLED = 'true';
  process.env.OAUTH_PROVIDER_NAME = 'Mock';
  process.env.OAUTH_CLIENT_ID = 'cpm';
  process.env.OAUTH_CLIENT_SECRET = 'secret';
  process.env.OAUTH_ISSUER = MOCK_IDP_ISSUER;
  process.env.AUTH_ALLOW_OAUTH_REGISTRATION = 'true';
  // Better Auth's limiter counts every sign-in attempt in-process, so a handful of tests in one
  // file trip it and the second one onwards fails with 429 rather than anything meaningful.
  process.env.AUTH_RATE_LIMIT_ENABLED = 'false';
  resetDbModuleState();

  // config.ts reads OAUTH_* once at module load, and db.ts's runEnvProviderSync() asks it whether
  // OAuth is configured. A cached copy evaluated before these variables were set reports disabled,
  // no provider row is written, and sign-in fails with PROVIDER_NOT_FOUND. Re-evaluate it first.
  const config = await import(`@/src/lib/config${fresh()}`);
  vi.mock('@/src/lib/config', () => ({ ...config }));

  const { dbModule, schema } = await reloadDbModule();
  cleanups.push(() => (dbModule.client as { close?: () => void })?.close?.());

  // fresh() and not Date.now(): two boots inside the same millisecond would resolve to the same
  // specifier, so auth-server would not be re-evaluated and getAuth() would hand back an instance
  // still bound to the previous test's database.
  const authServer = await import(`@/src/lib/auth-server${fresh()}`);
  const auth = (await authServer.getAuth()) as any;
  return { auth, db: dbModule.default, schema };
}

describe.if(IDP_AVAILABLE)('OAuth sign-in against a real IdP', () => {
  it('completes the callback and provisions the federated user', async () => {
    const { auth, db, schema } = await bootWithMockProvider();

    const result = await completeOAuthSignIn(auth, { providerId: PROVIDER_ID });
    expect(result.location).not.toContain('error');
    expect(result.ok).toBe(true);

    const users = await db.select().from(schema.users);
    const federated = users.find((user) => user.email === MOCK_IDP_CLAIMS.email);
    expect(federated, 'OAuth sign-in should have created the user').toBeDefined();
  });

  it('writes the linked account row keyed by the provider subject', async () => {
    const { auth, db, schema } = await bootWithMockProvider();
    await completeOAuthSignIn(auth, { providerId: PROVIDER_ID });

    const accounts = await db.select().from(schema.accounts);
    const linked = accounts.find((account) => account.accountId === MOCK_IDP_CLAIMS.sub);
    expect(linked, 'the OAuth identity should be linked to an account row').toBeDefined();
    expect(linked?.providerId).toBe(PROVIDER_ID);
    // better-auth 1.7 keys external identities by (issuer, accountId), so a blank issuer here
    // means the account exists but will never resolve at the next sign-in.
    expect(linked?.issuer).toBeTruthy();
  });

  it('ignores a role claim from the IdP', async () => {
    // The mock returns role:"admin". Better Auth's generic-OAuth signup spreads raw claims into
    // the new user and ignores `input: false`, so enforceSafeUserDefaults has to override it. The
    // end-to-end suite covers this too; having it here means a broken hook is caught in seconds.
    const { auth, db, schema } = await bootWithMockProvider();
    await completeOAuthSignIn(auth, { providerId: PROVIDER_ID });

    const users = await db.select().from(schema.users);
    const federated = users.find((user) => user.email === MOCK_IDP_CLAIMS.email);
    expect(federated?.role).toBe('user');
    expect(federated?.status).toBe('active');
  });

  it('issues a session the app can then read back', async () => {
    const { auth, db, schema } = await bootWithMockProvider();
    const result = await completeOAuthSignIn(auth, { providerId: PROVIDER_ID });

    const sessions = await db.select().from(schema.sessions);
    expect(sessions).toHaveLength(1);

    const session = await auth.api.getSession({ headers: new Headers({ cookie: result.cookie }) });
    expect(session?.user?.email).toBe(MOCK_IDP_CLAIMS.email);
  });
});
