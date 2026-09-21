/**
 * Assembling what the staged bar and the review sheet render.
 *
 * Kept out of the pages because both the settings home and every section page show the same bar -
 * a change set spans sections, so the two must not be able to disagree about what is pending.
 */

import db from "../db";
import { listStagedSettings } from "./staging";
import { recentRevisions } from "./apply";
import { renderConfigComparison } from "./apply";
import { diffConfigDocuments } from "./config-diff";
import { sectionForStorageKey } from "./section-keys";

export type StagedChange = {
  key: string;
  sectionId: string | null;
  label: string;
  /**
   * The fields inside this key that differ from what is stored.
   *
   * A settings key is usually one JSON blob for a whole block, so "general is staged" was all the
   * review sheet could say. Comparing the staged blob with the stored one names the fields the
   * operator actually touched. Empty for a key that is a single value, and for a blob whose shape
   * is not an object.
   */
  fields: string[];
  stagedAt: string;
};

export type StagedView = {
  changes: StagedChange[];
  diff: ReturnType<typeof diffConfigDocuments>;
  revisions: Awaited<ReturnType<typeof recentRevisions>>;
  currentRevision: number | null;
};

/** The top-level fields that differ between the stored JSON and the staged JSON. */
function changedFields(storedValue: string | null, stagedValue: string): string[] {
  const parse = (raw: string | null): Record<string, unknown> | null => {
    if (raw === null) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  };

  const before = parse(storedValue);
  const after = parse(stagedValue);
  // A single value rather than a blob, or a shape this cannot read: the key itself is the change.
  if (!after) return [];

  const names = new Set([...Object.keys(before ?? {}), ...Object.keys(after)]);
  return [...names]
    .filter((name) => JSON.stringify(before?.[name]) !== JSON.stringify(after[name]))
    .sort();
}

export async function stagedView(userId: number): Promise<StagedView> {
  const [staged, revisions] = await Promise.all([listStagedSettings(userId), recentRevisions(3)]);

  // The stored rows, read straight from the table: the point is to compare the staged values
  // against what is saved, and the read path would hand back the staged ones.
  const storedRows = await db.query.settings.findMany();
  const stored = new Map(storedRows.map((row) => [row.key, row.value]));

  const changes: StagedChange[] = staged.map((entry) => {
    const known = sectionForStorageKey(entry.key);
    return {
      key: entry.key,
      sectionId: known?.id ?? null,
      // An unmapped key still shows, under its own name: a change nobody can see is worse than an
      // ugly label, and this is the only place that would silently drop one.
      label: known?.label ?? entry.key,
      fields: changedFields(stored.get(entry.key) ?? null, entry.value),
      stagedAt: entry.stagedAt,
    };
  });

  // Rendering the config twice is only worth it when there is something to compare.
  let diff = diffConfigDocuments({}, {});
  if (changes.length > 0) {
    try {
      const { current, staged: pending } = await renderConfigComparison(userId);
      diff = diffConfigDocuments(current, pending);
    } catch (error) {
      // A builder that throws must not take the settings page with it. The change list still
      // renders, and the sheet shows no config difference rather than an error the operator
      // cannot act on.
      console.error("Failed to render the staged config diff:", error);
    }
  }

  return {
    changes,
    diff,
    revisions,
    currentRevision: revisions[0]?.id ?? null,
  };
}

/** Just the keys, for marking tiles without paying for a config render. */
export async function stagedKeys(userId: number): Promise<Set<string>> {
  return new Set((await listStagedSettings(userId)).map((entry) => entry.key));
}
