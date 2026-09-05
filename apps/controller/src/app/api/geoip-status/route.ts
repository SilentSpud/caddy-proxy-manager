import { existsSync } from "node:fs";
import { type NextRequest, NextResponse } from "next/server";
import { requireApiAdmin, apiErrorResponse } from "@/src/lib/api-auth";
import { geoipDatabasePath, geoipEnabled } from "@/src/lib/agent/geoip";

export async function GET(request: NextRequest) {
  try {
    await requireApiAdmin(request);
    // A database present on a deployment with GeoIP switched off is reported as absent: the geo
    // block fields read this to decide whether to offer country matching at all, and offering it
    // from a stale file would build a Caddy config the feature is meant to stop emitting.
    const enabled = await geoipEnabled();
    return NextResponse.json({
      // Reported separately from the two files, so the UI can tell "switched off" from "switched
      // on but the download has not landed" — the fix is a different one in each case.
      enabled,
      country: enabled && existsSync(geoipDatabasePath("GeoLite2-Country")),
      asn: enabled && existsSync(geoipDatabasePath("GeoLite2-ASN")),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
