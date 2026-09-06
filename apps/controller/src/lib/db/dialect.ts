/**
 * How the environment names the database.
 *
 * Kept in its own leaf module (no drizzle, no driver imports) so drizzle.config.ts, the runtime
 * connection in db.ts and the tests can all agree on it without pulling in the driver.
 *
 * There are two ways to say it, and the second exists because of the first's one sharp edge. A URL
 * has to encode its password, and the place these deployments build one is a Compose file, where
 * the password arrives by shell interpolation and nothing encodes anything. A password containing
 * `/` ends the authority early — `postgres://cpm:pa/ss@postgres:5432/cpm` is a URL whose host is
 * `cpm:pa` and whose path is `/ss@postgres:5432/cpm` — and what the operator sees is a connection
 * failure naming a host they never configured. `@`, `#` and `?` each break it differently.
 *
 * So POSTGRES_* are read as discrete fields and handed to the driver as fields, where no character
 * is special and there is nothing to escape. DATABASE_URL still wins when it is set, because a URL
 * can carry options the fields cannot.
 *
 * PostgreSQL only. SQLite was supported through 3.0 and is now reached exclusively by the
 * migration flow, which opens the old file read-only through ./legacy-sqlite.ts — never as the
 * application's own database.
 */

/** Where the connection came from, so a caller can shape it for whatever it is configuring. */
export type DatabaseTarget =
  /** A libpq-style connection string, handed to the driver to parse. */
  | { kind: "url"; url: string }
  /** Discrete fields, which never passed through a URL and so were never encoded. */
  | {
      kind: "fields";
      hostname: string;
      port: number;
      username: string;
      password: string;
      database: string;
      tls: boolean;
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

/** What the bundled compose stack runs, so an operator who sets only a password gets it. */
const FIELD_DEFAULTS = {
  hostname: "postgres",
  port: 5432,
  username: "cpm",
  database: "cpm",
} as const;

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
  "detects the old file and offers to migrate it.";

const MISSING_MESSAGE =
  "No database is configured. Set POSTGRES_PASSWORD (with POSTGRES_HOST, POSTGRES_PORT, " +
  "POSTGRES_USER and POSTGRES_DB as needed), or DATABASE_URL for a full connection string. " +
  "PostgreSQL only.";

/** Trimmed, or undefined for a variable that is unset or blank — which .env files produce easily. */
function read(env: Record<string, string | undefined>, name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

/** A URL naming PostgreSQL, or a message explaining what the operator actually pointed at. */
function targetFromUrl(url: string): DatabaseTarget {
  const scheme = schemeOf(url);
  if (scheme === "postgres" || scheme === "postgresql") {
    return { kind: "url", url };
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

/** POSTGRES_PORT as a number, refusing anything that is not a port rather than defaulting past it. */
function portFrom(raw: string | undefined): number {
  if (raw === undefined) return FIELD_DEFAULTS.port;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`POSTGRES_PORT must be a port number between 1 and 65535, not "${raw}".`);
  }
  return port;
}

/**
 * Read POSTGRES_SSL, which is a plain on/off.
 *
 * Deliberately not an sslmode: `require`, `verify-ca` and `verify-full` differ in what they check
 * about the certificate, and a half-modelled mapping between them would be worse than not offering
 * one. A deployment that needs those wants DATABASE_URL, where libpq's own vocabulary applies.
 */
function tlsFrom(raw: string | undefined): boolean {
  if (raw === undefined) return false;
  const normalized = raw.toLowerCase();
  if (["true", "1", "yes", "on", "require"].includes(normalized)) return true;
  if (["false", "0", "no", "off", "disable"].includes(normalized)) return false;
  throw new Error(`POSTGRES_SSL must be true or false, not "${raw}".`);
}

/**
 * The database this process should connect to.
 *
 * Takes the whole environment rather than one variable because there is now more than one way to
 * name a database, and deciding between them is this module's job rather than every caller's.
 */
export function resolveDatabaseTarget(
  env: Record<string, string | undefined> = process.env,
): DatabaseTarget {
  const url = read(env, "DATABASE_URL");
  if (url) return targetFromUrl(url);

  // The password is the field that decides: host, port, user and database all have defaults that
  // match the bundled stack, and a deployment with none of them set has configured nothing at all.
  const password = read(env, "POSTGRES_PASSWORD");
  if (password === undefined) {
    throw new Error(MISSING_MESSAGE);
  }

  return {
    kind: "fields",
    hostname: read(env, "POSTGRES_HOST") ?? FIELD_DEFAULTS.hostname,
    port: portFrom(read(env, "POSTGRES_PORT")),
    username: read(env, "POSTGRES_USER") ?? FIELD_DEFAULTS.username,
    password,
    database: read(env, "POSTGRES_DB") ?? FIELD_DEFAULTS.database,
    tls: tlsFrom(read(env, "POSTGRES_SSL")),
  };
}

/**
 * The target as the driver's own options.
 *
 * `kind` is the only field that is ours rather than the driver's, so dropping it is all this does
 * — but doing it here means neither the connection nor drizzle.config has to know that.
 */
export function driverOptions(
  target: DatabaseTarget,
): Record<string, string | number | boolean | undefined> {
  const { kind: _kind, ...options } = target;
  return options;
}

/**
 * How to describe the connection without printing the password.
 *
 * A URL is not summarised: it may carry credentials anywhere in it, and there is no safe partial
 * of an arbitrary one.
 */
export function describeTarget(target: DatabaseTarget): string {
  return target.kind === "url"
    ? "the server named by DATABASE_URL"
    : `${target.username}@${target.hostname}:${target.port}/${target.database}`;
}
