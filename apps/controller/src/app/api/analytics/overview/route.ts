import { type NextRequest, NextResponse } from "next/server";
import { requireApiAdmin, apiErrorResponse } from "@/src/lib/api-auth";
import {
  getOverviewAnalytics,
  type TrafficEventFilter,
  resolveAnalyticsRange,
} from "@/src/lib/analytics-db";

const FILTERS: TrafficEventFilter[] = ["all", "server-errors", "client-errors", "largest"];
const DEFAULT_LIMIT = 40;
const DEFAULT_INTERVAL = "24h";

export async function GET(req: NextRequest) {
  try {
    await requireApiAdmin(req);
    const { searchParams } = req.nextUrl;
    const hostsParam = searchParams.get("hosts") ?? "";
    const hosts = hostsParam ? hostsParam.split(",").filter(Boolean) : [];

    // An unknown filter falls back to "all" rather than erroring. The caller is the
    // overview's own tile row, and a stale client asking for a filter this build has
    // dropped should still get a log rather than a broken pane.
    const requested = searchParams.get("filter") ?? "all";
    const filter = FILTERS.includes(requested as TrafficEventFilter)
      ? (requested as TrafficEventFilter)
      : "all";

    const limitParam = parseInt(searchParams.get("limit") ?? "", 10);
    const limit = Number.isFinite(limitParam) ? limitParam : DEFAULT_LIMIT;

    const { from, to } = resolveAnalyticsRange(searchParams, DEFAULT_INTERVAL);
    const data = await getOverviewAnalytics(from, to, hosts, filter, limit);
    return NextResponse.json(data);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
