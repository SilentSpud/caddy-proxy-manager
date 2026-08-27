/**
 * The one definition of what makes a password acceptable.
 *
 * This rule previously existed as two independent copies — the ADMIN_PASSWORD
 * check in config.ts and the change-password route, whose comment said it was
 * "matching production admin password requirements" and then restated it by
 * hand. Anything that asks a human to choose a password should import from here
 * instead, so the requirement cannot drift between the places that enforce it.
 *
 * Deliberately dependency-free: config.ts loads it at module scope, and client
 * components import it to give the same feedback the server will.
 */

export const MIN_PASSWORD_LENGTH = 12;

/** Shown under password fields so the rule is visible before submitting. */
export const PASSWORD_POLICY_HINT = `At least ${MIN_PASSWORD_LENGTH} characters, including upper and lower case, a number, and a special character`;

/**
 * Every requirement the password fails, phrased as a predicate so the caller can
 * supply the subject — "ADMIN_PASSWORD must be…", "Export password must be…".
 * An empty array means the password is acceptable.
 */
export function passwordPolicyFailures(password: string): string[] {
  const failures: string[] = [];

  if (password.length < MIN_PASSWORD_LENGTH) {
    failures.push(`must be at least ${MIN_PASSWORD_LENGTH} characters long`);
  }
  if (!/[A-Z]/.test(password) || !/[a-z]/.test(password)) {
    failures.push("must include both uppercase and lowercase letters");
  }
  if (!/[0-9]/.test(password)) {
    failures.push("must include at least one number");
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    failures.push("must include at least one special character");
  }

  return failures;
}

/**
 * One sentence naming every failure, or null when the password is acceptable.
 * Reports all failures at once rather than one per attempt.
 */
export function passwordPolicyError(password: string, subject = "Password"): string | null {
  const failures = passwordPolicyFailures(password);
  return failures.length > 0 ? `${subject} ${failures.join(", ")}` : null;
}
