import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { auth } from "@/src/lib/auth";
import { getMigrationSource, getSetupState, SETUP_PATHS } from "@/src/lib/setup";
import SetupAccountClient from "./SetupAccountClient";

export const metadata: Metadata = {
  title: { absolute: "Set up Caddy Proxy Manager" },
};

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
