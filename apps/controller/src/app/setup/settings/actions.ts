"use server";

import { redirect } from "next/navigation";
import { auth } from "@/src/lib/auth";
import {
  analyticsEnabled,
  clickhousePassword,
  SETTING_DEFINITIONS,
  SettingValidationError,
} from "@/src/lib/settings/registry";
import { propagateOptionalFeatureSettings } from "@/src/lib/settings/optional-features";
import { resolveAllSettings, saveSettings } from "@/src/lib/settings/resolve";
import { getMigrationSource, isSetupCompleted, markSetupCompleted } from "@/src/lib/setup";

export type SetupSettingsState = { error: string | null };

/**
 * Save the configuration collected by the last setup step, then mark setup finished.
 *
 * Requires an admin session: this step runs after the sign-in that setup insists on, so there is a
 * real user by now and the endpoint should be protected like any other administrative write.
 */
export async function saveSetupSettings(
  _previous: SetupSettingsState,
  formData: FormData,
): Promise<SetupSettingsState> {
  const session = await auth();
  if (session?.user?.role !== "admin") {
    return { error: "You need to be signed in as an administrator to finish setup." };
  }
  if (await isSetupCompleted()) {
    redirect("/");
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

  try {
    await saveSettings(values);
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

  await markSetupCompleted();

  // A deployment that migrated has one more thing owed to it: its old database back, and a .env it
  // can safely replace. Everyone else is finished here.
  redirect((await getMigrationSource()) ? "/setup/done" : "/");
}
