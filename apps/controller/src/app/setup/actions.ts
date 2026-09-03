"use server";

/**
 * The first-run setup actions.
 *
 * Every one of these re-checks the stage before it writes. The pages guard too, but a page guard is
 * a redirect and these are the endpoints that actually create an administrator — an unauthenticated
 * POST to a setup action on a configured instance would otherwise be a way to mint one.
 */
import { redirect } from "next/navigation";
import { createOAuthProvider } from "@/src/lib/models/oauth-providers";
import { createUser, findUserByEmail } from "@/src/lib/models/user";
import { hashPassword } from "@/src/lib/password";
import { passwordPolicyError } from "@/src/lib/password-policy";
import { hasAnySignIn, isSetupCompleted } from "@/src/lib/setup";

export type SetupActionState = { error: string | null };

/**
 * Refuse to run once anything can sign in.
 *
 * `hasAnySignIn`, not the completion flag: the account step is over the moment an account exists,
 * whether or not the operator has finished the settings step. Checking the flag instead would leave
 * this open for the whole of the rest of setup.
 */
async function assertAccountStepOpen(): Promise<void> {
  if ((await isSetupCompleted()) || (await hasAnySignIn())) {
    throw new Error("Setup has already been completed.");
  }
}

/** Create the first administrator from the setup form. */
export async function createFirstAdmin(
  _previous: SetupActionState,
  formData: FormData,
): Promise<SetupActionState> {
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const confirmation = String(formData.get("passwordConfirmation") ?? "");

  if (!username) return { error: "A username is required." };
  if (password !== confirmation) return { error: "The two passwords do not match." };

  const policyFailure = passwordPolicyError(password);
  if (policyFailure) return { error: policyFailure };

  try {
    await assertAccountStepOpen();
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Setup is no longer open." };
  }

  // The same synthetic address the environment-seeded admin has always used, so an operator who
  // later sets ADMIN_USERNAME to the same name updates this account rather than making a second.
  const email = `${username.toLowerCase()}@localhost`;
  if (await findUserByEmail(email)) {
    return { error: "That username is already taken." };
  }

  await createUser({
    email,
    name: username,
    role: "admin",
    provider: "credentials",
    subject: username,
    username: username.toLowerCase(),
    displayUsername: username,
    passwordHash: await hashPassword(password),
  });

  // To the login page rather than onwards: the point of this step is to prove the credentials work
  // before any more configuration is entered.
  redirect("/login");
}

/** Configure an OAuth provider as the way in, instead of a local account. */
export async function configureFirstOAuthProvider(
  _previous: SetupActionState,
  formData: FormData,
): Promise<SetupActionState> {
  const name = String(formData.get("providerName") ?? "").trim();
  const clientId = String(formData.get("clientId") ?? "").trim();
  const clientSecret = String(formData.get("clientSecret") ?? "").trim();
  const issuer = String(formData.get("issuer") ?? "").trim();

  if (!name) return { error: "A display name is required." };
  if (!clientId || !clientSecret) return { error: "A client ID and secret are required." };
  if (!/^https?:\/\/\S+$/.test(issuer)) {
    return { error: "The issuer must be a URL starting with http:// or https://." };
  }

  try {
    await assertAccountStepOpen();
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Setup is no longer open." };
  }

  try {
    await createOAuthProvider({
      name,
      type: "oidc",
      clientId,
      clientSecret,
      issuer,
      scopes: "openid email profile",
      autoLink: false,
      enabled: true,
      source: "ui",
    });
  } catch (error) {
    console.error("Setup: failed to create the OAuth provider", error);
    return { error: "Could not save the provider. Check the values and try again." };
  }

  redirect("/login");
}
