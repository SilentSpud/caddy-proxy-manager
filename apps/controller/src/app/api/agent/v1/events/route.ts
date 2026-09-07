/**
 * GET /api/agent/v1/events — the controller's half of the conversation.
 *
 * An agent opens this and holds it open for as long as it runs. Everything the controller needs to
 * push travels down it: desired state whenever it changes, and the Caddy admin calls the controller
 * blocks on. Nothing else can reach an agent — the controller does not dial out — so a closed
 * stream and an unreachable host are the same condition.
 *
 * The response never ends on the controller's side. It is torn down when the agent disconnects,
 * which arrives here as the stream's `cancel`.
 */

import { verifyAgentRequest } from "@/src/lib/agent/verify";
import { attach } from "@/src/lib/agent/registry";
import { buildDesiredState } from "@/src/lib/agent/desired-state";
import { getControllerId } from "@/src/lib/models/agents";
import { getSetting } from "@/src/lib/settings";

export async function GET(request: Request) {
  // GET, so the signed body is the empty string — the same value the agent hashed.
  const verified = await verifyAgentRequest(request, "");
  if (!verified.ok) {
    return Response.json({ error: verified.error }, { status: verified.status });
  }

  const controllerName =
    (await getSetting<string>("branding_title").catch(() => null)) || "Caddy Proxy Manager";

  const { stream } = attach({
    agentId: verified.agent.agentId,
    agentRowId: verified.agent.id,
    name: verified.agent.name,
    controllerId: await getControllerId(),
    controllerName,
    // Built for this agent: the ports its own hosts need, and its own module selection.
    initialState: await buildDesiredState(verified.agent.id),
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      // Nginx buffers proxied responses by default, which turns an event stream into one very late
      // download. Harmless anywhere else, and the deployments that need it cannot be detected here.
      "x-accel-buffering": "no",
    },
  });
}
