/**
 * POST /api/agent/v1/pair/preview - who a pairing code would pair with, without spending it.
 *
 * `cpm-agent --pair` asks this first and shows the answer, so the operator confirms the controller
 * by name before the code is used. Without it, an address with a typo that happens to reach some
 * other controller is only discovered after the pairing has happened there.
 *
 * Unauthenticated for the same reason the pair route is, and held to the same rules: the code must
 * be right - a controller's name is not handed to anyone who asks - and a wrong one counts against
 * the caller's throttle and the code's own budget exactly as a wrong pairing attempt does.
 * Bootstrap tokens are not previewed: they pair the agent in the controller's own stack, with no
 * operator at a terminal to ask.
 */

import type { AgentPairPreviewRequest, AgentPairPreviewResponse } from "@cpm/shared";
import {
  checkPairingCode,
  checkRepairCode,
  clientThrottled,
  recordFailedGuess,
} from "@/src/lib/agent/pairing-codes";
import { looksLikeBootstrapToken } from "@/src/lib/agent/bootstrap";
import { findAgentRowByAgentId, getControllerId } from "@/src/lib/models/agents";
import { getClientIp } from "@/src/lib/client-ip";
import { isDemoMode } from "@/src/lib/demo-mode";
import { controllerDisplayName } from "@/src/lib/agent/controller-name";

/** A preview body is two short fields; anything larger is not one. */
const MAX_BODY_BYTES = 4 * 1024;

const bad = (error: string, status = 400) => Response.json({ error }, { status });

export async function POST(request: Request) {
  if (isDemoMode()) return bad("This controller is in demo mode and does not pair agents.", 403);

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return bad("That request is too large to be a pairing.", 413);

  let parsed: AgentPairPreviewRequest;
  try {
    parsed = JSON.parse(raw) as AgentPairPreviewRequest;
  } catch {
    return bad("The request is not valid JSON.");
  }

  const agentId = typeof parsed?.agentId === "string" ? parsed.agentId.trim() : "";
  const code = typeof parsed?.code === "string" ? parsed.code : "";
  if (!/^[0-9a-f]{8,64}$/.test(agentId)) return bad("The agent id is not valid.");
  if (code.length === 0) return bad("A pairing code is required.");
  if (looksLikeBootstrapToken(code)) return bad("Bootstrap tokens are not previewed.");

  const existing = await findAgentRowByAgentId(agentId);

  const client = (await getClientIp(request.headers)) ?? "unknown";
  if (clientThrottled(client)) {
    return bad("Too many wrong pairing codes from this address. Try again in a minute.", 429);
  }
  const checked = existing ? checkRepairCode(agentId, code) : checkPairingCode(code);
  if (!checked.ok) {
    recordFailedGuess(client);
    return bad(checked.error, 401);
  }
  // Only after the code is right: refused before it, a wrong-code caller could tell an agent id
  // that is disabled here from one that is not. The pair route refuses earlier, because there the
  // point is not to spend a code on an agent that cannot come back - a preview spends nothing.
  if (existing && !existing.enabled) return bad("This agent is disabled on the controller.", 403);

  const [controllerName, controllerId] = await Promise.all([
    controllerDisplayName(),
    getControllerId(),
  ]);

  return Response.json({
    controllerId,
    controllerName,
    repair: existing !== null,
  } satisfies AgentPairPreviewResponse);
}
