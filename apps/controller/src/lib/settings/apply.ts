/**
 * Moving a staged change set into the settings table and reloading Caddy once.
 *
 * The whole point of staging is that this is the only place a settings edit reaches Caddy, so the
 * cost of a batch is one reload rather than one per form, and the operator sees what will happen
 * before it does.
 */

import db, { nowIso } from "../db";
import { settings, settingsRevisions } from "../db/schema";
import { desc, sql } from "drizzle-orm";
import { applyCaddyConfig, buildCaddyDocument } from "../caddy";
import { withSettingsUpdateLock } from "../settings-update-lock";
import { discardAllStaged, listStagedSettings, stagedOverlay } from "./staging";
import { withStagedReads } from "./staging-context";
import { domainError } from "../domain-error";

export type RevisionRow = {
  id: number;
  appliedByName: string | null;
  /** The stored change list. Kept as written, since the migration copies it; the UI renders `keys`. */
  summary: string;
  /** The storage keys the apply committed, for the review sheet to name in the reader's language. */
  keys: string[];
  outcome: "applied" | "failed";
  error: string | null;
  appliedAt: string;
};

/** `error` is what the revision stores; `cause` is what the action renders, in the reader's language. */
export type ApplyOutcome =
  | { ok: true; revision: number }
  | { ok: false; error: string; cause: Error; revision: number };

/**
 * Render the config Caddy would receive if this operator applied now.
 *
 * Cheap because of the read overlay: the builder is called unmodified and every settings read
 * inside it resolves against the staged set instead of the table.
 */
export async function renderStagedDocument(userId: number): Promise<unknown> {
  const overlay = await stagedOverlay(userId);
  return withStagedReads(overlay, () => buildCaddyDocument());
}

/** The current config and the staged one, for the review sheet's diff. */
export async function renderConfigComparison(
  userId: number,
): Promise<{ current: unknown; staged: unknown }> {
  const [current, staged] = await Promise.all([buildCaddyDocument(), renderStagedDocument(userId)]);
  return { current, staged };
}

/**
 * Commit the staged set and push it.
 *
 * Under the same lock every settings write takes, so a concurrent apply by another operator cannot
 * interleave with this one's writes. The staged rows are dropped only after the write succeeds -
 * a failed push leaves the settings table updated but records the failure, because the values are
 * what the operator asked for and re-applying is a retry rather than a re-entry.
 */
export async function applyStagedSettings(
  userId: number,
  appliedByName: string | null,
): Promise<ApplyOutcome> {
  return withSettingsUpdateLock(async () => {
    const staged = await listStagedSettings(userId);
    if (staged.length === 0) {
      throw domainError("nothingStagedToApply");
    }

    const now = nowIso();
    // One statement for the set; keys are unique per operator, which a multi-row upsert requires.
    await db
      .insert(settings)
      .values(staged.map((entry) => ({ key: entry.key, value: entry.value, updatedAt: now })))
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: sql`excluded.value`, updatedAt: now },
      });
    await discardAllStaged(userId);

    const keys = staged.map((entry) => entry.key);
    const fallback = domainError("applyCaddyConfigFailed");
    let failure: Error | null = null;
    try {
      await applyCaddyConfig();
    } catch (cause) {
      // Something that is not an Error, or caddy.ts's CaddyApplyError carrying this very sentence:
      // either way the code stands in, so the action can say it translated. The English is the same.
      failure = cause instanceof Error && cause.message !== fallback.message ? cause : fallback;
    }
    // Stored in English as before: the revision row is history, not a message for one reader.
    const error = failure?.message ?? null;

    const [row] = await db
      .insert(settingsRevisions)
      .values({
        appliedBy: userId,
        appliedByName,
        summary: keys.join(", "),
        keys: JSON.stringify(keys),
        outcome: error ? "failed" : "applied",
        error,
        appliedAt: now,
      })
      .returning({ id: settingsRevisions.id });

    const revision = row?.id ?? 0;
    return failure
      ? { ok: false, error: failure.message, cause: failure, revision }
      : { ok: true, revision };
  });
}

/** The most recent applies, newest first. Drives the header pill and the review sheet's history. */
export async function recentRevisions(limit = 3): Promise<RevisionRow[]> {
  const rows = await db
    .select({
      id: settingsRevisions.id,
      appliedByName: settingsRevisions.appliedByName,
      summary: settingsRevisions.summary,
      keys: settingsRevisions.keys,
      outcome: settingsRevisions.outcome,
      error: settingsRevisions.error,
      appliedAt: settingsRevisions.appliedAt,
    })
    .from(settingsRevisions)
    .orderBy(desc(settingsRevisions.id))
    .limit(limit);

  return rows.map((row) => ({
    ...row,
    keys: parseRevisionKeys(row.keys),
    outcome: row.outcome === "failed" ? "failed" : "applied",
  }));
}

/** An unreadable column yields no keys, and the sheet falls back to the stored summary. */
function parseRevisionKeys(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((key): key is string => typeof key === "string")
      : [];
  } catch {
    return [];
  }
}
