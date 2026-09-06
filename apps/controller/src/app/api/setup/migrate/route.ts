import type { NextRequest } from "next/server";
import { importLegacyDatabase } from "@/src/lib/migration/import";
import { scanForLegacyDatabases } from "@/src/lib/migration/legacy-database";
import { parseMigrationSelection } from "@/src/lib/migration/selection";
import { carryOverBlobSettings } from "@/src/lib/migration/settings-carryover";
import { hasAnySignIn, isSetupCompleted, recordMigrationSource } from "@/src/lib/setup";

/**
 * POST /api/setup/migrate — copy the chosen groups out of a legacy database.
 *
 * A route handler rather than a server action, and that is the whole reason this file exists. A
 * server action re-renders the page it was called from, and this page redirects as soon as the
 * import has changed what `getSetupState` answers — so the operator was thrown to /login the
 * instant the import finished, with no chance to be told the app is about to restart. A fetch
 * leaves the page mounted, which is what lets the restart happen in front of them.
 *
 * Unauthenticated by necessity: nothing can sign in to a deployment that has not been set up. The
 * guard is the same one the account step uses — this reads an arbitrary file off the host into the
 * application database, so it must only work while the database is genuinely empty.
 */

export type MigrateResponse =
  | { ok: true; next: string; migratedSignIn: boolean }
  | { ok: false; error: string };

function json(body: MigrateResponse, status: number): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest): Promise<Response> {
  if ((await isSetupCompleted()) || (await hasAnySignIn())) {
    return json({ ok: false, error: "Setup has already been completed." }, 409);
  }

  let body: { path?: unknown; groups?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Expected a JSON body." }, 400);
  }

  const path = typeof body.path === "string" ? body.path.trim() : "";
  if (!path) return json({ ok: false, error: "Choose a database to migrate." }, 400);

  // Re-derived here rather than trusted: the checkboxes close over each group's dependencies as
  // they are ticked, but this arrives as a list of strings and could have been sent without them.
  // Doing it again is what stops a proxy host being imported apart from the access list that was
  // protecting it.
  const groups = parseMigrationSelection(
    Array.isArray(body.groups) ? body.groups.filter((g): g is string => typeof g === "string") : [],
  );
  if (groups.length === 0) {
    return json(
      { ok: false, error: "Choose at least one thing to migrate, or start fresh instead." },
      400,
    );
  }

  // Matched against the scan rather than used, and this is the whole guard.
  //
  // The posted value names a file to open on the host, and this endpoint is unauthenticated by
  // necessity — nothing can sign in to a deployment that has not been set up yet. Inspecting the
  // posted path, which is what this did before, proves the file is a database of ours; it does not
  // prove it is one this host offered. Anything else on the filesystem was still reachable: an
  // existence check, a size, an error message naming why a file would not open — and, for a real
  // SQLite file with the right tables, an import of accounts an attacker had written themselves.
  //
  // So the browser chooses among what the scan enumerated, and the path that reaches the importer
  // is the scan's, never the request's. The candidates come from LEGACY_SQLITE_PATH or from
  // reading the known directories, and each was inspected on the way out.
  const chosen = scanForLegacyDatabases().candidates.find((candidate) => candidate.path === path);
  if (!chosen) {
    return json(
      {
        ok: false,
        error:
          "That is not one of the databases found on this host. Reload the page and choose one of " +
          "the files it offers.",
      },
      400,
    );
  }

  try {
    await importLegacyDatabase(chosen.path, groups);
    // The old JSON blobs live in the settings table, so there is nothing to lift when settings
    // were left behind — and writing them anyway would pin values the operator declined to bring.
    if (groups.includes("settings")) await carryOverBlobSettings();
    await recordMigrationSource(chosen.path);
  } catch (error) {
    console.error("Migration failed", error);
    return json(
      {
        ok: false,
        error:
          "The migration failed partway through. The database may be partly populated — empty it " +
          "before trying again, so a retry does not merge two attempts.",
      },
      500,
    );
  }

  // Where to go next is asked of the database rather than of the checkboxes: migrating an enabled
  // OAuth provider is a way in even without the old accounts, and a users group that turned out to
  // be empty is not one. A deployment that now has neither still needs its first administrator.
  const migratedSignIn = await hasAnySignIn();
  return json({ ok: true, next: migratedSignIn ? "/login" : "/setup", migratedSignIn }, 200);
}
