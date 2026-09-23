import { defineConfig } from "drizzle-kit";
import { resolveDatabaseTarget } from "./src/lib/db/dialect";

/**
 * drizzle-kit is single-dialect per invocation, so this follows DATABASE_URL the way the runtime
 * does, and each backend keeps its own migration folder. After a schema change, run both:
 *
 *   bun scripts/generate-sqlite-schema.ts
 *   DATABASE_URL=postgres://... bun run db:generate     # -> drizzle/postgres/
 *   DATABASE_URL=file:./data/cpm.db bun run db:generate # -> drizzle/sqlite/
 *
 * `drizzle/legacy-sqlite/` holds the migrations every pre-3.0 deployment ran. Nothing generates
 * into it; it exists so the migration flow's tests can build a realistic old database.
 *
 * The POSTGRES_* fields work here too: drizzle-kit takes discrete credentials as readily as a URL,
 * so a password with a `/` in it never has to survive being parsed as one.
 */
const target = resolveDatabaseTarget(process.env);

export default target.kind === "sqlite"
  ? defineConfig({
      out: "./drizzle/sqlite",
      schema: "./src/lib/db/schema.sqlite.ts",
      dialect: "sqlite",
      dbCredentials: { url: target.path },
    })
  : defineConfig({
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
