/**
 * Errors the model layer raises that a person is meant to read.
 *
 * The models cannot translate: they run for a server action, for `/api/v1/*` and for the agent's
 * own sync, and only the first of those has a reader with a language. So they raise a code and an
 * English sentence - the action layer renders the code, and everything else keeps the sentence,
 * which is what the REST contract already documents.
 *
 * Same shape and same reasoning as `SettingValidationError`; see the note there.
 */

import en from "../../messages/en.json";

export type DomainErrorCode = keyof typeof en.errors;

/**
 * A list param - a run of host names, say - is joined with ", " for the English, which is what those
 * messages said before the catalog, and list-formatted for a reader by `extractErrorMessage`.
 */
export type DomainErrorParams = Record<string, string | number | readonly string[]>;

export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    readonly params: DomainErrorParams,
    message: string,
    /**
     * The 4xx `/api/v1` answers with, for a model error that used to be an `ApiClientError`.
     * Without one the REST layer treats the error as it always has.
     */
    readonly status?: number,
  ) {
    // The same guard as ApiClientError: a status is a promise the message is safe to hand back.
    if (status !== undefined && (!Number.isInteger(status) || status < 400 || status > 499)) {
      throw new RangeError("DomainError status must be a 4xx status code");
    }
    super(message);
    this.name = "DomainError";
  }
}

/** The English sentence for a code, as `/api/v1` and the agent's sync return it. */
export function domainErrorMessage(code: DomainErrorCode, params: DomainErrorParams = {}): string {
  return en.errors[code].replace(/\{(\w+)\}/g, (whole, name: string) => {
    if (!(name in params)) return whole;
    const value = params[name];
    return typeof value === "object" ? value.join(", ") : String(value);
  });
}

/**
 * Raise one. The English wording comes from the catalog rather than being repeated here, so the
 * message an API client gets and the message a browser gets can never drift apart.
 */
export function domainError(
  code: DomainErrorCode,
  params: DomainErrorParams = {},
  options: { status?: number } = {},
): DomainError {
  return new DomainError(code, params, domainErrorMessage(code, params), options.status);
}

/**
 * A `DomainError`'s code as a background job writes it to the database next to the English, so a
 * page can later say it in its reader's language. See `storedErrorMessage` in `actions.ts`.
 */
export type StoredErrorCode = { code: DomainErrorCode; params: DomainErrorParams };

/** The code to store for a failure, or null when it has none to store. */
export function storedErrorCode(error: unknown): StoredErrorCode | null {
  return error instanceof DomainError ? { code: error.code, params: error.params } : null;
}
