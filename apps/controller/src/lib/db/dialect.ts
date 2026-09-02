/**
 * Which database backend a DATABASE_URL selects, and how to reach it.
 *
 * Kept in its own leaf module (no drizzle, no driver imports) so drizzle.config.ts, the runtime
 * connection in db.ts and the tests can all agree on how a URL is read without pulling in either
 * driver. Only the backends Bun ships a native driver for that drizzle can also target are
 * supported: bun:sqlite and Bun.SQL's PostgreSQL adapter.
 */
import { isAbsolute, resolve as resolvePath } from "node:path";

export type DatabaseDialect = "sqlite" | "postgres";

export type DatabaseTarget =
  /** `path` is an absolute filesystem path, or the literal ":memory:". */
  | { dialect: "sqlite"; path: string }
  /** `url` is a libpq-style connection string handed straight to Bun.SQL. */
  | { dialect: "postgres"; url: string };

export const DEFAULT_DATABASE_URL = "file:./data/caddy-proxy-manager.db";

/**
 * Bun.SQL also speaks MySQL and MariaDB, but drizzle-orm's Bun driver (`drizzle-orm/bun-sql`)
 * only builds PostgreSQL, and MySQL has no RETURNING for the insert paths this app relies on.
 * Named here so an operator pointing at MySQL gets a straight answer instead of a filesystem
 * error from the SQLite branch treating "mysql://..." as a relative filename.
 */
const UNSUPPORTED_SCHEMES = new Map<string, string>([
  ["mysql", "MySQL"],
  ["mariadb", "MariaDB"],
  ["mssql", "SQL Server"],
  ["sqlserver", "SQL Server"],
  ["mongodb", "MongoDB"],
]);

/**
 * A `file:` URL exposes its path with a leading slash, so a Windows absolute path arrives as
 * "/C:/data/app.db" and resolves against the drive root — drop the slash when a drive letter
 * follows. Not `fileURLToPath`, which rejects POSIX-style file URLs on Windows. Windows-only; on
 * POSIX "/C:/x" is a real path. `platform` is a parameter so tests can cover both.
 */
export function stripLeadingSlashBeforeDriveLetter(
  pathname: string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform !== "win32") return pathname;
  return /^\/[A-Za-z]:[/\\]/.test(pathname) ? pathname.slice(1) : pathname;
}

export function resolveSqlitePath(rawUrl: string): string {
  if (!rawUrl) {
    return ":memory:";
  }
  if (rawUrl === ":memory:" || rawUrl === "file::memory:" || rawUrl === "sqlite::memory:") {
    return ":memory:";
  }

  // `sqlite:` is an explicit opt-in to the SQLite branch; past that point it reads like `file:`.
  const url = rawUrl.startsWith("sqlite://")
    ? `file:${rawUrl.slice("sqlite://".length)}`
    : rawUrl.startsWith("sqlite:")
      ? `file:${rawUrl.slice("sqlite:".length)}`
      : rawUrl;

  if (url.startsWith("file:./") || url.startsWith("file:../")) {
    const relative = url.slice("file:".length);
    return resolvePath(/* turbopackIgnore: true */ process.cwd(), relative);
  }

  if (url.startsWith("file:")) {
    try {
      const fileUrl = new URL(url);
      if (fileUrl.host && fileUrl.host !== "localhost") {
        throw new Error("Remote SQLite hosts are not supported.");
      }
      return stripLeadingSlashBeforeDriveLetter(decodeURIComponent(fileUrl.pathname));
    } catch {
      const remainder = url.slice("file:".length);
      if (!remainder) {
        return ":memory:";
      }
      return isAbsolute(remainder)
        ? remainder
        : resolvePath(/* turbopackIgnore: true */ process.cwd(), remainder);
    }
  }

  return isAbsolute(url) ? url : resolvePath(/* turbopackIgnore: true */ process.cwd(), url);
}

/** The scheme of a URL-shaped string, lowercased. Null for bare filesystem paths. */
function schemeOf(rawUrl: string): string | null {
  const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(rawUrl);
  if (!match) return null;
  const scheme = match[1].toLowerCase();
  // Windows drive letters ("C:\data\app.db") parse as a one-character scheme.
  return scheme.length === 1 ? null : scheme;
}

/**
 * Read DATABASE_URL into the backend it names. Anything without a recognized scheme is a SQLite
 * path, which is what every pre-PostgreSQL deployment has in its .env.
 */
export function resolveDatabaseTarget(rawUrl: string | undefined): DatabaseTarget {
  const url = (rawUrl ?? DEFAULT_DATABASE_URL).trim();
  const scheme = schemeOf(url);

  if (scheme === "postgres" || scheme === "postgresql") {
    return { dialect: "postgres", url };
  }

  const unsupported = scheme ? UNSUPPORTED_SCHEMES.get(scheme) : undefined;
  if (unsupported) {
    throw new Error(
      `DATABASE_URL names ${unsupported}, which is not supported. Use a SQLite path ` +
        `(file:./data/caddy-proxy-manager.db) or a PostgreSQL URL (postgres://user:pass@host/db).`,
    );
  }

  return { dialect: "sqlite", path: resolveSqlitePath(url) };
}

/** The dialect alone, for callers that only need to branch. */
export function resolveDatabaseDialect(rawUrl: string | undefined): DatabaseDialect {
  return resolveDatabaseTarget(rawUrl).dialect;
}
