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
  options: { timeoutSeconds?: number } = {},
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

  constructor(private readonly config: AgentConfig) {}

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

    const result = await run([
      "docker",
      "inspect",
      "--format",
      '{{index .Config.Labels "com.docker.compose.project"}}',
      this.config.caddyContainerName,
    ]);
    const detected = result.ok ? result.output.trim() : "";
    this.detectedProject = detected.length > 0 ? detected : "caddy-proxy-manager";
    return this.detectedProject;
  }

  /**
   * The -f/-p/--env-file arguments every invocation shares.
   *
   * Both overrides are always included: a rebuild must not drop the published L4 ports, and a port
   * change must not rebuild Caddy without the module selection. Omitting either is how one
   * operation silently undoes the other.
   */
  private async composeArgs(): Promise<string[]> {
    const { composeDir, composeHostDir, composeSkipOverride, composeExtraFile, dataDir } =
      this.config;
    const args = ["-p", await this.composeProject()];

    // The daemon resolves relative bind-mount paths against the project directory, and the agent's
    // /compose mount is not where the host thinks the project is.
    if (composeHostDir) args.push("--project-directory", composeHostDir);
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

  async compose(argv: string[], options: { timeoutSeconds?: number } = {}) {
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
