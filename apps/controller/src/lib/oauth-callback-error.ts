/**
 * Turns the `?error=` Better Auth appends when an OAuth sign-in fails into a sentence for the
 * sign-in page.
 *
 * Only `account_not_linked` gets its own wording: it is the one an operator can act on, and it
 * replaces the old /link-account page. A provider without "Link to an existing account with the
 * same email" is refused when the email already belongs to someone, and the way forward is to sign
 * in some other way and link the provider from Profile.
 *
 * The code is echoed only when it looks like one of Better Auth's codes, so a crafted link cannot
 * put arbitrary text on the sign-in page.
 */

type Translate = (
  key: "accountNotLinked" | "oauthFailedCode",
  values?: Record<string, string>,
) => string;

const CODE_SHAPE = /^[a-z_]{1,64}$/;

export function oauthCallbackErrorMessage(code: string | undefined, t: Translate): string | null {
  if (!code) return null;
  if (code === "account_not_linked") return t("accountNotLinked");
  return t("oauthFailedCode", { code: CODE_SHAPE.test(code) ? code : "unknown" });
}
