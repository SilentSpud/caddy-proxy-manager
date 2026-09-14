/**
 * Starting and stopping the optional ClickHouse container from the Settings page.
 *
 * ClickHouse sits behind a Compose profile, so whether it exists at all is decided by
 * `COMPOSE_PROFILES` on the host - outside the stack, before anything in it runs. Nothing the
 * controller can reach changes that, but the agent runs the Compose CLI, and `--profile` on one
 * invocation enables a profile for that invocation. That is the whole trick: the agent turns a
 * stored setting into `docker compose --profile clickhouse up -d clickhouse`.
 *
 * The credentials travel with the request because Compose interpolates them from the host `.env`,
 * which the agent mounts read-only and the controller has no access to at all. Sending them lets an
 * operator configure ClickHouse in one place - the Settings page - instead of keeping the database
 * and a file on the host in step by hand.
 *
 * Only the agent in the controller's own stack is asked. ClickHouse lives with the controller, and
 * every other agent relays its events there, so an agent elsewhere has no use for the container or
 * for the password that starts it.
 */

import type { ManagedServicesRequest } from "@cpm/shared";
import { findAgentRowByAgentId } from "../models/agents";
import { isAnalyticsEnabled } from "../clickhouse/client";
import { bundledAgentId } from "./bootstrap";
import { pushDesiredState } from "./desired-state";

/**
 * Whether this agent is the one that runs the controller's services.
 *
 * With no record of which agent is bundled - paired before that was recorded, or that agent since
 * unpaired - every agent is asked, as before, rather than a deployment losing its ClickHouse.
 */
async function runsControllerServices(agentRowId: number): Promise<boolean> {
  const bundled = await bundledAgentId();
  const row = bundled ? await findAgentRowByAgentId(bundled) : null;
  return row === null || row.id === agentRowId;
}

/**
 * What the optional services should currently be, from the settings alone.
 *
 * `agentRowId` scopes it to one agent; omitted gives the answer for the agent that runs them.
 */
export async function desiredManagedServices(agentRowId?: number): Promise<ManagedServicesRequest> {
  if (agentRowId !== undefined && !(await runsControllerServices(agentRowId))) {
    return { services: { clickhouse: false }, env: {} };
  }

  const [registry, { getSetting }] = await Promise.all([
    import("../settings/registry"),
    import("../settings/resolve"),
  ]);

  const [analytics, user, password, database] = await Promise.all([
    isAnalyticsEnabled(),
    getSetting(registry.clickhouseUser),
    getSetting(registry.clickhousePassword),
    getSetting(registry.clickhouseDb),
  ]);

  return {
    services: { clickhouse: analytics },
    env: {
      CLICKHOUSE_USER: user,
      CLICKHOUSE_PASSWORD: password,
      CLICKHOUSE_DB: database,
    },
  };
}

/**
 * Ask every agent to reconcile its optional services with the current settings.
 *
 * Desired state now, like everything else the controller wants: the services travel in the same
 * frame as the ports and the modules, and the agent reconciles at its own pace. Kept as its own
 * function because the callers name what changed, not how it is delivered.
 *
 * Never throws. An agent that is not attached gets the whole state the moment it reconnects, which
 * is also the answer for a deployment whose agent has not started - the operator manages the
 * container themselves there, which is what COMPOSE_PROFILES is still for.
 */
export async function applyManagedServices(): Promise<void> {
  await pushDesiredState();
}
