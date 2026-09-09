/**
 * Says a `DomainError` in the reader's language before it leaves the server.
 *
 * For actions that return data, so they cannot return an `ActionState` and be rendered through
 * `actionError()` like the proxy-host ones. They still throw, and the client still shows
 * `e.message` - but the message is translated by then, because only the server can reach the
 * catalog. Anything that is not a `DomainError` is rethrown untouched, which is what keeps
 * `redirect()` working: it signals by throwing.
 */
import { getTranslations } from "next-intl/server";
import { DomainError } from "./domain-error";
import { extractErrorMessage } from "./actions";

export async function withTranslatedErrors<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
    const t = await getTranslations();
    throw new Error(extractErrorMessage(t, error, error.message));
  }
}
