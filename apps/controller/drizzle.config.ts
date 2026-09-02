import { defineConfig } from "drizzle-kit";
import { DEFAULT_DATABASE_URL, resolveDatabaseTarget } from "./src/lib/db/dialect";

/**
 * drizzle-kit is single-dialect per invocation, so the config follows DATABASE_URL the same way
 * the runtime does. Each backend keeps its own migration folder because the generated DDL is not
 * portable — `integer ... autoincrement` vs `serial`, `integer` booleans vs `boolean`.
 *
 *   bun run db:generate                                     # SQLite -> drizzle/
 *   DATABASE_URL=postgres://... bun run db:generate         # PostgreSQL -> drizzle/postgres/
 */
const target = resolveDatabaseTarget(process.env.DATABASE_URL);

export default target.dialect === "postgres"
  ? defineConfig({
      out: "./drizzle/postgres",
      schema: "./src/lib/db/schema.pg.ts",
      dialect: "postgresql",
      dbCredentials: { url: target.url },
    })
  : defineConfig({
      out: "./drizzle",
      schema: "./src/lib/db/schema.sqlite.ts",
      dialect: "sqlite",
      dbCredentials: { url: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL },
    });
