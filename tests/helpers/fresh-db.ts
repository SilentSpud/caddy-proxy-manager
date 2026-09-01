import { vi } from './vi';
import { fresh } from './fresh';

export type ReloadedDb = {
  dbModule: typeof import('@/src/lib/db');
  schema: typeof import('@/src/lib/db/schema');
};

/**
 * Re-evaluate the database layer against whatever DATABASE_URL currently says.
 *
 * Three modules have to move together. src/lib/db.ts opens nothing itself — src/lib/db/connection.ts
 * creates the driver and runs migrations — and src/lib/db/schema.ts re-exports the table objects
 * connection.ts handed that driver. Putting a `?fresh=` suffix on db.ts alone reuses the cached
 * connection and schema, so the "reloaded" module would still be pointed at whichever database the
 * very first import opened, holding that dialect's tables.
 *
 * All three are re-evaluated here, in dependency order, and the plain specifiers are pointed at the
 * new copies so the live bindings other modules already read through are rewritten too.
 *
 * The returned namespaces are the authoritative ones for the caller. Prefer them over importing the
 * plain specifier afterwards: `vi.mock` is global and last-write-wins, so a later reload in the same
 * file (a test covering more than one backend) would move the plain specifier out from under you.
 *
 * Callers must set process.env.DATABASE_URL and clear the __DRIZZLE_DB__ / __DB_CLIENT__ /
 * __MIGRATIONS_RAN__ globals before calling.
 */
export async function reloadDbModule(): Promise<ReloadedDb> {
  const connection = await import(`@/src/lib/db/connection${fresh()}`);
  vi.mock('@/src/lib/db/connection', () => ({ ...connection }));

  const schema = (await import(
    `@/src/lib/db/schema${fresh()}`
  )) as typeof import('@/src/lib/db/schema');
  vi.mock('@/src/lib/db/schema', () => ({ ...schema }));

  const dbModule = (await import(`@/src/lib/db${fresh()}`)) as typeof import('@/src/lib/db');
  vi.mock('@/src/lib/db', () => ({ ...dbModule }));

  return { dbModule, schema };
}
