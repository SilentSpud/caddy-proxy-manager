/**
 * The one definition of what makes a password acceptable — previously duplicated between config.ts
 * and the change-password route. Dependency-free, so config.ts can load it at module scope and
 * client components can give the same feedback the server will.
 *
 * The rule returns codes rather than sentences: a translated message cannot be built by pasting a
 * subject in front of a predicate, because not every language puts it there. `password-policy-
 * message.ts` turns these into text, and `messages/*.json` decides the wording.
 */

export const MIN_PASSWORD_LENGTH = 12;

/** One per rule, in the order they are reported. */
export type PasswordPolicyViolation = "length" | "case" | "number" | "special";

/** Every requirement the password fails. Empty means acceptable. */
export function passwordPolicyViolations(password: string): PasswordPolicyViolation[] {
  const violations: PasswordPolicyViolation[] = [];

  if (password.length < MIN_PASSWORD_LENGTH) {
    violations.push("length");
  }
  if (!/[A-Z]/.test(password) || !/[a-z]/.test(password)) {
    violations.push("case");
  }
  if (!/[0-9]/.test(password)) {
    violations.push("number");
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    violations.push("special");
  }

  return violations;
}

/** Whether the password may be accepted. */
export function isPasswordAcceptable(password: string): boolean {
  return passwordPolicyViolations(password).length === 0;
}
