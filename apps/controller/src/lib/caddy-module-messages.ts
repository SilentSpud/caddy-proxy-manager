/**
 * Reads the `caddyModules.modules.*` and `caddyModules.conflicts.*` catalog for the screens that
 * name a Caddy module: the module picker, the module gate, and the settings action refusing a
 * selection.
 *
 * `caddy-modules.ts` and `caddy-build-conflicts.ts` keep their English as the source, because
 * `/api/v1/caddy/modules` returns it. The screens ask here instead, by module id and conflict kind -
 * both only known at runtime, so `tests/unit/caddy-module-messages.test.ts` asserts every module
 * and conflict has an entry, and that the English entries say exactly what the registry says.
 *
 * Takes the root translator, since a DNS module's description is the provider's own, which lives
 * under `settings.dnsProviders`.
 */

import type { useTranslations } from "next-intl";
import type { ModuleConflict } from "./caddy-build-conflicts";
import type { CaddyModuleDefinition } from "./caddy-modules";
import { dnsMessageName } from "./dns-provider-messages";

type Translator = ReturnType<typeof useTranslations>;

/** The one place the narrowing is given up, for the reason in the header comment. */
type DynamicTranslator = {
  (key: string, values?: Record<string, string | number>): string;
  has: (key: string) => boolean;
};

function dynamic(t: Translator): DynamicTranslator {
  return t as unknown as DynamicTranslator;
}

/** A module id (`caddy-l4`) as a catalog key segment (`caddyL4`). */
export function caddyModuleMessageName(id: string): string {
  return dnsMessageName(id);
}

export function caddyModuleName(t: Translator, module: CaddyModuleDefinition): string {
  // A DNS module is named for its provider, and a brand is not translated.
  if (module.dnsProviderDisplayName !== undefined) {
    return dynamic(t)("caddyModules.dnsModuleName", { provider: module.dnsProviderDisplayName });
  }
  return dynamic(t)(`caddyModules.modules.${caddyModuleMessageName(module.id)}.name`);
}

export function caddyModuleDescription(t: Translator, module: CaddyModuleDefinition): string {
  const translate = dynamic(t);
  if (module.dnsProvider !== undefined) {
    const own = `settings.dnsProviders.${dnsMessageName(module.dnsProvider)}.description`;
    return translate.has(own)
      ? translate(own)
      : translate("caddyModules.dnsModuleDescription", {
          provider: module.dnsProviderDisplayName ?? module.dnsProvider,
        });
  }
  return translate(`caddyModules.modules.${caddyModuleMessageName(module.id)}.description`);
}

/** The refusal for a module selection something still uses, or null when nothing does. */
export function moduleConflictMessage(
  t: Translator,
  conflicts: readonly ModuleConflict[],
): string | null {
  if (conflicts.length === 0) return null;
  const translate = dynamic(t);
  const problems = conflicts
    .map((conflict) => {
      let values: Record<string, string | number> | undefined;
      if ("count" in conflict) values = { count: conflict.count };
      else if ("provider" in conflict) values = { provider: conflict.provider };
      return translate(`caddyModules.conflicts.${conflict.kind}`, values);
    })
    .join("; ");
  return translate("caddyModules.conflicts.summary", { problems });
}
