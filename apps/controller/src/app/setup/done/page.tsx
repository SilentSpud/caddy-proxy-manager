import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { auth } from "@/src/lib/auth";
import { trimMigratedEnv } from "@/src/lib/migration/env-file";
import { SETTING_DEFINITIONS } from "@/src/lib/settings/registry";
import { resolveAllSettings } from "@/src/lib/settings/resolve";
import { getMigrationSource, isSetupCompleted } from "@/src/lib/setup";
import SetupDoneClient from "./SetupDoneClient";

export const metadata: Metadata = {
  title: { absolute: "Migration complete" },
};

/**
 * The summary a migrated deployment sees once setup finishes: its old database to keep, and the
 * `.env` it can replace.
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

  // The container is usually handed its environment by Compose rather than a file, so an absent
  // .env is the normal case, not an error. Fall back to naming the variables instead.
  let trimmed: string | null = null;
  let removed: string[] = [];
  try {
    const original = readFileSync(resolve(process.cwd(), ".env"), "utf8");
    const result = trimMigratedEnv(original);
    trimmed = result.contents;
    removed = result.removed;
  } catch {
    const stored = await resolveAllSettings();
    removed = SETTING_DEFINITIONS.filter(
      (definition) => stored.get(definition.key)?.source === "stored",
    ).map((definition) => definition.env);
  }

  return <SetupDoneClient source={source} trimmedEnv={trimmed} removed={removed} />;
}
