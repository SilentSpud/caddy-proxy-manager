/**
 * The driver, and the schema migrations that run against it.
 *
 * PostgreSQL only, through Bun.SQL. SQLite was supported through 3.0; the only code that still
 * opens a SQLite file is ./legacy-sqlite.ts, which the migration flow uses to read an old
 * deployment's database read-only.
 */
import { SQL } from "bun";
import { drizzle, type BunSQLDatabase } from "drizzle-orm/bun-sql";
import { migrate } from "drizzle-orm/bun-sql/migrator";
import { resolve as resolvePath } from "node:path";
import { driverOptions, resolveDatabaseTarget } from "./dialect";
import * as pgSchema from "./schema.pg";

export type Db = BunSQLDatabase<typeof pgSchema> & { $client: unknown };

type GlobalForDrizzle = typeof globalThis & {
  __DRIZZLE_DB__?: Db;
  __DB_CLIENT__?: SQL;
  __MIGRATIONS_RAN__?: boolean;
};

const globalForDrizzle = globalThis as GlobalForDrizzle;

export const target = resolveDatabaseTarget(process.env);

/**
 * Connections the pool may open. Bun.SQL defaults to 10 and says so nowhere; measured, 30
 * concurrent queries against a default client run in three batches. SQLite had no such ceiling —
 * it was in-process — so this limit arrived with PostgreSQL rather than being chosen, and an
 * instance serving more concurrent work than this queues behind it.
 *
 * Stays an environment variable rather than a stored setting: the pool has to exist before
 * anything can be read from the database.
 */
const DEFAULT_POOL_MAX = 10;
const poolMax = Number(process.env.DATABASE_POOL_MAX) || DEFAULT_POOL_MAX;

/** The tables handed to the driver. ./schema.ts re-exports these rather than importing separately. */
export const activeSchema = pgSchema;

/**
 * The raw driver handle. Only the migration path should need it.
 *
 * Spread from the target rather than assembled here: when the environment gave discrete fields,
 * they reach the driver as fields, so a password containing `/` or `@` is a password rather than a
 * URL delimiter. See ./dialect.ts.
 */
export const client: SQL =
  globalForDrizzle.__DB_CLIENT__ ?? new SQL({ ...driverOptions(target), max: poolMax });

export const db: Db =
  globalForDrizzle.__DRIZZLE_DB__ ?? (drizzle(client, { schema: pgSchema }) as unknown as Db);

// Dev-mode module reloads would otherwise open a new connection per edit.
if (process.env.NODE_ENV !== "production") {
  globalForDrizzle.__DB_CLIENT__ = client;
  globalForDrizzle.__DRIZZLE_DB__ = db;
}

const migrationsFolder = resolvePath(process.cwd(), "drizzle", "postgres");

/** True for the "table already exists" race between parallel Next build workers. */
function isAlreadyExistsError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("message" in error)) return false;
  const code = "code" in error ? (error as { code: unknown }).code : undefined;
  // Matched on the driver's error code, never on message text alone: a bare "already exists"
  // substring would also swallow genuine migration failures that happen to mention it.
  // 42P07 is PostgreSQL's duplicate_table, 42P06 duplicate_schema.
  return code === "42P07" || code === "42P06";
}

export async function runSchemaMigrations(): Promise<void> {
  if (globalForDrizzle.__MIGRATIONS_RAN__) {
    return;
  }

  try {
    await migrate(db as unknown as Parameters<typeof migrate>[0], { migrationsFolder });
    globalForDrizzle.__MIGRATIONS_RAN__ = true;
  } catch (error: unknown) {
    // Pages may be pre-rendered in parallel during the build, racing the migrations. If the
    // tables already exist, continue.
    if (isAlreadyExistsError(error)) {
      console.log("Database tables already exist, skipping migrations");
      globalForDrizzle.__MIGRATIONS_RAN__ = true;
      return;
    }
    throw error;
  }
}

/**
 * True when the connection points at a throwaway database that carries no deployment history, so
 * the one-time data migrations in ../db.ts have nothing to migrate and are skipped.
 *
 * Under SQLite this was `:memory:`. There is no PostgreSQL equivalent, so it is now an explicit
 * opt-in that only the test harness sets.
 */
export const isEphemeral = process.env.CPM_EPHEMERAL_DB === "true";

/** A statement produced inside a transaction. */
// biome-ignore lint/suspicious/noExplicitAny: a drizzle query builder's type is per-table; the only contract this needs is "executable"
type Executable = PromiseLike<any>;

/**
 * Run a batch of statements in one transaction.
 *
 * The callback returns statements rather than executing them: the shape is left over from
 * supporting bun:sqlite alongside Bun.SQL, whose transaction bodies could not be written the same
 * way. Kept because every caller is written to it, and it still reads as one reviewable list.
 */
export async function runInTransaction(
  // biome-ignore lint/suspicious/noExplicitAny: `tx` is the per-dialect transaction handle
  build: (tx: any) => Executable[],
): Promise<void> {
  // biome-ignore lint/suspicious/noExplicitAny: see above
  await (db as any).transaction(async (tx: any) => {
    for (const statement of build(tx)) {
      await statement;
    }
  });
}
