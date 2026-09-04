/**
 * Running the log parsers, and starting or stopping them as the controller's configuration changes.
 *
 * Analytics are optional, so this is entirely driven by what the controller pushes: credentials
 * start the parsers, `null` stops them, and a deployment that never enables analytics never opens
 * a log file at all.
 */

import type { FleetConfig } from "@cpm/shared";
import type { AgentStore } from "../db";
import { analyticsEnabled, closeAnalytics, configureAnalytics } from "./clickhouse";
import { syncGeoipDatabases } from "./geoip";
import {
  initLogParser,
  parseNewLogEntries,
  stopLogParser,
  bindStore as bindTrafficStore,
} from "./log-parser";
import {
  initWafLogParser,
  parseNewWafLogEntries,
  stopWafLogParser,
  bindStore as bindWafStore,
} from "./waf-log-parser";

/** How often each log is read. Matches what the controller used before this moved. */
const PARSE_INTERVAL_MS = 30_000;

let timers: NodeJS.Timeout[] = [];
let running = false;

/** How often the MaxMind databases are re-checked. They are published a couple of times a week. */
const GEOIP_REFRESH_MS = 24 * 60 * 60_000;

let geoipTimer: NodeJS.Timeout | null = null;

/**
 * Apply a pushed configuration.
 *
 * Idempotent: the controller pushes on every startup and whenever the settings change, and a
 * repeat of the configuration already in force must not restart a working parser.
 *
 * `controllerId` names which paired controller pushed this, so the GeoIP fetch — the one request
 * that runs the other way — can be signed with the secret shared with that controller.
 */
export async function applyFleetConfig(
  store: AgentStore,
  config: FleetConfig,
  controllerId: string,
): Promise<void> {
  bindTrafficStore(store);
  bindWafStore(store);

  await configureAnalytics(config.clickhouse);

  if (analyticsEnabled() && !running) await start();
  else if (!analyticsEnabled() && running) await stop();

  scheduleGeoipSync(store, config, controllerId);
}

/**
 * Fetch the GeoIP databases now, and daily after that.
 *
 * Skipped entirely when the controller offered none, and when this agent talks over a socket: that
 * agent shares the volume the databases are on, so it would be downloading a file it can already
 * see.
 */
function scheduleGeoipSync(store: AgentStore, config: FleetConfig, controllerId: string): void {
  if (geoipTimer) {
    clearInterval(geoipTimer);
    geoipTimer = null;
  }
  const geoip = config.geoip;
  if (!geoip || geoip.editions.length === 0) return;

  const secret = store.findController(controllerId)?.secret;
  if (!secret) return;
  const agentId = store.agentId();

  const run = () => {
    void syncGeoipDatabases(store, geoip, agentId, secret).catch((error: unknown) => {
      console.warn("[geoip] sync failed:", error);
    });
  };
  run();
  geoipTimer = setInterval(run, GEOIP_REFRESH_MS);
  geoipTimer.unref();
}

async function start(): Promise<void> {
  running = true;
  await initLogParser();
  await initWafLogParser();

  // Each tick is guarded: a parse that throws must not kill the interval and leave analytics
  // silently stopped for the life of the process.
  timers = [
    setInterval(() => {
      void parseNewLogEntries().catch((error: unknown) => {
        console.error("[analytics] access log parse failed:", error);
      });
    }, PARSE_INTERVAL_MS),
    setInterval(() => {
      void parseNewWafLogEntries().catch((error: unknown) => {
        console.error("[analytics] WAF log parse failed:", error);
      });
    }, PARSE_INTERVAL_MS),
  ];
  console.log("[analytics] log parsers started");
}

export async function stop(): Promise<void> {
  running = false;
  if (geoipTimer) {
    clearInterval(geoipTimer);
    geoipTimer = null;
  }
  for (const timer of timers) clearInterval(timer);
  timers = [];
  stopLogParser();
  stopWafLogParser();
  await closeAnalytics();
  console.log("[analytics] log parsers stopped");
}

/**
 * Resume from whatever the controller last pushed.
 *
 * Called at startup so an agent that restarts keeps writing analytics without waiting for the
 * controller to notice it came back.
 */
export async function resumeFleetConfig(store: AgentStore): Promise<void> {
  const stored = store.fleetConfig();
  if (!stored) return;
  // Whichever controller is paired: in managed mode there is exactly one, and in standalone mode
  // there is no GeoIP fetch to sign anyway.
  const controller = store.listControllers()[0];
  if (!controller) return;
  await applyFleetConfig(store, stored, controller.controllerId);
}
