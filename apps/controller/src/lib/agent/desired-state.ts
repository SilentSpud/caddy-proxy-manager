/**
 * Everything the controller wants its agents to have, assembled from the settings that decide it.
 *
 * Computed rather than stored: each of these already has a source of truth — the proxy hosts decide
 * the ports, the Caddy build settings decide the modules, the analytics settings decide the fleet
 * config — and a second copy would be one more thing to keep in step. Cheap enough to rebuild on
 * every push, which is what makes "reconnect and re-send everything" a correct recovery path.
 */

import type { AgentDesiredState } from "@cpm/shared";
import { desiredManagedServices } from "./managed-services";
import { currentFleetConfig } from "./fleet-config";
import { getRequiredL4Ports } from "../l4-ports";
import { getCaddyBuildDiff } from "../caddy-build";
import { isSetupCompleted } from "../setup";
import { broadcastDesiredState } from "./registry";

export async function buildDesiredState(): Promise<AgentDesiredState> {
  const [l4Ports, buildDiff, services, fleetConfig, setupDone] = await Promise.all([
    getRequiredL4Ports(),
    getCaddyBuildDiff(),
    desiredManagedServices(),
    currentFleetConfig(),
    isSetupCompleted(),
  ]);

  return {
    l4Ports,
    caddyModules: buildDiff.desiredSpecs,
    services,
    fleetConfig,
    // Until first-run setup is finished there is no configuration to serve, and a Caddy answering
    // 80 and 443 with a default page is worse than one that is not listening. This is what holds a
    // freshly installed host shut.
    caddyEnabled: setupDone,
  };
}

/**
 * Recompute and push to every attached agent.
 *
 * Call after anything that changes what an agent should have. Fire-and-forget by design: a caller
 * saving a proxy host must not fail because one agent's stream had just dropped — the agent gets
 * the full state again the moment it reconnects.
 */
export async function pushDesiredState(): Promise<void> {
  try {
    broadcastDesiredState(await buildDesiredState());
  } catch (error) {
    console.warn("[cpm] could not push desired state to agents:", error);
  }
}
