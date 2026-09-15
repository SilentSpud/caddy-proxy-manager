/**
 * The GeoIP updater's failures, in the language of whoever reads the settings page.
 *
 * The updater runs on a timer with no reader, so it stores each failure's English and, when the
 * failure had one, its code (see `storedErrorMessage`). These put them back together for a page.
 */

import { storedErrorMessage } from "../actions";
import type { GeoipDownloadFailure, GeoipUpdateResult } from "./updater";

type Translator = Parameters<typeof storedErrorMessage>[0];

function editionFailureMessage(t: Translator, failure: GeoipDownloadFailure): string {
  // Narrowed by hand: resolving one literal key against the whole root catalog is more than tsc
  // will instantiate. `settings.geoipEditionDownloadFailed` is checked by the catalog test instead.
  const translate = t as unknown as (key: string, values: Record<string, string>) => string;
  return translate("settings.geoipEditionDownloadFailed", {
    edition: failure.edition,
    reason: storedErrorMessage(t, failure.message, failure.code),
  });
}

/** Why the last download failed, or null. `joined` is the English a state stored earlier holds. */
export function geoipDownloadErrorMessage(
  t: Translator,
  joined: string | null,
  failures: readonly GeoipDownloadFailure[],
): string | null {
  if (!joined) return null;
  if (failures.length === 0) return joined;
  return failures.map((failure) => editionFailureMessage(t, failure)).join("; ");
}

/** Everything that went wrong in one run, the check's failure first, or null. */
export function geoipUpdateErrorMessage(t: Translator, result: GeoipUpdateResult): string | null {
  if (!result.error) return null;
  const parts: string[] = [];
  if (result.checkError) {
    parts.push(storedErrorMessage(t, result.checkError.message, result.checkError.code));
  }
  for (const failure of result.failures ?? []) parts.push(editionFailureMessage(t, failure));
  // Empty when the run itself threw: its English is all there is.
  return parts.length > 0 ? parts.join("; ") : result.error;
}
