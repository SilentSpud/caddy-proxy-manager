/**
 * The controller's side of the agent API.
 *
 * The agent owns the Docker socket, so anything needing the Caddy *container* recreated rather than
 * its config reloaded goes through here. Until 3.1 this was files on a shared volume, polled by a
 * shell script; it is now a signed HTTP call, which is what lets an agent live on a different host.
 *
 * Every request is signed with a shared secret rather than carrying a bearer token, so the secret
 * never appears in a request the way a token would. In standalone mode the agent writes that secret
 * beside its socket on the shared volume and rotates it on every start, so it is read per request
 * rather than cached — a cached copy would break silently the first time the agent restarted.
 */

import { createHmac } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AGENT_CONTROLLER_HEADER,
  AGENT_ROUTES,
  AGENT_SIGNATURE_HEADER,
  AGENT_TIMESTAMP_HEADER,
  signatureBase,
  type AgentStatus,
  type ApplyCaddyBuildRequest,
  type ApplyL4PortsRequest,
  type CaddyBuildStatus,
  type L4PortsStatus,
} from "@cpm/shared";
import { getActiveAgent, getControllerId, recordAgentContact } from "../models/agents";

/** Matches the agent's own default, and its `LOCAL_CONTROLLER_ID`. */
const LOCAL_CONTROLLER_ID = "local";
const SECRET_FILE = "agent-secret";
const SOCKET_FILE = "agent.sock";

/**
 * Where the shared volume is mounted. Named for the setting it originally served so a deployment
 * that already points it at a scratch directory — every test rig does — keeps working.
 */
function dataDir(): string {
  return process.env.L4_PORTS_DIR || "/app/data";
}

function socketPath(): string {
  return process.env.AGENT_SOCKET || join(dataDir(), SOCKET_FILE);
}

/**
 * How long to wait on the agent.
 *
 * Every call here is either a local socket round trip or a status read; the long operations return
 * immediately with a status and are polled. A request that has not answered in this long means the
 * agent is wedged, and reporting that is more useful than waiting.
 */
const REQUEST_TIMEOUT_MS = 10_000;

export class AgentUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentUnavailableError";
  }
}

export class AgentRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "AgentRequestError";
  }
}

type Transport = {
  /** Base URL. Ignored by the socket transport beyond supplying a host for the Request. */
  origin: string;
  unix?: string;
  secret: string;
  controllerId: string;
  /** Row id of the paired agent, when the transport came from the database. */
  agentRowId?: number;
};

/** The local agent, found by its socket and secret on the shared volume, or null if absent. */
function resolveLocalTransport(): Transport | null {
  const secretFile = join(dataDir(), SECRET_FILE);
  const socket = socketPath();
  if (!existsSync(secretFile) || !existsSync(socket)) return null;

  try {
    const fileSecret = readFileSync(secretFile, "utf-8").trim();
    if (fileSecret.length === 0) return null;
    return {
      // The agent listens on a socket, so the authority is never dialled. It still has to be a
      // valid URL for Request, and it is part of nothing that gets signed.
      origin: "http://agent.local",
      unix: socket,
      secret: fileSecret,
      controllerId: LOCAL_CONTROLLER_ID,
    };
  } catch {
    return null;
  }
}

/**
 * Resolve how to reach the agent, or null when there is none.
 *
 * Null is a normal state, not an error: a deployment that has not started the agent container, or
 * one whose agent has not come up yet, still serves every page — it just cannot publish a port or
 * rebuild Caddy, and the UI says so.
 *
 * Three ways to be configured, in order. A paired agent in the database wins, because pairing is
 * an explicit act by an operator and should not be silently overridden by a leftover variable.
 * `AGENT_URL` + `AGENT_SECRET` come next, for a deployment that configures its agent the way it
 * configures everything else. The local socket is the fallback, and the case almost every
 * deployment is in.
 */
async function resolveTransport(): Promise<Transport | null> {
  try {
    const paired = await getActiveAgent();
    if (paired) {
      return {
        origin: paired.address.replace(/\/$/, ""),
        secret: paired.secret,
        controllerId: await getControllerId(),
        agentRowId: paired.id,
      };
    }
  } catch (error) {
    // A database that cannot be read is not a reason to stop trying the local socket, which is
    // what a single-host deployment uses and which needs no database at all.
    console.warn("[agent] could not read the paired agent:", error);
  }

  const url = process.env.AGENT_URL?.trim();
  const secret = process.env.AGENT_SECRET?.trim();
  if (url && secret) {
    return {
      origin: url.replace(/\/$/, ""),
      secret,
      controllerId: process.env.AGENT_CONTROLLER_ID?.trim() || LOCAL_CONTROLLER_ID,
    };
  }

  return resolveLocalTransport();
}

