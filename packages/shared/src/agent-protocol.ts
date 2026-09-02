/**
 * The controller <-> agent contract.
 *
 * Today that contract is files on a shared volume: the controller writes a trigger, the agent acts
 * on it and writes back a status. The names live here because both sides hard-code them — the
 * controller in TypeScript, the agent in shell — and a rename that reaches only one side leaves the
 * controller waiting forever on a status the agent is writing under a different name.
 */

/** Filenames on the shared data volume, relative to the agent's DATA_DIR. */
export const AGENT_FILES = {
  l4Ports: {
    /** Compose override with the published ports enabled L4 hosts need. Controller writes. */
    override: "docker-compose.l4-ports.yml",
    /** Controller signals here; the agent deletes it once handled. */
    trigger: "l4-ports.trigger",
    /** Agent writes the outcome of the port apply. */
    status: "l4-ports.status",
  },
  caddyBuild: {
    /** DESIRED module list, carried into the build. Controller writes before triggering. */
    override: "docker-compose.caddy-build.yml",
    trigger: "caddy-build.trigger",
    status: "caddy-build.status",
    /**
     * APPLIED module list, written only after a build succeeds and caddy is healthy. The
     * controller treats it as the authority on what the running binary contains — distinct from
     * `override`, which is only ever a request.
     */
    applied: "caddy-build.applied.json",
  },
} as const;

/** Shared shape of both status files. `state` narrows per operation. */
export type AgentOperationStatus<TState extends string> = {
  state: TState;
  message?: string;
  appliedAt?: string;
  triggeredAt?: string;
  appliedHash?: string;
  error?: string;
};

export type L4PortsState = "idle" | "pending" | "applying" | "applied" | "failed";
export type CaddyBuildState = "idle" | "pending" | "building" | "applied" | "failed";

export type L4PortsStatus = AgentOperationStatus<L4PortsState>;
export type CaddyBuildStatus = AgentOperationStatus<CaddyBuildState>;
