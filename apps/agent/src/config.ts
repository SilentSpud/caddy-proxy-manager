/**
 * Everything the agent reads from its environment, resolved once at startup.
 *
 * The agent has no database to read configuration from until it has one, and nothing here is
 * changeable at runtime - it describes the host the agent is bolted to, not a preference - so this
 * stays environment-only rather than moving to the controller's settings registry.
 */

import { resolve } from "node:path";
import type { AgentMode } from "@cpm/shared";
import {
  ControllerAddressError,
  normalizeControllerUrl,
  normalizePairingCode,
} from "./controller-url";

export type { AgentMode };

export type AgentConfig = {
  /**
   * Controller origin this agent polls, or null when it has never been given one.
   *
   * Null is the idle state the whole pairing flow exists to leave: the agent runs, answers
   * `cpm-agent --pair`, and holds Caddy down until it has somewhere to fetch a config from.
   */
  controllerUrl: string | null;
  /** One-time code to pair with at startup, when the operator supplied one up front. */
  pairingCode: string | null;
  /**
   * `standalone` listens on a Unix socket in the shared data volume: the controller is on the same
   * host and reaches it through the filesystem. `managed` listens on TCP and requires an operator
   * to pair it first.
   */
  mode: AgentMode;
  /** Where state, the socket and the shared secret live. Must be writable. */
  dataDir: string;
  /**
   * The controller's data volume, mounted read-only, or null for an agent that has none.
   *
   * Two things are read from it: the bootstrap token the controller leaves for the agent in its own
   * stack, and - once, on upgrade - the database agents kept there before they had a volume of
   * their own. Null falls back to `dataDir` for the token, which is where it was before.
   */
  controllerDataDir: string | null;
  /** Where the compose project files are mounted, read-only. */
  composeDir: string;
  /** The local control socket. The agent's only listener, and it faces the host. */
  socketPath: string;
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

/**
 * CLI values that win over the environment.
 *
 * Flags beat variables because a flag is typed for one invocation while a variable is baked into
 * the container: an operator repairing a bad `CONTROLLER_URL` must not have to edit compose first.
 */
export type ConfigOverrides = {
  controllerHost?: string | null;
  controllerPort?: number | null;
  pairingCode?: string | null;
};

function resolveControllerUrl(overrides: ConfigOverrides): string | null {
  if (overrides.controllerHost) {
    return normalizeControllerUrl(overrides.controllerHost, overrides.controllerPort ?? null);
  }
  const fromEnv = optional("CONTROLLER_URL");
  if (fromEnv) return normalizeControllerUrl(fromEnv, overrides.controllerPort ?? null);
  // A port with nothing to attach it to is a half-configured agent, and silently idling on it
  // would look identical to never having been configured at all.
  if (overrides.controllerPort != null) {
    throw new ControllerAddressError("--port needs --host (or CONTROLLER_URL) alongside it.");
  }
  return null;
}

function resolvePairingCode(overrides: ConfigOverrides): string | null {
  const raw = overrides.pairingCode ?? optional("PAIRING_CODE");
  return raw === null || raw === undefined ? null : normalizePairingCode(raw);
}

export function loadConfig(overrides: ConfigOverrides = {}): AgentConfig {
  const mode = resolveMode();
  const dataDir = resolve(optional("DATA_DIR") ?? "/data");

  return {
    controllerUrl: resolveControllerUrl(overrides),
    pairingCode: resolvePairingCode(overrides),
    mode,
    dataDir,
    controllerDataDir: optional("CONTROLLER_DATA_DIR"),
    composeDir: resolve(optional("COMPOSE_DIR") ?? "/compose"),
    socketPath: optional("AGENT_SOCKET") ?? resolve(dataDir, "agent.sock"),
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
