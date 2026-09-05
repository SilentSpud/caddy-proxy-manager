/**
 * The exact commands the agent runs, and what each operation does with their outcome.
 *
 * These invariants were previously pinned by grepping the shell script this replaced; they are
 * pinned properly now, against the argv actually built and the state actually written. Each one
 * corresponds to a way the proxy can be taken down by a recreate that does slightly too much:
 * pulling an image, cascading to dependencies, dropping an override, or recording a build that
 * never finished.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { type AgentConfig, loadConfig } from "../src/config";
import { AgentStore } from "../src/db";
import { DockerHost, renderCaddyBuildOverride, renderL4PortsOverride } from "../src/docker";
import { Operations } from "../src/operations";

let dir: string;
let config: AgentConfig;
/** Every argv the agent spawned, in order. */
let spawned: string[][];
/** Queue of results for the next spawns; anything unqueued succeeds with empty output. */
let results: Array<{ exitCode: number; stdout?: string }>;
/**
 * What `docker inspect` reports for the working_dir label.
 *
 * Answered outside the queue above, unlike the project-name inspect: it is a second question the
 * agent asks before every compose invocation, and threading it through a positional queue would
 * make every test's result list depend on how many labels the implementation happens to read.
 */
let hostDirLabel: string;

const realSpawn = Bun.spawn;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "agent-docker-"));
  process.env.DATA_DIR = dir;
  process.env.COMPOSE_DIR = dir;
  process.env.AGENT_MODE = "standalone";
  delete process.env.COMPOSE_HOST_DIR;
  delete process.env.COMPOSE_EXTRA_FILE;
  delete process.env.COMPOSE_SKIP_OVERRIDE;
  delete process.env.COMPOSE_PROJECT_NAME;
  config = loadConfig();

  spawned = [];
  results = [];
  hostDirLabel = "";
  // Intercepting the spawn rather than the DockerHost is the point: what matters is the argv that
  // would reach Docker, and a stubbed DockerHost would assert only that the test agrees with itself.
  (Bun as { spawn: unknown }).spawn = ((argv: string[]) => {
    spawned.push(argv);
    if (argv.some((a) => a.includes("com.docker.compose.project.working_dir"))) {
      return {
        stdout: new Response(hostDirLabel).body,
        stderr: new Response("").body,
        exited: Promise.resolve(hostDirLabel === "" ? 1 : 0),
      };
    }
    const next = results.shift() ?? { exitCode: 0 };
    return {
      stdout: new Response(next.stdout ?? "").body,
      stderr: new Response("").body,
      exited: Promise.resolve(next.exitCode),
    };
  }) as unknown as typeof Bun.spawn;
});

afterEach(() => {
  (Bun as { spawn: unknown }).spawn = realSpawn;
  Bun.gc(true);
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* a leftover temp directory is not worth failing a test over */
  }
});

/** The argv of the last `docker compose` invocation. */
function lastCompose(): string[] {
  const found = [...spawned].reverse().find((a) => a[0] === "docker" && a[1] === "compose");
  if (!found) throw new Error("no compose invocation was made");
  return found;
}

