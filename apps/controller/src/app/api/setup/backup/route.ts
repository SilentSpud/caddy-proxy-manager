import { existsSync } from "node:fs";
import { basename } from "node:path";
import type { NextRequest } from "next/server";
import { auth } from "@/src/lib/auth";
import { getMigrationSource } from "@/src/lib/setup";

/**
 * GET /api/setup/backup — the SQLite file this deployment migrated from.
 *
 * The path is read from the database, never from the request: this streams a file off the host's
 * filesystem, and taking the path from a query parameter would make it an arbitrary file read.
 * Admin-only, and only for a deployment that actually recorded a migration.
 */
export async function GET(request: NextRequest) {
  const session = await auth(request);
  if (session?.user?.role !== "admin") {
    return new Response("Not found", { status: 404 });
  }

  const path = await getMigrationSource();
  if (!path || !existsSync(path)) {
    return new Response("No migrated database is available to download.", { status: 404 });
  }

  // Bun.file streams lazily and gives Response a real web stream; node:stream's toWeb produces a
  // type Response does not accept.
  return new Response(Bun.file(path), {
    headers: {
      "Content-Type": "application/vnd.sqlite3",
      "Content-Disposition": `attachment; filename="${basename(path)}"`,
      // The file is a database dump; nothing should hold a copy on the way through.
      "Cache-Control": "no-store",
    },
  });
}
