/**
 * The two long-running operations, and the rule that only one may run at a time.
 *
 * Both end in `docker compose up caddy`, so overlapping them would have two recreates racing for
 * the same container — one of which would win with the other's overrides half-written. The lock is
 * process-wide because the agent is the only writer of these files on its host.
 */

import {
  MANAGED_SERVICES,
  type ManagedServiceName,
  type ManagedServicesRequest,
} from "@cpm/shared";
import {
  BUILD_OVERRIDE_FILE,
  composeEnv,
  type DockerHost,
  L4_OVERRIDE_FILE,
  renderCaddyBuildOverride,
  renderL4PortsOverride,
  tail,
  writeOverride,
} from "./docker";
import type { AgentConfig } from "./config";
import type { AgentStore } from "./db";

type OperationKind = "l4-ports" | "caddy-build" | "services";

export class OperationBusyError extends Error {
  constructor(readonly running: OperationKind) {
    super(`Another operation is already running: ${running}`);
    this.name = "OperationBusyError";
  }
}

export class Operations {
  private running: OperationKind | null = null;

  constructor(
    private readonly config: AgentConfig,
    private readonly store: AgentStore,
    private readonly docker: DockerHost,
  ) {}

  /**
   * Clear a status left mid-flight by a killed agent.
   *
   * Without this the UI spins forever on an operation that is provably not running — this process
   * has just started, so nothing it launched can still be in progress — with its button disabled
   * and no way back except editing the database by hand.
   */
  clearStaleStatuses(): void {
    const l4 = this.store.l4PortsStatus();
    if (l4.state === "applying" || l4.state === "pending") {
      this.store.setL4PortsStatus({
        state: "failed",
        message: "The agent restarted while applying port changes. Apply again to retry.",
        error: "Interrupted by an agent restart",
      });
    }
    const build = this.store.caddyBuildStatus();
    if (build.state === "building" || build.state === "pending") {
      this.store.setCaddyBuildStatus({
        state: "failed",
        message:
          "The agent restarted while rebuilding Caddy. The image was left unchanged; rebuild to try again.",
        error: "Interrupted by an agent restart",
      });
    }
    const services = this.store.managedServicesStatus();
    if (services.state === "applying" || services.state === "pending") {
      this.store.setManagedServicesStatus({
        state: "failed",
        message:
          "The agent restarted while starting the optional services. Save the settings again to retry.",
        error: "Interrupted by an agent restart",
      });
    }
  }

  /**
   * Reconcile the published ports with the ones this agent last applied.
   *
   * This runs at startup and is not bookkeeping — it is the only thing that keeps layer-4 routing
   * alive across a host reboot. The operator's `docker compose up` starts Caddy from the base
   * files, which do not include the generated port override, so a restarted stack comes up with
   * every L4 port unpublished. Nothing else would notice until someone opened the UI.
   *
   * With nothing recorded, Docker is adopted as the baseline instead: that is either this agent's
   * first run or a stack whose ports an operator manages by hand, and re-applying an empty list
   * over either would unpublish ports the agent never published.
   */
  async restorePublishedPorts(): Promise<void> {
    const recorded = this.store.appliedL4Ports();
    const published = await this.docker.publishedCaddyPorts();

    if (recorded.length === 0) {
      if (published.length > 0) this.store.setAppliedL4Ports(published);
      return;
    }

    // Compose's own spelling on both sides, both sorted, so this compares sets rather than text.
    const same =
      recorded.length === published.length && recorded.every((port, i) => port === published[i]);
    if (same) return;

    console.log(
      `[agent] Caddy is publishing ${published.length} port(s) but ${recorded.length} were applied; republishing`,
    );
    this.applyL4Ports(recorded);
  }

  private begin(kind: OperationKind): void {
    if (this.running) throw new OperationBusyError(this.running);
    this.running = kind;
  }

  // ─── L4 ports ──────────────────────────────────────────────────────────────

  /**
   * Publish a new port set on the Caddy container.
   *
   * Returns as soon as the work is accepted, not when it finishes: recreating a container takes
   * seconds and a rebuild takes minutes, and holding the controller's request open for either would
   * make its own HTTP client time out mid-operation.
   */
  applyL4Ports(ports: string[]): void {
    this.begin("l4-ports");
    const triggeredAt = new Date().toISOString();
    this.store.setL4PortsStatus({
      state: "applying",
      message: `Recreating Caddy with ${ports.length} published port(s).`,
      triggeredAt,
    });

    void this.runL4Ports(ports, triggeredAt).finally(() => {
      this.running = null;
    });
  }

