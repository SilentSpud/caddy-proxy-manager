"use server";

import { redirect } from "next/navigation";
import { auth } from "@/src/lib/auth";
import { createOAuthProvider, listOAuthProviders } from "@/src/lib/models/oauth-providers";
import { isAppRole } from "@/src/lib/oidc-groups";
import {
  analyticsEnabled,
  clickhousePassword,
  SETTING_DEFINITIONS,
  SettingValidationError,
} from "@/src/lib/settings/registry";
import { propagateOptionalFeatureSettings } from "@/src/lib/settings/optional-features";
import { resolveAllSettings, saveSettings } from "@/src/lib/settings/resolve";
import { type GeneralSettings, saveGeneralSettings } from "@/src/lib/settings";
// SettingsValidationError, not the registry's SettingValidationError beside it: one belongs to the
// JSON groups and one to the registry, and this action now saves through both.
import { SettingsValidationError, validateSettingsGroup } from "@/src/lib/settings-validation";
import {
  getMigrationSource,
  isSetupCompleted,
  markSetupCompleted,
  promoteFirstSetupAdmin,
} from "@/src/lib/setup";

export type SetupSettingsState = { error: string | null };

/**
 * Save the configuration collected by the last setup step, then mark setup finished.
 *
 * Whoever completes setup is the administrator. A signed-in session is required — this step runs
 * after the sign-in setup insists on, so there is a real user by now — but demanding that they
 * already *be* an admin made the OAuth branch of the account step a dead end: it stores a provider
 * and no user, so the user row is created by Better Auth's callback with `role: "user"`, and the
 * only place group-to-role mapping can be turned on is this very step. Promoting here rather than
 * relaxing the check outright matters: finishing setup with nobody an admin would leave a
 * completed instance with no way to reach Settings at all.
 */
export async function saveSetupSettings(
  _previous: SetupSettingsState,
  formData: FormData,
): Promise<SetupSettingsState> {
  const session = await auth();
  if (!session?.user) {
    return { error: "You need to be signed in to finish setup." };
  }
  if (await isSetupCompleted()) {
    redirect("/");
  }

  // Before the writes below, so the rest of this action runs as an administrator. A no-op when
  // the account step already made one, which is every local-account setup — and for a second,
  // ordinary user reaching this step, which is what the check below still refuses.
  const promoted = await promoteFirstSetupAdmin(Number(session.user.id));
  if (!promoted && session.user.role !== "admin") {
    return { error: "You need to be signed in as an administrator to finish setup." };
  }

  // Read from the registry rather than iterating the form, so a setting the form did not post is
  // still considered. Booleans compare against "on": the Switch wrapper in
  // components/ui/FormBooleanControls always submits a hidden input, empty when off, so a
  // presence check would read every toggle as true.
  const resolved = await resolveAllSettings();
  const values: Record<string, unknown> = {};

  for (const definition of SETTING_DEFINITIONS) {
    const raw = formData.get(definition.key);

    // A gate is stored tri-state but rendered as a switch, and setup is where the choice becomes
    // explicit: write a definite yes or no rather than the null that means "infer it".
    if (definition.gate) {
      values[definition.key] = raw === "on";
      continue;
    }

    if (typeof definition.default === "boolean") {
      // Nothing posted means the field was not rendered — a gated group whose switch is off. Left
      // alone rather than written false, which is what keeps a stored credential from being
      // cleared by turning its feature off.
      if (raw === null) continue;
      values[definition.key] = raw === "on";
      continue;
    }

    if (raw === null) continue;
    const text = String(raw);

    // A secret is never sent to the browser, so a blank one means "leave it alone" rather than
    // "clear it". Carry the resolved value across instead: the point of this step is that the
    // operator can delete the variable from their .env afterwards, which only holds if the value
    // actually lands in the database.
    if (definition.secret && text === "") {
      const current = resolved.get(definition.key)?.value;
      if (typeof current === "string" && current !== "") {
        values[definition.key] = current;
      }
      continue;
    }

    values[definition.key] = text;
  }

  // Refused rather than saved and quietly ignored, matching the Settings page: the ClickHouse
  // container will not start without a password, so "analytics on, no password" cannot become true.
  // `values` already carries a blank secret's stored value, so this sees what will actually land.
  if (values[analyticsEnabled.key] === true) {
    const password = values[clickhousePassword.key] ?? resolved.get(clickhousePassword.key)?.value;
    if (typeof password !== "string" || password.trim() === "") {
      return {
        error: "Analytics need a ClickHouse password, or switch analytics off to continue.",
      };
    }
  }

  // Not a registry setting: `general` is a JSON object older than the registry, and the Settings
  // page and the v1 API both read it from there. Validated through the same function that API
  // route uses rather than by hand, so the rules and the wording cannot drift apart.
  let general: GeneralSettings;
  try {
    const acmeEmail = String(formData.get("acmeEmail") ?? "").trim();
    general = validateSettingsGroup("general", {
      primaryDomain: String(formData.get("primaryDomain") ?? "").trim(),
      // Omitted rather than empty when blank: the validator treats the key as optional, and
      // storing "" would hand an empty contact to the ACME issuer instead of leaving it unset.
      ...(acmeEmail === "" ? {} : { acmeEmail }),
    }) as GeneralSettings;
  } catch (error) {
    if (error instanceof SettingsValidationError) {
      return { error: error.message };
    }
    throw error;
  }

  try {
    await saveSettings(values);
    await saveGeneralSettings(general);
  } catch (error) {
    if (error instanceof SettingValidationError) {
      return { error: error.message };
    }
    console.error("Setup: failed to save settings", error);
    return { error: "Could not save the configuration. Try again." };
  }

  // Analytics and GeoIP decide whether a container runs, and the operator has just chosen. Without
  // this, setup would finish with ClickHouse still stopped and the client still holding whatever it
  // resolved before the form was filled in. Never throws — see the function's own note.
  await propagateOptionalFeatureSettings();

  const providerError = await createProviderFromForm(formData);
  if (providerError) return { error: providerError };

  await markSetupCompleted();

  // A deployment that migrated has one more thing owed to it: its old database back, and a .env it
  // can safely replace. Everyone else is finished here.
  redirect((await getMigrationSource()) ? "/setup/done" : "/");
}

