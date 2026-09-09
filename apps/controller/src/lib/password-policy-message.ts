/**
 * Renders the password rule as text. Separate from `password-policy.ts` so that module stays a
 * dependency-free predicate, and separate from any one caller because four screens report it.
 */

import en from "../../messages/en.json";
import {
  MIN_PASSWORD_LENGTH,
  type PasswordPolicyViolation,
  passwordPolicyViolations,
} from "./password-policy";

/** Exactly the keys this module reads. */
type PolicyKey =
  | "passwordPolicy.hint"
  | "passwordPolicy.error"
  | `passwordPolicy.violation.${PasswordPolicyViolation}`;

/**
 * Narrowed to the keys above rather than typed as next-intl's translator, which would drag the
 * package into `config.ts`'s startup graph. An unscoped `useTranslations()` or `getTranslations()`
 * satisfies this, because it accepts every key in the catalog and these are four of them.
 */
type Translate = (key: PolicyKey, values?: Record<string, string | number>) => string;

function violationKey(violation: PasswordPolicyViolation): PolicyKey {
  return `passwordPolicy.violation.${violation}`;
}

/** The rule as a sentence, for the hint under a password field. */
export function passwordPolicyHint(t: Translate): string {
  return t("passwordPolicy.hint", { min: MIN_PASSWORD_LENGTH });
}

/**
 * One sentence naming every failure, or null when the password passes. Reports all at once rather
 * than one per attempt, so someone retyping learns the whole rule in one go.
 *
 * `subject` names the field ("New password"), already translated by the caller - each form calls
 * its field something different, and only the caller knows which.
 */
export function passwordPolicyMessage(
  t: Translate,
  password: string,
  subject: string,
): string | null {
  const violations = passwordPolicyViolations(password);
  if (violations.length === 0) return null;

  const failures = violations
    .map((violation) => t(violationKey(violation), { min: MIN_PASSWORD_LENGTH }))
    .join(", ");

  return t("passwordPolicy.error", { subject, failures });
}

/**
 * The same wording, read straight from the English catalog.
 *
 * For `config.ts`, which validates ADMIN_PASSWORD at module scope: that runs before any request, so
 * there is no locale to render in and the message goes to the container log rather than a browser.
 * Reading the catalog rather than repeating the strings keeps the two from drifting.
 */
export function passwordPolicyViolationsInEnglish(password: string): string[] {
  return passwordPolicyViolations(password).map((violation) =>
    en.passwordPolicy.violation[violation].replace("{min}", String(MIN_PASSWORD_LENGTH)),
  );
}
