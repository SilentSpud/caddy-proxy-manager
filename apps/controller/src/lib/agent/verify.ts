/**
 * Proving that a request came from a paired agent.
 *
 * The mirror of what the agent used to do to the controller. Both sides sign the same canonical
 * string with the same symmetric secret, so this is the old `verifyRequest` with the roles swapped
 * - which is the whole security consequence of inverting the dial direction: the party that has to
 * prove itself changed, the primitive did not.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import {
  AGENT_CLOCK_SKEW_MS,
  AGENT_ID_HEADER,
  AGENT_SIGNATURE_HEADER,
  AGENT_TIMESTAMP_HEADER,
  signatureBase,
} from "@cpm/shared";
import { type AgentCredentials, findAgentByAgentId } from "../models/agents";

export type VerifyResult =
  | { ok: true; agent: AgentCredentials }
  | { ok: false; status: number; error: string };

/**
 * Every failure returns the same message and the same status.
 *
 * Telling a caller whether it got the agent id, the timestamp or the signature wrong turns this
 * into a probe for which of those it already has right.
 */
const DENY: VerifyResult = {
  ok: false,
  status: 401,
  error: "The request is not signed by a paired agent.",
};

/** Constant-time comparison that tolerates length differences without leaking them by timing. */
function secureEquals(a: string, b: string): boolean {
  // timingSafeEqual throws on a length mismatch, which would itself be an oracle. Hashing both to
  // a fixed width first makes every comparison the same shape.
  const left = createHmac("sha256", "compare").update(Buffer.from(a, "utf8")).digest();
  const right = createHmac("sha256", "compare").update(Buffer.from(b, "utf8")).digest();
  return timingSafeEqual(left, right);
}

async function sha256Hex(body: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(body);
  return hasher.digest("hex");
}

/**
 * Verify a signed agent request.
 *
 * `body` is the raw text the agent signed - read it once at the route and pass it here, because
 * re-reading a consumed request body would hash the empty string and fail every POST.
 */
export async function verifyAgentRequest(
  request: Request,
  body: string,
  now = Date.now(),
): Promise<VerifyResult> {
  const agentId = request.headers.get(AGENT_ID_HEADER);
  const timestampRaw = request.headers.get(AGENT_TIMESTAMP_HEADER);
  const signature = request.headers.get(AGENT_SIGNATURE_HEADER);
  if (!agentId || !timestampRaw || !signature) return DENY;

  const timestamp = Number.parseInt(timestampRaw, 10);
  if (!Number.isFinite(timestamp)) return DENY;
  // A captured request stops being replayable in a minute rather than a day.
  if (Math.abs(now - timestamp) > AGENT_CLOCK_SKEW_MS) return DENY;

  const agent = await findAgentByAgentId(agentId);
  if (!agent) return DENY;

  const path = new URL(request.url).pathname;
  const expected = createHmac("sha256", agent.secret)
    .update(signatureBase(request.method, path, timestamp, await sha256Hex(body)))
    .digest("hex");

  if (!secureEquals(expected, signature)) return DENY;
  return { ok: true, agent };
}
