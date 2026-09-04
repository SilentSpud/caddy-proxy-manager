/**
 * Agents this controller has paired with, and the identity it pairs as.
 *
 * A row here is a standing grant: whoever holds the secret can recreate containers on that host.
 * So the secret is encrypted at rest, never leaves the server in any shape, and the only way to
 * create a row is to complete a pairing exchange with a code the agent itself issued.
 */

import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import db, { nowIso } from "../db";
import { agents } from "../db/schema";
import { decryptSecret, encryptSecret } from "../secret";
import { getSetting, setSetting } from "../settings";

/** Setting holding this controller's stable id, as agents know it. */
const CONTROLLER_ID_KEY = "controller_id";

export type PairedAgent = {
  id: number;
  name: string;
  address: string;
  agentId: string | null;
  enabled: boolean;
  lastSeenAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

/** A paired agent with the secret needed to talk to it. Server-side only. */
export type AgentCredentials = PairedAgent & { secret: string };

type Row = typeof agents.$inferSelect;

/** Strip the secret. Everything that leaves this module for a page or an API goes through here. */
function toView(row: Row): PairedAgent {
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    agentId: row.agentId,
    enabled: row.enabled,
    lastSeenAt: row.lastSeenAt,
    lastError: row.lastError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * This controller's stable id, minted on first use.
 *
 * Agents key their stored secrets on it, so it has to outlive restarts: a new id would make every
 * previously paired agent refuse this controller, with no way back but re-pairing each one by hand.
 */
export async function getControllerId(): Promise<string> {
  const existing = await getSetting<string>(CONTROLLER_ID_KEY);
  if (typeof existing === "string" && existing.length > 0) return existing;

  const id = randomBytes(16).toString("hex");
  await setSetting(CONTROLLER_ID_KEY, id);
  return id;
}

export async function listAgents(): Promise<PairedAgent[]> {
  const rows = await db.select().from(agents).orderBy(agents.id);
  return rows.map(toView);
}

/**
 * The agent the controller should be talking to, with its secret.
 *
 * Exactly one enabled agent is used. The table holds several so a deployment can keep a disabled
 * one it is about to switch back to, but nothing fans out to more than one yet — see
 * docs/overhaul-plan.md for why that is a larger decision than it looks.
 */
export async function getActiveAgent(): Promise<AgentCredentials | null> {
  const [row] = await db.select().from(agents).where(eq(agents.enabled, true)).limit(1);
  if (!row) return null;

  try {
    return { ...toView(row), secret: decryptSecret(row.secret) };
  } catch (error) {
    // The secret was encrypted under a SESSION_SECRET this process no longer has. Re-pairing is
    // the only fix, and reporting "no agent" is what puts that in front of the operator.
    console.error(`Failed to decrypt the secret for agent "${row.name}":`, error);
    return null;
  }
}

export async function saveAgent(input: {
  name: string;
  address: string;
  agentId: string | null;
  secret: string;
}): Promise<PairedAgent> {
  const now = nowIso();
  const [row] = await db
    .insert(agents)
    .values({
      name: input.name,
      address: input.address,
      agentId: input.agentId,
      secret: encryptSecret(input.secret),
      enabled: true,
      createdAt: now,
      updatedAt: now,
    })
    // Pairing the same address again replaces its secret. That is the recovery path for a
    // controller whose copy is gone, and refusing it would leave the operator editing the database.
    .onConflictDoUpdate({
      target: agents.address,
      set: {
        name: input.name,
        agentId: input.agentId,
        secret: encryptSecret(input.secret),
        enabled: true,
        lastError: null,
        updatedAt: now,
      },
    })
    .returning();

  return toView(row);
}

export async function deleteAgent(id: number): Promise<void> {
  await db.delete(agents).where(eq(agents.id, id));
}

export async function setAgentEnabled(id: number, enabled: boolean): Promise<void> {
  await db.update(agents).set({ enabled, updatedAt: nowIso() }).where(eq(agents.id, id));
}

/**
 * Record the outcome of talking to an agent.
 *
 * Best-effort on purpose: this runs on the path of every status read, and a controller that could
 * not write a timestamp should still serve the page it was rendering.
 */
export async function recordAgentContact(
  id: number,
  result: { ok: boolean; error?: string },
): Promise<void> {
  try {
    await db
      .update(agents)
      .set(
        result.ok
          ? { lastSeenAt: nowIso(), lastError: null, updatedAt: nowIso() }
          : { lastError: (result.error ?? "Unreachable").slice(0, 500), updatedAt: nowIso() },
      )
      .where(eq(agents.id, id));
  } catch (error) {
    console.warn("Failed to record agent contact:", error);
  }
}