  private async runL4Ports(ports: string[], triggeredAt: string): Promise<void> {
    try {
      writeOverride(this.config.dataDir, L4_OVERRIDE_FILE, renderL4PortsOverride(ports));

      const result = await this.docker.recreateCaddy();
      if (!result.ok) {
        const detail = tail(result.output, 5);
        this.store.setL4PortsStatus({
          state: "failed",
          message: `Could not recreate the Caddy container: ${detail}`,
          triggeredAt,
          error: detail,
        });
        return;
      }

      const health = await this.docker.waitForCaddyHealth(30);
      this.store.setAppliedL4Ports(ports);
      this.store.setL4PortsStatus({
        state: "applied",
        message:
          health === "healthy"
            ? `Caddy recreated and healthy with ${ports.length} published port(s).`
            : `Caddy recreated; its health check reports "${health}" and may still be starting.`,
        triggeredAt,
        appliedAt: new Date().toISOString(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.store.setL4PortsStatus({
        state: "failed",
        message: `Applying port changes failed: ${message}`,
        triggeredAt,
        error: message,
      });
    }
  }

  // ─── Caddy build ───────────────────────────────────────────────────────────

  applyCaddyBuild(modules: string[]): void {
    this.begin("caddy-build");
    const triggeredAt = new Date().toISOString();
    this.store.setCaddyBuildStatus({
      state: "building",
      message: `Rebuilding the Caddy image with ${modules.length} module(s). This can take several minutes.`,
      triggeredAt,
    });

    void this.runCaddyBuild(modules, triggeredAt).finally(() => {
      this.running = null;
    });
  }

  private async runCaddyBuild(modules: string[], triggeredAt: string): Promise<void> {
    try {
      writeOverride(this.config.dataDir, BUILD_OVERRIDE_FILE, renderCaddyBuildOverride(modules));

      const build = await this.docker.buildCaddy();
      if (!build.ok) {
        // Say what is still serving. After a failed rebuild the operator's first question is
        // whether the proxy just went down, and the answer is no: the old image is untouched.
        const detail = build.timedOut
          ? `The build was abandoned after ${this.config.buildTimeoutSeconds}s.`
          : tail(build.output, 10);
        const message = `Caddy image build failed; the running container was left untouched. ${detail}`;
        this.store.setCaddyBuildStatus({
          state: "failed",
          message,
          triggeredAt,
          error: detail,
        });
        return;
      }

      const up = await this.docker.recreateCaddy();
      if (!up.ok) {
        const detail = tail(up.output, 5);
        this.store.setCaddyBuildStatus({
          state: "failed",
          message: `Caddy was built, but recreating the container failed: ${detail}`,
          triggeredAt,
          error: detail,
        });
        return;
      }

      const health = await this.docker.waitForCaddyHealth();
      if (health !== "healthy") {
        // Unhealthy right after a module change usually means the running config references a
        // plugin the new binary no longer has, which Caddy refuses wholesale.
        const message =
          `Caddy was rebuilt but its health check reports "${health}". Check the Caddy ` +
          `container logs — a config referencing a removed module will fail to load.`;
        this.store.setCaddyBuildStatus({
          state: "failed",
          message,
          triggeredAt,
          error: `health=${health}`,
        });
        return;
      }

      // Recorded here and nowhere else: only after a successful build, recreate and health check
      // is the new module set genuinely in the running binary. Writing it earlier would tell the
      // controller a module is available while the old image is still serving.
      this.store.setAppliedCaddyModules(modules);
      this.store.setCaddyBuildStatus({
        state: "applied",
        message: "Caddy was rebuilt with the selected modules and is healthy.",
        triggeredAt,
        appliedAt: new Date().toISOString(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.store.setCaddyBuildStatus({
        state: "failed",
        message: `The rebuild failed: ${message}`,
        triggeredAt,
        error: message,
      });
    }
  }

  // ─── Optional services ─────────────────────────────────────────────────────

  /**
   * Reconcile which optional compose services are running with what the controller asked for.
   *
   * Reconciled every time rather than diffed against what was last applied, for the same reason
   * restorePublishedPorts exists: after a host reboot the operator's own `docker compose up` brings
   * the stack back without these profiles, so bookkeeping saying "clickhouse is on" would describe
   * a container that is not running. `up -d` and `stop` are both no-ops when the service is already
   * in the requested state, which makes reconciling cheaper than being clever about it.
   */
  applyManagedServices(request: ManagedServicesRequest): void {
    this.begin("services");
    const triggeredAt = new Date().toISOString();
    const wanted = MANAGED_SERVICES.filter((name) => request.services[name]);
    this.store.setManagedServicesStatus({
      state: "applying",
      message:
        wanted.length > 0
          ? `Starting ${wanted.join(" and ")}. The first start pulls the image, which can take a few minutes.`
          : "Stopping the optional services.",
      triggeredAt,
    });

    void this.runManagedServices(request, triggeredAt).finally(() => {
      this.running = null;
    });
  }

  private async runManagedServices(
    request: ManagedServicesRequest,
    triggeredAt: string,
  ): Promise<void> {
    try {
      // Handed to every invocation, `stop` included, so each resolves the project to the identical
      // configuration. Compose interpolates the whole file before deciding what to act on, so
      // varying these between calls makes it see a service as changed that nothing has touched.
      const env = composeEnv(request.env);

      const failures: string[] = [];
      const applied: Record<ManagedServiceName, boolean> = {
        clickhouse: false,
        geoipupdate: false,
      };

      for (const name of MANAGED_SERVICES) {
        const enable = request.services[name] === true;
        const result = enable
          ? await this.docker.startService(name, env)
          : await this.docker.stopService(name, env);

        if (result.ok) {
          applied[name] = enable;
          continue;
        }
        // Each service is independent, so one failing must not leave the other unattempted —
        // a missing MaxMind subscription should not also take analytics down.
        const detail = result.timedOut
          ? `abandoned after ${this.config.serviceTimeoutSeconds}s`
          : tail(result.output, 4);
        failures.push(`${name}: ${detail}`);
      }

      this.store.setAppliedManagedServices(applied);

      if (failures.length > 0) {
        const detail = failures.join("; ");
        this.store.setManagedServicesStatus({
          state: "failed",
          message: `Could not apply every optional service — ${detail}`,
          triggeredAt,
          error: detail,
        });
        return;
      }

      const running = MANAGED_SERVICES.filter((name) => applied[name]);
      this.store.setManagedServicesStatus({
        state: "applied",
        message:
          running.length > 0 ? `Running: ${running.join(", ")}.` : "The optional services are off.",
        triggeredAt,
        appliedAt: new Date().toISOString(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.store.setManagedServicesStatus({
        state: "failed",
        message: `Applying the optional services failed: ${message}`,
        triggeredAt,
        error: message,
      });
    }
  }
}
