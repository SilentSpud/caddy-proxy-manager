import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { auth } from "@/src/lib/auth";
import { getMigrationSource, getSetupState, SETUP_PATHS } from "@/src/lib/setup";
import SetupAccountClient from "./SetupAccountClient";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("setup.account");
  return { title: { absolute: t("metaTitle") } };
}

/**
 * The account step. Public by necessity — there is nothing to authenticate against yet — so the
 * stage is re-checked here rather than trusted from the proxy, which lets this page through
 * unconditionally so an unconfigured instance can reach it.
 */
export default async function SetupPage() {
  const session = await auth();
  const { stage } = await getSetupState(!!session?.user);

  if (stage !== "account") {
    redirect(SETUP_PATHS[stage]);
  }

  // A migration that left the old accounts behind lands here, and it looks exactly like a fresh
  // install unless the page says otherwise — which reads as the migration having done nothing.
  return <SetupAccountClient migratedFrom={await getMigrationSource()} />;
}
