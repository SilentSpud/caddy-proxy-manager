/**
 * Puts a refused Better Auth sign-in into words for the sign-in screen.
 *
 * Better Auth answers with an English `message` and a stable `code`. The message is never shown -
 * it is English whatever the reader's language - and the code is looked up instead. A code this
 * does not know (a newer Better Auth, a plugin added later) gets a generic sentence rather than
 * raw text. The rate limiter answers 429 with a message and no code, so it is matched by status.
 *
 * The English under `auth.errors` is Better Auth's own wording, so an English reader sees what
 * they saw before; `tests/unit/sign-in-error.test.ts` holds the two together.
 */

export type SignInErrorKey =
  | "emailNotVerified"
  | "invalidUsername"
  | "invalidUsernameOrPassword"
  | "tooManyRequests"
  | "unknown"
  | "usernameTooLong"
  | "usernameTooShort";

/** The codes `signIn.username` can refuse with, from the username plugin's USERNAME_ERROR_CODES. */
export const SIGN_IN_ERROR_KEYS: Readonly<
  Record<string, Exclude<SignInErrorKey, "tooManyRequests" | "unknown">>
> = {
  INVALID_USERNAME_OR_PASSWORD: "invalidUsernameOrPassword",
  INVALID_USERNAME: "invalidUsername",
  USERNAME_TOO_SHORT: "usernameTooShort",
  USERNAME_TOO_LONG: "usernameTooLong",
  EMAIL_NOT_VERIFIED: "emailNotVerified",
};

export function signInErrorMessage(
  error: { status?: number; code?: string },
  t: (key: SignInErrorKey) => string,
): string {
  if (error.status === 429) return t("tooManyRequests");
  // Own properties only: a code of "toString" must not find Object.prototype's.
  const key =
    error.code && Object.hasOwn(SIGN_IN_ERROR_KEYS, error.code)
      ? SIGN_IN_ERROR_KEYS[error.code]
      : undefined;
  return t(key ?? "unknown");
}
