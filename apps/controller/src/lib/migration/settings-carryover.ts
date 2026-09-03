/**
 * Translating the JSON blobs an older release stored into registry settings.
 *
 * Two settings were configurable from both sides before the registry existed: a `settings` row
 * holding a JSON object that the Settings page wrote, and an environment variable that merely
 * pinned it. Phase 2 deliberately left their consumers alone, because reading only the registry
 * would have discarded whatever the operator had chosen in the UI.
 *
 * This is the other half. A migrating deployment's blob value is lifted into the registry key, so
 * the choice survives and the consumers can stop consulting two places.
 */
import { eq } from "drizzle-orm";
import db from "../db";
import { settings } from "../db/schema";
import { gravatarEnabled, requirePasswordChangeOnLegacyHash } from "../settings/registry";
import { saveSettings } from "../settings/resolve";

type Carryover = {
  /** The `settings` row the old release wrote. */
  blobKey: string;
  /** The field inside that row's JSON object. */
  field: string;
  /** The registry setting it becomes. */
  settingKey: string;
};

const CARRYOVERS: Carryover[] = [
  { blobKey: "avatars", field: "gravatarEnabled", settingKey: gravatarEnabled.key },
  {
    blobKey: "password_policy",
    field: "requireChangeOnLegacyHash",
    settingKey: requirePasswordChangeOnLegacyHash.key,
  },
];

export type CarryoverResult = { settingKey: string; value: boolean };

/**
 * Lift every recognised blob field into its registry key.
 *
 * Only writes what it finds: a deployment that never touched the Settings toggle has no blob, and
 * inventing a stored value for it would pin a default that was previously free to change.
 */
export async function carryOverBlobSettings(): Promise<CarryoverResult[]> {
  const applied: CarryoverResult[] = [];

  for (const carryover of CARRYOVERS) {
    const [row] = await db
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.key, carryover.blobKey))
      .limit(1);
    if (!row) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(row.value);
    } catch {
      console.warn(`Migration: ignoring unparseable ${carryover.blobKey} setting`);
      continue;
    }

    if (typeof parsed !== "object" || parsed === null) continue;
    const value = (parsed as Record<string, unknown>)[carryover.field];
    if (typeof value !== "boolean") continue;

    await saveSettings({ [carryover.settingKey]: value });
    applied.push({ settingKey: carryover.settingKey, value });
  }

  return applied;
}
