/**
 * The REST surface, with Docker stubbed out.
 *
 * What is worth pinning here is the boundary, not the plumbing: which requests reach an operation
 * at all, what a rejected one is told, and what the agent refuses to interpolate into a compose
 * file. The Docker half is stubbed because a test that shells out to `docker compose` tests the
 * host it runs on rather than this code.
 */
import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  AGENT_CONTROLLER_HEADER,
  AGENT_ROUTES,
  AGENT_SIGNATURE_HEADER,
  AGENT_TIMESTAMP_HEADER,
  signatureBase,
  type AgentErrorBody,
  type AgentStatus,
} from "@cpm/shared";
import { PairingCodeIssuer, sha256Hex } from "../src/auth";
import { loadConfig, type AgentConfig } from "../src/config";
import { AgentStore } from "../src/db";
import type { DockerHost } from "../src/docker";
import { Operations } from "../src/operations";
import { createHandler } from "../src/server";

const SECRET = "c".repeat(64);
const CONTROLLER = "local";

let dir: string;
let store: AgentStore;
let config: AgentConfig;
let pairing: PairingCodeIssuer;
let handle: (request: Request) => Promise<Response>;
/** What the stubbed Docker was asked to do, in order. */
let dockerCalls: string[];
/** Resolve to let a held build finish; null means builds complete immediately. */
let releaseBuild: (() => void) | null;

/**
 * A DockerHost that records what it was asked and always succeeds.
 *
 * `holdBuild` makes the build hang until released, which is the only way to observe the agent
 * while an operation is genuinely in flight — a stub that returns immediately has already let go
 * of the lock by the time the next request arrives.
 */
function stubDocker(holdBuild: boolean): DockerHost {
  return {
    composeProject: async () => "caddy-proxy-manager",
    recreateCaddy: async () => {
      dockerCalls.push("recreate");
      return { ok: true, exitCode: 0, output: "", timedOut: false };
    },
    buildCaddy: async () => {
      dockerCalls.push("build");
      if (holdBuild) {
        await new Promise<void>((resolve) => {
          releaseBuild = resolve;
        });
      }
      return { ok: true, exitCode: 0, output: "", timedOut: false };
    },
    waitForCaddyHealth: async () => "healthy",
    publishedCaddyPorts: async () => [],
    compose: async () => ({ ok: true, exitCode: 0, output: "", timedOut: false }),
  } as unknown as DockerHost;
}

function build(pairingEnabled = false, holdBuild = false) {
  dockerCalls = [];
  releaseBuild = null;
  store = new AgentStore(join(dir, "agent.db"));
  store.upsertController({ controllerId: CONTROLLER, controllerName: null, secret: SECRET });
  const docker = stubDocker(holdBuild);
  pairing = new PairingCodeIssuer(pairingEnabled);
  handle = createHandler({
    config,
    store,
    docker,
    operations: new Operations(config, store, docker),
    pairing,
  });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "agent-server-"));
  process.env.DATA_DIR = dir;
  process.env.COMPOSE_DIR = dir;
  process.env.AGENT_MODE = "standalone";
  config = loadConfig();
  build();
});

afterEach(() => {
  store.close();
  Bun.gc(true);
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* a leftover temp directory is not worth failing a test over */
  }
});

async function send(
  path: string,
  options: { method?: string; body?: unknown; signed?: boolean } = {},
): Promise<Response> {
  const method = options.method ?? "GET";
  const body = options.body === undefined ? "" : JSON.stringify(options.body);
  const timestamp = Date.now();
  const headers: Record<string, string> = { "content-type": "application/json" };

  if (options.signed !== false) {
    headers[AGENT_CONTROLLER_HEADER] = CONTROLLER;
    headers[AGENT_TIMESTAMP_HEADER] = String(timestamp);
    headers[AGENT_SIGNATURE_HEADER] = createHmac("sha256", SECRET)
      .update(signatureBase(method, path, timestamp, await sha256Hex(body)))
      .digest("hex");
  }

  return handle(
    new Request(`http://agent.local${path}`, {
      method,
      headers,
      body: method === "GET" ? undefined : body,
    }),
  );
}

describe("health", () => {
  it("answers without a signature", async () => {
    // It exists for a container healthcheck and for a controller asking "is anything there" before
    // it has a secret, so requiring one would make both impossible.
    const response = await send(AGENT_ROUTES.health, { signed: false });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true });
  });

  it("says nothing about the host to an unauthenticated caller", async () => {
    const body = (await (await send(AGENT_ROUTES.health, { signed: false })).json()) as Record<
      string,
      unknown
    >;
    expect(Object.keys(body).sort()).toEqual(["ok", "version"]);
  });
});

