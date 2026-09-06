import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { auth } from "@/src/lib/auth";
import { planEnvCleanup } from "@/src/lib/migration/env-file";
import { SETTING_DEFINITIONS } from "@/src/lib/settings/registry";
import { resolveAllSettings } from "@/src/lib/settings/resolve";
import { getMigrationSource, isSetupCompleted } from "@/src/lib/setup";
import SetupDoneClient from "./SetupDoneClient";

export const metadata: Metadata = {
  title: { absolute: "Migration complete" },
};

/**
 * The summary a migrated deployment sees once setup finishes: its old database to keep, and the
 * command that tidies its `.env`.
 *
 * Only reachable by a deployment that recorded a migration, so an ordinary first-run setup is not
 * shown instructions about a file it never had.
 */
export default async function SetupDonePage() {
  const session = await auth();
  if (session?.user?.role !== "admin") redirect("/login");
  if (!(await isSetupCompleted())) redirect("/setup");

  const source = await getMigrationSource();
  if (!source) redirect("/");

  // Derived from what is in the database, not from reading the file: the environment usually comes
  // from Compose, Swarm or Kubernetes rather than a `.env` beside the app, and none of those are
  // visible from in here. What the app does know for certain is which settings it now stores.
  const settings = await resolveAllSettings();
  const cleanup = planEnvCleanup(
    SETTING_DEFINITIONS.filter(
      (definition) => settings.get(definition.key)?.source === "stored",
    ).map((definition) => definition.env),
  );

  return <SetupDoneClient source={source} cleanup={cleanup} />;
}
