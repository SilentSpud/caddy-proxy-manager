/**
 * Assembling what the staged bar and the review sheet render.
 *
 * Kept out of the pages because both the settings home and every section page show the same bar -
 * a change set spans sections, so the two must not be able to disagree about what is pending.
 */

import { listStagedSettings } from "./staging";
import { recentRevisions } from "./apply";
import { renderConfigComparison } from "./apply";
import { diffConfigDocuments } from "./config-diff";
import { sectionForStorageKey } from "./section-keys";

export type StagedChange = {
  key: string;
  sectionId: string | null;
  label: string;
  stagedAt: string;
};

export type StagedView = {
  changes: StagedChange[];
  diff: ReturnType<typeof diffConfigDocuments>;
  revisions: Awaited<ReturnType<typeof recentRevisions>>;
  currentRevision: number | null;
};

export async function stagedView(userId: number): Promise<StagedView> {
  const [staged, revisions] = await Promise.all([listStagedSettings(userId), recentRevisions(3)]);

  const changes: StagedChange[] = staged.map((entry) => {
    const known = sectionForStorageKey(entry.key);
    return {
      key: entry.key,
      sectionId: known?.id ?? null,
      // An unmapped key still shows, under its own name: a change nobody can see is worse than an
      // ugly label, and this is the only place that would silently drop one.
      label: known?.label ?? entry.key,
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
