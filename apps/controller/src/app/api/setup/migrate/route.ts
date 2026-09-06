import type { NextRequest } from "next/server";
import { importLegacyDatabase } from "@/src/lib/migration/import";
import { scanForLegacyDatabases } from "@/src/lib/migration/legacy-database";
import {
  LegacySecretError,
  probeLegacySecrets,
  verifyLegacyKey,
} from "@/src/lib/migration/legacy-secrets";
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
  // `code` is what lets the browser tell "ask for the old SESSION_SECRET" apart from an error it
  // can only report. Everything else carries the message alone.
  | { ok: false; error: string; code?: "legacy-key-required" | "legacy-key-invalid" };

function json(body: MigrateResponse, status: number): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest): Promise<Response> {
  if ((await isSetupCompleted()) || (await hasAnySignIn())) {
    return json({ ok: false, error: "Setup has already been completed." }, 409);
  }

  let body: { path?: unknown; groups?: unknown; legacyKey?: unknown };
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

  // The old database's secrets, and whether this deployment's SESSION_SECRET reads them.
  //
  // Checked here rather than left to the importer to discover, so a missing or mistyped key is a
  // 400 that names the problem before any row is written. The key itself is used and dropped: what
  // is stored is the re-encrypted ciphertext, under this deployment's own key.
  const legacyKey = typeof body.legacyKey === "string" ? body.legacyKey.trim() : "";
  const probe = probeLegacySecrets(chosen.path);
  if (probe.hasEncryptedValues && !probe.readableWithCurrentKey) {
    if (!legacyKey) {
      return json(
        {
          ok: false,
          code: "legacy-key-required",
          error:
            "This database's secrets — certificate keys, provider credentials, agent secrets — are " +
            "encrypted with the SESSION_SECRET the old installation ran with, which is not the one " +
            "this deployment uses. Enter the old value to bring them across.",
        },
        400,
      );
    }
    if (!verifyLegacyKey(probe, legacyKey)) {
      return json(
        {
          ok: false,
          code: "legacy-key-invalid",
          error:
            "That SESSION_SECRET does not decrypt this database's secrets. Take it from the `.env` " +
            "the old installation ran with, exactly as it appears there.",
        },
        400,
      );
    }
  }

  try {
    await importLegacyDatabase(chosen.path, groups, { legacyKey: legacyKey || null });
    // The old JSON blobs live in the settings table, so there is nothing to lift when settings
    // were left behind — and writing them anyway would pin values the operator declined to bring.
    if (groups.includes("settings")) await carryOverBlobSettings();
    await recordMigrationSource(chosen.path);
  } catch (error) {
    console.error("Migration failed", error);
    // Reachable despite the check above only when a value outside the sampled ones is encrypted
    // under a third key — a database whose secret was rotated more than once. Nothing was written:
    // every row is converted before any is inserted, so this is a refusal, not a partial import.
    if (error instanceof LegacySecretError) {
      return json(
        {
          ok: false,
          code: "legacy-key-invalid",
          error: `${error.message} Nothing was written — the import stops before writing when a value cannot be read.`,
        },
        400,
      );
    }
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
