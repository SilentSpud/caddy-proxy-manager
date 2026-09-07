/**
 * Reads the `settings.*` catalog on behalf of the screens that render the registry.
 *
 * Every lookup here is keyed by something only known at runtime — which setting, which group,
 * which validation code — so none of them can be checked against the catalog the way a literal
 * `t("...")` is. `tests/unit/settings-messages.test.ts` covers that gap: it asserts the catalog
 * has an entry for every registry setting, every group and every code.
 */

import type { useTranslations } from "next-intl";
import type { SettingGroup, SettingValidationError } from "./registry";

type Translator = ReturnType<typeof useTranslations>;

/** The one place the narrowing is given up, for the reason in the header comment. */
type DynamicTranslate = (key: string, values?: Record<string, string | number>) => string;

function dynamic(t: Translator): DynamicTranslate {
  return t as unknown as DynamicTranslate;
}

/**
 * The registry key without its `config:` prefix, which is how `settings.registry.*` is keyed —
 * a colon would read as nesting to next-intl.
 */
export function settingMessageName(settingKey: string): string {
  return settingKey.replace(/^config:/, "");
}

export function settingLabel(t: Translator, settingKey: string): string {
  return dynamic(t)(`settings.registry.${settingMessageName(settingKey)}.label`);
}

export function settingDescription(t: Translator, settingKey: string): string {
  return dynamic(t)(`settings.registry.${settingMessageName(settingKey)}.description`);
}

export function settingGroupTitle(t: Translator, group: SettingGroup): string {
  return dynamic(t)(`settings.groups.${group}`);
}

export function settingValidationMessage(t: Translator, error: SettingValidationError): string {
  // An unknown key has no label to look up — the key itself is the only thing to name it by.
  const label =
    error.code === "unknown" ? String(error.params.label) : settingLabel(t, error.settingKey);

  return dynamic(t)(`settings.validation.${error.code}`, { ...error.params, label });
}
