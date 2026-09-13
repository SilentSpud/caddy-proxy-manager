import { passwordPolicyMessage } from "./password-policy-message";

type Translate = Parameters<typeof passwordPolicyMessage>[0];

/** The one Better Auth route whose password the app's policy has to be applied to by hand. */
export const SIGN_UP_EMAIL_PATH = "/sign-up/email";

/**
 * Why a Better Auth request must be refused under the app's password policy, or null to let it
 * through. Self-registration is Better Auth's own route, which would only check its length floor.
 * Pure, so the rule is testable without building an auth instance; `t` renders the message from
 * the catalog, as every other password form does.
 */
export function signUpPasswordError(path: string, body: unknown, t: Translate): string | null {
  if (path !== SIGN_UP_EMAIL_PATH) return null;
  const password = (body as { password?: unknown } | null | undefined)?.password;
  return passwordPolicyMessage(
    t,
    typeof password === "string" ? password : "",
    t("passwordPolicy.subject.password" as Parameters<Translate>[0]),
  );
}
