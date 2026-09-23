/**
 * The driver, and the schema migrations that run against it.
 *
 * PostgreSQL through Bun.SQL, or SQLite through bun:sqlite, chosen by ./dialect.ts. `db` is typed
 * as the PostgreSQL database either way: pg-core has no `.get()`/`.all()`/`.run()`, so a
 * SQLite-only call in app code fails typecheck rather than at a PostgreSQL deployment's first
 * request. Everything else in this file exists because it is the one place allowed to know which.
 */
import { Database } from "bun:sqlite";
import { SQL } from "bun";
import { drizzle as drizzlePg, type BunSQLDatabase } from "drizzle-orm/bun-sql";
import { migrate as migratePg } from "drizzle-orm/bun-sql/migrator";
import { drizzle as drizzleSqlite } from "drizzle-orm/bun-sqlite";
import { migrate as migrateSqlite } from "drizzle-orm/bun-sqlite/migrator";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { type DatabaseDialect, driverOptions, resolveDatabaseTarget } from "./dialect";
import { activeSchema, schemaDialect } from "./schema";
import * as pgSchema from "./schema.pg";

export type Db = BunSQLDatabase<typeof pgSchema> & { $client: unknown };

type GlobalForDrizzle = typeof globalThis & {
  __DRIZZLE_DB__?: Db;
  __DB_CLIENT__?: SQL | Database;
  __MIGRATIONS_RAN__?: boolean;
};

const globalForDrizzle = globalThis as GlobalForDrizzle;

export const target = resolveDatabaseTarget(process.env);
export const dialect: DatabaseDialect = target.kind === "sqlite" ? "sqlite" : "postgres";

// ./schema.ts chose its tables from the same environment. A PostgreSQL driver handed SQLite tables
// fails far from the cause ("column is of type boolean but expression is of type integer").
if (schemaDialect !== dialect) {
  throw new Error(`The ${schemaDialect} schema was loaded for a ${dialect} connection.`);
}

/**
 * Connections the pool may open. Bun.SQL defaults to 10 and says so nowhere; measured, 30
 * concurrent queries against a default client run in three batches. SQLite is in-process and
 * ignores it.
 *
 * Stays an environment variable rather than a stored setting: the pool has to exist before
 * anything can be read from the database.
 */
const DEFAULT_POOL_MAX = 10;
const poolMax = Number(process.env.DATABASE_POOL_MAX) || DEFAULT_POOL_MAX;

function openSqlite(path: string): Database {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const database = new Database(path, { create: true });
  // Off by default in SQLite, and every ON DELETE in the schema depends on it.
  database.run("PRAGMA foreign_keys = ON");
  // Readers stop blocking the writer, and a second writer waits rather than failing at once.
  database.run("PRAGMA journal_mode = WAL");
  database.run("PRAGMA busy_timeout = 5000");
  return database;
}

/**
 * The raw driver handle: `SQL` under PostgreSQL, `Database` under SQLite. Only the migration path
 * should need it.
 *
 * The PostgreSQL options are spread from the target rather than assembled here: when the
 * environment gave discrete fields they reach the driver as fields, so a password containing `/`
 * or `@` is a password rather than a URL delimiter. See ./dialect.ts.
 */
export const client: SQL | Database =
  globalForDrizzle.__DB_CLIENT__ ??
  (target.kind === "sqlite"
    ? openSqlite(target.path)
    : new SQL({ ...driverOptions(target), max: poolMax }));

export const db: Db =
  globalForDrizzle.__DRIZZLE_DB__ ??
  ((client instanceof Database
    ? drizzleSqlite(client, { schema: activeSchema as never })
    : drizzlePg(client, { schema: pgSchema })) as unknown as Db);

// Dev-mode module reloads would otherwise open a new connection per edit.
if (process.env.NODE_ENV !== "production") {
  globalForDrizzle.__DB_CLIENT__ = client;
  globalForDrizzle.__DRIZZLE_DB__ = db;
}

const migrationsFolder = resolvePath(process.cwd(), "drizzle", dialect);

