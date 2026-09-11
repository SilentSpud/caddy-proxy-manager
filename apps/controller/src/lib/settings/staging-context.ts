/**
 * The ambient scope that turns a settings read or write into a staged one.
 *
 * Settings reach Caddy through a long chain - `getSetting` feeds two dozen `get*Settings`
 * helpers, which feed a 3000-line config builder - and threading a "pretend these values are
 * different" parameter down it would mean editing every link. An AsyncLocalStorage scope does the
 * same job at the two ends that matter: `getSetting` consults the overlay, `setSetting` diverts
 * into the capture map, and everything between them is unchanged and unaware.
 *
 * Values are held as serialized JSON, the same shape the `settings` table stores, so a staged read
 * takes the identical parse path as a stored one and cannot diverge from it.
 */

import { AsyncLocalStorage } from "node:async_hooks";

export type StagingScope = {
  /**
   * Consulted by `getSetting` before the table: a key present here wins. Values are serialized
   * JSON, so a staged clear is the string `"null"` - present, so it still wins, and it parses to null
   * rather than falling through to the stored value.
   */
  overlay: ReadonlyMap<string, string>;
  /**
   * Where `setSetting` writes instead of the table. Absent means reads are overlaid but writes
   * still land for real - which is what the apply path wants, and what a dry-run render wants.
   */
  capture?: Map<string, string>;
  /**
   * Suppresses `applyCaddyConfig`. Actions call it themselves after saving; while their writes are
   * being staged there is nothing yet to push, and the apply step pushes once for all of them.
   */
  suppressApply?: boolean;
};

const storage = new AsyncLocalStorage<StagingScope>();

export function currentStagingScope(): StagingScope | undefined {
  return storage.getStore();
}

export function withStagingScope<T>(scope: StagingScope, fn: () => Promise<T>): Promise<T> {
  return storage.run(scope, fn);
}

/**
 * Run `fn` with no staging scope at all, whatever the caller is inside.
 *
 * For writes that are caches rather than configuration - an update check's result, say. Those are
 * triggered by a read, so they inherit whatever scope that read was in, and a cache landing in an
 * operator's change set would be both baffling to review and wrong to apply.
 */
export function outsideStagingScope<T>(fn: () => Promise<T>): Promise<T> {
  return storage.exit(fn);
}

/**
 * Run `fn` with staged values standing in for stored ones, writes still landing normally.
 *
 * This is how the config builder renders what Caddy *would* receive: call it around
 * `buildCaddyDocument()` and every settings read inside resolves against the staged set.
 */
export function withStagedReads<T>(
  overlay: ReadonlyMap<string, string>,
  fn: () => Promise<T>,
): Promise<T> {
  return withStagingScope({ overlay }, fn);
}

/**
 * Run `fn` with its settings writes captured instead of committed.
 *
 * Reads are overlaid with the same staged set so an action that reads a blob, edits one field and
 * writes it back composes with earlier staged edits rather than reverting them.
 */
export async function withCapturedWrites<T>(
  overlay: ReadonlyMap<string, string>,
  fn: () => Promise<T>,
): Promise<{ result: T; writes: Map<string, string> }> {
  const capture = new Map<string, string>();
  const result = await withStagingScope({ overlay, capture, suppressApply: true }, fn);
  return { result, writes: capture };
}
