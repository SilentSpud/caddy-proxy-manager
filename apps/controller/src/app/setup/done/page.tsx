import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { auth } from "@/src/lib/auth";
import { dashboardHostAnswers, dashboardHostOrigin } from "@/src/lib/dashboard-host";
import { planEnvCleanup } from "@/src/lib/migration/env-file";
import { getDashboardSettings } from "@/src/lib/settings";
import { SETTING_DEFINITIONS } from "@/src/lib/settings/registry";
import { resolveAllSettings } from "@/src/lib/settings/resolve";
import { getMigrationSource, isSetupCompleted } from "@/src/lib/setup";
import SetupDoneClient from "./SetupDoneClient";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("setup.done");
  return { title: { absolute: t("metaTitle") } };
}

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

  // The dashboard's own domain, when setup claimed one and it answers there: this page is the one
  // place a migrated deployment is not handed over automatically, so its last button is where that
  // happens. Asked rather than assumed - the check is bounded, and a button onto a domain whose
  // DNS does not arrive here yet is worse than one that stays where the operator already is.
  const dashboardSettings = await getDashboardSettings();
  const dashboard = (await dashboardHostAnswers(dashboardSettings))
    ? dashboardHostOrigin(dashboardSettings)
    : null;

  return <SetupDoneClient source={source} cleanup={cleanup} dashboardOrigin={dashboard} />;
}
