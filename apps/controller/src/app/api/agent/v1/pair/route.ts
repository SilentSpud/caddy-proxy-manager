/**
 * POST /api/agent/v1/pair - exchange a one-time credential for a shared secret.
 *
 * The only unauthenticated route an agent calls, because there is nothing to authenticate with
 * yet: the code stands in for the secret, which is why it is six letters, lives five minutes, and
 * is burned on use.
 *
 * An agentId this controller already knows is never re-paired with a credential anyone could hold.
 * Replacing its secret takes a code or token an operator minted for that agent, because the old
 * secret dying is what stops that agent's Caddy - and a disabled agent is refused outright.
 *
 * Unlike the GeoIP route this answers 400/401 rather than 404. Hiding it would buy nothing - an
 * operator has to be told the difference between "wrong code" and "wrong address" - and guessing is
 * bounded per client address and per code.
 */

import { randomBytes } from "node:crypto";
import type { AgentPairRequest, AgentPairResponse } from "@cpm/shared";
import {
  clientThrottled,
  recordFailedGuess,
  redeemPairingCode,
  redeemRepairCode,
} from "@/src/lib/agent/pairing-codes";
import {
  ensureBootstrapToken,
  looksLikeBootstrapToken,
  recordBundledAgent,
  redeemBootstrapToken,
} from "@/src/lib/agent/bootstrap";
import {
  findAgentRowByAgentId,
  getControllerId,
  insertPairedAgent,
  replaceAgentSecret,
} from "@/src/lib/models/agents";
import { getClientIp } from "@/src/lib/client-ip";
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

  const existing = await findAgentRowByAgentId(agentId);
  // Before any credential is spent: pairing must never be how a disabled agent comes back.
  if (existing && !existing.enabled) return bad("This agent is disabled on the controller.", 403);

  // Two ways in, and the shape says which. A bootstrap token is proof the caller can read this
  // controller's data volume. It is not throttled: 64 hex characters are not guessable, and the
  // bundled agent retries a stale one every few seconds.
  const bootstrap = looksLikeBootstrapToken(code);
  if (bootstrap) {
    if (!redeemBootstrapToken(code, agentId, existing !== null)) {
      // Startup is the only other writer, so an agent that arrives after the token expired would
      // otherwise wait for a file nothing writes. A fresh one appears only while the bundled agent
      // still wants pairing, and the agent's watcher picks it up on its next poll.
      await ensureBootstrapToken();
      return bad("That bootstrap token is not valid.", 401);
    }
  } else {
    // Each code also has a budget of its own, for when no trusted address is known.
    const client = (await getClientIp(request.headers)) ?? "unknown";
    if (clientThrottled(client)) {
      return bad("Too many wrong pairing codes from this address. Try again in a minute.", 429);
    }
    const redeemed = existing ? redeemRepairCode(agentId, code) : redeemPairingCode(code);
    if (!redeemed.ok) {
      recordFailedGuess(client);
      return bad(redeemed.error, 401);
    }
  }

  const secret = randomBytes(32).toString("hex");
  if (existing) {
    await replaceAgentSecret({ agentId, secret });
  } else {
    // Named for the operator's benefit only; routing is by agentId. Bounded because it is rendered.
    const name =
      typeof parsed.agentName === "string" && parsed.agentName.trim().length > 0
        ? parsed.agentName.trim().slice(0, 128)
        : `Agent ${agentId.slice(0, 8)}`;
    if (!(await insertPairedAgent({ name, agentId, secret }))) {
      return bad("Another pairing for this agent landed first.", 409);
    }
  }
  if (bootstrap) await recordBundledAgent(agentId);

  const [brandingTitle, controllerId] = await Promise.all([
    getSetting<string>("branding_title").catch(() => null),
    getControllerId(),
  ]);

  return Response.json({
    secret,
    controllerId,
    controllerName: brandingTitle || "Caddy Proxy Manager",
  } satisfies AgentPairResponse);
}
