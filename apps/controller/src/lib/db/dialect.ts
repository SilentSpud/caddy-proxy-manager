/**
 * How DATABASE_URL is read.
 *
 * Kept in its own leaf module (no drizzle, no driver imports) so drizzle.config.ts, the runtime
 * connection in db.ts and the tests can all agree on it without pulling in the driver.
 *
 * PostgreSQL only. SQLite was supported through 3.0 and is now reached exclusively by the
 * migration flow, which opens the old file read-only through ./legacy-sqlite.ts — never as the
 * application's own database.
 */

export type DatabaseTarget = {
  /** A libpq-style connection string, handed straight to Bun.SQL. */
  url: string;
};

/**
 * Named so an operator pointing at one of these gets a straight answer. `file:`/`sqlite:` is
 * called out separately because every pre-3.1 deployment has one in its .env, and the useful
 * response is "the app migrates it for you", not "unsupported scheme".
 */
const UNSUPPORTED_SCHEMES = new Map<string, string>([
  ["mysql", "MySQL"],
  ["mariadb", "MariaDB"],
  ["mssql", "SQL Server"],
  ["sqlserver", "SQL Server"],
  ["mongodb", "MongoDB"],
]);

const SQLITE_SCHEMES = new Set(["file", "sqlite"]);

/** The scheme of a URL-shaped string, lowercased. Null for bare filesystem paths. */
function schemeOf(rawUrl: string): string | null {
  const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(rawUrl);
  if (!match) return null;
  const scheme = match[1].toLowerCase();
  // Windows drive letters ("C:\data\app.db") parse as a one-character scheme.
  return scheme.length === 1 ? null : scheme;
}

const SQLITE_MESSAGE =
  "DATABASE_URL points at a SQLite file, which is no longer supported as the application " +
  "database. Point it at PostgreSQL (postgres://user:pass@host:5432/db) and start the app: it " +
  "detects the old file and offers to migrate it. See docs/overhaul-plan.md.";

export function resolveDatabaseTarget(rawUrl: string | undefined): DatabaseTarget {
  const url = rawUrl?.trim();
  if (!url) {
    throw new Error("DATABASE_URL is required. PostgreSQL only: postgres://user:pass@host:5432/db");
  }

  const scheme = schemeOf(url);
  if (scheme === "postgres" || scheme === "postgresql") {
    return { url };
  }

  // A bare path is what a pre-3.1 .env carries when it names the file directly.
  if (scheme === null || SQLITE_SCHEMES.has(scheme)) {
    throw new Error(SQLITE_MESSAGE);
  }

  const unsupported = UNSUPPORTED_SCHEMES.get(scheme);
  throw new Error(
    unsupported
      ? `DATABASE_URL names ${unsupported}, which is not supported. Use PostgreSQL ` +
          "(postgres://user:pass@host:5432/db)."
      : `DATABASE_URL has an unrecognized scheme "${scheme}". Use PostgreSQL ` +
          "(postgres://user:pass@host:5432/db).",
  );
}
