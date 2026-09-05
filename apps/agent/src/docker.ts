/**
 * Everything the agent does with Docker.
 *
 * This is the whole reason the agent exists as a separate container: the controller has no Docker
 * socket, and anything needing the Caddy *container* recreated — rather than its config reloaded
 * over the admin API — has to happen here. Two such things: published ports, which are fixed at
 * create time, and compiled-in plugins.
 */

import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ManagedServiceName, ManagedServicesRequest } from "@cpm/shared";
import type { AgentConfig } from "./config";

/** Files the agent generates for compose. Written by the agent now, not the controller. */
export const L4_OVERRIDE_FILE = "docker-compose.l4-ports.yml";
export const BUILD_OVERRIDE_FILE = "docker-compose.caddy-build.yml";

export type CommandResult = { ok: boolean; exitCode: number; output: string; timedOut: boolean };

/**
 * Run a command, capturing both streams as one transcript.
 *
 * Interleaved rather than separated because that transcript exists to be shown to an operator, and
 * a build failure's cause is routinely on stdout with the exit context on stderr.
 */
async function run(
  argv: string[],
  options: { timeoutSeconds?: number; env?: Record<string, string> } = {},
): Promise<CommandResult> {
  const controller = new AbortController();
  const timer = options.timeoutSeconds
    ? setTimeout(() => controller.abort(), options.timeoutSeconds * 1000)
    : null;

  try {
    const proc = Bun.spawn(argv, {
      stdout: "pipe",
      stderr: "pipe",
      signal: controller.signal,
      // Spread, because Bun replaces the environment wholesale rather than extending it — and
      // `docker` needs DOCKER_HOST from ours to find the socket proxy at all.
      env: options.env ? { ...process.env, ...options.env } : undefined,
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    const output = [stdout, stderr].filter((s) => s.trim().length > 0).join("\n");
    return { ok: exitCode === 0, exitCode, output, timedOut: false };
  } catch (error) {
    if (controller.signal.aborted) {
      return { ok: false, exitCode: 124, output: "", timedOut: true };
    }
    // Docker missing, or the socket unreachable. The message is the agent's own, never a remote's.
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, exitCode: -1, output: message, timedOut: false };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** The last few lines of a transcript, for a status field an operator reads in a toast. */
export function tail(output: string, lines: number): string {
  return output.split("\n").slice(-lines).join("\n").trim();
}

export class DockerHost {
  /** Cached because it comes from a container label that cannot change without a recreate. */
  private detectedProject: string | null = null;
  /** Same, for the host path the operator's own compose was run from. "" means "asked, none found". */
  private detectedHostDir: string | null = null;

  constructor(private readonly config: AgentConfig) {}

  /**
   * Read one compose label off the running Caddy container. Empty when it cannot be read.
   *
   * Bounded, unlike most inspects: this runs before every compose invocation, and an unresponsive
   * daemon would otherwise hold the operation lock with no timeout to end it. Both callers treat
   * an empty answer as "fall back", so giving up early costs nothing.
   */
  private async caddyLabel(label: string): Promise<string> {
    const result = await run(
      [
        "docker",
        "inspect",
        "--format",
        `{{index .Config.Labels "${label}"}}`,
        this.config.caddyContainerName,
      ],
      { timeoutSeconds: 15 },
    );
    return result.ok ? result.output.trim() : "";
  }

  /**
   * The compose project to operate on, read off the running Caddy container's labels.
   *
   * Detected rather than assumed: the project name comes from the directory the operator ran
   * `docker compose up` in, so hard-coding it would make the agent silently manage a project that
   * does not exist on any deployment whose directory is not called `caddy-proxy-manager`.
   */
  async composeProject(): Promise<string> {
    if (this.config.composeProject) return this.config.composeProject;
    if (this.detectedProject) return this.detectedProject;

    const detected = await this.caddyLabel("com.docker.compose.project");
    this.detectedProject = detected.length > 0 ? detected : "caddy-proxy-manager";
    return this.detectedProject;
  }

  /**
   * The project directory as the *host* knows it, for `--project-directory`.
   *
   * The daemon resolves a relative bind mount against the project directory, and `/compose` is a
   * path inside this container. Left unset, `./docker/clickhouse/low-disk-write.yml` resolves to a
   * host path that does not exist, and Docker silently creates an empty directory there — so the
   * service comes up without the config it was mounted, which is a wrong container rather than a
   * failed command.
   *
   * Caddy uses named volumes only, so this went unnoticed while recreating it was all the agent
   * did. Detected from the same container's labels as the project name, for the same reason:
   * asking the operator to set `COMPOSE_HOST_DIR` correctly is not a thing to depend on.
   */
  private async composeHostDir(): Promise<string> {
    if (this.config.composeHostDir) return this.config.composeHostDir;
    if (this.detectedHostDir !== null) return this.detectedHostDir;

    this.detectedHostDir = await this.caddyLabel("com.docker.compose.project.working_dir");
    return this.detectedHostDir;
  }

  /**
   * The -f/-p/--env-file arguments every invocation shares.
   *
   * Both overrides are always included: a rebuild must not drop the published L4 ports, and a port
   * change must not rebuild Caddy without the module selection. Omitting either is how one
   * operation silently undoes the other.
   */
  private async composeArgs(): Promise<string[]> {
    const { composeDir, composeSkipOverride, composeExtraFile, dataDir } = this.config;
    const args = ["-p", await this.composeProject()];

    // The daemon resolves relative bind-mount paths against the project directory, and the agent's
    // /compose mount is not where the host thinks the project is. See composeHostDir.
    const hostDir = await this.composeHostDir();
    if (hostDir) args.push("--project-directory", hostDir);
    // Supplied explicitly so required variables are available even when --project-directory points
    // at a host path this container cannot read.
    if (existsSync(join(composeDir, ".env"))) args.push("--env-file", join(composeDir, ".env"));

    args.push("-f", join(composeDir, "docker-compose.yml"));
    const override = join(composeDir, "docker-compose.override.yml");
    if (!composeSkipOverride && existsSync(override)) args.push("-f", override);
    if (composeExtraFile && existsSync(composeExtraFile)) args.push("-f", composeExtraFile);

    const buildOverride = join(dataDir, BUILD_OVERRIDE_FILE);
    if (existsSync(buildOverride)) args.push("-f", buildOverride);
    const portsOverride = join(dataDir, L4_OVERRIDE_FILE);
    if (existsSync(portsOverride)) args.push("-f", portsOverride);

    return args;
  }

  async compose(
    argv: string[],
    options: { timeoutSeconds?: number; env?: Record<string, string> } = {},
  ) {
    return run(["docker", "compose", ...(await this.composeArgs()), ...argv], options);
  }

  /** Recreate only the Caddy container, leaving everything else running. */
  async recreateCaddy(): Promise<CommandResult> {
    return this.compose(["up", "-d", "--no-deps", "--pull", "never", "--force-recreate", "caddy"]);
  }

  async buildCaddy(): Promise<CommandResult> {
    return this.compose(["build", "caddy"], {
      timeoutSeconds: this.config.buildTimeoutSeconds,
    });
  }

  /**
   * Poll the Caddy healthcheck until it passes or the budget runs out, returning the last status
   * seen. Both the port apply and the rebuild ask the same question — did it come back up — so
   * neither reports success on a container that started and immediately died.
   */
  async waitForCaddyHealth(timeoutSeconds = this.config.healthTimeoutSeconds): Promise<string> {
    const deadline = Date.now() + timeoutSeconds * 1000;
    let health = "unknown";
    while (Date.now() < deadline) {
      const result = await run([
        "docker",
        "inspect",
        "--format",
        "{{.State.Health.Status}}",
        this.config.caddyContainerName,
      ]);
      health = result.ok ? result.output.trim() : "unknown";
      if (health === "healthy") return health;
      await Bun.sleep(1000);
    }
    return health;
  }

  /**
   * Bring one optional service up, enabling its profile for this invocation.
   *
   * `--profile` rather than relying on compose auto-enabling the profile of a service named on the
   * command line: that behaviour arrived partway through v2 and is silently a "no such service"
   * error on anything older. `--no-deps` because these have no dependency the stack is not already
   * running, and pulling in the rest would recreate containers nobody asked to touch.
   *
   * No `--pull` flag, unlike recreateCaddy: a deployment that never ran the profile has no image
   * for it, so the implicit pull-if-missing is exactly what is wanted — and also why this takes a
   * timeout measured in minutes.
   *
   * `env` carries the credentials the compose file interpolates. Passed through the child's
   * environment rather than a generated `--env-file`, for two reasons: compose reads the process
   * environment at a higher precedence than any env file, so this overrides a stale value in the
   * project's own `.env` without the agent needing to write to a read-only mount — and a value
   * passed this way needs no quoting, where an env file would need escaping that compose's parser
   * defines differently for single and double quotes. It also keeps the password off disk.
   */
  async startService(
    service: ManagedServiceName,
    env: Record<string, string> = {},
  ): Promise<CommandResult> {
    return this.compose(["--profile", service, "up", "-d", "--no-deps", service], {
      timeoutSeconds: this.config.serviceTimeoutSeconds,
      env,
    });
  }

  /**
   * Stop one optional service, leaving its container and volume in place.
   *
   * `stop` rather than `down` or `rm`: turning analytics off must not be how someone discovers
   * their event history is gone. The data volume outlives the toggle.
   *
   * Still takes `env`, so every invocation resolves the project to the same configuration. Compose
   * interpolates the whole file before deciding what to act on, and a deployment whose compose file
   * still guards a credential with `${VAR:?}` — an override, or one shipped before this — would
   * otherwise fail here on a variable belonging to a service this command is not touching.
   */
  async stopService(
    service: ManagedServiceName,
    env: Record<string, string> = {},
  ): Promise<CommandResult> {
    return this.compose(["--profile", service, "stop", service], { timeoutSeconds: 120, env });
  }

  /** The ports Docker reports published on the running Caddy container, as compose spells them. */
  async publishedCaddyPorts(): Promise<string[]> {
    const result = await run([
      "docker",
      "inspect",
      "--format",
      "{{json .NetworkSettings.Ports}}",
      this.config.caddyContainerName,
    ]);
    if (!result.ok) return [];

    try {
      const parsed = JSON.parse(result.output.trim()) as Record<
        string,
        Array<{ HostPort?: string }> | null
      >;
      const ports = new Set<string>();
      for (const [spec, bindings] of Object.entries(parsed)) {
        if (!bindings || bindings.length === 0) continue;
        // Docker's key is "8080/tcp"; compose's short form is "8080:8080" or "53:53/udp".
        const [container, protocol] = spec.split("/");
        for (const binding of bindings) {
          if (!binding.HostPort) continue;
          ports.add(`${binding.HostPort}:${container}${protocol === "udp" ? "/udp" : ""}`);
        }
      }
      return Array.from(ports).sort();
    } catch {
      return [];
    }
  }
}

// ─── Generated compose files ─────────────────────────────────────────────────

export function renderL4PortsOverride(ports: string[]): string {
  if (ports.length === 0) {
    return `# Generated by the Caddy Proxy Manager agent — L4 port mappings
# No L4 proxy host requires an additional published port.
services: {}
`;
  }
  const lines = ports.map((port) => `      - "${port}"`).join("\n");
  return `# Generated by the Caddy Proxy Manager agent — L4 port mappings
# Do not edit: rewritten whenever the controller applies a port change.
services:
  caddy:
    ports:
${lines}
`;
}

export function renderCaddyBuildOverride(modules: string[]): string {
  return `# Generated by the Caddy Proxy Manager agent — Caddy module selection
# Do not edit: rewritten whenever the controller requests a rebuild.
services:
  caddy:
    build:
      args:
        CADDY_MODULES: "${modules.join(" ")}"
`;
}

export function writeOverride(dataDir: string, file: string, contents: string): void {
  writeFileSync(join(dataDir, file), contents, "utf-8");
}

/** Drop the unset entries, so an absent credential leaves compose to fall back to the `.env`. */
export function composeEnv(env: ManagedServicesRequest["env"]): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter(([, value]) => typeof value === "string" && value.length > 0),
  ) as Record<string, string>;
}
