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

/**
 * Apply a pushed configuration.
 *
 * Idempotent: the controller pushes on every startup and whenever the settings change, and a
 * repeat of the configuration already in force must not restart a working parser.
 */
export async function applyFleetConfig(store: AgentStore, config: FleetConfig): Promise<void> {
  bindTrafficStore(store);
  bindWafStore(store);

  await configureAnalytics(config.clickhouse);

  if (analyticsEnabled() && !running) await start();
  else if (!analyticsEnabled() && running) await stop();
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
  await applyFleetConfig(store, stored);
}