describe("authentication", () => {
  it("refuses an unsigned status read", async () => {
    const response = await send(AGENT_ROUTES.status, { signed: false });
    expect(response.status).toBe(401);
    expect(((await response.json()) as AgentErrorBody).code).toBe("UNAUTHENTICATED");
  });

  it("refuses an unsigned write, and does not run it", async () => {
    const response = await send(AGENT_ROUTES.l4Ports, {
      method: "POST",
      body: { ports: ["25:25"] },
      signed: false,
    });
    expect(response.status).toBe(401);
    expect(dockerCalls).toEqual([]);
  });
});

describe("status", () => {
  it("reports the shape the controller expects", async () => {
    const status = (await (await send(AGENT_ROUTES.status)).json()) as AgentStatus;
    expect(status.mode).toBe("standalone");
    expect(status.composeProject).toBe("caddy-proxy-manager");
    expect(status.l4Ports.status.state).toBe("idle");
    // Never rebuilt, which is different from "built with nothing".
    expect(status.caddyBuild.applied).toBeNull();
  });
});

describe("applying ports", () => {
  it("accepts a valid port list and recreates Caddy", async () => {
    const response = await send(AGENT_ROUTES.l4Ports, {
      method: "POST",
      body: { ports: ["25:25", "53:53/udp"] },
    });
    expect(response.status).toBe(202);

    // The work runs after the response, which is the point of the 202.
    await Bun.sleep(50);
    expect(dockerCalls).toContain("recreate");
    expect(store.appliedL4Ports()).toEqual(["25:25", "53:53/udp"]);
  });

  it("records the ports only once the recreate has succeeded", async () => {
    const response = await send(AGENT_ROUTES.l4Ports, {
      method: "POST",
      body: { ports: ["25:25"] },
    });
    // Accepted, not done: at this instant Caddy has not been touched.
    expect(((await response.json()) as { status: { state: string } }).status.state).toBe(
      "applying",
    );
  });

  it("refuses a port spec that is not a port spec", async () => {
    // This string ends up inside generated YAML. A value that is not two numbers cannot be there.
    for (const ports of [["25"], ["25:25; rm -rf /"], ["not:aport"], ['25:25"\nx: y']]) {
      const response = await send(AGENT_ROUTES.l4Ports, { method: "POST", body: { ports } });
      expect(response.status).toBe(400);
    }
    expect(dockerCalls).toEqual([]);
  });

  it("refuses a body that is not an array of ports", async () => {
    for (const body of [{ ports: "25:25" }, { ports: [25] }, {}]) {
      expect((await send(AGENT_ROUTES.l4Ports, { method: "POST", body })).status).toBe(400);
    }
  });

  it("refuses a list long enough to be a denial of service by itself", async () => {
    const ports = Array.from({ length: 500 }, (_, i) => `${9000 + i}:${9000 + i}`);
    expect((await send(AGENT_ROUTES.l4Ports, { method: "POST", body: { ports } })).status).toBe(
      400,
    );
  });
});

describe("requesting a build", () => {
  it("accepts a valid module list", async () => {
    const response = await send(AGENT_ROUTES.caddyBuild, {
      method: "POST",
      body: { modules: ["github.com/mholt/caddy-l4", "github.com/o/x@v1.2.3"] },
    });
    expect(response.status).toBe(202);

    await Bun.sleep(50);
    expect(dockerCalls).toEqual(["build", "recreate"]);
    expect(store.appliedCaddyModules()).toEqual([
      "github.com/mholt/caddy-l4",
      "github.com/o/x@v1.2.3",
    ]);
  });

  it("refuses a module spec that could break out of the generated YAML", async () => {
    // The spec is interpolated into a compose build arg. `docker compose` is spawned without a
    // shell, so this is not a command-injection route — but a quote or a newline still corrupts
    // the file, which is a config-injection route into the build.
    for (const modules of [
      ['github.com/o/x"\nservices:\n  evil: {}'],
      ["github.com/o/x; touch /tmp/pwned"],
      ["$(id)"],
      ["../../etc/passwd"],
    ]) {
      const response = await send(AGENT_ROUTES.caddyBuild, { method: "POST", body: { modules } });
      expect(response.status).toBe(400);
    }
    expect(dockerCalls).toEqual([]);
  });

  it("refuses a second operation while one is running", async () => {
    build(false, true);
    await send(AGENT_ROUTES.caddyBuild, {
      method: "POST",
      body: { modules: ["github.com/mholt/caddy-l4"] },
    });
    await Bun.sleep(20);
    // Both end in `docker compose up caddy`; overlapping them races two recreates against the same
    // container, one of which wins with the other's overrides half-written.
    const second = await send(AGENT_ROUTES.l4Ports, { method: "POST", body: { ports: ["25:25"] } });
    expect(second.status).toBe(409);
    expect(((await second.json()) as AgentErrorBody).code).toBe("BUSY");

    // And once it finishes, the next one is accepted rather than staying wedged.
    releaseBuild?.();
    await Bun.sleep(50);
    expect(
      (await send(AGENT_ROUTES.l4Ports, { method: "POST", body: { ports: ["25:25"] } })).status,
    ).toBe(202);
  });
});

