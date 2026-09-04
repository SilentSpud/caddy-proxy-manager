/**
 * The agent's entry point: wire the pieces together and listen.
 *
 * Two listening modes, one code path behind them. `standalone` binds a Unix socket in the shared
 * data volume and writes the shared secret beside it, so a controller on the same host is
 * configured by having the volume mounted and nothing else. `managed` binds TCP and refuses every
 * request until an operator has paired a controller with the code it prints.
 *
 * Requests are signed in both modes. The socket already limits who can reach the agent, but the
 * signature is what makes the two modes the same program rather than two, and it costs a
 * process-local HMAC per request.
 */

import { chmodSync, existsSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resumeFleetConfig, stop as stopAnalytics } from "./analytics/runner";
import { PairingCodeIssuer, generateSecret } from "./auth";
import { loadConfig } from "./config";
import { AgentStore } from "./db";
import { DockerHost } from "./docker";
import { Operations } from "./operations";
import { AGENT_VERSION, createHandler } from "./server";

/** Controller id the local controller uses in standalone mode. Fixed: there is only ever one. */
export const LOCAL_CONTROLLER_ID = "local";
/** Where standalone mode leaves the secret for the controller to read off the shared volume. */
export const SECRET_FILE = "agent-secret";

const config = loadConfig();

/**
 * `--healthcheck` probes the running agent and exits, rather than starting a second one.
 *
 * The container has no curl and no shell tooling worth adding for this, so the binary answers the
 * question about itself. It dials the same transport a controller would, which is what makes a
 * pass mean "a controller could reach this" rather than "the process exists".
 */
if (process.argv.includes("--healthcheck")) {
  const target =
    config.mode === "standalone"
      ? { url: "http://agent.local/health", unix: config.socketPath }
      : { url: `http://127.0.0.1:${config.port}/health` };
  try {
    const response = await fetch(target.url, {
      ...(target.unix ? { unix: target.unix } : {}),
      signal: AbortSignal.timeout(4000),
    });
    process.exit(response.ok ? 0 : 1);
  } catch {
    process.exit(1);
  }
}

const store = new AgentStore(join(config.dataDir, "agent.db"));
const docker = new DockerHost(config);
const operations = new Operations(config, store, docker);
const pairing = new PairingCodeIssuer(config.mode === "managed");

operations.clearStaleStatuses();

/**
 * In standalone mode the secret is derived from the volume, not from an operator.
 *
 * Rotated on every start rather than persisted: the only reader is a controller that mounts the
 * same volume and can read the file at any time, so a long-lived secret buys nothing and a
 * rotating one bounds the damage from a leaked copy to one agent lifetime.
 */
function provisionLocalSecret(): void {
  const secret = generateSecret();
  store.upsertController({
    controllerId: LOCAL_CONTROLLER_ID,
    controllerName: "Local controller",
    secret,
  });
  const path = join(config.dataDir, SECRET_FILE);
  writeFileSync(path, secret, "utf-8");
  // World-readable, and it has to be: the agent runs as root (for Docker) while the controller runs
  // as an unprivileged uid, with no group in common. The protection here is the volume boundary —
  // only a container that mounts this volume can read the file at all — not the file mode, which is
  // why the secret is rotated on every start rather than being long-lived.
  chmodSync(path, 0o644);
}

function announcePairingCode(): void {
  const code = pairing.ensure();
  if (!code) return;
  const minutes = Math.round((code.expiresAt - Date.now()) / 60_000);
  console.log(
    `[agent] pairing code ${code.code} — valid for ${minutes} minute(s). Enter it in the ` +
      `controller under Settings to pair this agent.`,
  );
}

if (config.mode === "standalone") {
  provisionLocalSecret();
  // A socket file left by a killed process makes bind fail with EADDRINUSE, which reads as "the
  // port is taken" for something that has no port.
  if (existsSync(config.socketPath)) unlinkSync(config.socketPath);
} else {
  announcePairingCode();
  // The code expires on its own; reprinting keeps a live one in the logs an operator is tailing
  // rather than making them restart the container to get a fresh one.
  setInterval(announcePairingCode, 60_000).unref();
}

const handler = createHandler({ config, store, docker, operations, pairing });

const server = Bun.serve(
  config.mode === "standalone"
    ? { unix: config.socketPath, fetch: handler }
    : { hostname: config.host, port: config.port, fetch: handler },
);

if (config.mode === "standalone") {
  // The controller container runs as a different uid than this one (root, for Docker access), so
  // the socket has to be group- and other-writable to be usable at all. Reachability is still
  // bounded by who mounts the volume, and every request is signed regardless.
  chmodSync(config.socketPath, 0o666);
  console.log(`[agent] ${AGENT_VERSION} listening on ${config.socketPath} (standalone)`);
} else {
  console.log(`[agent] ${AGENT_VERSION} listening on ${config.host}:${config.port} (managed)`);
}

// A restarted stack comes up from the base compose files, which carry no L4 port override, so this
// is what keeps layer-4 routing alive across a host reboot. After the listener is up, so a slow
// `docker inspect` cannot delay readiness.
void operations.restorePublishedPorts().catch((error: unknown) => {
  console.warn("[agent] could not restore the Caddy container's published ports:", error);
});

// Resume analytics from whatever the controller last pushed, so a restarted agent keeps writing
// without waiting for the controller to notice it came back.
void resumeFleetConfig(store).catch((error: unknown) => {
  console.warn("[agent] could not resume the pushed fleet configuration:", error);
});

function shutdown(signal: string): void {
  console.log(`[agent] ${signal} received, shutting down`);
  void Promise.resolve(stopAnalytics())
    .catch(() => {
      // Shutting down regardless: a ClickHouse connection that will not close cleanly must not
      // stop the socket from being released.
    })
    .then(() => server.stop(true))
    .then(() => {
      store.close();
      if (config.mode === "standalone" && existsSync(config.socketPath)) {
        unlinkSync(config.socketPath);
      }
      process.exit(0);
    });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
