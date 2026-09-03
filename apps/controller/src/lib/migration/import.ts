/**
 * Copying a vetted legacy SQLite database into PostgreSQL.
 *
 * Three things make this more than a row-for-row copy, and all three are derived from the schema
 * rather than from a list someone has to keep in step with it:
 *
 * 1. **Order.** Foreign keys mean `accounts` cannot land before `users`. The order is a
 *    topological sort of the schema's own foreign keys, so adding a table with a new reference
 *    orders itself.
 * 2. **Booleans.** SQLite stored them as 0/1 and PostgreSQL will not accept an integer in a
 *    boolean column. The columns that need converting are read off the drizzle schema.
 * 3. **Sequences.** Rows keep their ids so foreign keys stay intact, and PostgreSQL does not
 *    advance a `serial` for an explicit id — so every sequence is resynced afterwards. Skipping
 *    this is the bug that made the first post-migration insert fail with a duplicate key.
 */
import { Database } from "bun:sqlite";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { is, sql } from "drizzle-orm";
import db from "../db";
import * as schema from "../db/schema.pg";

/** How many rows to insert per statement. Large enough to be fast, small enough to stay readable. */
const BATCH_SIZE = 250;

export type TableResult = { table: string; copied: number; skipped: number };

export type ImportReport = {
  tables: TableResult[];
  /** Tables the old database had that this version no longer has, named so nothing looks lost. */
  droppedFromSchema: string[];
  totalRows: number;
};

type Described = {
  key: string;
  table: PgTable;
  name: string;
  columns: Array<{ name: string; isBoolean: boolean }>;
  references: string[];
  /** The serial column whose sequence needs resyncing, if the table has one. */
  serialColumn: string | null;
};

function describeTables(): Described[] {
  const described: Described[] = [];

  for (const [key, value] of Object.entries(schema)) {
    // The schema module also exports types and helpers. `is` is the only reliable runtime test:
    // `$inferSelect` is a type-only phantom and is not present on the object at all.
    if (!is(value, PgTable)) continue;
    const table = value as PgTable;

    let config: ReturnType<typeof getTableConfig>;
    try {
      config = getTableConfig(table);
    } catch {
      continue;
    }

    described.push({
      key,
      table,
      name: config.name,
      columns: config.columns.map((column) => ({
        name: column.name,
        isBoolean: column.dataType === "boolean",
      })),
      references: config.foreignKeys.map((foreignKey) => {
        const reference = foreignKey.reference();
        return getTableConfig(reference.foreignTable).name;
      }),
      serialColumn: config.columns.find((column) => column.columnType === "PgSerial")?.name ?? null,
    });
  }

  return described;
}

/**
 * Tables ordered so every reference is satisfied before the table that makes it.
 *
 * A self-reference is ignored rather than treated as a cycle — a table pointing at itself only
 * constrains row order within it, which the source database already satisfied.
 */
function inFkOrder(tables: Described[]): Described[] {
  const byName = new Map(tables.map((table) => [table.name, table]));
  const ordered: Described[] = [];
  const state = new Map<string, "visiting" | "done">();

  function visit(table: Described): void {
    const status = state.get(table.name);
    if (status === "done") return;
    if (status === "visiting") return; // A cycle; the remaining edge is handled by deferral below.
    state.set(table.name, "visiting");

    for (const reference of table.references) {
      if (reference === table.name) continue;
      const target = byName.get(reference);
      if (target) visit(target);
    }

    state.set(table.name, "done");
    ordered.push(table);
  }

  for (const table of tables) visit(table);
  return ordered;
}

function sqliteTables(source: Database): Set<string> {
  const rows = source
    .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all();
  return new Set(rows.map((row) => row.name));
}

function sqliteColumns(source: Database, table: string): Set<string> {
  const rows = source.query<{ name: string }, []>(`PRAGMA table_info("${table}")`).all();
  return new Set(rows.map((row) => row.name));
}

/**
 * Convert one SQLite row into what the PostgreSQL column expects.
 *
 * Only booleans actually differ. Everything else — text, integers, the JSON this app keeps in text
 * columns — round-trips as-is, and coercing it would risk changing values that were already right.
 */
function convertRow(
  row: Record<string, unknown>,
  columns: Described["columns"],
  available: Set<string>,
): Record<string, unknown> {
  const converted: Record<string, unknown> = {};
  for (const column of columns) {
    if (!available.has(column.name)) continue; // The old schema predates this column.
    const value = row[column.name];
    converted[column.name] =
      column.isBoolean && (value === 0 || value === 1) ? value === 1 : (value ?? null);
  }
  return converted;
}

/**
 * Copy everything from `sqlitePath` into the connected PostgreSQL database.
 *
 * The destination is expected to be empty — this runs during setup, before anything else has been
 * created — so rows keep their ids and conflicts are skipped rather than merged. Merging two
 * populated databases is a different problem, and guessing at it would silently pick a winner.
 */
export async function importLegacyDatabase(sqlitePath: string): Promise<ImportReport> {
  const source = new Database(sqlitePath, { readonly: true });

  try {
    const present = sqliteTables(source);
    const described = inFkOrder(describeTables());
    const known = new Set(described.map((table) => table.name));

    const results: TableResult[] = [];
    let totalRows = 0;

    for (const table of described) {
      if (!present.has(table.name)) {
        results.push({ table: table.name, copied: 0, skipped: 0 });
        continue;
      }

      const available = sqliteColumns(source, table.name);
      const rows = source.query<Record<string, unknown>, []>(`SELECT * FROM "${table.name}"`).all();

      let copied = 0;
      for (let index = 0; index < rows.length; index += BATCH_SIZE) {
        const batch = rows
          .slice(index, index + BATCH_SIZE)
          .map((row) => convertRow(row, table.columns, available));
        if (batch.length === 0) continue;

        // `returning` so the count is rows actually written: onConflictDoNothing silently drops
        // duplicates, and reporting the batch size would claim work a re-run did not do.
        const inserted = await db
          .insert(table.table)
          // biome-ignore lint/suspicious/noExplicitAny: the row shape is per-table, and this loop is generic over all thirty
          .values(batch as any)
          .onConflictDoNothing()
          .returning();
        copied += inserted.length;
      }

      if (table.serialColumn) {
        await resyncSequence(table.name, table.serialColumn);
      }

      results.push({ table: table.name, copied, skipped: rows.length - copied });
      totalRows += copied;
    }

    return {
      tables: results,
      // Named rather than silently ignored: an operator whose old database had waf_events should
      // be told those are gone, not left to notice later.
      droppedFromSchema: [...present].filter(
        (name) => !known.has(name) && !name.startsWith("sqlite_") && !name.startsWith("__drizzle"),
      ),
      totalRows,
    };
  } finally {
    source.close();
  }
}

/**
 * Move a serial's sequence past the highest id just inserted.
 *
 * `setval` with a third argument of false would set "next value is this"; the default true means
 * "this was the last value used", which is what a copied table needs.
 */
async function resyncSequence(table: string, column: string): Promise<void> {
  await db.execute(
    sql`SELECT setval(
          pg_get_serial_sequence(${table}, ${column}),
          GREATEST((SELECT COALESCE(MAX(${sql.identifier(column)}), 1) FROM ${sql.identifier(table)}), 1)
        )`,
  );
}
