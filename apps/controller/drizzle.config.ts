import { defineConfig } from "drizzle-kit";
import { resolveDatabaseTarget } from "./src/lib/db/dialect";

/**
 * PostgreSQL only. `drizzle/legacy-sqlite/` still holds the SQLite migrations every pre-3.1
 * deployment ran; nothing generates into it any more, and it exists so the migration flow's tests
 * can build a realistic old database to read.
 *
 *   DATABASE_URL=postgres://... bun run db:generate
 *
 * The POSTGRES_* fields work here too, and for the same reason they exist at all: drizzle-kit
 * takes discrete credentials as readily as a URL, so a password with a `/` in it never has to
 * survive being parsed as one.
 */
const target = resolveDatabaseTarget(process.env);

export default defineConfig({
  out: "./drizzle/postgres",
  schema: "./src/lib/db/schema.pg.ts",
  dialect: "postgresql",
  dbCredentials:
    target.kind === "url"
      ? { url: target.url }
      : {
          host: target.hostname,
          port: target.port,
          user: target.username,
          password: target.password,
          database: target.database,
          ssl: target.tls,
        },
});
