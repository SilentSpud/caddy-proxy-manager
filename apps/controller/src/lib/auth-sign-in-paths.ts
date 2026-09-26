/**
 * Better Auth's password sign-in endpoints, relative to its base path. Shared by the auth route,
 * which gates and audits them, and the session hook, which must not audit them early.
 */
export const CREDENTIAL_SIGN_IN_PATHS = ["/sign-in/username", "/sign-in/email"] as const;

/** Where a second factor is checked after a password sign-in asked for one. */
export const TWO_FACTOR_VERIFY_PATHS = [
  "/two-factor/verify-totp",
  "/two-factor/verify-backup-code",
] as const;

/** Where a signed-in user turns 2FA on or off, or replaces their backup codes. */
export const TWO_FACTOR_MANAGE_PATHS = [
  "/two-factor/enable",
  "/two-factor/disable",
  "/two-factor/generate-backup-codes",
] as const;

export function isCredentialSignInPath(path: string | undefined): boolean {
  return (CREDENTIAL_SIGN_IN_PATHS as readonly string[]).includes(path ?? "");
}

export function isTwoFactorVerifyPath(path: string | undefined): boolean {
  return (TWO_FACTOR_VERIFY_PATHS as readonly string[]).includes(path ?? "");
}

/**
 * The plugin's challenge cookie, `<prefix>.two_factor`, which only a sign-in part-way through has.
 * Confirming a new authenticator goes through the same verify endpoint without one.
 */
export function hasTwoFactorChallengeCookie(cookieHeader: string | null | undefined): boolean {
  return /(?:^|;\s*)(?:__Secure-)?[^=;]*\.two_factor=/.test(cookieHeader ?? "");
}