async function sha256Hex(body: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(body);
  return hasher.digest("hex");
}

async function call<T>(
  path: string,
  options: { method?: "GET" | "POST"; body?: unknown } = {},
): Promise<T> {
  const transport = await resolveTransport();
  if (!transport) {
    throw new AgentUnavailableError(
      "No agent is reachable. Start the agent container — it is what recreates the Caddy " +
        "container, which the controller has no Docker access to do itself.",
    );
  }

  const method = options.method ?? "GET";
  const body = options.body === undefined ? "" : JSON.stringify(options.body);
  const timestamp = Date.now();
  const signature = createHmac("sha256", transport.secret)
    .update(signatureBase(method, path, timestamp, await sha256Hex(body)))
    .digest("hex");

  let response: Response;
  try {
    response = await fetch(`${transport.origin}${path}`, {
      method,
      ...(transport.unix ? { unix: transport.unix } : {}),
      headers: {
        "content-type": "application/json",
        [AGENT_CONTROLLER_HEADER]: transport.controllerId,
        [AGENT_TIMESTAMP_HEADER]: String(timestamp),
        [AGENT_SIGNATURE_HEADER]: signature,
      },
      ...(method === "POST" ? { body } : {}),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    // Never surfaces the underlying message: it carries the socket path and, on some failures, the
    // request headers — which include the signature.
    console.error("[agent] request failed", { path, method, error });
    if (transport.agentRowId !== undefined) {
      await recordAgentContact(transport.agentRowId, { ok: false, error: "Unreachable" });
    }
    throw new AgentUnavailableError("The agent did not answer.");
  }

  if (!response.ok) {
    // The agent's error bodies are its own authored strings, not echoes of the request, so they
    // are safe to pass on — and they are the only explanation the operator will get.
    const detail = await response
      .json()
      .then((parsed: unknown) =>
        parsed && typeof parsed === "object" && "error" in parsed
          ? String((parsed as { error: unknown }).error)
          : null,
      )
      .catch(() => null);
    if (transport.agentRowId !== undefined) {
      await recordAgentContact(transport.agentRowId, {
        ok: false,
        error: detail ?? `HTTP ${response.status}`,
      });
    }
    throw new AgentRequestError(
      detail ?? `The agent rejected the request (HTTP ${response.status}).`,
      response.status,
    );
  }

  if (transport.agentRowId !== undefined) {
    await recordAgentContact(transport.agentRowId, { ok: true });
  }
  return (await response.json()) as T;
}

// ─── Public surface ──────────────────────────────────────────────────────────

/** Whether an agent is configured and reachable at all. Never throws. */
export async function isAgentAvailable(): Promise<boolean> {
  if (!(await resolveTransport())) return false;
  try {
    await getAgentStatus();
    return true;
  } catch {
    return false;
  }
}

export async function getAgentStatus(): Promise<AgentStatus> {
  return call<AgentStatus>(AGENT_ROUTES.status);
}

/**
 * The agent's whole state, or null when there is none.
 *
 * Callers that render a page use this rather than getAgentStatus: a missing agent must not turn
 * the Settings page into an error, and every caller would otherwise write the same try/catch.
 */
export async function tryGetAgentStatus(): Promise<AgentStatus | null> {
  try {
    return await getAgentStatus();
  } catch {
    return null;
  }
}

export async function requestL4Ports(ports: string[]): Promise<L4PortsStatus> {
  const response = await call<{ status: L4PortsStatus }>(AGENT_ROUTES.l4Ports, {
    method: "POST",
    body: { ports } satisfies ApplyL4PortsRequest,
  });
  return response.status;
}

export async function requestCaddyBuild(modules: string[]): Promise<CaddyBuildStatus> {
  const response = await call<{ status: CaddyBuildStatus }>(AGENT_ROUTES.caddyBuild, {
    method: "POST",
    body: { modules } satisfies ApplyCaddyBuildRequest,
  });
  return response.status;
}
