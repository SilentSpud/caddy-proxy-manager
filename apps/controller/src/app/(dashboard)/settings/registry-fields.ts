/**
 * The registry settings that had no form of their own, as fields the Settings screens can edit.
 *
 * These were answered during setup or left to the environment, and for a while Settings could only
 * report them: an operator asking "why can nobody sign up" had to read `.env` to find out, and
 * then edit `.env` and restart to change it. They are ordinary registry settings, so `saveSettings`
 * already validates and stores them and a stored value already beats the variable - all that was
 * missing was the form.
 *
 * Built from the definitions rather than written out field by field, so the kind of control, its
 * bounds and its wording all come from the one place that decides them, and a setting added to a
 * block below gets a field without anyone writing one.
 */

import type { getTranslations } from "next-intl/server";
import {
  allowOauthRegistration,
  allowOauthRoleFromClaims,
  allowSelfRegistration,
  appName,
  authRateLimitEnabled,
  authRateLimitMax,
  authRateLimitWindow,
  baseUrl,
  disableLocalUsers,
  loginBlockMs,
  loginMaxAttempts,
  loginWindowMs,
  trustHost,
  type SettingDefinition,
  type SettingValue,
} from "@/src/lib/settings/registry";
import { settingDescription, settingLabel } from "@/src/lib/settings/messages";
import { resolveSetting } from "@/src/lib/settings/resolve";
import type { RegistryField } from "./RegistrySettingsBlock";

/** Widened once: each definition has its own value type, and the union of those is not one. */
type AnySetting = SettingDefinition<SettingValue>;

/** The blocks that render them, in the order each block lists its settings. */
const BLOCKS: Record<string, readonly AnySetting[]> = {
  instance: [appName, baseUrl] as AnySetting[],
  "sign-in": [
    allowSelfRegistration,
    allowOauthRegistration,
    allowOauthRoleFromClaims,
    disableLocalUsers,
    trustHost,
    authRateLimitEnabled,
    authRateLimitWindow,
    authRateLimitMax,
    loginMaxAttempts,
    loginWindowMs,
    loginBlockMs,
  ] as AnySetting[],
};

/** Which settings a block owns, for the action that saves one. Keys, since that is what it posts. */
export const REGISTRY_BLOCK_KEYS: Record<string, readonly string[]> = Object.fromEntries(
  Object.entries(BLOCKS).map(([block, definitions]) => [
    block,
    definitions.map((definition) => definition.key),
  ]),
);

type Translator = Awaited<ReturnType<typeof getTranslations>>;

function field(t: Translator, definition: AnySetting, value: SettingValue): RegistryField {
  const common = {
    key: definition.key,
    env: definition.env,
    label: settingLabel(t, definition.key),
    description: settingDescription(t, definition.key),
  };

  if (typeof definition.default === "boolean") {
    return { ...common, kind: "boolean", value: value === true };
  }
  if (typeof definition.default === "number") {
    return {
      ...common,
      kind: "number",
      value: typeof value === "number" ? value : definition.default,
      // The registry's own range. A number setting always has one.
      min: definition.min ?? 0,
      max: definition.max ?? Number.MAX_SAFE_INTEGER,
    };
  }
  return {
    ...common,
    kind: "text",
    value: typeof value === "string" ? value : "",
    maxLength: definition.maxLength,
    // What it falls back to with nothing stored and no variable set, so an empty field still says
    // what the instance will do.
    placeholder: String(definition.default ?? ""),
  };
}

export async function registryFields(
  t: Translator,
): Promise<Record<string, readonly RegistryField[]>> {
  const blocks: Record<string, RegistryField[]> = {};
  for (const [block, definitions] of Object.entries(BLOCKS)) {
    blocks[block] = await Promise.all(
      definitions.map(async (definition) => {
        const resolved = await resolveSetting(definition);
        return { ...field(t, definition, resolved.value), source: resolved.source };
      }),
    );
  }
  return blocks;
}
