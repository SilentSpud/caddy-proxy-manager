/**
 * The agent's REST surface.
 *
 * Small on purpose. Everything the controller can ask for is one of four things — are you alive,
 * what is your state, publish these ports, build with these modules — and each maps to exactly one
 * route. Anything richer would put decisions on the agent that the controller is the authority on.
 */

import {
  AGENT_ROUTES,
  type AgentErrorBody,
  type AgentErrorCode,
  type AgentStatus,
  type ApplyCaddyBuildRequest,
  type ApplyL4PortsRequest,
  type CaddyAdminProxyRequest,
  type FleetConfig,
  MAX_CADDY_CONFIG_BYTES,
  type PairRequest,
  type PairResponse,
} from "@cpm/shared";
import { accessLogPresent } from "./analytics/log-parser";
import { analyticsEnabled } from "./analytics/clickhouse";
import { applyFleetConfig } from "./analytics/runner";
import { CaddyAdminUnreachable, forwardToCaddy, isAllowedAdminPath } from "./caddy-admin";
import { generateSecret, verifyRequest, type PairingCodeIssuer } from "./auth";
import type { AgentConfig } from "./config";
import type { AgentStore } from "./db";
import type { DockerHost } from "./docker";
import { OperationBusyError, type Operations } from "./operations";

export const AGENT_VERSION = "3.1.0";

/**
 * Largest body most endpoints accept. Every one of them is a short JSON object.
 *
 * The Caddy admin proxy is the exception: it carries a whole generated config, which grows with
 * the number of proxy hosts.
 */
const MAX_BODY_BYTES = 64 * 1024;

function error(status: number, code: AgentErrorCode, message: string): Response {
  return Response.json({ error: message, code } satisfies AgentErrorBody, { status });
}

/** A compose port spec: `HOST:CONTAINER` or `HOST:CONTAINER/udp`, numeric on both sides. */
const PORT_SPEC = /^\d{1,5}:\d{1,5}(\/(tcp|udp))?$/;

/**
 * An xcaddy `--with` spec: a Go module path, optionally `@version` and `=replacement`.
 *
 * Validated here as well as in the controller because this string is interpolated into a compose
 * build arg and reaches a shell-free `docker compose` invocation as one argument — but a newline or
 * a quote in it would still corrupt the generated YAML, which is a config-injection route into the
 * build regardless of how the process is spawned.
 */
const MODULE_SPEC = /^[A-Za-z0-9][A-Za-z0-9._~\-/]*(@[A-Za-z0-9._~\-+/]+)?(=[A-Za-z0-9._~\-/]+)?$/;

function validateStringList(
  value: unknown,
  pattern: RegExp,
  label: string,
  limit: number,
): string[] | string {
  if (!Array.isArray(value)) return `${label} must be an array of strings.`;
  if (value.length > limit) return `${label} must contain at most ${limit} entries.`;
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || !pattern.test(entry)) {
      return `${label} contains an entry that is not a valid value.`;
    }
    out.push(entry);
  }
  return out;
}

export type AgentServices = {
  config: AgentConfig;
  store: AgentStore;
  docker: DockerHost;
  operations: Operations;
  pairing: PairingCodeIssuer;
};