describe("compose invocation", () => {
  it("recreates only the caddy service", async () => {
    // A bare `up -d` would recreate the controller and this agent along with it, killing the
    // process partway through its own operation.
    results.push({ exitCode: 0, stdout: "caddy-proxy-manager" });
    await new DockerHost(config).recreateCaddy();
    expect(lastCompose().at(-1)).toBe("caddy");
  });

  it("passes --no-deps so a recreate does not cascade", async () => {
    results.push({ exitCode: 0, stdout: "proj" });
    await new DockerHost(config).recreateCaddy();
    expect(lastCompose()).toContain("--no-deps");
  });

  it("passes --force-recreate, without which a port change is a no-op", async () => {
    // Published ports are fixed at create time. Compose sees no config change and would leave the
    // existing container running with the old bindings.
    results.push({ exitCode: 0, stdout: "proj" });
    await new DockerHost(config).recreateCaddy();
    expect(lastCompose()).toContain("--force-recreate");
  });

  it("passes --pull never, so a recreate cannot swap the image underneath", async () => {
    results.push({ exitCode: 0, stdout: "proj" });
    await new DockerHost(config).recreateCaddy();
    const argv = lastCompose();
    expect(argv[argv.indexOf("--pull") + 1]).toBe("never");
  });

  it("detects the compose project from the caddy container's labels", async () => {
    // The project name comes from whatever directory the operator ran compose in, so assuming one
    // would make the agent manage a project that does not exist on most deployments.
    results.push({ exitCode: 0, stdout: "someone-elses-project\n" });
    await new DockerHost(config).recreateCaddy();
    const argv = lastCompose();
    expect(argv[argv.indexOf("-p") + 1]).toBe("someone-elses-project");
  });

  it("falls back to the default project when the label cannot be read", async () => {
    results.push({ exitCode: 1, stdout: "" });
    await new DockerHost(config).recreateCaddy();
    const argv = lastCompose();
    expect(argv[argv.indexOf("-p") + 1]).toBe("caddy-proxy-manager");
  });

  it("prefers an explicit project name over detection", async () => {
    process.env.COMPOSE_PROJECT_NAME = "pinned";
    process.env.COMPOSE_HOST_DIR = "/srv/cpm";
    const host = new DockerHost(loadConfig());
    await host.recreateCaddy();
    const argv = lastCompose();
    expect(argv[argv.indexOf("-p") + 1]).toBe("pinned");
    // With both pinned it never asks Docker at all, so a stopped Caddy container does not stop a
    // recreate. Neither lookup is load-bearing on its own — see the two tests below.
    expect(spawned.some((a) => a[1] === "inspect")).toBe(false);
  });

  it("carries both overrides on every invocation", async () => {
    // A rebuild must not drop the published L4 ports, and a port change must not rebuild Caddy
    // without the module selection. Omitting either is how one operation silently undoes the other.
    writeFileSync(join(dir, "docker-compose.l4-ports.yml"), renderL4PortsOverride(["25:25"]));
    writeFileSync(join(dir, "docker-compose.caddy-build.yml"), renderCaddyBuildOverride(["x"]));
    results.push({ exitCode: 0, stdout: "proj" });

    await new DockerHost(config).buildCaddy();
    const argv = lastCompose().join(" ");
    expect(argv).toContain("docker-compose.l4-ports.yml");
    expect(argv).toContain("docker-compose.caddy-build.yml");
  });

  it("detects --project-directory from the host path the operator's compose recorded", async () => {
    // The daemon resolves a relative bind mount against this. Without it, a service mounting
    // ./docker/... gets an empty directory Docker silently created at a path that does not exist
    // on the host — a container that comes up wrong rather than a command that fails.
    hostDirLabel = "/srv/cpm";
    results.push({ exitCode: 0, stdout: "proj" });
    await new DockerHost(config).recreateCaddy();
    const argv = lastCompose();
    expect(argv[argv.indexOf("--project-directory") + 1]).toBe("/srv/cpm");
  });

  it("omits --project-directory when the label cannot be read", async () => {
    // Unconditionally passing something breaks named-volume deployments, where the agent's
    // /compose mount is the correct project directory; a guess would be worse than nothing.
    hostDirLabel = "";
    results.push({ exitCode: 0, stdout: "proj" });
    await new DockerHost(config).recreateCaddy();
    expect(lastCompose()).not.toContain("--project-directory");
  });

  it("prefers an explicit COMPOSE_HOST_DIR over the detected label", async () => {
    hostDirLabel = "/detected";
    process.env.COMPOSE_HOST_DIR = "/srv/cpm";
    results.push({ exitCode: 0, stdout: "proj" });
    await new DockerHost(loadConfig()).recreateCaddy();
    const argv = lastCompose();
    expect(argv[argv.indexOf("--project-directory") + 1]).toBe("/srv/cpm");
  });

  it("reads --env-file from the mounted compose dir, not the host path", async () => {
    // --project-directory can name a host path this container cannot see; the env file has to come
    // from somewhere it can actually read.
    writeFileSync(join(dir, ".env"), "X=1\n");
    process.env.COMPOSE_HOST_DIR = "/srv/cpm";
    results.push({ exitCode: 0, stdout: "proj" });
    await new DockerHost(loadConfig()).recreateCaddy();
    const argv = lastCompose();
    expect(argv[argv.indexOf("--env-file") + 1]).toBe(join(dir, ".env"));
  });

  it("omits --env-file entirely when there is no .env to read", async () => {
    results.push({ exitCode: 0, stdout: "proj" });
    await new DockerHost(config).recreateCaddy();
    expect(lastCompose()).not.toContain("--env-file");
  });

  it("bounds the build with a timeout so a hung compile cannot wedge the agent", async () => {
    // Without it a wedged xcaddy holds the operation lock forever, and every later port change and
    // rebuild is refused as BUSY until someone restarts the container.
    // Both pinned so composeArgs asks Docker nothing: the stub below never exits, and this test is
    // about the build's timeout, not the label lookups'.
    process.env.COMPOSE_PROJECT_NAME = "proj";
    process.env.COMPOSE_HOST_DIR = "/srv/cpm";
    const host = new DockerHost({ ...loadConfig(), buildTimeoutSeconds: 1 });
    (Bun as { spawn: unknown }).spawn = ((argv: string[], options: { signal?: AbortSignal }) => {
      spawned.push(argv);
      return {
        stdout: new Response("").body,
        stderr: new Response("").body,
        // Never exits on its own. Only the abort ends it.
        exited: new Promise((_, reject) => {
          options.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
      };
    }) as unknown as typeof Bun.spawn;

    const result = await host.buildCaddy();
    expect(result.timedOut).toBe(true);
    expect(result.ok).toBe(false);
  });
});

describe("published ports", () => {
  it("reads what Docker reports, in compose's own spelling", async () => {
    results.push({
      exitCode: 0,
      stdout: JSON.stringify({
        "443/tcp": [{ HostPort: "443" }],
        "53/udp": [{ HostPort: "53" }],
        "9999/tcp": null,
      }),
    });
    expect(await new DockerHost(config).publishedCaddyPorts()).toEqual(["443:443", "53:53/udp"]);
  });

  it("reports nothing rather than throwing when the container is gone", async () => {
    results.push({ exitCode: 1, stdout: "" });
    expect(await new DockerHost(config).publishedCaddyPorts()).toEqual([]);
  });
});

describe("operations", () => {
  let store: AgentStore;
  let operations: Operations;

  beforeEach(() => {
    store = new AgentStore(join(dir, "agent.db"));
    operations = new Operations(config, store, new DockerHost(config));
  });

  afterEach(() => {
    store.close();
  });

  it("records the applied module set only once Caddy is healthy again", async () => {
    // Recording it earlier tells the controller a module is available while the old image is still
    // serving, and it will then emit a handler the running binary rejects the whole config over.
    const impatient = { ...config, healthTimeoutSeconds: 1 };
    operations = new Operations(impatient, store, new DockerHost(impatient));

    results.push({ exitCode: 0, stdout: "proj" }); // inspect (project)
    results.push({ exitCode: 0 }); // build
    results.push({ exitCode: 0 }); // up
    results.push({ exitCode: 0, stdout: "starting" }); // health, never becomes healthy

    operations.applyCaddyBuild(["github.com/a/b"]);
    await Bun.sleep(1500);

    expect(store.appliedCaddyModules()).toBeNull();
    expect(store.caddyBuildStatus().state).toBe("failed");
  });

  it("leaves the running container alone when the build fails", async () => {
    // A failed xcaddy compile is routine, and the old image keeps serving. The status has to say so
    // — the operator's first question is whether the proxy just went down.
    results.push({ exitCode: 0, stdout: "proj" });
    results.push({ exitCode: 1, stdout: "go: module not found" });

    operations.applyCaddyBuild(["github.com/a/b"]);
    await Bun.sleep(100);

    expect(spawned.some((a) => a.includes("up"))).toBe(false);
    expect(store.caddyBuildStatus().message).toContain("left untouched");
    expect(store.appliedCaddyModules()).toBeNull();
  });

  it("writes the override before the build reads it", async () => {
    results.push({ exitCode: 0, stdout: "proj" });
    operations.applyCaddyBuild(["github.com/a/b"]);
    await Bun.sleep(50);
    expect(readFileSync(join(dir, "docker-compose.caddy-build.yml"), "utf-8")).toContain(
      'CADDY_MODULES: "github.com/a/b"',
    );
  });

  it("clears a status left mid-flight by a killed agent", async () => {
    // The UI would otherwise spin forever on an operation that provably is not running — this
    // process has just started — with its button disabled and no way back.
    store.setCaddyBuildStatus({ state: "building", message: "compiling" });
    store.setL4PortsStatus({ state: "applying", message: "recreating" });

    new Operations(config, store, new DockerHost(config)).clearStaleStatuses();

    expect(store.caddyBuildStatus().state).toBe("failed");
    expect(store.l4PortsStatus().state).toBe("failed");
  });

  it("leaves a finished status alone", async () => {
    store.setCaddyBuildStatus({ state: "applied", message: "done" });
    new Operations(config, store, new DockerHost(config)).clearStaleStatuses();
    expect(store.caddyBuildStatus().state).toBe("applied");
  });

  it("republishes at startup when Caddy came up without the port override", async () => {
    // The operator's `docker compose up` starts Caddy from the base files, which carry no
    // generated override, so a rebooted host comes up with every L4 port unpublished. This is the
    // only thing that notices.
    store.setAppliedL4Ports(["15432:15432"]);
    results.push({ exitCode: 0, stdout: JSON.stringify({ "80/tcp": [{ HostPort: "80" }] }) });

    await operations.restorePublishedPorts();
    await Bun.sleep(100);

    expect(spawned.some((a) => a.includes("--force-recreate"))).toBe(true);
    expect(readFileSync(join(dir, "docker-compose.l4-ports.yml"), "utf-8")).toContain(
      '"15432:15432"',
    );
  });

  it("does nothing at startup when the published ports already match", async () => {
    store.setAppliedL4Ports(["80:80"]);
    results.push({ exitCode: 0, stdout: JSON.stringify({ "80/tcp": [{ HostPort: "80" }] }) });

    await operations.restorePublishedPorts();
    await Bun.sleep(50);
    // A recreate on every agent restart would drop every live connection for nothing.
    expect(spawned.some((a) => a.includes("--force-recreate"))).toBe(false);
  });

  it("adopts what Docker publishes when it has never applied anything", async () => {
    // First run, or a stack whose ports an operator manages by hand. Re-applying an empty list
    // over either would unpublish ports this agent never published.
    results.push({ exitCode: 0, stdout: JSON.stringify({ "443/tcp": [{ HostPort: "443" }] }) });

    await operations.restorePublishedPorts();
    await Bun.sleep(50);

    expect(store.appliedL4Ports()).toEqual(["443:443"]);
    expect(spawned.some((a) => a.includes("--force-recreate"))).toBe(false);
  });
});

describe("optional services", () => {
  let store: AgentStore;
  let operations: Operations;

  beforeEach(() => {
    store = new AgentStore(join(dir, "agent.db"));
    operations = new Operations(config, store, new DockerHost(config));
  });

  afterEach(() => {
    store.close();
  });

  /** Wait for the operation, which returns as soon as the work is accepted. */
  async function settle(): Promise<void> {
    for (let i = 0; i < 100 && store.managedServicesStatus().state === "applying"; i++) {
      await Bun.sleep(10);
    }
  }

  it("enables the profile explicitly rather than relying on compose to infer it", async () => {
    // These services sit behind a profile, so without this compose reports "no such service" —
    // and on the versions that do infer it, the behaviour arrived partway through v2.
    results.push({ exitCode: 0, stdout: "proj" });
    await new DockerHost(config).startService("clickhouse");

    const argv = lastCompose();
    expect(argv[argv.indexOf("--profile") + 1]).toBe("clickhouse");
    // Top-level flag: it has to precede the subcommand or compose rejects it.
    expect(argv.indexOf("--profile")).toBeLessThan(argv.indexOf("up"));
    expect(argv.at(-1)).toBe("clickhouse");
  });

  it("stops rather than removes, so the data volume outlives the toggle", async () => {
    // Turning analytics off must not be how someone discovers their event history is gone.
    results.push({ exitCode: 0, stdout: "proj" });
    await new DockerHost(config).stopService("clickhouse");

    const argv = lastCompose();
    expect(argv).toContain("stop");
    expect(argv).not.toContain("down");
    expect(argv).not.toContain("rm");
  });

  it("passes the credentials through the child's environment, not a file on disk", async () => {
    // Compose reads the process environment at a higher precedence than any env file, so this
    // overrides a stale value in the project's own .env — which the agent mounts read-only and
    // cannot rewrite. It also keeps the password off the agent's data volume, and sidesteps the
    // quoting rules an env file would need.
    writeFileSync(join(dir, ".env"), "CLICKHOUSE_PASSWORD=stale\n");
    let seen: Record<string, string> | undefined;
    (Bun as { spawn: unknown }).spawn = ((
      argv: string[],
      opts: { env?: Record<string, string> },
    ) => {
      spawned.push(argv);
      if (argv[1] === "compose") seen = opts.env;
      return {
        stdout: new Response("").body,
        stderr: new Response("").body,
        exited: Promise.resolve(0),
      };
    }) as unknown as typeof Bun.spawn;

    await new DockerHost(config).startService("clickhouse", { CLICKHOUSE_PASSWORD: "pa$$#word'x" });

    expect(seen?.CLICKHOUSE_PASSWORD).toBe("pa$$#word'x");
    // Inherited too, or `docker` cannot find the socket proxy.
    expect(seen?.DATA_DIR).toBe(dir);
    expect(existsSync(join(dir, "fleet.env"))).toBe(false);
  });

  it("hands the credentials to a stop as well as a start", async () => {
    // Compose parses the whole file, including the ${...:?} guard on a service it is not touching.
    let seen: Record<string, string> | undefined;
    (Bun as { spawn: unknown }).spawn = ((
      argv: string[],
      opts: { env?: Record<string, string> },
    ) => {
      spawned.push(argv);
      if (argv[1] === "compose") seen = opts.env;
      return {
        stdout: new Response("").body,
        stderr: new Response("").body,
        exited: Promise.resolve(0),
      };
    }) as unknown as typeof Bun.spawn;

    await new DockerHost(config).stopService("clickhouse", { CLICKHOUSE_PASSWORD: "s3cret" });
    expect(seen?.CLICKHOUSE_PASSWORD).toBe("s3cret");
  });

  it("starts what was asked for and stops what was not", async () => {
    operations.applyManagedServices({
      services: { clickhouse: true, geoipupdate: false },
      env: {},
    });
    await settle();

    const composeCalls = spawned.filter((a) => a[1] === "compose").map((a) => a.join(" "));
    expect(composeCalls.some((c) => c.includes("--profile clickhouse") && c.includes(" up "))).toBe(
      true,
    );
    expect(
      composeCalls.some((c) => c.includes("--profile geoipupdate") && c.includes(" stop ")),
    ).toBe(true);
    expect(store.appliedManagedServices()).toEqual({ clickhouse: true, geoipupdate: false });
  });

  it("attempts every service even when one fails", async () => {
    // A missing MaxMind subscription must not also take analytics down.
    results.push({ exitCode: 0, stdout: "proj" }); // project detection
    results.push({ exitCode: 1, stdout: "no such image" }); // clickhouse up
    results.push({ exitCode: 0, stdout: "" }); // geoipupdate stop

    operations.applyManagedServices({
      services: { clickhouse: true, geoipupdate: false },
      env: {},
    });
    await settle();

    const status = store.managedServicesStatus();
    expect(status.state).toBe("failed");
    expect(status.message).toContain("clickhouse");
    // The one that worked is still recorded, so the next reconcile does not undo it.
    expect(store.appliedManagedServices()).toEqual({ clickhouse: false, geoipupdate: false });
  });

  it("refuses to run alongside a rebuild", async () => {
    operations.applyCaddyBuild(["mod"]);
    expect(() =>
      operations.applyManagedServices({
        services: { clickhouse: true, geoipupdate: false },
        env: {},
      }),
    ).toThrow(/caddy-build/);
  });
});
