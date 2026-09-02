import { defineConfig } from "drizzle-kit";
import { resolveDatabaseTarget } from "./src/lib/db/dialect";

/**
 * PostgreSQL only. `drizzle/legacy-sqlite/` still holds the SQLite migrations every pre-3.1
 * deployment ran; nothing generates into it any more, and it exists so the migration flow's tests
 * can build a realistic old database to read.
 *
 *   DATABASE_URL=postgres://... bun run db:generate
 */
export default defineConfig({
  out: "./drizzle/postgres",
  schema: "./src/lib/db/schema.pg.ts",
  dialect: "postgresql",
  dbCredentials: { url: resolveDatabaseTarget(process.env.DATABASE_URL).url },
});
