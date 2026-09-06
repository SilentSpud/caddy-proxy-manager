"use server";

import { redirect } from "next/navigation";
import { declineMigration, hasAnySignIn, isSetupCompleted } from "@/src/lib/setup";

/**
 * Declining the offer, which is the only half of this screen that is still a server action.
 *
 * Running the import is a route handler instead — see app/api/setup/migrate/route.ts. A server
 * action re-renders the page it was called from, and once the import has changed what
 * `getSetupState` answers this page redirects, which is precisely what the restart step needs not
 * to happen. Declining has no such problem: the redirect it performs is the point.
 */
export async function skipMigration(): Promise<void> {
  if ((await isSetupCompleted()) || (await hasAnySignIn())) {
    throw new Error("Setup has already been completed.");
  }
  await declineMigration();
  redirect("/setup");
}
