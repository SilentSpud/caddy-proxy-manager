/**
 * Reads the `setup.migrationGroups.*` catalog on behalf of the migration screen.
 *
 * selection.ts keeps the English as the source - it is a plain module the importer and the API
 * route share, with no translator to hand - and the screen renders through these instead. The
 * lookup is keyed by the group's id at runtime, so TypeScript cannot check it against the catalog;
 * `tests/unit/migration-messages.test.ts` asserts every group has both messages.
 */

import type { useTranslations } from "next-intl";
import type { MigrationGroupId } from "./selection";

type SetupTranslator = ReturnType<typeof useTranslations<"setup">>;

/** The one place the narrowing is given up, for the reason in the header comment. */
type DynamicTranslate = (key: string) => string;

function dynamic(t: SetupTranslator): DynamicTranslate {
  return t as unknown as DynamicTranslate;
}

export function migrationGroupLabel(t: SetupTranslator, id: MigrationGroupId): string {
  return dynamic(t)(`migrationGroups.${id}.label`);
}

export function migrationGroupDescription(t: SetupTranslator, id: MigrationGroupId): string {
  return dynamic(t)(`migrationGroups.${id}.description`);
}
