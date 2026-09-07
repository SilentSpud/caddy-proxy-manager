/**
 * POST /api/agent/v1/pair — exchange a one-time code for a shared secret.
 *
 * The only unauthenticated route an agent calls, because there is nothing to authenticate with
 * yet: the code stands in for the secret, which is why it is six letters, lives five minutes, and
 * is burned on use.
 *
 * Unlike the GeoIP route this answers 400/401 rather than 404. Hiding it would buy nothing — an
 * operator has to be told the difference between "wrong code" and "wrong address", and the code's
 * own rate limiting is what bounds guessing.
 */

import { randomBytes } from "node:crypto";
import type { AgentPairRequest, AgentPairResponse } from "@cpm/shared";
import { redeemPairingCode } from "@/src/lib/agent/pairing-codes";
import { looksLikeBootstrapToken, redeemBootstrapToken } from "@/src/lib/agent/bootstrap";
import { getControllerId, saveAgent } from "@/src/lib/models/agents";
import { getSetting } from "@/src/lib/settings";

/** A pairing body is four short fields; anything larger is not one. */
const MAX_BODY_BYTES = 4 * 1024;

const bad = (error: string, status = 400) => Response.json({ error }, { status });

export async function POST(request: Request) {
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return bad("That request is too large to be a pairing.", 413);

  let parsed: AgentPairRequest;
  try {
    parsed = JSON.parse(raw) as AgentPairRequest;
  } catch {
    return bad("The request is not valid JSON.");
  }

  const agentId = typeof parsed?.agentId === "string" ? parsed.agentId.trim() : "";
  const code = typeof parsed?.code === "string" ? parsed.code : "";
  if (!/^[0-9a-f]{8,64}$/.test(agentId)) return bad("The agent id is not valid.");
  if (code.length === 0) return bad("A pairing code is required.");

  // Two ways in, and the shape says which. A bootstrap token is proof the caller can read this
  // controller's data volume, which is a stronger claim than a six-letter code an operator carried
  // across the room — so it is checked the same way and burned just as hard.
  if (looksLikeBootstrapToken(code)) {
    if (!redeemBootstrapToken(code)) return bad("That bootstrap token is not valid.", 401);
  } else {
    const redeemed = redeemPairingCode(code);
    if (!redeemed.ok) return bad(redeemed.error, 401);
  }

  // Named for the operator's benefit only; routing is by agentId. Bounded because it is rendered.
  const name =
    typeof parsed.agentName === "string" && parsed.agentName.trim().length > 0
      ? parsed.agentName.trim().slice(0, 128)
      : `Agent ${agentId.slice(0, 8)}`;

  const secret = randomBytes(32).toString("hex");
  await saveAgent({ name, agentId, secret });

  const controllerName =
    (await getSetting<string>("branding_title").catch(() => null)) || "Caddy Proxy Manager";

  return Response.json({
    secret,
    controllerId: await getControllerId(),
    controllerName,
  } satisfies AgentPairResponse);
}
