import { customType } from "drizzle-orm/sqlite-core";

/**
 * The SQLite twin of ./columns.pg.ts. This is the backend that needs it: bun:sqlite refuses to
 * bind a Date, and Better Auth's adapter writes Dates, so without it every sign-in fails.
 */
export const isoTimestamp = customType<{ data: string; driverData: string }>({
  dataType: () => "text",
  toDriver: (value: string | Date) => (value instanceof Date ? value.toISOString() : value),
});
