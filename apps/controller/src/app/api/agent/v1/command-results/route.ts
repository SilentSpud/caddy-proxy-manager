/**
 * POST /api/agent/v1/command-results — answers to commands the stream issued.
 *
 * Its own route rather than a frame back up the stream, because SSE only runs one way. That is the
 * trade that keeps this whole surface inside ordinary route handlers, and the reason a command
 * carries a correlation id at all.
 */

import type { AgentCommandResultsRequest } from "@cpm/shared";
import { verifyAgentRequest } from "@/src/lib/agent/verify";
import { settleResults } from "@/src/lib/agent/registry";
import { MAX_CADDY_CONFIG_BYTES } from "@cpm/shared";

export async function POST(request: Request) {
  // A result carries whatever Caddy answered, which for a config read is the whole document.
  const raw = await request.text();
  if (raw.length > MAX_CADDY_CONFIG_BYTES) {
    return Response.json({ error: "That result is too large." }, { status: 413 });
  }

  const verified = await verifyAgentRequest(request, raw);
  if (!verified.ok) {
    return Response.json({ error: verified.error }, { status: verified.status });
  }

  let parsed: AgentCommandResultsRequest;
  try {
    parsed = JSON.parse(raw) as AgentCommandResultsRequest;
  } catch {
    return Response.json({ error: "The request is not valid JSON." }, { status: 400 });
  }
  if (!Array.isArray(parsed?.results)) {
    return Response.json({ error: "Results must be an array." }, { status: 400 });
  }

  settleResults(verified.agent.agentId, parsed.results);
  return Response.json({ ok: true });
}
