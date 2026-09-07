import type { useTranslations } from "next-intl";
import { DomainError } from "./domain-error";

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

export function extractErrorMessage(
  t: Translator,
  error: unknown,
  fallbackMessage: string,
): string {
  if (error instanceof DomainError) {
    // `params` has to come along: without it a code carrying placeholders renders them raw.
    return (t as unknown as DynamicTranslate)(`errors.${error.code}`, error.params);
  }
  return error instanceof Error ? error.message : fallbackMessage;
}
