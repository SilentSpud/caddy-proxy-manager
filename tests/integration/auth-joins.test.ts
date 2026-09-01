/**
 * `advanced.database.joins` fetches a session and its user in one statement instead of two.
 *
 * It is asserted by counting SQL statements, not by checking that sign-in still works, because the
 * feature fails *quietly*: Better Auth's drizzle adapter resolves the join key from drizzle's
 * relational schema, and if the relations in db/schema.sqlite.ts are missing or misnamed it falls
 * back to separate queries with no error and no log line. A test that only asserted "the session
 * resolved" would pass just as happily with the optimization silently doing nothing.
 *
 * getSession runs on essentially every authenticated request (requireSession in src/lib/auth.ts),
 * so this is the hottest query path in the app.
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reloadDbModule } from '@/tests/helpers/fresh-db';

const USERNAME = 'joinsuser';
const PASSWORD = 'JoinsTestPassword2026!';

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

type Harness = {
  auth: any;
  cookie: string;
  /** SQL text of every statement prepared while `fn` ran. */
  recordStatements: (fn: () => Promise<unknown>) => Promise<string[]>;
};

async function signedInHarness(): Promise<Harness> {
  const directory = mkdtempSync(join(tmpdir(), 'cpm-auth-joins-'));
  cleanups.push(() => {
    Bun.gc(true);
    rmSync(directory, { recursive: true, force: true });
  });

  process.env.DATABASE_URL = `file:${join(directory, 'joins.db')}`;
  process.env.ADMIN_USERNAME = USERNAME;
  process.env.ADMIN_PASSWORD = PASSWORD;
  resetDbModuleState();

  const { dbModule } = await reloadDbModule();
  const client = dbModule.client as any;
  cleanups.push(() => client?.close?.());

  const authServer = await import(`@/src/lib/auth-server?joins=${Date.now()}`);
  const { ensureAdminUser } = await import(`@/src/lib/init-db?joins=${Date.now()}`);
  await ensureAdminUser();

  const auth = (await authServer.getAuth()) as any;
  const response: Response = await auth.api.signInUsername({
    body: { username: USERNAME, password: PASSWORD },
    asResponse: true,
  });
  const cookie = (response.headers.getSetCookie?.() ?? [])
    .map((value) => value.split(';')[0])
    .join('; ');
  expect(cookie).not.toBe('');

  const recordStatements = async (fn: () => Promise<unknown>): Promise<string[]> => {
    const seen: string[] = [];
    const original = client.prepare.bind(client);
    client.prepare = (sql: string, ...rest: unknown[]) => {
      seen.push(String(sql).replace(/\s+/g, ' ').trim());
      return original(sql, ...rest);
    };
    try {
      await fn();
    } finally {
      client.prepare = original;
    }
    return seen;
  };

  return { auth, cookie, recordStatements };
}

describe('Better Auth database joins', () => {
  it('resolves a session in a single statement', async () => {
    const { auth, cookie, recordStatements } = await signedInHarness();

    let session: { user?: { id: unknown } } | null = null;
    const statements = await recordStatements(async () => {
      session = await auth.api.getSession({ headers: new Headers({ cookie }) });
    });

    // Guard the count from passing vacuously on a failed lookup.
    expect(session).not.toBeNull();
    expect((session as unknown as { user?: { id: unknown } })?.user?.id).toBeDefined();

    // Two statements means the join silently fell back to a separate user lookup.
    expect(statements).toHaveLength(1);
  });

  it('reads the user through the session query rather than a second select', async () => {
    const { auth, cookie, recordStatements } = await signedInHarness();

    const statements = await recordStatements(async () => {
      await auth.api.getSession({ headers: new Headers({ cookie }) });
    });

    expect(statements).toHaveLength(1);
    const [statement] = statements;
    // One statement that reaches both tables: the user columns arrive inside the session query as
    // a correlated subselect. Without the join there would be two statements, the second a bare
    // `select ... from "users" where "users"."id" = ?`.
    expect(statement).toContain('from "sessions"');
    expect(statement).toContain('from "users"');
    expect(statement).toContain('"email"');
  });

  it('has joins actually enabled in the shipped config', async () => {
    // If this is ever turned off, the counts above become wrong rather than failing usefully.
    const { auth } = await signedInHarness();
    expect(auth.options?.advanced?.database?.joins).toBe(true);
  });
});
