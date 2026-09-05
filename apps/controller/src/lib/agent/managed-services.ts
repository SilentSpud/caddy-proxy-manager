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

import { AGENT_ROUTES, type ManagedServicesRequest } from "@cpm/shared";
import { callOnEveryAgent } from "./client";
import { geoipEnabled } from "./geoip";
import { isAnalyticsEnabled } from "../clickhouse/client";

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
 * Never throws, for the same reason `pushFleetConfig` does not: the agent accepts this and works in
 * the background, so there is no success to wait for, and failing a settings save because one host
 * is down would leave the operator unable to save a setting that has nothing to do with that host.
 * The outcome is reported through the agent's status instead.
 */
export async function applyManagedServices(): Promise<void> {
  const body = await desiredManagedServices();
  try {
    const results = await callOnEveryAgent(AGENT_ROUTES.services, { method: "POST", body });
    for (const result of results) {
      if (!result.ok) {
        console.warn(
          `[agent] could not apply the optional services on ${result.agent}: ${result.error}`,
        );
      }
    }
  } catch {
    // No agent at all — a standalone binary, or a stack whose agent has not started. The operator
    // manages these containers themselves there, which is what COMPOSE_PROFILES is still for.
  }
}
