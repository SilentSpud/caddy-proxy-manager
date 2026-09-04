/**
 * Handing agents what they need to reach the services that live with the controller.
 *
 * Pushed rather than fetched, so an agent needs no credential for the controller and the direction
 * of trust stays one-way: the controller reaches agents, never the reverse. Pushed on startup and
 * again whenever the settings behind it change, because an agent that came up while the controller
 * was down would otherwise sit with stale credentials until something else happened to touch it.
 */

import { AGENT_ROUTES, type FleetConfig } from "@cpm/shared";
import { analyticsCredentialsForAgents } from "../clickhouse/client";
import { callOnEveryAgent } from "./client";
import { geoipFleetConfig } from "./geoip";

/** What every agent should currently be configured with. */
export function currentFleetConfig(): FleetConfig {
  return { clickhouse: analyticsCredentialsForAgents(), geoip: geoipFleetConfig() };
}

/**
 * Push the current configuration to every agent.
 *
 * Never throws: analytics are optional, and an agent that cannot be reached is already reported as
 * unreachable everywhere else. Failing a settings save because one host is down would be worse
 * than the agent writing nothing until the next push.
 */
export async function pushFleetConfig(): Promise<void> {
  const config = currentFleetConfig();
  try {
    const results = await callOnEveryAgent(AGENT_ROUTES.fleetConfig, {
      method: "POST",
      body: config,
    });
    for (const result of results) {
      if (!result.ok) {
        console.warn(`[agent] could not configure ${result.agent}: ${result.error}`);
      }
    }
  } catch {
    // No agent at all. Normal for a deployment that has not started one.
  }
}
