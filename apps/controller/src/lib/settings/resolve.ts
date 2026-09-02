/**
 * Reading and writing the settings in ./registry.ts.
 *
 * Resolution order is stored value, then environment variable, then default. The environment layer
 * is what makes the migration safe to land in pieces: until a deployment has been through the
 * migration flow nothing is stored, every setting resolves from the same variable it always did,
 * and behaviour is unchanged. Once a value is stored it wins, and the variable can be deleted from
 * the `.env`.
 *
 * Values are cached for the process. The settings table is small and read on nearly every request,
 * and a write goes through ./resolve.ts's own save path, which clears the cache — so the only way
 * to see a stale value is to write to the table directly.
 */
import { eq, inArray } from "drizzle-orm";
import db, { nowIso } from "../db";
import { settings } from "../db/schema";
import { decryptSecret, encryptSecret } from "../secret";
import {
  SETTINGS_BY_KEY,
  SETTING_DEFINITIONS,
  SettingValidationError,
  type SettingDefinition,
  type SettingValue,
} from "./registry";

/** Stored values by key. Absent means "not loaded yet"; a key absent from a loaded map is unset. */
let cache: Map<string, SettingValue> | null = null;

/** Drops the cache so the next read reloads. Exported for the tests and the migration flow. */
export function invalidateSettingsCache(): void {
  cache = null;
}

function decode(definition: SettingDefinition, raw: string): SettingValue | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.warn(`Ignoring unparseable stored value for ${definition.key}`);
    return undefined;
  }

  const value = definition.secret && typeof parsed === "string" ? decryptSecret(parsed) : parsed;

  try {
    return definition.parse(value);
  } catch (error) {
    // A stored value that no longer validates — a tightened range, say — must not take the app
    // down. Fall through to the environment and the default, and say so once.
    console.warn(`Ignoring invalid stored value for ${definition.key}:`, error);
    return undefined;
  }
}

async function load(): Promise<Map<string, SettingValue>> {
  if (cache) return cache;

  const keys = SETTING_DEFINITIONS.map((definition) => definition.key);
  const rows = await db
    .select({ key: settings.key, value: settings.value })
    .from(settings)
    .where(inArray(settings.key, keys));

  const loaded = new Map<string, SettingValue>();
  for (const row of rows) {
    const definition = SETTINGS_BY_KEY.get(row.key);
    if (!definition) continue;
    const value = decode(definition, row.value);
    if (value !== undefined) loaded.set(row.key, value);
  }

  cache = loaded;
  return loaded;
}

/** The environment's value for a setting, or undefined when the variable is unset or unusable. */
function fromEnvironment(definition: SettingDefinition): SettingValue | undefined {
  const raw = process.env[definition.env];
  if (raw === undefined) return undefined;
  // An empty variable is not the same as an unset one for a tri-state setting, whose parse turns
  // it into an explicit null. Every other kind treats it as "not configured".
  if (raw.trim() === "" && definition.default !== null) return undefined;

  try {
    return definition.fromEnv(raw);
  } catch (error) {
    console.warn(`Ignoring invalid ${definition.env}:`, error);
    return undefined;
  }
}

/** Where a resolved value came from. The setup and migration pages show this to the operator. */
export type SettingSource = "stored" | "environment" | "default";

export type ResolvedSetting<T extends SettingValue = SettingValue> = {
  value: T;
  source: SettingSource;
};

export async function resolveSetting<T extends SettingValue>(
  definition: SettingDefinition<T>,
): Promise<ResolvedSetting<T>> {
  const stored = (await load()).get(definition.key);
  if (stored !== undefined) return { value: stored as T, source: "stored" };

  const environment = fromEnvironment(definition);
  if (environment !== undefined) return { value: environment as T, source: "environment" };

  return { value: definition.default, source: "default" };
}

/** The value alone, for the many callers that do not care where it came from. */
export async function getSetting<T extends SettingValue>(
  definition: SettingDefinition<T>,
): Promise<T> {
  return (await resolveSetting(definition)).value;
}

/** Every setting with its value and source, for the settings and setup pages. */
export async function resolveAllSettings(): Promise<Map<string, ResolvedSetting>> {
  await load();
  const resolved = new Map<string, ResolvedSetting>();
  // Widened to the base definition: each entry has its own value type, and the union of those
  // does not infer through a generic parameter.
  for (const definition of SETTING_DEFINITIONS as readonly SettingDefinition[]) {
    resolved.set(definition.key, await resolveSetting(definition));
  }
  return resolved;
}

/**
 * Validate and store a batch of settings, keyed by definition key.
 *
 * All or nothing: every value is validated before anything is written, so a form with one bad
 * field leaves the stored configuration exactly as it was rather than half-applied.
 */
export async function saveSettings(values: Record<string, unknown>): Promise<void> {
  const writes: Array<{ key: string; value: string }> = [];

  for (const [key, raw] of Object.entries(values)) {
    const definition = SETTINGS_BY_KEY.get(key);
    if (!definition) {
      throw new SettingValidationError(key, `Unknown setting "${key}"`);
    }

    const parsed = definition.parse(raw);
    const encoded =
      definition.secret && typeof parsed === "string" && parsed !== ""
        ? encryptSecret(parsed)
        : parsed;
    writes.push({ key, value: JSON.stringify(encoded) });
  }

  const now = nowIso();
  for (const write of writes) {
    await db
      .insert(settings)
      .values({ key: write.key, value: write.value, updatedAt: now })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: write.value, updatedAt: now },
      });
  }

  invalidateSettingsCache();
}

/** Remove a stored value, so the setting falls back to the environment or its default. */
export async function clearStoredSetting(key: string): Promise<void> {
  if (!SETTINGS_BY_KEY.has(key)) {
    throw new SettingValidationError(key, `Unknown setting "${key}"`);
  }
  await db.delete(settings).where(eq(settings.key, key));
  invalidateSettingsCache();
}

/** True once anything has been stored — i.e. the deployment has been through setup or migration. */
export async function hasStoredSettings(): Promise<boolean> {
  return (await load()).size > 0;
}
