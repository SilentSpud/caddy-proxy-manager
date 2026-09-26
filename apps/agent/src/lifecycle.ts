/**
 * What the agent is doing, and the one place that decides it.
 *
 * Three states, and the transitions between them are the whole feature: an agent installed on a
 * host has nowhere to fetch a configuration from, so it comes up `idle` - Caddy stopped, ports 80
 * and 443 shut - and stays there until an operator runs `cpm-agent --pair`. Only once it has a
 * controller does it start Caddy, which makes "paired" and "serving traffic" the same state rather
 * than two an operator has to reconcile.
 *
 * Caddy is deliberately not started by compose (it sits behind a profile), so this class is the
 * only thing that starts it. Anything that bypasses this file gets a Caddy answering the internet
 * with a default page on a host nobody has finished installing.
 */

import {
  AGENT_BOOTSTRAP_FILE,
  AGENT_BOOTSTRAP_TOKEN_PATTERN,
  AGENT_RECONNECT_MAX_MS,
  AGENT_RECONNECT_MIN_MS,
  AGENT_STATUS_HEARTBEAT_MS,
  type AgentCommand,
  type AgentCommandResult,
  type AgentDesiredState,
  type AgentLifecycle as Lifecycle,
  type AgentLocalState,
  type AgentServerEvent,
  CADDY_VALIDATE_REFUSED_STATUS,
  type CaddyValidateRequest,
  type CertificateFileRequest,
  type LogReadRequest,
  type LogReadResponse,
  MANAGED_SERVICES,
  MAX_CADDY_CONFIG_BYTES,
  SHIPPED_CADDY_MODULES,
  type AgentLocalPairPreviewResponse,
} from "@cpm/shared";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { applyFleetConfig } from "./analytics/runner";
import {
  CaddyAdminUnreachable,
  forwardToCaddy,
  isAllowedAdminPath,
  loadsConfig,
  pinAdminListen,
} from "./caddy-admin";
import type { AgentConfig } from "./config";
import { ControllerClient, ControllerRejected } from "./controller-client";
import {
  ControllerAddressError,
  checkControllerTransport,
  normalizeControllerUrl,
  normalizePairingCode,
} from "./controller-url";
import type { AgentStore } from "./db";
import { type DockerHost, tail } from "./docker";
import { listCaddyCertificates, readCaddyCertificate } from "./certificates";
import {
  CONTAINER_LOG_CURSOR,
  MAX_LOG_LINES,
  logFileFor,
  parseContainerLogs,
  readLogFile,
} from "./logs";
import { OperationBusyError, type Operations } from "./operations";
import { AGENT_VERSION, buildStatus } from "./status";

export type LifecycleDeps = {
  config: AgentConfig;
  store: AgentStore;
  docker: DockerHost;
  operations: Operations;
  /**
   * End the process, for a restart the controller asked for. The entrypoint supplies its shutdown
   * so the socket and store are released first; a test supplies a spy.
   */
  exit?: (reason: string) => void;
};

/**
 * How often an idle agent looks for a bootstrap token the controller has not written yet.
 *
 * Frequent enough that a stack coming up together pairs itself in seconds, slow enough that an
 * agent which will never have one - every remote agent - spends nothing worth measuring on it.
 */
const BOOTSTRAP_POLL_MS = 3_000;

/** Same shape both entry points want back: the CLI prints it, the local route serialises it. */
export type PairOutcome = { ok: true } | { ok: false; error: string };