describe("pairing", () => {
  it("refuses to pair in standalone mode", async () => {
    // Standalone reaches the agent over a socket on a shared volume; there is no operator at a
    // keyboard, and an open pairing endpoint would only be a way in.
    const response = await send(AGENT_ROUTES.pair, {
      method: "POST",
      body: { code: "ABCDEF", controllerId: "someone" },
      signed: false,
    });
    expect(response.status).toBe(403);
    expect(((await response.json()) as AgentErrorBody).code).toBe("PAIRING_DISABLED");
  });

  it("exchanges the live code for a secret in managed mode", async () => {
    build(true);
    const code = pairing.ensure()?.code as string;

    const response = await send(AGENT_ROUTES.pair, {
      method: "POST",
      body: { code, controllerId: "remote-controller", controllerName: "HQ" },
      signed: false,
    });
    expect(response.status).toBe(200);

    const { secret } = (await response.json()) as { secret: string };
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    expect(store.findController("remote-controller")?.secret).toBe(secret);
  });

  it("refuses a wrong code without saying which part was wrong", async () => {
    build(true);
    pairing.ensure();
    const response = await send(AGENT_ROUTES.pair, {
      method: "POST",
      body: { code: "ZZZZZZ", controllerId: "remote-controller" },
      signed: false,
    });
    expect(response.status).toBe(401);
    expect(store.findController("remote-controller")).toBeNull();
  });

  it("refuses a pairing request missing a controller id", async () => {
    build(true);
    pairing.ensure();
    const response = await send(AGENT_ROUTES.pair, {
      method: "POST",
      body: { code: "ABCDEF" },
      signed: false,
    });
    expect(response.status).toBe(400);
  });

  it("does not let one code pair twice", async () => {
    build(true);
    const code = pairing.ensure()?.code as string;
    await send(AGENT_ROUTES.pair, {
      method: "POST",
      body: { code, controllerId: "first" },
      signed: false,
    });
    const second = await send(AGENT_ROUTES.pair, {
      method: "POST",
      body: { code, controllerId: "second" },
      signed: false,
    });
    expect(second.status).toBe(401);
    expect(store.findController("second")).toBeNull();
  });
});

describe("unknown routes", () => {
  it("answers 404 rather than falling through to an operation", async () => {
    expect((await send("/v1/nope")).status).toBe(404);
  });
});

