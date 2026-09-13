/**
 * Better Auth endpoints the app replaces or does not offer, answered 404. Each writes `accounts`
 * alone and skips the app's own rules: the password policy, `users.passwordHash` (which sign-in
 * verifies), the unlink guard. The username probe tells anyone whether an account exists, and
 * verify-password is a guessing oracle outside the app's shared password budget. The UI signs in,
 * signs out, reads the session and links a provider - none of these.
 *
 * Its own module so a test can hand the list to a real Better Auth instance without the database.
 */
export const DISABLED_AUTH_PATHS = [
  "/change-password",
  "/request-password-reset",
  "/reset-password",
  "/verify-password",
  "/change-email",
  "/update-user",
  "/delete-user",
  "/delete-user/callback",
  "/unlink-account",
  "/is-username-available",
];
