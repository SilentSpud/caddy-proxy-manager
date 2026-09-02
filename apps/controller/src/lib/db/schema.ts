/**
 * The application's tables.
 *
 * Re-exported from ./connection.ts rather than imported from ./schema.pg.ts directly, so the
 * tables callers use are provably the same objects the driver was handed. That mattered more when
 * there were two dialects to disagree about; it is kept because it still costs nothing and keeps
 * one definition of "the active schema".
 */
export * from "./schema.pg";
