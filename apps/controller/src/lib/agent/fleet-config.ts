/**
 * Handing agents what they need to reach the services that live with the controller.
 *
 * Travels as part of desired state, so it is sent when an agent attaches and again whenever the
 * settings behind it change — an agent that came up while the controller was down would otherwise
 * sit with stale credentials until something else happened to touch it.
 */

import type { FleetConfig } from "@cpm/shared";
import { analyticsCredentialsForAgents } from "../clickhouse/client";
import { geoipFleetConfig } from "./geoip";
import { pushDesiredState } from "./desired-state";

/** What every agent should currently be configured with. */
export async function currentFleetConfig(): Promise<FleetConfig> {
  const [clickhouse, geoip] = await Promise.all([
    analyticsCredentialsForAgents(),
    geoipFleetConfig(),
  ]);
  return { clickhouse, geoip };
}

/**
 * Push the current configuration to every agent.
 *
 * Now just desired state: the fleet config travels with the ports, modules and services in one
 * frame, so there is nothing left here but the recompute-and-broadcast every other setting does.
 * Kept as its own function because a dozen callers name it, and what they mean — "the analytics
 * credentials changed" — is still true.
 *
 * Never throws. An agent that is not attached gets the whole state the moment it reconnects.
 */
export async function pushFleetConfig(): Promise<void> {
  await pushDesiredState();
}
