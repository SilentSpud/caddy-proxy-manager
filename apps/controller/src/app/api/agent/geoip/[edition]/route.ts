/**
 * GET /api/agent/geoip/:edition — a MaxMind database, for a paired agent.
 *
 * The controller holds the subscription and the files; an agent reaches them through here rather
 * than each host needing a licence key of its own. An agent sharing the controller's volume has the
 * files mounted already and never asks.
 *
 * Authenticated by the agent signing with its pairing secret, which is symmetric. An unsigned or
 * unrecognised caller gets 404, not 401: nothing should be able to learn that this route exists,
 * or which agent ids are real, without already holding a secret.
 */

import { existsSync, statSync } from "node:fs";
import { GEOIP_EDITIONS, type GeoipEdition } from "@cpm/shared";
import type { NextRequest } from "next/server";
import { verifyAgentRequest } from "@/src/lib/agent/verify";
import { geoipDatabasePath, geoipEtag } from "@/src/lib/agent/geoip";

const notFound = () => new Response("Not found", { status: 404 });

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ edition: string }> },
) {
  const { edition } = await params;
  // Checked before authentication so an unknown edition cannot be used to probe which agent ids
  // verify: every failure below this point looks identical from outside.
  if (!(GEOIP_EDITIONS as readonly string[]).includes(edition)) return notFound();

  // GET, so the signed body is the empty string — the same value the agent hashed.
  const verified = await verifyAgentRequest(request, "");
  const agent = verified.ok ? verified.agent : null;
  if (!agent) return notFound();

  const path = geoipDatabasePath(edition as GeoipEdition);
  if (!existsSync(path)) return notFound();

  const etag = geoipEtag(path);
  // The single-host case shares this volume, and a remote agent re-checks daily; without this
  // every check would move tens of megabytes to discover nothing had changed.
  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag } });
  }

  return new Response(Bun.file(path), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(statSync(path).size),
      ETag: etag,
      "Cache-Control": "no-store",
    },
  });
}
