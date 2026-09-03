import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { auth } from "@/src/lib/auth";
import { SETTING_DEFINITIONS, SETTING_GROUPS } from "@/src/lib/settings/registry";
import { resolveAllSettings } from "@/src/lib/settings/resolve";
import { getSetupState, SETUP_PATHS } from "@/src/lib/setup";
import SetupSettingsClient, { type SettingField } from "./SetupSettingsClient";

export const metadata: Metadata = {
  title: { absolute: "Finish setting up" },
};

const GROUP_TITLES: Record<(typeof SETTING_GROUPS)[number], string> = {
  application: "Application",
  authentication: "Sign-in and accounts",
  analytics: "Analytics",
  geoip: "GeoIP",
};

export default async function SetupSettingsPage() {
  const session = await auth();
  const { stage } = await getSetupState(!!session?.user);
  if (stage !== "settings") {
    redirect(SETUP_PATHS[stage]);
  }

  const resolved = await resolveAllSettings();

  // Secrets are never sent to the browser. An operator re-entering one is a small cost next to a
  // page that ships the ClickHouse password in its HTML.
  const fields: SettingField[] = SETTING_DEFINITIONS.map((definition) => {
    const current = resolved.get(definition.key);
    return {
      key: definition.key,
      env: definition.env,
      group: definition.group,
      label: definition.label,
      description: definition.description,
      kind:
        typeof definition.default === "boolean"
          ? "boolean"
          : typeof definition.default === "number"
            ? "number"
            : definition.default === null
              ? "tristate"
              : "string",
      secret: definition.secret === true,
      value: definition.secret ? "" : (current?.value ?? definition.default),
      source: current?.source ?? "default",
    };
  });

  return (
    <SetupSettingsClient
      fields={fields}
      groups={SETTING_GROUPS.map((group) => ({ id: group, title: GROUP_TITLES[group] }))}
    />
  );
}
