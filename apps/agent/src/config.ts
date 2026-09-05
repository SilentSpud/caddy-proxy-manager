/**
 * Everything the agent reads from its environment, resolved once at startup.
 *
 * The agent has no database to read configuration from until it has one, and nothing here is
 * changeable at runtime — it describes the host the agent is bolted to, not a preference — so this
 * stays environment-only rather than moving to the controller's settings registry.
 */

import { resolve } from "node:path";
import type { AgentMode } from "@cpm/shared";

export type { AgentMode };

export type AgentConfig = {
  /**
   * `standalone` listens on a Unix socket in the shared data volume: the controller is on the same
   * host and reaches it through the filesystem. `managed` listens on TCP and requires an operator
   * to pair it first.
   */
  mode: AgentMode;
  /** Where state, the socket and the shared secret live. Must be writable. */
  dataDir: string;
  /** Where the compose project files are mounted, read-only. */
  composeDir: string;
  socketPath: string;
  host: string;
  port: number;
  caddyContainerName: string;
  /** Where this host's Caddy admin API listens. The controller reaches it only through here. */
  caddyApiUrl: string;
  /** Override for the auto-detected compose project name. */
  composeProject: string | null;
  /** Passed to compose as --project-directory, for a host path the agent cannot see. */
  composeHostDir: string | null;
  /** An extra `-f` file, used by the test rigs. */
  composeExtraFile: string | null;
  /** Skip docker-compose.override.yml, used by the test rigs. */
  composeSkipOverride: boolean;
  /** Seconds before a Caddy image rebuild is abandoned. */
  buildTimeoutSeconds: number;
  /**
   * Seconds before starting an optional service is abandoned.
   *
   * Generous because the first start of one pulls its image: a deployment that never ran the
   * clickhouse profile has nothing cached, and abandoning a half-finished pull leaves the operator
   * with a failure that a retry over the same slow link would only repeat.
   */
  serviceTimeoutSeconds: number;
  /** Seconds to wait for Caddy to report healthy after a recreate. */
  healthTimeoutSeconds: number;
};

function optional(name: string): string | null {
  const value = process.env[name];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function positiveInteger(name: string, fallback: number): number {
  const raw = optional(name);
  if (raw === null) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer; got "${raw}"`);
  }
  return parsed;
}

function resolveMode(): AgentMode {
  const raw = optional("AGENT_MODE") ?? "standalone";
  if (raw === "standalone" || raw === "managed") return raw;
  throw new Error(
    `AGENT_MODE must be "standalone" or "managed"; got "${raw}". Startup fails rather than ` +
      `guessing: standalone listens on a socket only the local controller can reach, while ` +
      `managed listens on the network, and defaulting the wrong way either hides the agent or ` +
      `exposes it.`,
  );
}

export function loadConfig(): AgentConfig {
  const mode = resolveMode();
  const dataDir = resolve(optional("DATA_DIR") ?? "/data");

  return {
    mode,
    dataDir,
    composeDir: resolve(optional("COMPOSE_DIR") ?? "/compose"),
    socketPath: optional("AGENT_SOCKET") ?? resolve(dataDir, "agent.sock"),
    // Binds every interface, v6 and v4 alike, rather than 0.0.0.0. Reachability is the operator's
    // to decide with Docker's port publishing; refusing v6 here would only make it undecidable.
    host: optional("AGENT_HOST") ?? "::",
    port: positiveInteger("AGENT_PORT", 3100),
    caddyContainerName: optional("CADDY_CONTAINER_NAME") ?? "caddy-proxy-manager-caddy",
    caddyApiUrl: optional("CADDY_API_URL") ?? "http://caddy:2019",
    composeProject: optional("COMPOSE_PROJECT_NAME"),
    composeHostDir: optional("COMPOSE_HOST_DIR"),
    composeExtraFile: optional("COMPOSE_EXTRA_FILE"),
    composeSkipOverride: optional("COMPOSE_SKIP_OVERRIDE") !== null,
    buildTimeoutSeconds: positiveInteger("CADDY_BUILD_TIMEOUT", 1800),
    serviceTimeoutSeconds: positiveInteger("SERVICE_START_TIMEOUT", 900),
    healthTimeoutSeconds: positiveInteger("CADDY_HEALTH_TIMEOUT", 60),
  };
}
