/**
 * Caddy health monitoring: watches each agent's Caddy for a restart and reapplies its configuration.
 *
 * Per agent, never through one "primary": an agent answers only for its own Caddy, so what it says
 * may only ever cause work on that same agent. A lying agent can make this re-apply its own config,
 * at most once a minute, and nothing else in the fleet.
 *
 * A restart is detected by content: `caddy.ts` fingerprints what each Caddy serves right after it
 * accepts a load, and anything else on the wire later means that Caddy is no longer running what
 * this controller gave it - a recreated container with no autosave, the image's default Caddyfile,
 * or an edit from outside. Comparing the ETag or looking for an empty config cannot see any of
 * those: Caddy always serves an ETag, and its default Caddyfile is a perfectly non-empty config.
 */

import type { ConnectedAgent } from "./agent/registry";
import { connectedAgents } from "./agent/registry";
import {
  applyCaddyConfig,
  applyCaddyConfigToAgent,
  getCaddyLiveConfigHash,
  getLastAppliedConfigHash,
} from "./caddy";

type CaddyMonitorState = {
  isHealthy: boolean;
  /** Fingerprint of the config this Caddy was last seen serving. */
  lastConfigId: string | null;
  lastCheckTime: number;
  consecutiveFailures: number;
  lastReapplyAt: number;
  reapplyPending: boolean;
};

const HEALTH_CHECK_INTERVAL = 10000; // Check every 10 seconds
const MAX_CONSECUTIVE_FAILURES = 3; // Consider unhealthy after 3 failures
const REAPPLY_DELAY = 5000; // Wait 5 seconds after detecting restart before reapplying
/** Floor between re-applies to one Caddy, so one reporting an empty config forever stays cheap. */
const MIN_REAPPLY_INTERVAL = 60_000;

/** The Caddy reached with no agent attached: a development setup, or nothing paired yet. */
const DIRECT = "direct";

type Target = { key: string; agent: ConnectedAgent | null };

const states = new Map<string, CaddyMonitorState>();

let monitorInterval: NodeJS.Timeout | null = null;
let isMonitoring = false;

function targets(): Target[] {
  const agents = connectedAgents();
  if (agents.length === 0) return [{ key: DIRECT, agent: null }];
  return agents.map((agent) => ({ key: agent.agentId, agent }));
}

async function checkTarget(target: Target, now: number, reapplyDelayMs: number): Promise<void> {
  let state = states.get(target.key);
  if (!state) {
    state = {
      isHealthy: false,
      lastConfigId: null,
      lastCheckTime: 0,
      consecutiveFailures: 0,
      lastReapplyAt: 0,
      reapplyPending: false,
    };
    states.set(target.key, state);
  }
  state.lastCheckTime = now;
  const who = target.agent ? ` on ${target.agent.name}` : "";

  const currentConfigId = await getCaddyLiveConfigHash(target.agent?.agentId);

  if (currentConfigId === null) {
    // Caddy is not responding
    state.consecutiveFailures++;

    if (state.isHealthy && state.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      console.warn(
        `[CaddyMonitor] Caddy${who} appears to be down (${state.consecutiveFailures} consecutive failures)`,
      );
      state.isHealthy = false;
    }
    return;
  }

  // Caddy is responding
  state.consecutiveFailures = 0;
  state.isHealthy = true;

  // Detect a restart: this Caddy is serving something other than what it was given. Nothing to
  // compare against until a load of ours has landed on it - that case is the first sighting below.
  const appliedConfigId = getLastAppliedConfigHash(target.agent?.agentId);
  const hasRestarted = appliedConfigId !== null && currentConfigId !== appliedConfigId;

  // First sighting since this process started also re-applies: the startup apply usually ran before
  // any agent attached, so a running Caddy can still hold a config the previous release built (an
  // old forward-auth proof, say). lastConfigId stays null until a re-apply lands, so it retries.
  const firstSighting = state.lastConfigId === null;
  if (!hasRestarted && !firstSighting) {
    state.lastConfigId = currentConfigId;
    return;
  }

  if (state.reapplyPending) return;
  // Both paths count toward the floor: a first sighting whose re-apply fails stays a first sighting.
  if (now - state.lastReapplyAt < MIN_REAPPLY_INTERVAL) return;
  state.lastReapplyAt = now;
  state.reapplyPending = true;
  console.log(
    hasRestarted
      ? `[CaddyMonitor] Caddy restart detected${who}; reapplying its configuration shortly`
      : `[CaddyMonitor] Monitoring Caddy${who}; reapplying its configuration`,
  );

  const pending = state;
  // Wait a bit for Caddy to fully initialize
  setTimeout(async () => {
    try {
      // Only this agent's own document, built with snippets this same agent adapted.
      if (target.agent) await applyCaddyConfigToAgent(target.agent);
      else await applyCaddyConfig();
      pending.lastConfigId = await getCaddyLiveConfigHash(target.agent?.agentId);
      // A first sighting that landed is not a restart, so it must not hold back the next real one.
      if (!hasRestarted) pending.lastReapplyAt = 0;
    } catch (error) {
      // Will retry on a later health check
      console.error(`[CaddyMonitor] Failed to reapply configuration${who}:`, error);
    } finally {
      pending.reapplyPending = false;
    }
  }, reapplyDelayMs);
}

