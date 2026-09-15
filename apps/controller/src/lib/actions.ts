import type { useFormatter, useTranslations } from "next-intl";
import { DomainError, type StoredErrorCode } from "./domain-error";

export type ActionState = {
  status: "idle" | "success" | "error";
  message?: string;
};

export const INITIAL_ACTION_STATE: ActionState = { status: "idle" };

export function actionSuccess(message?: string): ActionState {
  return {
    status: "success",
    message,
  };
}

type Translator = ReturnType<typeof useTranslations>;

/** Which error code failed is only known at runtime; `tests/unit/domain-error.test.ts` covers it. */
type DynamicTranslate = (key: string, values?: Record<string, string | number>) => string;

/**
 * The message to show for a failed action.
 *
 * A `DomainError` carries a code, so it can be said in the reader's language; anything else has
 * only the English sentence it was constructed with, and an unrecognized failure falls back to the
 * caller's own wording. Pass `t` from `await getTranslations()`.
 */
export function actionError(t: Translator, error: unknown, fallbackMessage: string): ActionState {
  return {
    status: "error",
    message: extractErrorMessage(t, error, fallbackMessage),
  };
}

/** What a list param needs from next-intl's formatter; `await getFormatter()` is one. */
export type ListFormatter = Pick<ReturnType<typeof useFormatter>, "list">;

/**
 * `format` is for codes carrying a list param. Without it a list is joined the way the English
 * joins it, which is right for English and merely readable for anything else.
 */
export function extractErrorMessage(
  t: Translator,
  error: unknown,
  fallbackMessage: string,
  format?: ListFormatter,
): string {
  if (error instanceof DomainError) {
    // `params` has to come along: without it a code carrying placeholders renders them raw.
    const values: Record<string, string | number> = {};
    for (const [name, value] of Object.entries(error.params)) {
      values[name] =
        typeof value !== "object"
          ? value
          : format
            ? format.list(value, { type: "unit" })
            : value.join(", ");
    }
    return (t as unknown as DynamicTranslate)(`errors.${error.code}`, values);
  }
  return error instanceof Error ? error.message : fallbackMessage;
}

/**
 * The message for a failure a background job stored: the update check, the GeoIP updater.
 *
 * They run with no reader, so they keep the English they always stored and, when the failure was
 * a `DomainError`, its code beside it. A result stored before the code existed, or a failure that
 * never had one (a refused connection), is shown in the English it was stored in.
 */
export function storedErrorMessage(
  t: Translator,
  message: string,
  code: StoredErrorCode | null | undefined,
): string {
  if (!code) return message;
  return extractErrorMessage(t, new DomainError(code.code, code.params, message), message);
}
