import type { NextRequest } from "next/server";
import { auth } from "@/src/lib/auth";
import { dashboardHostAnswers } from "@/src/lib/dashboard-host";
import { getDashboardSettings } from "@/src/lib/settings";

/**
 * GET /api/setup/dashboard-reachable - whether the dashboard host is answering yet.
 *
 * Asked by the restart dialog, once, to decide whether to hand the operator over to the domain
 * setup just claimed or leave them on the address they are already using. It is a question only
 * the server can answer: the browser cannot read a cross-origin response, and an opaque one cannot
 * tell this instance from whatever else holds the name.
 *
 * Admin-gated, because it makes this deployment fetch a URL - the same reason the Settings page's
 * check is. The domain is the stored one, which has been through the settings validator; nothing
 * the caller sends reaches the request.
 */
export async function GET(request: NextRequest): Promise<Response> {
  if ((await auth(request))?.user.role !== "admin") {
    return Response.json({ ok: false }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }

  const ok = await dashboardHostAnswers(await getDashboardSettings());
  return Response.json({ ok }, { headers: { "Cache-Control": "no-store" } });
}
