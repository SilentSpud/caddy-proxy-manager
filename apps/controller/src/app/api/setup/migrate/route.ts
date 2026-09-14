import type { NextRequest } from "next/server";
import { getTranslations } from "next-intl/server";
import { importLegacyDatabase } from "@/src/lib/migration/import";
import { scanForLegacyDatabases } from "@/src/lib/migration/legacy-database";
import {
  LegacySecretError,
  probeLegacySecrets,
  verifyLegacyKey,
} from "@/src/lib/migration/legacy-secrets";
import { parseMigrationSelection } from "@/src/lib/migration/selection";
import { carryOverBlobSettings } from "@/src/lib/migration/settings-carryover";
import {
  hasAnySignIn,
  isSetupCompleted,
  issueRestartToken,
  recordMigrationSource,
} from "@/src/lib/setup";

/**
 * POST /api/setup/migrate - copy the chosen groups out of a legacy database.
 *
 * A route handler rather than a server action, and that is the whole reason this file exists. A
 * server action re-renders the page it was called from, and this page redirects as soon as the
 * import has changed what `getSetupState` answers - so the operator was thrown to /login the
 * instant the import finished, with no chance to be told the app is about to restart. A fetch
 * leaves the page mounted, which is what lets the restart happen in front of them.
 *
 * Unauthenticated by necessity: nothing can sign in to a deployment that has not been set up. The
 * guard is the same one the account step uses - this reads an arbitrary file off the host into the
 * application database, so it must only work while the database is genuinely empty.
 */

export type MigrateResponse =
  // `restartToken` lets this browser, and only this one, ask /api/setup/restart for the restart.
  | { ok: true; next: string; migratedSignIn: boolean; restartToken: string }
  // `code` is what lets the browser tell "ask for the old SESSION_SECRET" apart from an error it
  // can only report. Everything else carries the message alone.
  | { ok: false; error: string; code?: "legacy-key-required" | "legacy-key-invalid" };

function json(body: MigrateResponse, status: number): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest): Promise<Response> {
  // The setup page shows `error` as it arrives, so every one is said in the reader's language.
  const t = await getTranslations("setup");
  if ((await isSetupCompleted()) || (await hasAnySignIn())) {
    return json({ ok: false, error: t("errors.alreadyCompleted") }, 409);
  }

  let body: { path?: unknown; groups?: unknown; legacyKey?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: t("migrateErrors.expectedJson") }, 400);
  }

  const path = typeof body.path === "string" ? body.path.trim() : "";
  if (!path) return json({ ok: false, error: t("migrateErrors.chooseDatabase") }, 400);

  // Re-derived here rather than trusted: the checkboxes close over each group's dependencies as
  // they are ticked, but this arrives as a list of strings and could have been sent without them.
  // Doing it again is what stops a proxy host being imported apart from the access list that was
  // protecting it.
  const groups = parseMigrationSelection(
    Array.isArray(body.groups) ? body.groups.filter((g): g is string => typeof g === "string") : [],
  );
  if (groups.length === 0) {
    return json({ ok: false, error: t("migrateErrors.chooseGroups") }, 400);
  }

  // Matched against the scan rather than used, and this is the whole guard.
  //
  // The posted value names a file to open on the host, and this endpoint is unauthenticated by
  // necessity - nothing can sign in to a deployment that has not been set up yet. Inspecting the
  // posted path, which is what this did before, proves the file is a database of ours; it does not
  // prove it is one this host offered. Anything else on the filesystem was still reachable: an
  // existence check, a size, an error message naming why a file would not open - and, for a real
  // SQLite file with the right tables, an import of accounts an attacker had written themselves.
  //
  // So the browser chooses among what the scan enumerated, and the path that reaches the importer
  // is the scan's, never the request's. The candidates come from LEGACY_SQLITE_PATH or from
  // reading the known directories, and each was inspected on the way out.
  const chosen = scanForLegacyDatabases().candidates.find((candidate) => candidate.path === path);
  if (!chosen) {
    return json({ ok: false, error: t("migrateErrors.unknownDatabase") }, 400);
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
          error: t("migrateErrors.legacyKeyRequired"),
        },
        400,
      );
    }
    if (!verifyLegacyKey(probe, legacyKey)) {
      return json(
        {
          ok: false,
          code: "legacy-key-invalid",
          error: t("migrateErrors.legacyKeyInvalid"),
        },
        400,
      );
    }
  }

  try {
    await importLegacyDatabase(chosen.path, groups, { legacyKey: legacyKey || null });
    // The old JSON blobs live in the settings table, so there is nothing to lift when settings
    // were left behind - and writing them anyway would pin values the operator declined to bring.
    if (groups.includes("settings")) await carryOverBlobSettings();
    await recordMigrationSource(chosen.path);
  } catch (error) {
    console.error("Migration failed", error);
    // Reachable despite the check above only when a value outside the sampled ones is encrypted
    // under a third key - a database whose secret was rotated more than once. Nothing was written:
    // every row is converted before any is inserted, so this is a refusal, not a partial import.
    if (error instanceof LegacySecretError) {
      const sentence =
        error.reason === "keyMissing"
          ? t("migrateErrors.secretKeyMissing")
          : t("migrateErrors.secretKeyWrong");
      const reason = error.table
        ? t("migrateErrors.secretUnreadableInTable", { reason: sentence, table: error.table })
        : sentence;
      return json(
        {
          ok: false,
          code: "legacy-key-invalid",
          error: t("migrateErrors.nothingWritten", { reason }),
        },
        400,
      );
    }
    return json({ ok: false, error: t("migrateErrors.failedPartway") }, 500);
  }

  // Where to go next is asked of the database rather than of the checkboxes: migrating an enabled
  // OAuth provider is a way in even without the old accounts, and a users group that turned out to
  // be empty is not one. A deployment that now has neither still needs its first administrator.
  const migratedSignIn = await hasAnySignIn();
  const restartToken = await issueRestartToken();
  return json(
    { ok: true, next: migratedSignIn ? "/login" : "/setup", migratedSignIn, restartToken },
    200,
  );
}
