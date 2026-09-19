import { eq } from "drizzle-orm";
import db, { nowIso } from "../db";
import { settings } from "../db/schema";
import { DEFAULT_TABLE_DENSITY, isTableDensity, type TableDensity } from "../table-density";

/**
 * A user's table density, stored the way the More drawer's pins are: one settings row per user,
 * written straight to the table. setSetting would stage it for Review & apply, and a personal
 * display choice is not instance configuration - it has nothing to apply and belongs in nobody's
 * staged diff.
 */
const keyFor = (userId: number) => `ui:table_density:${userId}`;

/** The saved density, or the default for a user who never chose or whose row cannot be read. */
export async function getTableDensity(userId: number): Promise<TableDensity> {
  const [row] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, keyFor(userId)))
    .limit(1);
  return isTableDensity(row?.value) ? row.value : DEFAULT_TABLE_DENSITY;
}

export async function setTableDensity(userId: number, density: TableDensity): Promise<void> {
  const now = nowIso();
  await db
    .insert(settings)
    .values({ key: keyFor(userId), value: density, updatedAt: now })
    .onConflictDoUpdate({ target: settings.key, set: { value: density, updatedAt: now } });
}
