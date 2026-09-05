"use server";

import { redirect } from "next/navigation";
import { importLegacyDatabase } from "@/src/lib/migration/import";
import { inspectLegacyDatabase } from "@/src/lib/migration/legacy-database";
import { parseMigrationSelection } from "@/src/lib/migration/selection";
import { carryOverBlobSettings } from "@/src/lib/migration/settings-carryover";
import {
  declineMigration,
  hasAnySignIn,
  isSetupCompleted,
  recordMigrationSource,
} from "@/src/lib/setup";

export type MigrateActionState = { error: string | null };

/**
 * Refuse once anything can sign in.
 *
 * The same guard the account step uses, and for the same reason: this endpoint copies an arbitrary
 * file on the host into the application database, so it must only be reachable while the database
 * is genuinely empty.
 */
async function assertMigrationOpen(): Promise<void> {
  if ((await isSetupCompleted()) || (await hasAnySignIn())) {
    throw new Error("Setup has already been completed.");
  }
}

export async function runMigration(
  _previous: MigrateActionState,
  formData: FormData,
): Promise<MigrateActionState> {
  const path = String(formData.get("path") ?? "").trim();
  if (!path) return { error: "Choose a database to migrate." };

  // Re-derived here rather than trusting what the form posted: the checkboxes close over each
  // group's dependencies as they are ticked, but the request is a list of strings and could have
  // arrived without them. Doing it again is what stops a proxy host being imported apart from the
  // access list that was protecting it.
  const groups = parseMigrationSelection(formData.getAll("groups").map(String));
  if (groups.length === 0) {
    return { error: "Choose at least one thing to migrate, or start fresh instead." };
  }

  try {
    await assertMigrationOpen();
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Setup is no longer open." };
  }

  // Re-inspected here rather than trusting the path the form posted: the value reaches this action
  // from the browser, and it selects a file to read off the host's filesystem.
  const inspected = inspectLegacyDatabase(path);
  if ("reason" in inspected) {
    return { error: `That database cannot be migrated: ${inspected.reason}` };
  }

  try {
    await importLegacyDatabase(inspected.path, groups);
    // The old JSON blobs live in the settings table, so there is nothing to lift when settings
    // were left behind — and writing them anyway would pin values the operator declined to bring.
    if (groups.includes("settings")) await carryOverBlobSettings();
    await recordMigrationSource(inspected.path);
  } catch (error) {
    console.error("Migration failed", error);
    return {
      error:
        "The migration failed partway through. The database may be partly populated — empty it " +
        "before trying again, so a retry does not merge two attempts.",
    };
  }

  // Where to go next is asked of the database rather than of the checkboxes: migrating an enabled
  // OAuth provider is a way in even without the old accounts, and a users group that turned out to
  // be empty is not one. A deployment that now has neither still needs its first administrator.
  redirect((await hasAnySignIn()) ? "/login" : "/setup");
}

export async function skipMigration(): Promise<void> {
  await assertMigrationOpen();
  await declineMigration();
  redirect("/setup");
}
