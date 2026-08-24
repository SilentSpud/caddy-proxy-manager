import { type NextRequest, NextResponse } from "next/server";
import { requireApiAdmin, apiErrorResponse } from "@/src/lib/api-auth";
import { applyCaddyBuild, getCaddyBuildDiff, getCaddyBuildStatus } from "@/src/lib/caddy-build";

/**
 * GET /api/caddy-build — the module diff plus the sidecar's rebuild status.
 *
 * Polled by the Caddy Build settings panel while a rebuild is in flight.
 * Compiling Caddy from source takes minutes, which is far too long for a server
 * action to hold open, so the trigger and the progress are separate calls.
 */
export async function GET(request: NextRequest) {
  try {
    await requireApiAdmin(request);
    const [diff, status] = await Promise.all([
      getCaddyBuildDiff(),
      Promise.resolve(getCaddyBuildStatus()),
    ]);
    return NextResponse.json({ diff, status });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/** POST /api/caddy-build — write the build override and trigger the sidecar. */
export async function POST(request: NextRequest) {
  try {
    await requireApiAdmin(request);
    const status = await applyCaddyBuild();
    return NextResponse.json({ status });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
