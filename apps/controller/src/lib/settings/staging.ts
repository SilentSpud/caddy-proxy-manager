/**
 * The staged change set: what an operator has edited but not yet applied.
 *
 * Nothing here pushes to Caddy. Staging collects writes, `applyStagedSettings` in ./apply.ts moves
 * them into the `settings` table and reloads once. Keys and values match the `settings` table
 * exactly, so a staged row substitutes for a stored one with no translation.
 */

import db, { nowIso } from "../db";
import { settings, settingsStaged } from "../db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { getSetting } from "../settings";
import { withStagedReads } from "./staging-context";

export type StagedEntry = {
  key: string;
  /** Serialized JSON, as stored. */
  value: string;
  stagedAt: string;
};

/** Every key this operator has staged, oldest first. */
export async function listStagedSettings(userId: number): Promise<StagedEntry[]> {
  const rows = await db
    .select({
      key: settingsStaged.key,
      value: settingsStaged.value,
      stagedAt: settingsStaged.stagedAt,
    })
    .from(settingsStaged)
    .where(eq(settingsStaged.userId, userId));

  return rows.sort((a, b) => a.stagedAt.localeCompare(b.stagedAt));
}

/** The staged set as the overlay shape the read path consults. */
export async function stagedOverlay(userId: number): Promise<Map<string, string>> {
  const entries = await listStagedSettings(userId);
  return new Map(entries.map((entry) => [entry.key, entry.value]));
}

export async function countStagedSettings(userId: number): Promise<number> {
  return (await listStagedSettings(userId)).length;
}

/**
 * Record captured writes as this operator's staged set.
 *
 * A write whose value matches what is already stored is *unstaged* rather than recorded: editing a
 * field and putting it back should leave nothing pending, and without this a no-op save would show
 * up in the review sheet as a change from a value to itself.
 */
export async function stageWrites(userId: number, writes: Map<string, string>): Promise<void> {
  if (writes.size === 0) return;
  const now = nowIso();
  const stored = await storedValues([...writes.keys()]);

  for (const [key, value] of writes) {
    if (stored.get(key) === value) {
      await discardStagedKey(userId, key);
      continue;
    }

    await db
      .insert(settingsStaged)
      .values({ key, userId, value, stagedAt: now })
      .onConflictDoUpdate({
        target: [settingsStaged.userId, settingsStaged.key],
        set: { value, stagedAt: now },
      });
  }
}

export async function discardStagedKey(userId: number, key: string): Promise<void> {
  await db
    .delete(settingsStaged)
    .where(and(eq(settingsStaged.userId, userId), eq(settingsStaged.key, key)));
}

export async function discardAllStaged(userId: number): Promise<void> {
  await db.delete(settingsStaged).where(eq(settingsStaged.userId, userId));
}

/**
 * The stored serialization of each key; an unset key is absent.
 *
 * Deliberately reads the raw rows rather than going through `getSetting`, which parses - comparing
 * serialized forms is what tells us whether a write is a no-op, and re-serializing a parsed value
 * could differ from what is stored by key order alone.
 */
export async function storedValues(keys: string[]): Promise<Map<string, string>> {
  const rows = await db
    .select({ key: settings.key, value: settings.value })
    .from(settings)
    .where(inArray(settings.key, keys));
  return new Map(rows.map((row) => [row.key, row.value]));
}

/** Read a setting as it would be after applying this operator's staged set. */
export async function getStagedSetting<T>(userId: number, key: string): Promise<T | null> {
  const overlay = await stagedOverlay(userId);
  return withStagedReads(overlay, () => getSetting<T>(key));
}