/**
 * The startup apply just loaded the direct Caddy, so its first sighting need not load it again.
 * Only the direct target: an agent that attaches later still gets its own first-sighting re-apply,
 * and a state for a target that is not live is dropped on the next pass.
 */
export function noteStartupApply(now = Date.now()): void {
  states.set(DIRECT, {
    isHealthy: true,
    lastConfigId: "startup",
    lastCheckTime: now,
    consecutiveFailures: 0,
    lastReapplyAt: 0,
    reapplyPending: false,
  });
}

/**
 * Whether the operator wants drift re-applied at all. Read on every pass rather than when the
 * monitor starts, so switching it off in Settings takes effect without a restart. Off is for a
 * controller sharing a Caddy it does not own, where two monitors would push their own idea of the
 * config at each other. Imported lazily like `updates.ts` does: the registry pulls in the settings
 * store, which the tests mock after this module is loaded.
 */
async function monitorEnabled(): Promise<boolean> {
  const [registry, { getSetting }] = await Promise.all([
    import("./settings/registry"),
    import("./settings/resolve"),
  ]);
  return getSetting(registry.caddyMonitorEnabled);
}

/** One pass over every Caddy. Exported so tests can drive it with no delay before the re-apply. */
export async function checkCaddyHealth(reapplyDelayMs = REAPPLY_DELAY): Promise<void> {
  if (!(await monitorEnabled())) return;
  const now = Date.now();
  const current = targets();
  const live = new Set(current.map((target) => target.key));
  for (const key of states.keys()) {
    if (!live.has(key)) states.delete(key);
  }
  await Promise.all(current.map((target) => checkTarget(target, now, reapplyDelayMs)));
}

/** Start monitoring Caddy health. */
export function startCaddyMonitoring(): void {
  if (isMonitoring) {
    console.log("[CaddyMonitor] Already monitoring");
    return;
  }

  console.log(
    `[CaddyMonitor] Starting Caddy health monitoring (interval: ${HEALTH_CHECK_INTERVAL}ms)`,
  );
  isMonitoring = true;

  // Do initial check immediately
  checkCaddyHealth().catch((error) => {
    console.error("[CaddyMonitor] Initial health check failed:", error);
  });

  // Set up periodic checks
  monitorInterval = setInterval(() => {
    checkCaddyHealth().catch((error) => {
      console.error("[CaddyMonitor] Health check failed:", error);
    });
  }, HEALTH_CHECK_INTERVAL);
}

/** Stop monitoring Caddy health. */
export function stopCaddyMonitoring(): void {
  if (!isMonitoring) {
    return;
  }

  console.log("[CaddyMonitor] Stopping Caddy health monitoring");
  isMonitoring = false;

  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
  }
}

/** Current monitoring state per Caddy, keyed by agentId (useful for debugging). */
export function getMonitorState(): Record<string, Readonly<CaddyMonitorState>> {
  return Object.fromEntries([...states].map(([key, state]) => [key, { ...state }]));
}

/** Test seam: forget every Caddy's state. */
export function resetCaddyMonitor(): void {
  states.clear();
}
