/**
 * Errors the model layer raises that a person is meant to read.
 *
 * The models cannot translate: they run for a server action, for `/api/v1/*` and for the agent's
 * own sync, and only the first of those has a reader with a language. So they raise a code and an
 * English sentence — the action layer renders the code, and everything else keeps the sentence,
 * which is what the REST contract already documents.
 *
 * Same shape and same reasoning as `SettingValidationError`; see the note there.
 */

import en from "../../messages/en.json";

export type DomainErrorCode = keyof typeof en.errors;

export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    readonly params: Record<string, string | number>,
    message: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

/**
 * Raise one. The English wording comes from the catalog rather than being repeated here, so the
 * message an API client gets and the message a browser gets can never drift apart.
 */
export function domainError(
  code: DomainErrorCode,
  params: Record<string, string | number> = {},
): DomainError {
  const message = en.errors[code].replace(/\{(\w+)\}/g, (whole, name) =>
    name in params ? String(params[name]) : whole,
  );
  return new DomainError(code, params, message);
}
