import { eq } from "drizzle-orm";
import db, { nowIso } from "../db";
import { settings } from "../db/schema";
import { type DestinationId, isDestinationId, MORE_DRAWER_SLOTS } from "../nav/destinations";

/**
 * Which pages a user keeps in the mobile More drawer.
 *
 * One settings row per user. It is written straight to the table rather than through setSetting,
 * because setSetting stages its writes for Review & apply - and a personal navigation choice is
 * not instance configuration, has nothing to apply, and must not appear in anyone's staged diff.
 *
 * The row's presence is also the answer to "has this user customized the drawer?": the drawer
 * only offers to be customized until it has been, so there is no second flag to keep in step.
 */
const keyFor = (userId: number) => `nav:more_drawer:${userId}`;

/** The saved choice, or null when the user has never customized the drawer. */
export async function getMoreDrawerPins(userId: number): Promise<DestinationId[] | null> {
  const [row] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, keyFor(userId)))
    .limit(1);
  if (!row) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(row.value);
  } catch {
    // A row nobody can read is treated as a drawer nobody chose, which shows the defaults and
    // offers to customize again. Throwing here would take the whole dashboard layout down.
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  return parsed.filter(isDestinationId).slice(0, MORE_DRAWER_SLOTS);
}

export async function setMoreDrawerPins(
  userId: number,
  ids: readonly DestinationId[],
): Promise<void> {
  const value = JSON.stringify([...new Set(ids)].slice(0, MORE_DRAWER_SLOTS));
  const now = nowIso();
  await db
    .insert(settings)
    .values({ key: keyFor(userId), value, updatedAt: now })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: now } });
}
