/**
 * Client-side identity for the rows of an editable list. The field-array editors used to key rows
 * on the array index, so deleting row 1 of 3 made row 2 inherit row 1's DOM node and any state it
 * had not pushed into React. Each row now carries an id minted where it is created. The ids are
 * render-only, so each editor builds its hidden-input JSON from explicit fields.
 */

let fallbackCounter = 0;

/** Mints an id unique within the page. */
export function newRowId(): string {
  // randomUUID is only exposed in a secure context, which a plain-HTTP LAN install is not. The
  // counter covers that case: ids need to be unique among the rows on one page, not globally.
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  fallbackCounter += 1;
  return `row-${fallbackCounter}`;
}

export type WithRowId<T> = T & { rowId: string };

/** Tags one freshly created row with an id. */
export function withRowId<T extends object>(value: T): WithRowId<T> {
  return { ...value, rowId: newRowId() };
}

/** Tags rows seeded from server data, e.g. in a `useState` initializer. */
export function withRowIds<T extends object>(values: readonly T[]): WithRowId<T>[] {
  return values.map(withRowId);
}
