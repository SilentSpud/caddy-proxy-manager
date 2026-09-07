import { type NextRequest, NextResponse } from "next/server";
import { requireApiAdmin, apiErrorResponse } from "@/src/lib/api-auth";
import { applyCaddyBuild, getCaddyBuildDiff, getCaddyBuildStatus } from "@/src/lib/caddy-build";

/**
 * GET /api/caddy-build — the module diff plus the agent's rebuild status. Polled by the settings
 * panel: compiling Caddy takes minutes, too long for a server action to hold open.
 */
export async function GET(request: NextRequest) {
  try {
    await requireApiAdmin(request);
    // `?agent=<row id>` narrows both to one agent, which is what the settings panel polls with
    // once an agent is being edited separately. Absent is the fleet-wide answer.
    const agentRowId = parseAgentRowId(request.nextUrl.searchParams.get("agent"));
    const [diff, status] = await Promise.all([
      getCaddyBuildDiff(agentRowId),
      getCaddyBuildStatus(agentRowId),
    ]);
    return NextResponse.json({ diff, status });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

function parseAgentRowId(raw: string | null): number | undefined {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/** POST /api/caddy-build — write the build override and trigger the agent. */
export async function POST(request: NextRequest) {
  try {
    await requireApiAdmin(request);
    const status = await applyCaddyBuild(
      parseAgentRowId(request.nextUrl.searchParams.get("agent")),
    );
    return NextResponse.json({ status });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