export function createHandler(services: AgentServices) {
  const { config, store, docker, operations, pairing } = services;

  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === AGENT_ROUTES.health) {
      // Deliberately unauthenticated and deliberately sparse: it exists for a container
      // healthcheck and for a controller asking "is anything there" before it has a secret, so it
      // must not describe a host to an unpaired caller.
      return Response.json({ ok: true, version: AGENT_VERSION });
    }

    const limit =
      url.pathname === AGENT_ROUTES.caddyAdmin ? MAX_CADDY_CONFIG_BYTES : MAX_BODY_BYTES;
    const contentLength = Number.parseInt(request.headers.get("content-length") ?? "0", 10);
    if (Number.isFinite(contentLength) && contentLength > limit) {
      return error(413, "BAD_REQUEST", "The request body is too large.");
    }
    const body = await request.arrayBuffer();
    if (body.byteLength > limit) {
      return error(413, "BAD_REQUEST", "The request body is too large.");
    }

    if (url.pathname === AGENT_ROUTES.pair) {
      if (request.method !== "POST") return error(405, "BAD_REQUEST", "Use POST to pair.");
      return handlePair(body);
    }

    const auth = await verifyRequest(store, request, url, body);
    if (!auth.ok) return error(401, auth.code, auth.message);

    switch (url.pathname) {
      case AGENT_ROUTES.status:
        return Response.json(await buildStatus());
      case AGENT_ROUTES.l4Ports:
        return request.method === "POST"
          ? handleApplyPorts(body)
          : Response.json({
              applied: store.appliedL4Ports(),
              status: store.l4PortsStatus(),
            });
      case AGENT_ROUTES.caddyBuild:
        return request.method === "POST"
          ? handleApplyBuild(body)
          : Response.json({
              applied: store.appliedCaddyModules(),
              status: store.caddyBuildStatus(),
            });
      case AGENT_ROUTES.caddyAdmin:
        return request.method === "POST"
          ? handleCaddyAdmin(body)
          : error(405, "BAD_REQUEST", "Use POST to reach the Caddy admin API.");
      case AGENT_ROUTES.fleetConfig:
        return request.method === "POST"
          ? handleFleetConfig(body)
          : error(405, "BAD_REQUEST", "Use POST to set the fleet configuration.");
      default:
        return error(404, "BAD_REQUEST", "No such endpoint.");
    }
  };

  // ─── Handlers ──────────────────────────────────────────────────────────────

  function parseJson(body: ArrayBuffer): unknown {
    if (body.byteLength === 0) return {};
    try {
      return JSON.parse(new TextDecoder().decode(body));
    } catch {
      return null;
    }
  }

  function handlePair(body: ArrayBuffer): Response {
    const parsed = parseJson(body) as PairRequest | null;
    if (!parsed || typeof parsed !== "object") {
      return error(400, "BAD_REQUEST", "The pairing request is not valid JSON.");
    }
    if (typeof parsed.code !== "string" || typeof parsed.controllerId !== "string") {
      return error(400, "BAD_REQUEST", "A pairing request needs a code and a controller id.");
    }
    if (parsed.controllerId.length === 0 || parsed.controllerId.length > 128) {
      return error(400, "BAD_REQUEST", "The controller id is not a usable length.");
    }

    const redeemed = pairing.redeem(parsed.code);
    if (!redeemed.ok) {
      const message =
        redeemed.code === "PAIRING_DISABLED"
          ? "This agent runs in standalone mode and does not pair over the network."
          : "That pairing code is not valid. Check the agent's logs for the current one.";
      return error(redeemed.code === "PAIRING_DISABLED" ? 403 : 401, redeemed.code, message);
    }

    const secret = generateSecret();
    const controllerName =
      typeof parsed.controllerName === "string" && parsed.controllerName.trim().length > 0
        ? parsed.controllerName.trim().slice(0, 128)
        : null;
    store.upsertController({ controllerId: parsed.controllerId, controllerName, secret });
    console.log(
      `[agent] paired with controller ${parsed.controllerId}${controllerName ? ` (${controllerName})` : ""}`,
    );

    return Response.json({
      secret,
      agentId: store.agentId(),
      agentVersion: AGENT_VERSION,
    } satisfies PairResponse);
  }

  function handleApplyPorts(body: ArrayBuffer): Response {
    const parsed = parseJson(body) as ApplyL4PortsRequest | null;
    if (!parsed || typeof parsed !== "object") {
      return error(400, "BAD_REQUEST", "The request is not valid JSON.");
    }
    const ports = validateStringList(parsed.ports, PORT_SPEC, "ports", 200);
    if (typeof ports === "string") return error(400, "BAD_REQUEST", ports);

    try {
      operations.applyL4Ports(ports);
    } catch (busy) {
      if (busy instanceof OperationBusyError) {
        return error(409, "BUSY", `The agent is busy: ${busy.running} is already running.`);
      }
      throw busy;
    }
    return Response.json({ accepted: true, status: store.l4PortsStatus() }, { status: 202 });
  }

  function handleApplyBuild(body: ArrayBuffer): Response {
    const parsed = parseJson(body) as ApplyCaddyBuildRequest | null;
    if (!parsed || typeof parsed !== "object") {
      return error(400, "BAD_REQUEST", "The request is not valid JSON.");
    }
    const modules = validateStringList(parsed.modules, MODULE_SPEC, "modules", 200);
    if (typeof modules === "string") return error(400, "BAD_REQUEST", modules);

    try {
      operations.applyCaddyBuild(modules);
    } catch (busy) {
      if (busy instanceof OperationBusyError) {
        return error(409, "BUSY", `The agent is busy: ${busy.running} is already running.`);
      }
      throw busy;
    }
    return Response.json({ accepted: true, status: store.caddyBuildStatus() }, { status: 202 });
  }

  /**
   * Forward one admin request to this host's Caddy.
   *
   * Caddy's own answer is passed back unchanged, non-2xx included: a rejected config is something
   * the controller has to read and show the operator, not an error for this layer to reinterpret.
   */
  async function handleCaddyAdmin(body: ArrayBuffer): Promise<Response> {
    const parsed = parseJson(body) as CaddyAdminProxyRequest | null;
    if (!parsed || typeof parsed !== "object") {
      return error(400, "BAD_REQUEST", "The request is not valid JSON.");
    }
    if (typeof parsed.path !== "string" || typeof parsed.method !== "string") {
      return error(400, "BAD_REQUEST", "A Caddy admin request needs a path and a method.");
    }
    if (!isAllowedAdminPath(parsed.path)) {
      // The admin API can also stop the server outright. The controller needs four paths from it,
      // and anything else is a sign the request did not come from this application.
      return error(400, "BAD_REQUEST", `The Caddy admin path "${parsed.path}" is not allowed.`);
    }
    if (parsed.body !== undefined && typeof parsed.body !== "string") {
      return error(400, "BAD_REQUEST", "A Caddy admin body must be a string.");
    }

    try {
      return Response.json(await forwardToCaddy(config.caddyApiUrl, parsed));
    } catch (caddyError) {
      if (caddyError instanceof CaddyAdminUnreachable) {
        return error(502, "INTERNAL", caddyError.message);
      }
      throw caddyError;
    }
  }

  /**
   * Take the credentials the controller pushed.
   *
   * Stored before they are applied, so a restart resumes from them without waiting for the
   * controller to push again — and applied even when unchanged, since `applyFleetConfig` is
   * idempotent and a repeat push must not restart a working parser.
   */
  async function handleFleetConfig(body: ArrayBuffer): Promise<Response> {
    const parsed = parseJson(body) as FleetConfig | null;
    if (!parsed || typeof parsed !== "object") {
      return error(400, "BAD_REQUEST", "The request is not valid JSON.");
    }

    const clickhouse = parsed.clickhouse;
    if (clickhouse !== null && clickhouse !== undefined) {
      const fields = ["url", "user", "password", "database"] as const;
      if (fields.some((field) => typeof clickhouse[field] !== "string")) {
        return error(400, "BAD_REQUEST", "The ClickHouse credentials are incomplete.");
      }
      // The URL is dialled by this process. Refusing anything but http(s) keeps a pushed value
      // from turning into a file read or a request over some other scheme.
      try {
        const protocol = new URL(clickhouse.url).protocol;
        if (protocol !== "http:" && protocol !== "https:") throw new Error("scheme");
      } catch {
        return error(400, "BAD_REQUEST", "The ClickHouse URL must be http:// or https://.");
      }
    }

    const config: FleetConfig = { clickhouse: clickhouse ?? null };
    store.setFleetConfig(config);
    await applyFleetConfig(store, config);
    return Response.json({ ok: true });
  }

  async function buildStatus(): Promise<AgentStatus> {
    return {
      agentId: store.agentId(),
      version: AGENT_VERSION,
      mode: config.mode,
      composeProject: await docker.composeProject(),
      l4Ports: {
        applied: store.appliedL4Ports(),
        status: store.l4PortsStatus(),
      },
      caddyBuild: {
        applied: store.appliedCaddyModules(),
        status: store.caddyBuildStatus(),
      },
      analytics: {
        enabled: analyticsEnabled(),
        accessLogPresent: accessLogPresent(),
      },
    };
  }
}
