/**
 * Which agents serve which hosts.
 *
 * The rule this file exists to keep in one place: **a host with no assignments is served by every
 * agent**. That is the pre-assignment behaviour, so an upgrade changes nothing, and it is also the
 * only sane reading of "unassigned" — a host nobody has placed still has to be served somewhere,
 * and silently serving it nowhere would take a site down the moment the feature shipped.
 *
 * Assignments name the `agents.id` row rather than the agent's self-asserted `agentId`, because a
 * host is placed on a paired agent an operator picked from a list, and that list is the table.
 */

import { and, eq, inArray } from "drizzle-orm";
import db, { nowIso } from "../db";
import { l4ProxyHostAgents, proxyHostAgents } from "../db/schema";

/** Which host table an assignment belongs to. */
export type HostKind = "http" | "l4";

const TABLES = {
  http: { table: proxyHostAgents, hostColumn: proxyHostAgents.proxyHostId },
  l4: { table: l4ProxyHostAgents, hostColumn: l4ProxyHostAgents.l4ProxyHostId },
} as const;

/**
 * Host id → the agent row ids it is pinned to.
 *
 * A host absent from the map has no assignments, which means every agent. Callers must go through
 * {@link servedByAgent} rather than reading the map directly, so that reading lives in one place.
 */
export type HostAssignments = Map<number, number[]>;

export async function listHostAssignments(kind: HostKind): Promise<HostAssignments> {
  const { table, hostColumn } = TABLES[kind];
  const rows = await db.select({ hostId: hostColumn, agentId: table.agentId }).from(table);

  const assignments: HostAssignments = new Map();
  for (const row of rows) {
    const bucket = assignments.get(row.hostId) ?? [];
    bucket.push(row.agentId);
    assignments.set(row.hostId, bucket);
  }
  for (const bucket of assignments.values()) bucket.sort((a, b) => a - b);
  return assignments;
}

/**
 * Whether `agentRowId` serves this host.
 *
 * `null` for the agent means "no particular agent" — the fleet-wide document a single-agent
 * deployment and every unit test build — and then every host is in.
 */
export function servedByAgent(
  assignments: HostAssignments,
  hostId: number,
  agentRowId: number | null,
): boolean {
  if (agentRowId === null) return true;
  const assigned = assignments.get(hostId);
  if (!assigned || assigned.length === 0) return true;
  return assigned.includes(agentRowId);
}

/** The agent row ids one host is pinned to. Empty means every agent. */
export async function agentIdsForHost(kind: HostKind, hostId: number): Promise<number[]> {
  const { table, hostColumn } = TABLES[kind];
  const rows = await db
    .select({ agentId: table.agentId })
    .from(table)
    .where(eq(hostColumn, hostId));
  return rows.map((row) => row.agentId).sort((a, b) => a - b);
}

/** The same, for a batch of hosts — one query rather than one per row on a list page. */
export async function agentIdsForHosts(
  kind: HostKind,
  hostIds: number[],
): Promise<HostAssignments> {
  if (hostIds.length === 0) return new Map();
  const { table, hostColumn } = TABLES[kind];
  const rows = await db
    .select({ hostId: hostColumn, agentId: table.agentId })
    .from(table)
    .where(inArray(hostColumn, hostIds));

  const assignments: HostAssignments = new Map();
  for (const row of rows) {
    const bucket = assignments.get(row.hostId) ?? [];
    bucket.push(row.agentId);
    assignments.set(row.hostId, bucket);
  }
  for (const bucket of assignments.values()) bucket.sort((a, b) => a - b);
  return assignments;
}

/**
 * Replace a host's assignments.
 *
 * Diffed rather than delete-then-insert: the two run as separate statements here, and a reader
 * between them would see the host as unassigned, which under the rule above means *every* agent —
 * a brief fleet-wide exposure of a host being narrowed to one node. Deleting only what is leaving
 * never passes through that state.
 */
export async function setHostAgents(
  kind: HostKind,
  hostId: number,
  agentRowIds: number[],
): Promise<void> {
  const { table, hostColumn } = TABLES[kind];
  const wanted = [...new Set(agentRowIds.filter((id) => Number.isInteger(id) && id > 0))];
  const current = await agentIdsForHost(kind, hostId);

  const removed = current.filter((id) => !wanted.includes(id));
  const added = wanted.filter((id) => !current.includes(id));

  if (removed.length > 0) {
    await db.delete(table).where(and(eq(hostColumn, hostId), inArray(table.agentId, removed)));
  }
  if (added.length > 0) {
    const now = nowIso();
    await db
      .insert(table)
      .values(
        added.map((agentId) =>
          kind === "http"
            ? { proxyHostId: hostId, agentId, createdAt: now }
            : { l4ProxyHostId: hostId, agentId, createdAt: now },
        ) as never,
      );
  }
}

/**
 * Parse an assignment list off a form or API payload.
 *
 * Anything unparseable becomes the empty list, which is "every agent" — the same thing the field
 * being absent means, so an older client that does not know about assignments keeps working.
 */
export function parseAgentIds(value: unknown): number[] {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  const ids: number[] = [];
  for (const entry of raw) {
    const id = typeof entry === "number" ? entry : Number.parseInt(String(entry).trim(), 10);
    if (Number.isInteger(id) && id > 0 && !ids.includes(id)) ids.push(id);
  }
  return ids.sort((a, b) => a - b);
}
