/**
 * The one definition of what makes a password acceptable — previously duplicated between config.ts
 * and the change-password route. Dependency-free, so config.ts can load it at module scope and
 * client components can give the same feedback the server will.
 */

export const MIN_PASSWORD_LENGTH = 12;

/** Shown under password fields so the rule is visible before submitting. */
export const PASSWORD_POLICY_HINT = `At least ${MIN_PASSWORD_LENGTH} characters, including upper and lower case, a number, and a special character`;

/**
 * Every requirement the password fails, phrased as a predicate so the caller supplies the subject
 * ("ADMIN_PASSWORD must be…"). Empty means acceptable.
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

/** One sentence naming every failure, or null. Reports all at once, not one per attempt. */
export function passwordPolicyError(password: string, subject = "Password"): string | null {
  const failures = passwordPolicyFailures(password);
  return failures.length > 0 ? `${subject} ${failures.join(", ")}` : null;
}
