/**
 * Moving a staged change set into the settings table and reloading Caddy once.
 *
 * The whole point of staging is that this is the only place a settings edit reaches Caddy, so the
 * cost of a batch is one reload rather than one per form, and the operator sees what will happen
 * before it does.
 */

import db, { nowIso } from "../db";
import { settings, settingsRevisions } from "../db/schema";
import { desc } from "drizzle-orm";
import { applyCaddyConfig, buildCaddyDocument } from "../caddy";
import { withSettingsUpdateLock } from "../settings-update-lock";
import { discardAllStaged, listStagedSettings, stagedOverlay } from "./staging";
import { withStagedReads } from "./staging-context";
import { domainError } from "../domain-error";

export type RevisionRow = {
  id: number;
  appliedByName: string | null;
  summary: string;
  outcome: "applied" | "failed";
  error: string | null;
  appliedAt: string;
};

export type ApplyOutcome =
  | { ok: true; revision: number }
  | { ok: false; error: string; revision: number };

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
    for (const entry of staged) {
      await db
        .insert(settings)
        .values({ key: entry.key, value: entry.value, updatedAt: now })
        .onConflictDoUpdate({
          target: settings.key,
          set: { value: entry.value, updatedAt: now },
        });
    }
    await discardAllStaged(userId);

    const keys = staged.map((entry) => entry.key);
    let error: string | null = null;
    try {
      await applyCaddyConfig();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "Failed to apply Caddy configuration";
    }

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
    return error ? { ok: false, error, revision } : { ok: true, revision };
  });
}

/** The most recent applies, newest first. Drives the header pill and the review sheet's history. */
export async function recentRevisions(limit = 3): Promise<RevisionRow[]> {
  const rows = await db
    .select({
      id: settingsRevisions.id,
      appliedByName: settingsRevisions.appliedByName,
      summary: settingsRevisions.summary,
      outcome: settingsRevisions.outcome,
      error: settingsRevisions.error,
      appliedAt: settingsRevisions.appliedAt,
    })
    .from(settingsRevisions)
    .orderBy(desc(settingsRevisions.id))
    .limit(limit);

  return rows.map((row) => ({
    ...row,
    outcome: row.outcome === "failed" ? "failed" : "applied",
  }));
}
