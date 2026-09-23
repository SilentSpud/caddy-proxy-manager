/**
 * The warning a real (non-demo) instance on SQLite shows: it works, but it is meant for legacy
 * installs and demos, and an operator who picked it by accident should hear so before relying on it.
 *
 * The dashboard banner can be dismissed for a while rather than for good - the advice does not stop
 * being true, and a cookie is per browser, so each operator still sees it now and then.
 */
import { schemaDialect } from "./db/schema";
import { isDemoMode } from "./demo-mode";

export { SQLITE_NOTICE_COOKIE, SQLITE_NOTICE_DISMISS_SECONDS } from "./sqlite-notice-cookie";

/** A demo is exactly what SQLite is for, so it gets no warning. */
export function sqliteNoticeApplies(): boolean {
  return schemaDialect === "sqlite" && !isDemoMode();
}
