/**
 * Starting and stopping the two optional containers from the Settings page.
 *
 * ClickHouse and geoipupdate sit behind Compose profiles, so whether they exist at all is decided
 * by `COMPOSE_PROFILES` on the host — outside the stack, before anything in it runs. Nothing the
 * controller can reach changes that, but the agent runs the Compose CLI, and `--profile` on one
 * invocation enables a profile for that invocation. That is the whole trick: the agent turns a
 * stored setting into `docker compose --profile clickhouse up -d clickhouse`.
 *
 * The credentials travel with the request because Compose interpolates them from the host `.env`,
 * which the agent mounts read-only and the controller has no access to at all. Sending them lets an
 * operator configure MaxMind and ClickHouse in one place — the Settings page — instead of keeping
 * the database and a file on the host in step by hand.
 */

import type { ManagedServicesRequest } from "@cpm/shared";
import { geoipEnabled } from "./geoip";
import { isAnalyticsEnabled } from "../clickhouse/client";
import { pushDesiredState } from "./desired-state";

/** What the optional services should currently be, from the settings alone. */
export async function desiredManagedServices(): Promise<ManagedServicesRequest> {
  const [registry, { getSetting }] = await Promise.all([
    import("../settings/registry"),
    import("../settings/resolve"),
  ]);

  const [analytics, geoip, user, password, database, accountId, licenseKey] = await Promise.all([
    isAnalyticsEnabled(),
    geoipEnabled(),
    getSetting(registry.clickhouseUser),
    getSetting(registry.clickhousePassword),
    getSetting(registry.clickhouseDb),
    getSetting(registry.geoipAccountId),
    getSetting(registry.geoipLicenseKey),
  ]);

  return {
    services: {
      clickhouse: analytics,
      // Without a subscription the container starts and fails its download in a loop, which reads
      // to an operator as a broken feature rather than an unconfigured one.
      geoipupdate: geoip && accountId.trim().length > 0 && licenseKey.trim().length > 0,
    },
    env: {
      CLICKHOUSE_USER: user,
      CLICKHOUSE_PASSWORD: password,
      CLICKHOUSE_DB: database,
      GEOIPUPDATE_ACCOUNT_ID: accountId,
      GEOIPUPDATE_LICENSE_KEY: licenseKey,
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
 * is also the answer for a deployment whose agent has not started — the operator manages those
 * containers themselves there, which is what COMPOSE_PROFILES is still for.
 */
export async function applyManagedServices(): Promise<void> {
  await pushDesiredState();
}
