import { customType } from "drizzle-orm/pg-core";

/**
 * A TEXT column holding an ISO-8601 timestamp, tolerant of being handed a Date.
 *
 * Every timestamp in this schema is stored as ISO text, and application code writes strings
 * (nowIso()). Better Auth's drizzle adapter writes Date objects instead, and a plain `text` column
 * binds its value straight through to the driver. bun:sqlite rejects a Date outright ("Binding
 * expected string, TypedArray, boolean, number, bigint or null"), failing every sign-in, while
 * Bun.SQL quietly serializes it — so without this the defect reaches SQLite only. Normalizing on
 * write keeps both backends storing the same thing.
 *
 * Storage and DDL are unchanged (still TEXT), so no migration is involved, and reads still return
 * a string.
 */
export const isoTimestamp = customType<{ data: string; driverData: string }>({
  dataType: () => "text",
  // Typed wider than the column's `string` because the values that make this type necessary are
  // exactly the ones the column type does not admit. A parameter type wider than the signature's
  // is still assignable, so this stays type-safe for our own callers.
  toDriver: (value: string | Date) => (value instanceof Date ? value.toISOString() : value),
});
