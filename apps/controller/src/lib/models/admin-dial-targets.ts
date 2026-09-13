/**
 * Upstreams that could land on Caddy's own admin API, for every model that turns a stored target
 * into a Caddy `dial`. The dial leaves the Caddy container, which sits on the internal admin network,
 * so network isolation does nothing here: the model is the only place to refuse it.
 */

import db from "../db";
import { parseUpstreamTarget } from "../caddy-utils";
import { domainError } from "../domain-error";

const CADDY_ADMIN_PORT = 2019;

export async function isAdminActor(actorUserId: number): Promise<boolean> {
  const actor = await db.query.users.findFirst({
    where: (table, { eq }) => eq(table.id, actorUserId),
    columns: { role: true },
  });
  return actor?.role === "admin";
}

/**
 * Whether Caddy dialing this target could land on its own admin API. A placeholder is refused
 * because it can resolve to the admin port at request time, and a unix socket because the admin
 * listener can be one.
 */
export function isCaddyAdminDialTarget(target: string): boolean {
  const trimmed = target.trim();
  if (!trimmed) return false;
  if (trimmed.includes("{")) return true;
  if (/^unix/i.test(trimmed)) return true;
  const port = parseUpstreamTarget(trimmed.replace(/^[a-z0-9]+\/(?!\/)/i, "")).port;
  if (!port) return false;
  const range = port.match(/^(\d+)-(\d+)$/);
  if (range) return Number(range[1]) <= CADDY_ADMIN_PORT && CADDY_ADMIN_PORT <= Number(range[2]);
  return Number(port) === CADDY_ADMIN_PORT;
}

/**
 * An operator keeps upstream editing, but not a target that reaches the admin API, which would
 * expose the whole Caddy config through their host. Only newly added targets count, so an operator
 * can still save a host an admin pointed there.
 */
export async function assertNoNewAdminDialTargets(
  previous: readonly string[],
  proposed: readonly string[],
  actorUserId: number,
): Promise<void> {
  const kept = new Set(previous.map((target) => target.trim()));
  const added = proposed.filter(
    (target) => !kept.has(target.trim()) && isCaddyAdminDialTarget(target),
  );
  if (added.length === 0) return;
  if (!(await isAdminActor(actorUserId))) {
    throw domainError("upstreamTargetAdminOnly");
  }
}
