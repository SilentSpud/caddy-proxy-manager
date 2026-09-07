/**
 * POST /api/agent/v1/status — what an agent currently has applied.
 *
 * Posted on change and on a slow heartbeat. The controller renders "last seen" from these, so an
 * agent that changed nothing for an hour is still distinguishable from one whose host caught fire.
 *
 * The status is kept beside the live connection rather than in a row: it describes a process that
 * is attached right now, and a stored copy would outlive the stream it came from.
 */

import type { AgentStatusRequest } from "@cpm/shared";
import { verifyAgentRequest } from "@/src/lib/agent/verify";
import { isConnected, recordStatus } from "@/src/lib/agent/registry";
import { recordAgentContact } from "@/src/lib/models/agents";

/** A status is one small object. Well clear of the real thing, and still bounded. */
const MAX_BODY_BYTES = 64 * 1024;

export async function POST(request: Request) {
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return Response.json({ error: "That status is too large." }, { status: 413 });
  }

  const verified = await verifyAgentRequest(request, raw);
  if (!verified.ok) {
    return Response.json({ error: verified.error }, { status: verified.status });
  }

  let parsed: AgentStatusRequest;
  try {
    parsed = JSON.parse(raw) as AgentStatusRequest;
  } catch {
    return Response.json({ error: "The request is not valid JSON." }, { status: 400 });
  }
  if (!parsed?.status || typeof parsed.status !== "object") {
    return Response.json({ error: "A status is required." }, { status: 400 });
  }

  // 409 rather than accepting it: a status from an agent with no open stream describes a host the
  // controller cannot act on, and storing it would make the UI claim a reachability it lacks.
  if (!isConnected(verified.agent.agentId)) {
    return Response.json({ error: "Open the event stream first." }, { status: 409 });
  }

  recordStatus(verified.agent.agentId, parsed.status);
  await recordAgentContact(verified.agent.id, { ok: true });
  return Response.json({ ok: true });
}
