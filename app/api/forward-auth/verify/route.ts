import { type NextRequest, NextResponse } from "next/server";
import { validateForwardAuthSession, checkHostAccessByDomain } from "@/src/lib/models/forward-auth";
import { getUserById } from "@/src/lib/models/user";
import { getGroupsForUser } from "@/src/lib/models/groups";
import { lastHeaderValue } from "@/src/lib/request-headers";

const COOKIE_NAME = "_cpm_fa";

/**
 * Forward auth verify endpoint — called by Caddy as a subrequest.
 * Returns 200 + user headers on success, 401 on failure.
 */
export async function GET(request: NextRequest) {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) {
    return new NextResponse(null, { status: 401 });
  }

  const session = await validateForwardAuthSession(token);
  if (!session) {
    return new NextResponse(null, { status: 401 });
  }

  const user = await getUserById(session.userId);
  if (user?.status !== "active") {
    return new NextResponse(null, { status: 401 });
  }

  // Check host access using X-Forwarded-Host header set by Caddy. Duplicate
  // headers arrive comma-combined (see request-headers.ts), so take Caddy's value
  // rather than a joined "client-supplied, caddy" string that matches no host.
  const forwardedHost =
    lastHeaderValue(request.headers.get("x-forwarded-host")) ||
    lastHeaderValue(request.headers.get("host"));
  if (!forwardedHost) {
    return new NextResponse(null, { status: 401 });
  }

  const { hasAccess } = await checkHostAccessByDomain(session.userId, forwardedHost);
  if (!hasAccess) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  // Get user's groups for the header
  const userGroups = await getGroupsForUser(session.userId);
  const groupNames = userGroups.map((g) => g.name).join(",");

  // Return 200 with user info headers that Caddy will copy to upstream
  return new NextResponse(null, {
    status: 200,
    headers: {
      "X-CPM-User": user.name ?? user.email.split("@")[0],
      "X-CPM-Email": user.email,
      "X-CPM-Groups": groupNames,
      "X-CPM-User-Id": String(user.id),
    },
  });
}
