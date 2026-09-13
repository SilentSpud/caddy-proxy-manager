/**
 * Caddy health monitoring: watches each agent's Caddy for a restart and reapplies its configuration.
 *
 * Per agent, never through one "primary": an agent answers only for its own Caddy, so what it says
 * may only ever cause work on that same agent. A lying agent can make this re-apply its own config,
 * at most once a minute, and nothing else in the fleet.
 */

import type { ConnectedAgent } from "./agent/registry";
import { connectedAgents } from "./agent/registry";
import { caddyAdminRequest } from "./caddy-admin";
import { applyCaddyConfig, applyCaddyConfigToAgent } from "./caddy";

type CaddyMonitorState = {
  isHealthy: boolean;
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

/**
 * The current Caddy config ID from one admin API, used to detect a restart (the ID changes).
 */
async function getCaddyConfigId(agentId?: string): Promise<string | null> {
  try {
    const response = await caddyAdminRequest({
      path: "/config/",
      method: "GET",
      timeoutMs: 5000,
      agentId,
    });

    if (response.status < 200 || response.status >= 300) {
      return null;
    }

    // Use ETag or compute a simple hash from the response
    const etag = response.headers.etag;
    if (typeof etag === "string" && etag) {
      return etag;
    }

    // Fallback: use the config object's structure
    const configData = JSON.parse(response.text);
    // Check if config is essentially empty (default state after restart)
    const isEmpty = !configData.apps || Object.keys(configData.apps).length === 0;
    return isEmpty ? "empty" : "configured";
  } catch {
    // Network error or timeout
    return null;
  }
}

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

  const currentConfigId = await getCaddyConfigId(target.agent?.agentId);

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
  const wasUnhealthy = !state.isHealthy;
  state.consecutiveFailures = 0;
  state.isHealthy = true;

  // Detect restart: config ID changed to "empty" or Caddy was previously unhealthy
  const hasRestarted =
    (state.lastConfigId !== null && currentConfigId === "empty") ||
    (wasUnhealthy && currentConfigId === "empty");

  // First sighting since this process started also re-applies: the startup apply usually ran before
  // any agent attached, so a running Caddy can still hold a config the previous release built (an
  // old forward-auth proof, say). lastConfigId stays null until a re-apply lands, so it retries.
  const firstSighting = state.lastConfigId === null;
  if (!hasRestarted && !firstSighting) {
    state.lastConfigId = currentConfigId;
    return;
  }

  if (state.reapplyPending) return;
  // Only restarts count toward the floor; a first sighting happens once per attach.
  if (hasRestarted) {
    if (now - state.lastReapplyAt < MIN_REAPPLY_INTERVAL) return;
    state.lastReapplyAt = now;
  }
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
      pending.lastConfigId = await getCaddyConfigId(target.agent?.agentId);
    } catch (error) {
      // Will retry on a later health check
      console.error(`[CaddyMonitor] Failed to reapply configuration${who}:`, error);
    } finally {
      pending.reapplyPending = false;
    }
  }, reapplyDelayMs);
}

/** One pass over every Caddy. Exported so tests can drive it with no delay before the re-apply. */
export async function checkCaddyHealth(reapplyDelayMs = REAPPLY_DELAY): Promise<void> {
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
