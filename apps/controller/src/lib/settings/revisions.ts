/**
 * Comparing and restoring applied revisions.
 *
 * A revision records only the keys it committed, before and after, so the state at any revision is
 * reconstructed from the ones around it rather than stored whole: the value a key had at #N is its
 * `before` in the first later revision that touched it. That keeps the `settings` rows that are not
 * configuration - table density, nav order, update-check caches - out of history entirely, and a
 * restore can only ever touch what an apply once changed.
 */

import db from "../db";
import { settingsRevisions } from "../db/schema";
import { and, asc, count, desc, gt, isNull, lte, max } from "drizzle-orm";
import { buildCaddyDocument } from "../caddy";
import { domainError } from "../domain-error";
import { type RevisionChange, parseRevisionChanges } from "./apply";
import { type ConfigDiff, diffConfigDocuments } from "./config-diff";
import { sectionForStorageKey } from "./section-keys";
import { discardStagedKey, stageWrites, storedValues } from "./staging";
import { withStagedReads } from "./staging-context";

export type RevisionKeyDiff = {
  key: string;
  sectionId: string | null;
  label: string;
  diff: ConfigDiff;
};

export type RevisionComparison = {
  from: number;
  to: number;
  /** Null when a revision in the span predates recorded values, so there is nothing to compare. */
  keys: RevisionKeyDiff[] | null;
  /** The Caddy config either side, rendered against today's hosts; null when it could not be. */
  config: ConfigDiff | null;
};

export async function countRevisions(): Promise<number> {
  const [row] = await db.select({ total: count() }).from(settingsRevisions);
  return Number(row?.total ?? 0);
}

export async function latestRevisionId(): Promise<number> {
  const [row] = await db.select({ id: max(settingsRevisions.id) }).from(settingsRevisions);
  return Number(row?.id ?? 0);
}

/** Revision ids newest first, for the compare pickers. Capped: nobody scrolls a picker further. */
export async function revisionIds(limit = 500): Promise<number[]> {
  const rows = await db
    .select({ id: settingsRevisions.id })
    .from(settingsRevisions)
    .orderBy(desc(settingsRevisions.id))
    .limit(limit);
  return rows.map((row) => row.id);
}

/**
 * The oldest revision a restore can reach: the newest one without recorded values, since a
 * restore replays every later revision backwards. 0 when every revision has them.
 */
export async function oldestRestorable(): Promise<number> {
  const [row] = await db
    .select({ id: max(settingsRevisions.id) })
    .from(settingsRevisions)
    .where(isNull(settingsRevisions.changes));
  return Number(row?.id ?? 0);
}

/**
 * Every key the revisions in (`from`, `to`] committed, valued before the first and after the last.
 *
 * Null if any revision in the span predates recorded values: a key it changed has an unknown value
 * on one side, and a comparison or restore that skipped it would present a guess as history.
 */
export async function revisionSpan(
  from: number,
  to: number,
): Promise<Map<string, RevisionChange> | null> {
  const rows = await db
    .select({ changes: settingsRevisions.changes })
    .from(settingsRevisions)
    .where(and(gt(settingsRevisions.id, from), lte(settingsRevisions.id, to)))
    .orderBy(asc(settingsRevisions.id));

  const span = new Map<string, RevisionChange>();
  for (const row of rows) {
    const changes = parseRevisionChanges(row.changes);
    if (!changes) return null;
    for (const [key, change] of changes) {
      const earlier = span.get(key);
      span.set(key, { before: earlier ? earlier.before : change.before, after: change.after });
    }
  }
  return span;
}

/** A missing row reads as null through `getSetting`, and so does the stored string "null". */
function overlayFor(values: Map<string, string | null>): Map<string, string> {
  return new Map([...values].map(([key, value]) => [key, value ?? "null"]));
}

function parseValue(raw: string | null): unknown {
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/**
 * What changed from revision `from` to revision `to`, either direction.
 *
 * `from` may be 0, the state before the first apply. A backwards comparison is the same span with
 * its sides swapped, which is exactly what a restore from `from` to `to` would do.
 */
export async function compareRevisions(from: number, to: number): Promise<RevisionComparison> {
  const low = Math.min(from, to);
  const high = Math.max(from, to);
  const span = await revisionSpan(low, high);
  if (!span) return { from, to, keys: null, config: null };

  const reversed = from > to;
  const before = new Map<string, string | null>();
  const after = new Map<string, string | null>();
  for (const [key, change] of span) {
    if (change.before === change.after) continue;
    before.set(key, reversed ? change.after : change.before);
    after.set(key, reversed ? change.before : change.after);
  }

  const keys = [...before.keys()].sort().map((key): RevisionKeyDiff => {
    const known = sectionForStorageKey(key);
    return {
      key,
      sectionId: known?.id ?? null,
      label: known?.label ?? key,
      // The same renderer as the config diff, so a credential inside a blob is masked here too.
      diff: diffConfigDocuments(
        parseValue(before.get(key) ?? null),
        parseValue(after.get(key) ?? null),
      ),
    };
  });

  let config: ConfigDiff | null = diffConfigDocuments({}, {});
  if (keys.length > 0) {
    try {
      const [left, right] = await Promise.all([
        withStagedReads(overlayFor(before), () => buildCaddyDocument()),
        withStagedReads(overlayFor(after), () => buildCaddyDocument()),
      ]);
      config = diffConfigDocuments(left, right);
    } catch (error) {
      // As in the review sheet: a builder that throws costs the config pane, not the page.
      console.error("Failed to render the revision config diff:", error);
      config = null;
    }
  }

  return { from, to, keys, config };
}

/**
 * Stage every value revision `target` had, for this operator to review and apply.
 *
 * Staged rather than applied: a restore is a change set like any other, and the review sheet is
 * where an operator sees what it will do to the Caddy config before it does it. Applying it is a
 * new revision, so history only ever grows and a restore can itself be restored away.
 */
export async function stageRevisionRestore(
  userId: number,
  target: number,
): Promise<{ staged: number }> {
  const latest = await latestRevisionId();
  if (!Number.isInteger(target) || target < 1 || target > latest) {
    throw domainError("revisionNotFound", { revision: target }, { status: 404 });
  }

  const span = await revisionSpan(target, latest);
  if (!span) throw domainError("revisionNotRecorded", { revision: target }, { status: 409 });

  const stored = await storedValues([...span.keys()]);
  const writes = new Map<string, string>();
  for (const [key, change] of span) {
    // A key that did not exist then and does not exist now needs nothing, and staging the string
    // "null" for it would list a change from nothing to nothing.
    if (change.before === null && !stored.has(key)) {
      await discardStagedKey(userId, key);
      continue;
    }
    writes.set(key, change.before ?? "null");
  }
  await stageWrites(userId, writes);

  // stageWrites unstages a value that matches what is stored, so count what actually differs.
  return { staged: [...writes].filter(([key, value]) => stored.get(key) !== value).length };
}