/** True for the "table already exists" race between parallel Next build workers. */
function isAlreadyExistsError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("message" in error)) return false;
  const message = (error as { message: unknown }).message;
  const code = "code" in error ? (error as { code: unknown }).code : undefined;
  // Matched on the driver's error code, never on message text alone: a bare "already exists"
  // substring would also swallow genuine migration failures that happen to mention it.
  // 42P07 is PostgreSQL's duplicate_table, 42P06 duplicate_schema.
  return (
    code === "42P07" ||
    code === "42P06" ||
    (code === "SQLITE_ERROR" && typeof message === "string" && message.includes("already exists"))
  );
}

/**
 * Refuse a SQLite file from before 3.0, which an unmodified old .env still names.
 *
 * Today's SQLite history starts over at drizzle/sqlite/0000, so the migrator would try to create
 * tables that already exist - and the build-race handler below would swallow exactly that, leaving
 * the app running on a schema it does not know. Ours is recognisable by its own baseline in
 * __drizzle_migrations; a file with tables and no such row is someone else's history.
 */
function assertNotLegacySqlite(database: Database): void {
  const hasTables = database
    .query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'users'")
    .get();
  if (!hasTables) return;

  const journal = JSON.parse(
    readFileSync(resolvePath(migrationsFolder, "meta", "_journal.json"), "utf8"),
  ) as { entries: Array<{ when: number }> };
  const baseline = journal.entries[0]?.when;
  let ours = false;
  try {
    ours = !!database
      .query("SELECT 1 FROM __drizzle_migrations WHERE created_at = ?")
      .get(baseline ?? -1);
  } catch {
    // No migrations table at all: not ours either.
  }
  if (!ours) {
    throw new Error(
      "DATABASE_URL points at a SQLite database from before 3.0, which this version cannot run " +
        "on directly. Point DATABASE_URL at a new file (file:/app/data/cpm.db) or at PostgreSQL " +
        "and start the app: it finds the old database and offers to migrate it.",
    );
  }
}

export async function runSchemaMigrations(): Promise<void> {
  if (globalForDrizzle.__MIGRATIONS_RAN__) {
    return;
  }

  if (client instanceof Database) {
    assertNotLegacySqlite(client);
  }

  try {
    if (dialect === "sqlite") {
      migrateSqlite(db as unknown as Parameters<typeof migrateSqlite>[0], { migrationsFolder });
    } else {
      await migratePg(db as unknown as Parameters<typeof migratePg>[0], { migrationsFolder });
    }
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
 * the one-time data migrations in ../db.ts have nothing to migrate and are skipped: SQLite's
 * `:memory:`, or an explicit opt-in that only the test harness sets.
 */
export const isEphemeral =
  process.env.CPM_EPHEMERAL_DB === "true" ||
  (target.kind === "sqlite" && target.path === ":memory:");

/** A statement produced inside a transaction: awaited under PostgreSQL, `.run()` under SQLite. */
// biome-ignore lint/suspicious/noExplicitAny: a drizzle query builder's type is per-dialect and per-table; the only contract this needs is "executable"
type Executable = PromiseLike<any> & { run?: () => unknown };

/**
 * Run a batch of statements in one transaction.
 *
 * The callback returns statements rather than executing them because the drivers disagree on how
 * a transaction body may be written: Bun.SQL takes an async callback, while bun:sqlite commits the
 * moment its synchronous callback returns - an async body would commit before its first `await`.
 */
export async function runInTransaction(
  // biome-ignore lint/suspicious/noExplicitAny: `tx` is the per-dialect transaction handle
  build: (tx: any) => Executable[],
): Promise<void> {
  if (dialect === "sqlite") {
    // biome-ignore lint/suspicious/noExplicitAny: see above
    (db as any).transaction((tx: any) => {
      for (const statement of build(tx)) {
        statement.run?.();
      }
    });
    return;
  }

  // biome-ignore lint/suspicious/noExplicitAny: see above
  await (db as any).transaction(async (tx: any) => {
    for (const statement of build(tx)) {
      await statement;
    }
  });
}
