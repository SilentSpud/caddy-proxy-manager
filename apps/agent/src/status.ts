/**
 * What this agent reports about itself.
 *
 * Its own module because two callers need it and neither should own it: the lifecycle pushes it to
 * the controller, and the local control routes serve it to `cpm-agent` on the host. It used to be
 * a closure inside the request handler, back when the controller asked for it.
 */

import type { AgentStatus, ManagedServiceName, ManagedServicesStatus } from "@cpm/shared";
import { accessLogPresent } from "./analytics/log-parser";
import { analyticsEnabled } from "./analytics/clickhouse";
import type { AgentConfig } from "./config";
import type { AgentStore } from "./db";
import type { DockerHost } from "./docker";
import pkg from "../package.json";

/**
 * Reported to the controller and printed by `--version`. Read from the workspace manifest so there
 * is one version to bump: this used to be a literal, and had drifted a minor release ahead of
 * anything that was ever published.
 */
export const AGENT_VERSION: string = pkg.version;

export type StatusDeps = {
  config: AgentConfig;
  store: AgentStore;
  docker: DockerHost;
};

export async function buildStatus({ config, store, docker }: StatusDeps): Promise<AgentStatus> {
  return {
    agentId: store.agentId(),
    version: AGENT_VERSION,
    mode: config.mode,
    composeProject: await docker.composeProject(),
    l4Ports: {
      applied: store.appliedL4Ports(),
      status: store.l4PortsStatus(),
    },
    caddyBuild: {
      applied: store.appliedCaddyModules(),
      status: store.caddyBuildStatus(),
    },
    services: {
      applied: store.appliedManagedServices() as Record<ManagedServiceName, boolean> | null,
      status: store.managedServicesStatus() as ManagedServicesStatus,
    },
    analytics: {
      enabled: analyticsEnabled(),
      accessLogPresent: accessLogPresent(),
    },
  };
}
