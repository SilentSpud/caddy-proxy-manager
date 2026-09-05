/**
 * The agent's own store: a SQLite file beside its socket.
 *
 * Deliberately small and deliberately local. It holds the two things that must survive a restart
 * and cannot be recovered from anywhere else — which controllers this agent trusts, and what the
 * last operation did — and nothing that the controller is the authority on. Anything the controller
 * knows is asked for again rather than cached here, so a divergence is impossible by construction.
 */

import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import type {
  CaddyBuildStatus,
  FleetConfig,
  L4PortsStatus,
  ManagedServiceName,
  ManagedServicesStatus,
} from "@cpm/shared";

export type PairedController = {
  controllerId: string;
  controllerName: string | null;
  secret: string;
  pairedAt: string;
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS controllers (
  controllerId   TEXT PRIMARY KEY,
  controllerName TEXT,
  secret         TEXT NOT NULL,
  pairedAt       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS state (
  key       TEXT PRIMARY KEY,
  value     TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

-- How far the log parsers have read. Its own table rather than more rows in state: these are
-- written on every parse tick, and keeping the hot rows apart from configuration makes it obvious
-- which of them is safe to delete when a log is rotated out from under the agent.
CREATE TABLE IF NOT EXISTS parse_state (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

const AGENT_ID_KEY = "agent_id";
const L4_STATUS_KEY = "l4_ports_status";
const BUILD_STATUS_KEY = "caddy_build_status";
const APPLIED_PORTS_KEY = "applied_l4_ports";
const APPLIED_MODULES_KEY = "applied_caddy_modules";
const FLEET_CONFIG_KEY = "fleet_config";
const SERVICES_STATUS_KEY = "managed_services_status";
const APPLIED_SERVICES_KEY = "applied_managed_services";

export class AgentStore {
  private readonly db: Database;

  constructor(path: string) {
    mkdirSync(dirname(resolve(path)), { recursive: true });
    this.db = new Database(path, { create: true });
    // WAL so a long-running rebuild writing progress cannot block a status read.
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  // ─── Identity ──────────────────────────────────────────────────────────────

  /**
   * This agent's stable id, minted on first start.
   *
   * Survives restarts so a paired controller keeps recognising the same agent across upgrades; a
   * new id would read to the controller as a different machine at the same address.
   */
  agentId(): string {
    const existing = this.readState(AGENT_ID_KEY);
    if (existing) return existing;
    const id = randomBytes(16).toString("hex");
    this.writeState(AGENT_ID_KEY, id);
    return id;
  }

  // ─── Pairing ───────────────────────────────────────────────────────────────

  listControllers(): PairedController[] {
    return this.db
      .query("SELECT controllerId, controllerName, secret, pairedAt FROM controllers")
      .all() as PairedController[];
  }

  findController(controllerId: string): PairedController | null {
    const row = this.db
      .query(
        "SELECT controllerId, controllerName, secret, pairedAt FROM controllers WHERE controllerId = ?",
      )
      .get(controllerId) as PairedController | null;
    return row ?? null;
  }

  /**
   * Record a controller's secret, replacing any it already had.
   *
   * Replacing rather than rejecting is what makes re-pairing a recovery path: a controller that
   * lost its secret (a rebuilt volume, a restored backup) can pair again with a fresh code instead
   * of needing the agent's database edited by hand.
   */
  upsertController(entry: {
    controllerId: string;
    controllerName: string | null;
    secret: string;
  }): PairedController {
    const pairedAt = new Date().toISOString();
    this.db
      .query(
        `INSERT INTO controllers (controllerId, controllerName, secret, pairedAt)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(controllerId) DO UPDATE SET
           controllerName = excluded.controllerName,
           secret         = excluded.secret,
           pairedAt       = excluded.pairedAt`,
      )
      .run(entry.controllerId, entry.controllerName, entry.secret, pairedAt);
    return { ...entry, pairedAt };
  }

  // ─── Operation state ───────────────────────────────────────────────────────

  l4PortsStatus(): L4PortsStatus {
    return this.readJson<L4PortsStatus>(L4_STATUS_KEY) ?? { state: "idle" };
  }

  setL4PortsStatus(status: L4PortsStatus): void {
    this.writeState(L4_STATUS_KEY, JSON.stringify(status));
  }

  caddyBuildStatus(): CaddyBuildStatus {
    return this.readJson<CaddyBuildStatus>(BUILD_STATUS_KEY) ?? { state: "idle" };
  }

  setCaddyBuildStatus(status: CaddyBuildStatus): void {
    this.writeState(BUILD_STATUS_KEY, JSON.stringify(status));
  }

  managedServicesStatus(): ManagedServicesStatus {
    return this.readJson<ManagedServicesStatus>(SERVICES_STATUS_KEY) ?? { state: "idle" };
  }

  setManagedServicesStatus(status: ManagedServicesStatus): void {
    this.writeState(SERVICES_STATUS_KEY, JSON.stringify(status));
  }

  /**
   * Which optional services this agent last brought up, or null before it has been asked.
   *
   * Null and "both false" are different answers: the first means the controller has never spoken
   * about these, so whatever the operator started by hand with COMPOSE_PROFILES is still theirs to
   * own. The second means the controller asked for them off, and they are.
   */
  appliedManagedServices(): Record<ManagedServiceName, boolean> | null {
    return this.readJson<Record<ManagedServiceName, boolean>>(APPLIED_SERVICES_KEY);
  }

  setAppliedManagedServices(services: Record<ManagedServiceName, boolean>): void {
    this.writeState(APPLIED_SERVICES_KEY, JSON.stringify(services));
  }

  /**
   * The ports currently published on the Caddy container.
   *
   * Recorded here rather than parsed back out of the generated compose override: the override is
   * what the *next* recreate will use, so reading it would report a requested change as already
   * applied. This key is written only once a recreate has succeeded.
   */
  appliedL4Ports(): string[] {
    return this.readJson<string[]>(APPLIED_PORTS_KEY) ?? [];
  }

  setAppliedL4Ports(ports: string[]): void {
    this.writeState(APPLIED_PORTS_KEY, JSON.stringify(ports));
  }

  /**
   * The xcaddy specs the running binary was built with. Same reasoning as appliedL4Ports, and more
   * load-bearing: the controller refuses to emit config for a module outside this list, because
   * Caddy rejects a document naming an unknown module in full.
   *
   * Null means "never rebuilt", which the controller reads as the shipped image's full catalog.
   */
  appliedCaddyModules(): string[] | null {
    return this.readJson<string[]>(APPLIED_MODULES_KEY);
  }

  setAppliedCaddyModules(modules: string[]): void {
    this.writeState(APPLIED_MODULES_KEY, JSON.stringify(modules));
  }

  // ─── Fleet configuration ───────────────────────────────────────────────────

  /**
   * The credentials the controller last pushed, or null before it has pushed any.
   *
   * Persisted so the agent keeps writing analytics across a restart without waiting for the
   * controller to notice it came back. Stored as it arrived: this file already holds the pairing
   * secrets that grant container control on this host, so a database password beside them changes
   * nothing about what an attacker with read access to the volume already has.
   */
  fleetConfig(): FleetConfig | null {
    return this.readJson<FleetConfig>(FLEET_CONFIG_KEY);
  }

  setFleetConfig(config: FleetConfig): void {
    this.writeState(FLEET_CONFIG_KEY, JSON.stringify(config));
  }

  // ─── Log parse offsets ─────────────────────────────────────────────────────

  parseState(key: string): string | null {
    const row = this.db.query("SELECT value FROM parse_state WHERE key = ?").get(key) as {
      value: string;
    } | null;
    return row?.value ?? null;
  }

  setParseState(key: string, value: string): void {
    this.db
      .query(
        `INSERT INTO parse_state (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(key, value);
  }

  // ─── Key/value plumbing ────────────────────────────────────────────────────

  private readState(key: string): string | null {
    const row = this.db.query("SELECT value FROM state WHERE key = ?").get(key) as {
      value: string;
    } | null;
    return row?.value ?? null;
  }

  private readJson<T>(key: string): T | null {
    const raw = this.readState(key);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      // A row this process wrote should always parse. If it does not, the file has been edited or
      // truncated, and the honest answer is "no value" rather than a crash on every status read.
      console.warn(`[agent] discarding unparseable state row "${key}"`);
      return null;
    }
  }

  private writeState(key: string, value: string): void {
    this.db
      .query(
        `INSERT INTO state (key, value, updatedAt) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt`,
      )
      .run(key, value, new Date().toISOString());
  }
}
