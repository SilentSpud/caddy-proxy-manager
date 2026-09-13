import { isPasswordAcceptable } from "./password-policy";

/**
 * Why a Better Auth request must be refused under the app's password policy, or null to let it
 * through. Self-registration is Better Auth's own route, which would only check its length floor.
 * Pure, so the rule is testable without building an auth instance.
 */
export function signUpPasswordError(path: string, body: unknown): string | null {
  if (path !== "/sign-up/email") return null;
  const password = (body as { password?: unknown } | null | undefined)?.password;
  if (typeof password === "string" && isPasswordAcceptable(password)) return null;
  return "Password does not meet the password policy";
}
