/**
 * L4 port management.
 *
 * A layer-4 proxy host needs its port published on the Caddy container, and published ports are
 * fixed when a container is created — so this cannot be done over the Caddy admin API the way
 * everything else is. The controller works out which ports the enabled hosts need and asks the
 * agent to republish them; the agent owns the Docker socket and does the recreate.
 */

import crypto from "node:crypto";
import type { L4PortsStatus } from "@cpm/shared";
import { eq } from "drizzle-orm";
import db from "./db";
import { splitHostPort } from "./caddy-utils";
import { l4ProxyHosts } from "./db/schema";
import { isAgentAvailable, requestL4Ports, tryGetAgentStatus } from "./agent/client";

export type { L4PortsStatus };
export { isAgentAvailable };

export type L4PortsDiff = {
  currentPorts: string[];
  requiredPorts: string[];
  needsApply: boolean;
};

/** The ports that must be published on the Caddy container for every enabled L4 proxy host. */
export async function getRequiredL4Ports(): Promise<string[]> {
  const hosts = await db
    .select({
      listenAddress: l4ProxyHosts.listenAddress,
      protocol: l4ProxyHosts.protocol,
    })
    .from(l4ProxyHosts)
    .where(eq(l4ProxyHosts.enabled, true));

  const portSet = new Set<string>();
  for (const host of hosts) {
    // splitHostPort, not a trailing-colon match: an unbracketed IPv6 literal ends in something
    // that looks like a port, and publishing that number would open a port nobody asked for.
    const parsed = splitHostPort(host.listenAddress);
    if (!parsed) continue;
    const proto = host.protocol === "udp" ? "/udp" : "";
    // Docker publishes a port on every address family the network has; the listen address's own
    // host part is Caddy's business, inside the container.
    portSet.add(`${parsed.port}:${parsed.port}${proto}`);
  }

  return Array.from(portSet).sort();
}

/**
 * The ports the Caddy container currently publishes, as the agent reports them.
 *
 * Empty when there is no agent — which reads as "nothing is published", and makes every enabled L4
 * host show as needing an apply. That is the honest answer: without an agent nothing can be
 * published, and saying so is better than implying the ports are already up.
 */
export async function getAppliedL4Ports(): Promise<string[]> {
  const status = await tryGetAgentStatus();
  return status?.l4Ports.applied ?? [];
}

/** Hash of a port list, for change detection. */
function hashPorts(ports: string[]): string {
  return crypto.createHash("sha256").update(ports.join(",")).digest("hex").slice(0, 16);
}

/** Whether the current L4 proxy host config differs from what is published. */
export async function getL4PortsDiff(): Promise<L4PortsDiff> {
  const [requiredPorts, currentPorts] = await Promise.all([
    getRequiredL4Ports(),
    getAppliedL4Ports(),
  ]);
  return {
    currentPorts,
    requiredPorts,
    needsApply: hashPorts(requiredPorts) !== hashPorts(currentPorts),
  };
}

/**
 * Ask the agent to republish the ports the enabled hosts need.
 *
 * Returns as soon as the agent accepts the work, not when the container is back: a recreate takes
 * seconds and holding the request open for it would time out the browser rather than the operation.
 * The returned status is polled from there.
 */
export async function applyL4Ports(): Promise<L4PortsStatus> {
  return requestL4Ports(await getRequiredL4Ports());
}

/** The agent's last word on the port apply. */
export async function getL4PortsStatus(): Promise<L4PortsStatus> {
  const status = await tryGetAgentStatus();
  return status?.l4Ports.status ?? { state: "idle" };
}