describe("the Caddy admin proxy", () => {
  it("forwards an allowed path and passes Caddy's answer back unchanged", async () => {
    const caddy = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: async (request) =>
        new Response(JSON.stringify({ seen: new URL(request.url).pathname }), { status: 200 }),
    });
    try {
      config = { ...config, caddyApiUrl: `http://127.0.0.1:${caddy.port}` };
      build();

      const response = await send(AGENT_ROUTES.caddyAdmin, {
        method: "POST",
        body: { path: "/load", method: "POST", body: "{}" },
      });
      expect(response.status).toBe(200);
      const proxied = (await response.json()) as { status: number; text: string };
      expect(proxied.status).toBe(200);
      expect(JSON.parse(proxied.text)).toEqual({ seen: "/load" });
    } finally {
      await caddy.stop(true);
    }
  });

  it("passes a rejection back as data rather than as an error", async () => {
    // A config Caddy refuses is something the controller has to show the operator, not something
    // for this layer to reinterpret.
    const caddy = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: () => new Response("bad module", { status: 400 }),
    });
    try {
      config = { ...config, caddyApiUrl: `http://127.0.0.1:${caddy.port}` };
      build();

      const response = await send(AGENT_ROUTES.caddyAdmin, {
        method: "POST",
        body: { path: "/load", method: "POST", body: "{}" },
      });
      expect(response.status).toBe(200);
      expect((await response.json()) as { status: number; text: string }).toMatchObject({
        status: 400,
        text: "bad module",
      });
    } finally {
      await caddy.stop(true);
    }
  });

  it("refuses a path outside the allowlist", async () => {
    // Caddy's admin API can also stop the server outright. The controller needs four paths from
    // it, and anything else is a sign the request did not come from this application.
    for (const path of ["/stop", "/config/apps/http/servers/x", "/../stop", "load"]) {
      const response = await send(AGENT_ROUTES.caddyAdmin, {
        method: "POST",
        body: { path, method: "POST" },
      });
      expect(response.status).toBe(400);
    }
  });

  it("refuses an unsigned request, like every other write", async () => {
    const response = await send(AGENT_ROUTES.caddyAdmin, {
      method: "POST",
      body: { path: "/load", method: "POST", body: "{}" },
      signed: false,
    });
    expect(response.status).toBe(401);
  });

  it("reports an unreachable Caddy rather than hanging", async () => {
    // Port 1 on loopback: nothing is listening, so the connection is refused immediately.
    config = { ...config, caddyApiUrl: "http://127.0.0.1:1" };
    build();

    const response = await send(AGENT_ROUTES.caddyAdmin, {
      method: "POST",
      body: { path: "/config/", method: "GET" },
    });
    expect(response.status).toBe(502);
  });

  it("accepts a config far larger than the other routes allow", async () => {
    // A generated document grows with the number of proxy hosts; the 64 KB cap the short JSON
    // routes use would reject a realistic fleet's config outright.
    const caddy = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: async (request) =>
        new Response(String((await request.text()).length), { status: 200 }),
    });
    try {
      config = { ...config, caddyApiUrl: `http://127.0.0.1:${caddy.port}` };
      build();

      const big = "x".repeat(200_000);
      const response = await send(AGENT_ROUTES.caddyAdmin, {
        method: "POST",
        body: { path: "/load", method: "POST", body: big },
      });
      expect(response.status).toBe(200);
      expect((await response.json()) as { text: string }).toMatchObject({ text: "200000" });
    } finally {
      await caddy.stop(true);
    }
  });
});

describe("the fleet configuration", () => {
  it("stores what the controller pushes, so a restart resumes from it", async () => {
    const response = await send(AGENT_ROUTES.fleetConfig, {
      method: "POST",
      body: {
        clickhouse: {
          url: "http://clickhouse:8123",
          user: "cpm",
          password: "hunter2",
          database: "analytics",
        },
      },
    });
    expect(response.status).toBe(200);
    expect(store.fleetConfig()?.clickhouse?.user).toBe("cpm");
  });

  it("reports analytics as enabled once it has credentials", async () => {
    await send(AGENT_ROUTES.fleetConfig, {
      method: "POST",
      body: {
        clickhouse: { url: "http://ch:8123", user: "u", password: "p", database: "d" },
      },
    });
    const status = (await (await send(AGENT_ROUTES.status)).json()) as AgentStatus;
    expect(status.analytics.enabled).toBe(true);
  });

  it("turns analytics off when the controller pushes null", async () => {
    await send(AGENT_ROUTES.fleetConfig, {
      method: "POST",
      body: {
        clickhouse: { url: "http://ch:8123", user: "u", password: "p", database: "d" },
      },
    });
    await send(AGENT_ROUTES.fleetConfig, { method: "POST", body: { clickhouse: null } });

    const status = (await (await send(AGENT_ROUTES.status)).json()) as AgentStatus;
    expect(status.analytics.enabled).toBe(false);
  });

  it("refuses a URL this process would then dial over some other scheme", async () => {
    for (const url of ["file:///etc/passwd", "ftp://ch", "not-a-url"]) {
      const response = await send(AGENT_ROUTES.fleetConfig, {
        method: "POST",
        body: { clickhouse: { url, user: "u", password: "p", database: "d" } },
      });
      expect(response.status).toBe(400);
    }
    expect(store.fleetConfig()).toBeNull();
  });

  it("refuses incomplete credentials rather than storing half of them", async () => {
    const response = await send(AGENT_ROUTES.fleetConfig, {
      method: "POST",
      body: { clickhouse: { url: "http://ch:8123", user: "u" } },
    });
    expect(response.status).toBe(400);
    expect(store.fleetConfig()).toBeNull();
  });

  it("refuses an unsigned push", async () => {
    // These are database credentials. Anything that can set them can redirect every event this
    // host writes to a server of its own choosing.
    const response = await send(AGENT_ROUTES.fleetConfig, {
      method: "POST",
      body: { clickhouse: null },
      signed: false,
    });
    expect(response.status).toBe(401);
    expect(store.fleetConfig()).toBeNull();
  });
});