export class AgentLifecycle {
  private lifecycle: Lifecycle = "idle";
  private message: string | null = null;
  private client: ControllerClient | null = null;
  private secret: string | null = null;
  private controllerId: string | null = null;
  /** Aborts the live stream. Replaced on every (re)connect, nulled when idle. */
  private connection: AbortController | null = null;
  private stopped = false;
  /** What the controller last said it wanted. Null until the first frame arrives. */
  private desired: AgentDesiredState | null = null;
  /** Caddy being started again after the agent's own shutdown stopped it; see `start`. */
  private caddyRestore: Promise<void> | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  /** Polls for a bootstrap token that has not been written yet. Null unless idle and waiting. */
  private bootstrapWatch: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly deps: LifecycleDeps) {}

  // ─── Entry points ──────────────────────────────────────────────────────────

  /**
   * Resume a stored pairing, or take one from the command line, or idle.
   *
   * Stored pairing wins over configuration: a `--code` left in place after a successful pair would
   * otherwise re-pair on every restart, burning a code that is already spent and landing the agent
   * back in idle for no reason.
   */
  async start(): Promise<void> {
    const storedUrl = this.deps.store.pairedControllerUrl();
    const [storedController] = this.deps.store.listControllers();
    // Read once and cleared at once: it describes the last shutdown, and only this start acts on it.
    const restoreCaddy = this.deps.store.caddyStoppedForShutdown();
    this.deps.store.setCaddyStoppedForShutdown(false);

    if (storedUrl && storedController) {
      // Checked on resume too: a pairing stored before plain http to a public address was refused
      // must not keep carrying credentials over it. The pairing is kept, so opting in and
      // restarting resumes it.
      try {
        const warning = checkControllerTransport(storedUrl, this.deps.config.allowInsecureHttp);
        if (warning) console.warn(`[agent] ${warning}`);
      } catch (error) {
        if (!(error instanceof ControllerAddressError)) throw error;
        await this.goIdle(error.message);
        return;
      }
      this.adopt(storedUrl, storedController.controllerId, storedController.secret);
      console.log(`[agent] resuming pairing with ${storedUrl}`);
      // Before the controller answers, so a host that rebooted while its controller is unreachable
      // still serves. The controller's desired state still decides: if it has turned Caddy off,
      // the first reconcile stops it again.
      if (restoreCaddy) this.caddyRestore = this.startCaddy().catch(() => {});
      void this.run();
      return;
    }

    const { controllerUrl, pairingCode } = this.deps.config;
    const code = pairingCode ?? this.readBootstrapToken();
    if (controllerUrl && code) {
      const outcome = await this.pairWith(controllerUrl, code);
      if (!outcome.ok) {
        console.warn(`[agent] ${outcome.error}`);
        // A token found at boot can fail to redeem because the controller is still starting.
        this.rearmBootstrapWatch();
      }
      return;
    }

    await this.goIdle(
      controllerUrl
        ? "No pairing code. Run `cpm-agent --pair --host <controller> --code <code>`."
        : "No controller configured. Run `cpm-agent --pair --host <controller> --code <code>`.",
    );
    this.rearmBootstrapWatch();
  }

  /**
   * Keep looking for a bootstrap token whenever the agent lands in idle with a controller to pair
   * with.
   *
   * The bundled stack starts the agent and the controller together, and the controller writes the
   * bootstrap token as it boots. Reading it once meant losing that race left the agent idle
   * *forever* - Caddy never started, and the only clue was "No pairing code" on a stack the
   * operator never had to pair by hand. The same applies to an agent whose stored pairing the
   * controller no longer recognises: a rebuilt controller writes a fresh token, and an agent that
   * stopped watching would sit idle beside it. A remote agent has no such file and this finds
   * nothing, which costs one `existsSync` every few seconds and is the state it is already in. An
   * explicit `--code` opts out: that operator is pairing by hand.
   */
  private rearmBootstrapWatch(): void {
    const { controllerUrl, pairingCode } = this.deps.config;
    if (controllerUrl && !pairingCode) this.watchForBootstrapToken(controllerUrl);
  }

  /**
   * Wait for a bootstrap token to appear, then pair with it.
   *
   * Stops on the first success, and on `stop()`. Every failure is left to the next tick rather
   * than logged: the common one is the controller not being up yet, which is not worth a line
   * every few seconds on a stack that is still starting.
   */
  private watchForBootstrapToken(controllerUrl: string): void {
    if (this.bootstrapWatch) return;
    this.bootstrapWatch = setInterval(() => {
      if (this.stopped || this.lifecycle !== "idle") {
        this.clearBootstrapWatch();
        return;
      }
      const token = this.readBootstrapToken();
      if (!token) return;
      this.clearBootstrapWatch();
      void this.pairWith(controllerUrl, token).then((outcome) => {
        if (outcome.ok) return;
        // Redeeming a token can fail for a reason a retry fixes - the controller still starting -
        // so go back to watching rather than giving up the way the old single read did.
        console.warn(`[agent] ${outcome.error}`);
        if (!this.stopped && this.lifecycle === "idle") this.watchForBootstrapToken(controllerUrl);
      });
    }, BOOTSTRAP_POLL_MS);
  }

  private clearBootstrapWatch(): void {
    if (this.bootstrapWatch) clearInterval(this.bootstrapWatch);
    this.bootstrapWatch = null;
  }

  /**
   * A token the controller left on its data volume, for the agent in its own stack.
   *
   * Only ever read here, and only when there is no stored pairing: reaching this file means
   * mounting the controller's volume, which is the same host and the same trust boundary. The
   * bundled agent mounts it read-only and reads the token through the controller's group. An agent
   * on another host has no such file and pairs with a code an operator carries instead.
   *
   * Not treated as a failure when absent - that is the normal state for every remote agent.
   */
  private readBootstrapToken(): string | null {
    const { controllerDataDir, dataDir } = this.deps.config;
    const path = join(controllerDataDir ?? dataDir, AGENT_BOOTSTRAP_FILE);
    try {
      if (!existsSync(path)) return null;
      const token = readFileSync(path, "utf-8").trim();
      return AGENT_BOOTSTRAP_TOKEN_PATTERN.test(token) ? token : null;
    } catch {
      // Unreadable is the same as absent: pair with a typed code instead.
      return null;
    }
  }

  /**
   * Hand a running agent its controller and code - what `cpm-agent --pair` reaches.
   *
   * Validation happens here rather than in the CLI so that a bad address is refused the same way
   * whether it arrived from a flag, an environment variable, or the local route.
   */
  async pair(host: string, port: number | null, code: string): Promise<PairOutcome> {
    let url: string;
    let normalizedCode: string;
    try {
      url = normalizeControllerUrl(host, port);
      normalizedCode = normalizePairingCode(code);
      const warning = checkControllerTransport(url, this.deps.config.allowInsecureHttp);
      if (warning) console.warn(`[agent] ${warning}`);
    } catch (error) {
      if (error instanceof ControllerAddressError) return { ok: false, error: error.message };
      throw error;
    }
    return this.pairWith(url, normalizedCode);
  }

  /**
   * Who `pair` would pair with, asked before it runs so `cpm-agent --pair` can confirm by name.
   *
   * Validates the address and code exactly as `pair` does, and touches no state: the stream, the
   * stored pairing and the lifecycle are all left as they are, so answering "no" changes nothing.
   */
  async previewPair(
    host: string,
    port: number | null,
    code: string,
  ): Promise<AgentLocalPairPreviewResponse> {
    let url: string;
    let normalizedCode: string;
    try {
      url = normalizeControllerUrl(host, port);
      normalizedCode = normalizePairingCode(code);
      checkControllerTransport(url, this.deps.config.allowInsecureHttp);
    } catch (error) {
      if (error instanceof ControllerAddressError) return { ok: false, error: error.message };
      throw error;
    }

    const agentId = this.deps.store.agentId();
    try {
      const preview = await new ControllerClient(url, agentId).previewPair({
        code: normalizedCode,
        agentId,
      });
      return {
        ok: true,
        controllerUrl: url,
        controllerName: preview?.controllerName ?? null,
        controllerId: preview?.controllerId ?? null,
        repair: preview?.repair ?? false,
      };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async localState(): Promise<AgentLocalState> {
    return {
      lifecycle: this.lifecycle,
      agentId: this.deps.store.agentId(),
      version: AGENT_VERSION,
      controllerUrl: this.client?.controllerUrl ?? this.deps.store.pairedControllerUrl(),
      caddy: {
        running: await this.deps.docker.caddyRunning().catch(() => false),
        allowed: this.caddyAllowed(),
      },
      message: this.message,
    };
  }

  /**
   * Stop Caddy as this agent shuts down, and remember that it did.
   *
   * The agent is what owns Caddy on this host, so Caddy does not outlive it. Bounded, because the
   * container is given a short grace period before it is killed, and a Docker daemon that is itself
   * shutting down may never answer. Never throws: the shutdown goes on either way.
   */
  async stopCaddyForShutdown(timeoutSeconds: number): Promise<void> {
    try {
      if (!(await this.deps.docker.caddyRunning())) return;
      console.log("[agent] stopping Caddy before shutting down");
      const result = await this.deps.docker.stopCaddy(timeoutSeconds);
      if (result.ok) {
        this.deps.store.setCaddyStoppedForShutdown(true);
      } else {
        console.error(
          result.timedOut
            ? `[agent] Caddy did not stop within ${timeoutSeconds}s; shutting down anyway`
            : `[agent] could not stop Caddy: ${result.output}`,
        );
      }
    } catch (error) {
      console.error("[agent] could not stop Caddy:", error);
    }
  }

  /** Tear the stream down and stop reconnecting. Leaves Caddy exactly as it is. */
  stop(): void {
    this.stopped = true;
    this.connection?.abort();
    this.connection = null;
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    // Cleared here as well as on the next tick: an interval still armed keeps the process alive
    // after a SIGTERM, which turns a clean shutdown into a ten-second wait for the kill.
    this.clearBootstrapWatch();
  }

  // ─── Pairing ───────────────────────────────────────────────────────────────

  private async pairWith(url: string, code: string): Promise<PairOutcome> {
    // Drop any live stream first: pairing to a second controller while still attached to the first
    // would leave two sources of desired state racing over one Caddy.
    this.connection?.abort();
    this.connection = null;
    this.lifecycle = "pairing";
    this.message = `Pairing with ${url}…`;

    const store = this.deps.store;
    const client = new ControllerClient(url, store.agentId());

    try {
      const response = await client.pair({
        code,
        agentId: store.agentId(),
        agentName: this.deps.config.caddyContainerName,
        agentVersion: AGENT_VERSION,
      });

      store.upsertController({
        controllerId: response.controllerId,
        controllerName: response.controllerName,
        secret: response.secret,
      });
      store.setPairedControllerUrl(url);
      this.adopt(url, response.controllerId, response.secret);
      console.log(`[agent] paired with ${response.controllerName} at ${url}`);
      void this.run();
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.goIdle(message);
      return { ok: false, error: message };
    }
  }

  private adopt(url: string, controllerId: string, secret: string): void {
    this.client = new ControllerClient(url, this.deps.store.agentId());
    this.controllerId = controllerId;
    this.secret = secret;
    this.lifecycle = "paired";
    this.message = null;
  }

  /**
   * Drop to idle and take Caddy down with it.
   *
   * Stopping Caddy is the point: an agent whose controller revoked it must not keep serving a
   * configuration nobody can change any more.
   */
  private async goIdle(message: string): Promise<void> {
    this.lifecycle = "idle";
    this.message = message;
    this.client = null;
    this.secret = null;
    this.controllerId = null;
    this.desired = null;
    this.connection?.abort();
    this.connection = null;
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    await this.stopCaddy("no controller is configured");
  }

  // ─── The stream ────────────────────────────────────────────────────────────

  /**
   * Stay attached to the controller, reconnecting for as long as the agent runs.
   *
   * Only a 401 breaks the loop: the controller has forgotten this agent, so the stored secret is
   * dead and retrying with it is a request that can never start succeeding. Everything else - a
   * controller being restarted, a network that came and went - is a reconnect with backoff, and
   * Caddy keeps serving the configuration it already has throughout.
   */
  private async run(): Promise<void> {
    let backoff = AGENT_RECONNECT_MIN_MS;
    this.startHeartbeat();

    while (!this.stopped && this.lifecycle === "paired") {
      const client = this.client;
      const secret = this.secret;
      if (!client || !secret) return;

      const connection = new AbortController();
      this.connection = connection;

      try {
        for await (const event of client.events(secret, connection.signal)) {
          backoff = AGENT_RECONNECT_MIN_MS;
          await this.handle(event);
        }
        // A clean end is still an end: the controller closed the stream, so reconnect.
      } catch (error) {
        if (connection.signal.aborted) return;
        if (error instanceof ControllerRejected && error.status === 401) {
          this.deps.store.clearPairing();
          await this.goIdle(
            "The controller no longer recognises this agent. Pair it again with a fresh code.",
          );
          this.rearmBootstrapWatch();
          return;
        }
        console.warn(`[agent] stream lost, retrying in ${Math.round(backoff / 1000)}s:`, error);
      }

      if (this.stopped || connection.signal.aborted) return;
      await Bun.sleep(backoff);
      backoff = Math.min(backoff * 2, AGENT_RECONNECT_MAX_MS);
    }
  }

  private async handle(event: AgentServerEvent): Promise<void> {
    switch (event.type) {
      case "hello":
        console.log(`[agent] attached to ${event.controllerName}`);
        void this.reportStatus();
        return;
      case "desired-state":
        await this.reconcile(event.state);
        return;
      case "command":
        await this.execute(event.command);
        return;
      case "restart":
        await this.restart(event.reason);
        return;
    }
  }

  /**
   * Restart Caddy, then this process.
   *
   * The controller sends this as it restarts itself after a migration, so the whole stack comes
   * back reading the database it now has rather than what each part read at boot. Caddy only when
   * it is running: before setup finishes it is not, and starting it here would answer 80 and 443
   * before the controller has said it may.
   *
   * The process exits rather than running `compose restart agent`: stopping this container ends
   * the compose command before it can start the container again, and an explicit stop is one
   * `restart: unless-stopped` does not undo. An exit it does.
   */
  private async restart(reason: string): Promise<void> {
    console.log(`[agent] restart requested: ${reason}`);
    if (await this.deps.docker.caddyRunning().catch(() => false)) {
      console.log("[agent] restarting Caddy");
      const result = await this.deps.docker.restartCaddy();
      if (!result.ok) console.error("[agent] could not restart Caddy:", result.output);
    }
    (this.deps.exit ?? (() => process.exit(0)))(reason);
  }

  // ─── Reconciliation ────────────────────────────────────────────────────────

  /**
   * Bring this host to what the controller asked for.
   *
   * Every branch is a diff against what is already applied, never an unconditional apply: the
   * controller repeats the full desired state on every reconnect, and acting on all of it would
   * rebuild Caddy's image every time a network blip dropped the stream.
   */
  private async reconcile(state: AgentDesiredState): Promise<void> {
    // A restore still starting Caddy must finish first: a "Caddy off" that ran alongside it would
    // find nothing running yet, do nothing, and leave Caddy coming up against the controller's word.
    if (this.caddyRestore) {
      await this.caddyRestore;
      this.caddyRestore = null;
    }
    this.desired = state;
    const { store, operations } = this.deps;

    if (!state.caddyEnabled) {
      await this.stopCaddy("the controller has it switched off");
    } else {
      await this.startCaddy();
    }

    try {
      if (!sameList(state.l4Ports, store.appliedL4Ports())) {
        operations.applyL4Ports(state.l4Ports);
      }

      // Null means "never rebuilt", so the running binary is the shipped image. Skipping the diff
      // there instead made the first rebuild on a fresh install impossible.
      const appliedModules = store.appliedCaddyModules() ?? [...SHIPPED_CADDY_MODULES];
      if (!sameList(state.caddyModules, appliedModules)) {
        operations.applyCaddyBuild(state.caddyModules);
      }

      const appliedServices = store.appliedManagedServices();
      if (!sameServices(state.services.services, appliedServices)) {
        operations.applyManagedServices(state.services);
      }
    } catch (busy) {
      if (busy instanceof OperationBusyError) {
        // The next desired-state frame reconciles whatever this one could not; a queue here would
        // only let a slow rebuild pile up work that is already superseded.
        console.log(`[agent] deferring: ${busy.running} is already running`);
      } else {
        throw busy;
      }
    }

    if (this.controllerId) {
      await applyFleetConfig(store, state.fleetConfig, this.controllerId).catch(
        (error: unknown) => {
          console.warn("[agent] could not apply the pushed fleet configuration:", error);
        },
      );
    }

    void this.reportStatus();
  }

  // ─── Commands ──────────────────────────────────────────────────────────────

  /**
   * Run one command and hand the answer back.
   *
   * Commands are the one thing in the protocol the controller blocks on: inverting the dial
   * direction is what forced them onto the stream rather than leaving them requests the controller
   * could simply make.
   */
  private async execute(command: AgentCommand): Promise<void> {
    const result = await this.runCommand(command);
    const client = this.client;
    const secret = this.secret;
    if (!client || !secret) return;
    await client.postResults(secret, [result]).catch((error: unknown) => {
      // Nothing to retry against: the controller times the command out on its own, and a result
      // arriving after that would resolve a waiter that has already been failed.
      console.warn(`[agent] could not return the result of command ${command.id}:`, error);
    });
  }

  private async runCommand(command: AgentCommand): Promise<AgentCommandResult> {
    if (command.kind === "caddy-validate") return this.runValidate(command.id, command.request);
    if (command.kind === "log-read") return this.runLogRead(command.id, command.request);
    if (command.kind === "certificate-list") return this.runCertificateList(command.id);
    if (command.kind === "certificate-read") {
      return this.runCertificateRead(command.id, command.request);
    }
    if (!isAllowedAdminPath(command.request.path)) {
      return {
        id: command.id,
        ok: false,
        code: "BAD_REQUEST",
        error: `"${command.request.path}" is not a Caddy admin path this agent will forward.`,
      };
    }
    if ((command.request.body?.length ?? 0) > MAX_CADDY_CONFIG_BYTES) {
      return { id: command.id, ok: false, code: "BAD_REQUEST", error: "The config is too large." };
    }

    let request = command.request;
    const listen = this.deps.config.caddyAdminListen;
    if (listen && request.body && loadsConfig(request)) {
      const body = pinAdminListen(request.body, listen);
      if (body === null) {
        return {
          id: command.id,
          ok: false,
          code: "BAD_REQUEST",
          error: "A config for Caddy must be a JSON object.",
        };
      }
      request = { ...request, body };
    }

    try {
      const response = await forwardToCaddy(this.deps.config.caddyApiUrl, request);
      return { id: command.id, ok: true, response };
    } catch (error) {
      const code = error instanceof CaddyAdminUnreachable ? "BUSY" : "INTERNAL";
      return {
        id: command.id,
        ok: false,
        code,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async runCertificateList(id: string): Promise<AgentCommandResult> {
    const certificates = await listCaddyCertificates(this.deps.docker);
    if (!certificates)
      return { id, ok: false, code: "BUSY", error: "Caddy's storage is unreadable." };
    return {
      id,
      ok: true,
      response: { status: 200, text: JSON.stringify(certificates), headers: {} },
    };
  }

  private async runCertificateRead(
    id: string,
    request: CertificateFileRequest,
  ): Promise<AgentCommandResult> {
    const files = await readCaddyCertificate(this.deps.docker, request);
    return files
      ? { id, ok: true, response: { status: 200, text: JSON.stringify(files), headers: {} } }
      : { id, ok: true, response: { status: 404, text: "", headers: {} } };
  }

  /** A page of a log for the controller's log viewer. The answer is JSON in a 200's text. */
  private async runLogRead(id: string, request: LogReadRequest): Promise<AgentCommandResult> {
    const answer = (page: LogReadResponse): AgentCommandResult => ({
      id,
      ok: true,
      response: { status: 200, text: JSON.stringify(page), headers: {} },
    });
    const file = logFileFor(request?.source);
    if (file) {
      try {
        return answer(await readLogFile(file, request));
      } catch (error) {
        return { id, ok: false, code: "INTERNAL", error: String(error) };
      }
    }
    if (request?.source !== "caddy") {
      return { id, ok: false, code: "BAD_REQUEST", error: "Unknown log source." };
    }
    // Only a timestamp: it becomes a docker CLI argument, and anything else could read as a flag.
    const cursor =
      typeof request.cursor === "string" && CONTAINER_LOG_CURSOR.test(request.cursor)
        ? request.cursor
        : null;
    const limit = Math.min(Math.max(Number(request.limit) || 200, 1), MAX_LOG_LINES);
    const logs = await this.deps.docker.caddyLogs({ since: cursor, tail: limit });
    if (!logs.ok) return { id, ok: false, code: "BUSY", error: tail(logs.output, 3) };
    return answer(parseContainerLogs(logs.output, cursor, limit));
  }

  /**
   * `caddy validate` for the controller. Not pinned like a load: nothing binds, and the container
   * it runs in has no network to bind on.
   */
  private async runValidate(
    id: string,
    request: CaddyValidateRequest,
  ): Promise<AgentCommandResult> {
    if (typeof request?.config !== "string" || request.config.length > MAX_CADDY_CONFIG_BYTES) {
      return { id, ok: false, code: "BAD_REQUEST", error: "The config is missing or too large." };
    }
    const validation = await this.deps.docker.validateCaddyConfig(request.config);
    if (validation.state === "unavailable") {
      return { id, ok: false, code: "BUSY", error: validation.reason };
    }
    const status = validation.state === "accepted" ? 200 : CADDY_VALIDATE_REFUSED_STATUS;
    return { id, ok: true, response: { status, text: validation.output, headers: {} } };
  }

  // ─── Caddy ─────────────────────────────────────────────────────────────────

  private caddyAllowed(): boolean {
    return this.lifecycle === "paired" && this.desired?.caddyEnabled === true;
  }

  private async startCaddy(): Promise<void> {
    if (await this.deps.docker.caddyRunning()) return;
    console.log("[agent] starting Caddy");
    const result = await this.deps.docker.startCaddy();
    if (!result.ok) console.error("[agent] could not start Caddy:", result.output);
  }

  private async stopCaddy(reason: string): Promise<void> {
    if (!(await this.deps.docker.caddyRunning().catch(() => false))) return;
    console.log(`[agent] stopping Caddy: ${reason}`);
    const result = await this.deps.docker.stopCaddy();
    if (!result.ok) console.error("[agent] could not stop Caddy:", result.output);
  }

  // ─── Status ────────────────────────────────────────────────────────────────

  /**
   * Push status on a slow timer as well as on change.
   *
   * The controller shows "last seen" from these, and an agent that changed nothing for an hour
   * would otherwise be indistinguishable from one whose host caught fire.
   */
  private startHeartbeat(): void {
    if (this.heartbeat) return;
    this.heartbeat = setInterval(() => void this.reportStatus(), AGENT_STATUS_HEARTBEAT_MS);
    this.heartbeat.unref();
  }

  private async reportStatus(): Promise<void> {
    const client = this.client;
    const secret = this.secret;
    if (!client || !secret) return;
    try {
      const status = await buildStatus(this.deps);
      await client.postStatus(secret, status);
    } catch (error) {
      // Status is advisory; the stream is what proves the agent is alive.
      console.warn("[agent] could not report status:", error);
    }
  }
}

/** Order-insensitive comparison: the controller sorts, but a stored list may predate that. */
function sameList(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((value, index) => value === right[index]);
}

function sameServices(
  wanted: Record<string, boolean>,
  applied: Record<string, boolean> | null,
): boolean {
  if (applied === null) return false;
  // Only what this agent manages: a controller of another version may name a service it does not,
  // and diffing that would re-apply on every frame.
  return MANAGED_SERVICES.every((name) => (wanted[name] ?? false) === (applied[name] ?? false));
}
