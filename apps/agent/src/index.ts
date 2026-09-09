/**
 * The agent's entry point: parse the command line, then either talk to the agent already running
 * on this host or become it.
 *
 * There is one listener and it faces the host, not the network. The agent dials its controller and
 * holds an event stream open; nothing calls in. That is what lets a host behind NAT be managed
 * without an inbound port, and why an agent with no controller is simply idle rather than waiting
 * to be found.
 */

import { chmodSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { AGENT_LOCAL_ROUTES, type AgentLocalPairResponse, type AgentLocalState } from "@cpm/shared";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { stop as stopAnalytics } from "./analytics/runner";
import { loadConfig } from "./config";
import { AgentStore } from "./db";
import { DockerHost } from "./docker";
import { AgentLifecycle } from "./lifecycle";
import { createLocalHandler } from "./local-server";
import { Operations } from "./operations";
import { AGENT_VERSION } from "./status";

/**
 * Parsed before anything reads the environment, so `--help` and `--version` answer on a host that
 * has none of the agent's configuration set. `hideBin` is correct for the compiled binary too:
 * `bun build --compile` keeps argv's two-element prefix, exactly as `bun src/index.ts` has it.
 */
const argv = yargs(hideBin(process.argv))
  .scriptName("cpm-agent")
  .usage(
    "$0 [options]\n\nManages this host's Caddy container on behalf of a Caddy Proxy Manager " +
      "controller.\n\nStarted with no controller, the agent idles and leaves Caddy stopped. Pair " +
      "it from the host with:\n  cpm-agent --pair --host 10.0.0.5 --code ABCDEF",
  )
  .option("pair", {
    type: "boolean",
    default: false,
    describe: "Hand --host/--port/--code to the agent already running on this host, then exit",
  })
  .option("host", {
    type: "string",
    describe: "Controller address. A bare host is assumed to be http://",
    defaultDescription: "$CONTROLLER_URL",
  })
  .option("port", {
    type: "number",
    describe: "Controller port, when the address does not carry one",
    defaultDescription: "3000",
  })
  .option("code", {
    type: "string",
    describe: "Six-letter pairing code, read off the controller's Settings page",
    defaultDescription: "$PAIRING_CODE",
  })
  .option("healthcheck", {
    type: "boolean",
    default: false,
    describe: "Probe the running agent over its local socket, then exit 0 if it answered",
  })
  .version(AGENT_VERSION)
  // A mistyped flag used to be ignored, which in the container's HEALTHCHECK meant starting a
  // second agent rather than probing the first - and looking healthy while doing it.
  .strict()
  .help()
  .check((parsed) => {
    if (parsed.pair && !parsed.host) throw new Error("--pair needs --host.");
    if (parsed.pair && !parsed.code) throw new Error("--pair needs --code.");
    if (parsed.pair && parsed.healthcheck)
      throw new Error("--pair and --healthcheck are separate.");
    return true;
  })
  .parseSync();

const config = loadConfig({
  // Only when not pairing: in --pair mode these describe the message to send, not this process's
  // own configuration, and validating them as config would reject before the agent could answer.
  controllerHost: argv.pair ? null : argv.host,
  controllerPort: argv.pair ? null : argv.port,
  pairingCode: argv.pair ? null : argv.code,
});

/** Every local call dials the same socket the running agent binds. */
function localFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`http://agent.local${path}`, {
    unix: config.socketPath,
    signal: AbortSignal.timeout(20_000),
    ...init,
  });
}

// ─── --healthcheck ───────────────────────────────────────────────────────────

/**
 * Probes the running agent and exits, rather than starting a second one.
 *
 * The container has no curl and no shell tooling worth adding for this, so the binary answers the
 * question about itself. It dials the same socket `--pair` does, which is what makes a pass mean
 * "this agent is answering" rather than "the process exists".
 */
if (argv.healthcheck) {
  try {
    const response = await localFetch(AGENT_LOCAL_ROUTES.health);
    process.exit(response.ok ? 0 : 1);
  } catch {
    process.exit(1);
  }
}

// ─── --pair ──────────────────────────────────────────────────────────────────

/**
 * Hands the running agent its controller and code.
 *
 * A second process cannot pair on the first's behalf: the running one holds the database the
 * secret must land in and the stream it will open. So this is a message, not a mode.
 */
if (argv.pair) {
  if (!existsSync(config.socketPath)) {
    console.error(
      `No agent is listening on ${config.socketPath}. Start the agent first - pairing is handed ` +
        `to the running process, not performed by this one.`,
    );
    process.exit(1);
  }

  try {
    const response = await localFetch(AGENT_LOCAL_ROUTES.pair, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ host: argv.host, port: argv.port, code: argv.code }),
    });
    const body = (await response.json()) as AgentLocalPairResponse;

    if (!body.ok) {
      console.error(body.error ?? "The agent refused the pairing.");
      process.exit(1);
    }
    console.log(`Paired with ${body.state.controllerUrl}.`);
    console.log(describeState(body.state));
    process.exit(0);
  } catch (error) {
    console.error(`Could not reach the agent on ${config.socketPath}: ${describeError(error)}`);
    process.exit(1);
  }
}

function describeState(state: AgentLocalState): string {
  if (state.caddy.running) return "Caddy is running.";
  if (state.caddy.allowed) return "Caddy is starting.";
  return "Caddy is stopped; the controller has not enabled it yet.";
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ─── Running the agent ───────────────────────────────────────────────────────

const store = new AgentStore(join(config.dataDir, "agent.db"));
const docker = new DockerHost(config);
const operations = new Operations(config, store, docker);

operations.clearStaleStatuses();

const lifecycle = new AgentLifecycle({ config, store, docker, operations });

// A socket file left by a killed process makes bind fail with EADDRINUSE, which reads as "the port
// is taken" for something that has no port.
if (existsSync(config.socketPath)) unlinkSync(config.socketPath);

const server = Bun.serve({ unix: config.socketPath, fetch: createLocalHandler(lifecycle) });

// World-writable, and it has to be: `cpm-agent --pair` may be run by any user with a shell in this
// container, and the agent itself runs as root for Docker. The boundary is the volume - only
// something that mounts it can reach this socket at all - not the file mode.
chmodSync(config.socketPath, 0o666);
console.log(`[agent] ${AGENT_VERSION} listening on ${config.socketPath}`);

await lifecycle.start();

const state = await lifecycle.localState();
if (state.lifecycle === "idle") {
  console.log(`[agent] idle: ${state.message}`);
}

// A restarted stack comes up from the base compose files, which carry no L4 port override, so this
// is what keeps layer-4 routing alive across a host reboot. After the listener is up, so a slow
// `docker inspect` cannot delay readiness.
void operations.restorePublishedPorts().catch((error: unknown) => {
  console.warn("[agent] could not restore the Caddy container's published ports:", error);
});

function shutdown(signal: string): void {
  console.log(`[agent] ${signal} received, shutting down`);
  lifecycle.stop();
  void Promise.resolve(stopAnalytics())
    .catch(() => {
      // Shutting down regardless: a ClickHouse connection that will not close cleanly must not
      // stop the socket from being released.
    })
    .then(() => server.stop(true))
    .then(() => {
      store.close();
      if (existsSync(config.socketPath)) unlinkSync(config.socketPath);
      process.exit(0);
    });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
