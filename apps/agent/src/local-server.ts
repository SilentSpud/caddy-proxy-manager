/**
 * The agent's only listener, and it faces the host rather than the network.
 *
 * `cpm-agent --pair` is a second process: the one already running holds the socket, the database
 * and the Docker connection, so pairing has to be handed to it rather than done alongside it. This
 * is that hand-off, plus the healthcheck the container runs against itself.
 *
 * Unauthenticated on purpose. It binds a Unix socket inside the data volume, so reaching it already
 * means being inside the container or mounting its volume — the same boundary the shared secret
 * used to sit behind, and one no in-band credential would tighten.
 */

import {
  AGENT_LOCAL_ROUTES,
  type AgentLocalPairRequest,
  type AgentLocalPairResponse,
} from "@cpm/shared";
import type { AgentLifecycle } from "./lifecycle";
import { AGENT_VERSION } from "./status";

/** A pairing body is three short fields; anything larger is not one. */
const MAX_BODY_BYTES = 4 * 1024;

export function createLocalHandler(lifecycle: AgentLifecycle) {
  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === AGENT_LOCAL_ROUTES.health) {
      const state = await lifecycle.localState();
      // 200 in every lifecycle state, idle included: the container is healthy when the agent is
      // answering. Reporting unhealthy while waiting to be paired would make Docker restart it in
      // a loop, and a restart is the one thing that cannot help.
      return Response.json({ ok: true, version: AGENT_VERSION, lifecycle: state.lifecycle });
    }

    if (url.pathname === AGENT_LOCAL_ROUTES.state) {
      return Response.json(await lifecycle.localState());
    }

    if (url.pathname === AGENT_LOCAL_ROUTES.pair) {
      if (request.method !== "POST") {
        return Response.json({ error: "Use POST to pair." }, { status: 405 });
      }
      return handlePair(request, lifecycle);
    }

    return Response.json({ error: "No such route." }, { status: 404 });
  };
}

async function handlePair(request: Request, lifecycle: AgentLifecycle): Promise<Response> {
  const raw = await request.arrayBuffer();
  if (raw.byteLength > MAX_BODY_BYTES) {
    return Response.json({ error: "That request is too large to be a pairing." }, { status: 413 });
  }

  let parsed: AgentLocalPairRequest;
  try {
    parsed = JSON.parse(new TextDecoder().decode(raw)) as AgentLocalPairRequest;
  } catch {
    return Response.json({ error: "The request is not valid JSON." }, { status: 400 });
  }

  if (typeof parsed?.host !== "string" || typeof parsed?.code !== "string") {
    return Response.json({ error: "A pairing needs a host and a code." }, { status: 400 });
  }
  if (parsed.port !== undefined && parsed.port !== null && typeof parsed.port !== "number") {
    return Response.json({ error: "The port must be a number." }, { status: 400 });
  }

  const outcome = await lifecycle.pair(parsed.host, parsed.port ?? null, parsed.code);
  const body: AgentLocalPairResponse = {
    ok: outcome.ok,
    state: await lifecycle.localState(),
    ...(outcome.ok ? {} : { error: outcome.error }),
  };
  // 200 even for a refused code: the request reached the agent and it answered. The CLI reads
  // `ok`, and a non-2xx here would be indistinguishable from not reaching the agent at all.
  return Response.json(body);
}