/**
 * Create the identity provider the settings step offered, if it was filled in.
 *
 * Returns a message rather than throwing, so a mistyped issuer leaves the operator on the form
 * with the rest of their configuration already saved rather than losing the page.
 *
 * Blank is the ordinary answer: a deployment signing in with a local administrator has no provider
 * to describe, and the card is optional for that reason. Partly filled is not — a name with no
 * client secret is a provider that cannot work, and silently skipping it would leave the operator
 * believing they had configured single sign-on.
 */
async function createProviderFromForm(formData: FormData): Promise<string | null> {
  const read = (key: string) => String(formData.get(key) ?? "").trim();
  const flag = (key: string) => formData.get(key) === "on";

  const name = read("idpName");
  const clientId = read("idpClientId");
  const clientSecret = read("idpClientSecret");
  const issuer = read("idpIssuer");

  const filled = [name, clientId, clientSecret, issuer].filter((value) => value !== "");
  if (filled.length === 0) return null;
  if (filled.length < 4) {
    return "An identity provider needs a display name, issuer URL, client ID and client secret — or leave all four blank to skip it.";
  }
  if (!/^https?:\/\/\S+$/.test(issuer)) {
    return "The issuer must be a URL starting with http:// or https://.";
  }

  // Re-checked here rather than trusted from the render: the page was drawn before the form was
  // filled in, and the account step can have created a provider in between.
  if ((await listOAuthProviders()).length > 0) {
    return null;
  }

  // Narrowed rather than cast: this is a posted string that createOAuthProvider stores as a role,
  // so anything unrecognised falls back instead of being written.
  const posted = read("idpDefaultRole");
  const defaultRole = isAppRole(posted) ? posted : "user";

  try {
    await createOAuthProvider({
      name,
      type: "oidc",
      clientId,
      clientSecret,
      issuer,
      authorizationUrl: read("idpAuthorizationUrl") || null,
      tokenUrl: read("idpTokenUrl") || null,
      userinfoUrl: read("idpUserinfoUrl") || null,
      scopes: read("idpScopes") || "openid email profile",
      autoLink: flag("idpAutoLink"),
      enabled: true,
      source: "ui",
      roleMappingEnabled: flag("idpRoleMapping"),
      groupsClaim: read("idpGroupsClaim") || "groups",
      groupPrefix: read("idpGroupPrefix"),
      adminGroup: read("idpAdminGroup"),
      userGroup: read("idpUserGroup"),
      viewerGroup: read("idpViewerGroup"),
      defaultRole,
      syncGroups: flag("idpSyncGroups"),
    });
  } catch (error) {
    console.error("Setup: failed to create the OAuth provider", error);
    return "The settings were saved, but the identity provider could not be created. Check its values and try again.";
  }

  return null;
}
