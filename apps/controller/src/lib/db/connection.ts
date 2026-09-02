/**
 * Driver selection and the handful of operations that cannot be written once for both backends.
 *
 * `db` is typed as the PostgreSQL drizzle database regardless of which driver actually backs it —
 * see the note in ./schema.ts for why PostgreSQL is the canonical side. Everything in this file
 * exists because it is the only place allowed to know the difference.
 */
import { Database } from "bun:sqlite";
import { SQL } from "bun";
import { drizzle as drizzleSqlite } from "drizzle-orm/bun-sqlite";
import { migrate as migrateSqlite } from "drizzle-orm/bun-sqlite/migrator";
import { drizzle as drizzlePg, type BunSQLDatabase } from "drizzle-orm/bun-sql";
import { migrate as migratePg } from "drizzle-orm/bun-sql/migrator";
import { mkdirSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { resolveDatabaseTarget, type DatabaseTarget } from "./dialect";
import { repairLegacySqliteSchema } from "./legacy-sqlite";
import * as pgSchema from "./schema.pg";
import * as sqliteSchema from "./schema.sqlite";

export type Db = BunSQLDatabase<typeof pgSchema> & { $client: unknown };

type GlobalForDrizzle = typeof globalThis & {
  __DRIZZLE_DB__?: Db;
  __DB_CLIENT__?: Database | SQL;
  __MIGRATIONS_RAN__?: boolean;
};

const globalForDrizzle = globalThis as GlobalForDrizzle;

export const target: DatabaseTarget = resolveDatabaseTarget(process.env.DATABASE_URL);
export const dialect = target.dialect;

/**
 * The table objects handed to the driver, and the single place the dialect is decided. ./schema.ts
 * re-exports these rather than choosing again: two modules reading process.env.DATABASE_URL at
 * their own import times can disagree, and a PostgreSQL connection holding SQLite tables fails as
 * a type error from the server ("column is of type boolean but expression is of type integer")
 * rather than anywhere near the cause.
 */
export const activeSchema = (target.dialect === "postgres"
  ? pgSchema
  : sqliteSchema) as unknown as typeof pgSchema;

function ensureDirectoryFor(pathname: string) {
  if (pathname === ":memory:") {
    return;
  }
  mkdirSync(dirname(pathname), { recursive: true });
}

function createClient(): Database | SQL {
  if (target.dialect === "postgres") {
    return new SQL(target.url);
  }
  ensureDirectoryFor(target.path);
  return new Database(target.path);
}

/**
 * The raw driver handle. `Database` under SQLite, `SQL` under PostgreSQL — narrow it with
 * `dialect` before use. Only the migration and legacy-repair paths should need it.
 */
export const client = globalForDrizzle.__DB_CLIENT__ ?? createClient();

function createDb(): Db {
  if (target.dialect === "postgres") {
    return drizzlePg(client as SQL, { schema: pgSchema }) as unknown as Db;
  }
  return drizzleSqlite(client as Database, { schema: sqliteSchema }) as unknown as Db;
}

export const db: Db = globalForDrizzle.__DRIZZLE_DB__ ?? createDb();

// Dev-mode module reloads would otherwise open a new connection per edit and, under SQLite, leak
// file handles until the process is restarted.
if (process.env.NODE_ENV !== "production") {
  globalForDrizzle.__DB_CLIENT__ = client;
  globalForDrizzle.__DRIZZLE_DB__ = db;
}

/**
 * SQLite keeps its migrations at drizzle/ (where every existing deployment already has them) and
 * PostgreSQL at drizzle/postgres/. The SQLite migrator reads only the tags listed in
 * meta/_journal.json, so the nested folder is invisible to it.
 */
const migrationsFolder =
  target.dialect === "postgres"
    ? resolvePath(process.cwd(), "drizzle", "postgres")
    : resolvePath(process.cwd(), "drizzle");

/** True for the "table already exists" race between parallel Next build workers. */
function isAlreadyExistsError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("message" in error)) return false;
  const message = (error as { message: unknown }).message;
  if (typeof message !== "string") return false;
  const code = "code" in error ? (error as { code: unknown }).code : undefined;
  // Matched on the driver's error code, never on message text alone: a bare "already exists"
  // substring would also swallow genuine migration failures that happen to mention it.
  // 42P07 is PostgreSQL's duplicate_table, 42P06 duplicate_schema.
  return (
    (code === "SQLITE_ERROR" && message.includes("already exists")) ||
    code === "42P07" ||
    code === "42P06"
  );
}

export async function runSchemaMigrations(): Promise<void> {
  if (target.dialect === "sqlite" && target.path === ":memory:") {
    return;
  }
  if (globalForDrizzle.__MIGRATIONS_RAN__) {
    return;
  }

  if (target.dialect === "sqlite") {
    repairLegacySqliteSchema(client as Database);
  }

  try {
    if (target.dialect === "postgres") {
      await migratePg(db as unknown as Parameters<typeof migratePg>[0], { migrationsFolder });
    } else {
      migrateSqlite(db as unknown as Parameters<typeof migrateSqlite>[0], { migrationsFolder });
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

/** True when the connection points at a throwaway database that carries no deployment history. */
export const isEphemeral = target.dialect === "sqlite" && target.path === ":memory:";

/** A statement produced inside a transaction: awaited under PostgreSQL, `.run()` under SQLite. */
// biome-ignore lint/suspicious/noExplicitAny: a drizzle query builder's type is per-dialect and per-table; the only contract this needs is "executable"
type Executable = PromiseLike<any> & { run?: () => unknown };

/**
 * Run a batch of statements in one transaction.
 *
 * The callback returns statements rather than executing them because the two drivers disagree on
 * how a transaction body may be written: `Bun.SQL` transactions take an async callback, while
 * `bun:sqlite` is synchronous and commits the moment its callback returns — handing it an async
 * function would commit before the first `await` resolved. Building the statements first lets the
 * one list be executed either way.
 */
export async function runInTransaction(
  // biome-ignore lint/suspicious/noExplicitAny: `tx` is the per-dialect transaction handle; callers see it through the pg-typed `db` surface
  build: (tx: any) => Executable[],
): Promise<void> {
  if (target.dialect === "postgres") {
    // biome-ignore lint/suspicious/noExplicitAny: see above
    await (db as any).transaction(async (tx: any) => {
      for (const statement of build(tx)) {
        await statement;
      }
    });
    return;
  }

  // biome-ignore lint/suspicious/noExplicitAny: see above
  (db as any).transaction((tx: any) => {
    for (const statement of build(tx) as Executable[]) {
      statement.run?.();
    }
  });
}
