/**
 * Finding and vetting a pre-3.1 SQLite database.
 *
 * An upgrading deployment has a file somewhere its `.env` used to point at, and the operator
 * should not have to tell us where — but neither should we open something at a guessed path and
 * start copying rows out of it. So candidates are discovered, then each is opened read-only and
 * checked against the schema we expect before it is offered as something to migrate.
 *
 * Nothing here writes. The importer is a separate module for that reason: this one can be pointed
 * at anything without consequence.
 */
import { Database } from "bun:sqlite";
import { existsSync, readdirSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

/**
 * Where a 3.0 deployment's database actually sat: the documented Docker path, the repo-relative
 * default, and the working directory for a bare `bun start`. `LEGACY_SQLITE_PATH` short-circuits
 * all of it for anyone who moved theirs.
 */
const SEARCH_DIRECTORIES = ["/app/data", "./data", "."];

/** Tables every version of the schema had. A file without them is not one of ours. */
const REQUIRED_TABLES = ["users", "settings", "proxy_hosts", "certificates"] as const;

export type LegacyCandidate = {
  path: string;
  sizeBytes: number;
  /** Row counts for the tables an operator would recognise, so they can tell two files apart. */
  counts: { users: number; proxyHosts: number; certificates: number; settings: number };
  /** When the newest row we can date was written, as a hint at which file is the live one. */
  lastUpdatedAt: string | null;
};

export type LegacyRejection = { path: string; reason: string };

export type LegacyScan = {
  candidates: LegacyCandidate[];
  /** Files that looked like databases but are not ours, kept so the UI can say why. */
  rejected: LegacyRejection[];
};

function tableNames(database: Database): Set<string> {
  const rows = database
    .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all();
  return new Set(rows.map((row) => row.name));
}

function countRows(database: Database, table: string, present: Set<string>): number {
  if (!present.has(table)) return 0;
  // The table name is from sqlite_master, not from user input, so it cannot be a parameter.
  const row = database.query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM "${table}"`).get();
  return row?.n ?? 0;
}

/** The newest `updatedAt` across the tables that have one. Null when nothing is dated. */
function newestUpdate(database: Database, present: Set<string>): string | null {
  let newest: string | null = null;
  for (const table of ["proxy_hosts", "settings", "users"]) {
    if (!present.has(table)) continue;
    try {
      const row = database
        .query<{ value: string | null }, []>(`SELECT MAX("updatedAt") AS value FROM "${table}"`)
        .get();
      if (row?.value && (!newest || row.value > newest)) newest = row.value;
    } catch {
      // A schema old enough to lack the column tells us nothing here; it is a display hint only.
    }
  }
  return newest;
}

/**
 * Open a file read-only and decide whether it is a Caddy Proxy Manager database.
 *
 * Returns the candidate, or a rejection carrying the reason — which the setup UI shows verbatim,
 * because "that file is a Caddy Proxy Manager database but has no users table" is the difference
 * between an operator picking a different file and giving up.
 */
export function inspectLegacyDatabase(path: string): LegacyCandidate | LegacyRejection {
  if (!existsSync(path)) {
    return { path, reason: "No file at that path." };
  }

  let database: Database;
  try {
    database = new Database(path, { readonly: true });
  } catch (error) {
    return { path, reason: `Not a readable SQLite database: ${describe(error)}` };
  }

  try {
    const present = tableNames(database);
    const missing = REQUIRED_TABLES.filter((table) => !present.has(table));
    if (missing.length > 0) {
      return {
        path,
        reason: `Missing the ${missing.join(", ")} table(s) — this is not a Caddy Proxy Manager database.`,
      };
    }

    return {
      path,
      sizeBytes: statSync(path).size,
      counts: {
        users: countRows(database, "users", present),
        proxyHosts: countRows(database, "proxy_hosts", present),
        certificates: countRows(database, "certificates", present),
        settings: countRows(database, "settings", present),
      },
      lastUpdatedAt: newestUpdate(database, present),
    };
  } catch (error) {
    return { path, reason: `Could not read the database: ${describe(error)}` };
  } finally {
    database.close();
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function candidateFiles(): string[] {
  const pinned = process.env.LEGACY_SQLITE_PATH?.trim();
  if (pinned) {
    return [isAbsolute(pinned) ? pinned : resolve(process.cwd(), pinned)];
  }

  const found: string[] = [];
  for (const directory of SEARCH_DIRECTORIES) {
    const absolute = resolve(process.cwd(), directory);
    if (!existsSync(absolute)) continue;
    let entries: string[];
    try {
      entries = readdirSync(absolute);
    } catch {
      continue; // An unreadable directory is not worth failing the whole scan over.
    }
    for (const entry of entries) {
      // `-wal` and `-shm` are SQLite's sidecar files, not databases in their own right.
      if (!entry.endsWith(".db")) continue;
      const file = join(absolute, entry);
      if (!found.includes(file)) found.push(file);
    }
  }
  return found;
}

/**
 * Every SQLite database on this host that looks like ours.
 *
 * More than one is a real situation — a stale copy beside the live file, or a backup — and the
 * flow asks the operator which rather than guessing, since picking wrong migrates the wrong data
 * and there is no obvious signal that it happened.
 */
export function scanForLegacyDatabases(): LegacyScan {
  const candidates: LegacyCandidate[] = [];
  const rejected: LegacyRejection[] = [];

  for (const path of candidateFiles()) {
    const result = inspectLegacyDatabase(path);
    if ("reason" in result) {
      rejected.push(result);
    } else {
      candidates.push(result);
    }
  }

  // Busiest first: the file with the most proxy hosts is almost always the live one.
  candidates.sort((a, b) => b.counts.proxyHosts - a.counts.proxyHosts);
  return { candidates, rejected };
}
