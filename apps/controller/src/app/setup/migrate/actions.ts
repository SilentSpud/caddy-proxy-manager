"use server";

import { redirect } from "next/navigation";
import { importLegacyDatabase } from "@/src/lib/migration/import";
import { inspectLegacyDatabase } from "@/src/lib/migration/legacy-database";
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
    await importLegacyDatabase(inspected.path);
    await carryOverBlobSettings();
    await recordMigrationSource(inspected.path);
  } catch (error) {
    console.error("Migration failed", error);
    return {
      error:
        "The migration failed partway through. The database may be partly populated — empty it " +
        "before trying again, so a retry does not merge two attempts.",
    };
  }

  // The migrated accounts are the point: proving one of them still signs in comes next.
  redirect("/login");
}

export async function skipMigration(): Promise<void> {
  await assertMigrationOpen();
  await declineMigration();
  redirect("/setup");
}
