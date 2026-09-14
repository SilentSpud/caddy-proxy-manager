/**
 * Pairing the agent that shares this controller's volume, without anyone typing anything.
 *
 * The bundled single-host stack is the case almost every deployment is in, and asking that operator
 * to read a code off one container and run a command in another to make their own machine talk to
 * itself is ceremony for a trust boundary they already crossed by running `docker compose up`.
 *
 * So the controller leaves a token on the shared data volume and an idle agent that finds one pairs
 * with it. The boundary is the volume: reaching this file already means being inside the stack.
 *
 * The token is only on disk while it is needed, because anything that can read the volume could
 * otherwise pair whenever it liked. It is written at startup only while no bundled agent is paired,
 * never after an operator unpaired that agent (until they turn auto-pairing back on), expires after
 * half an hour, and is deleted the moment it is redeemed.
 *
 * An agent on another host cannot mount this volume and never sees any of it. It pairs with a
 * six-letter code an operator carries, which is the flow this one shortcuts rather than replaces.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AGENT_BOOTSTRAP_FILE, AGENT_BOOTSTRAP_TOKEN_PATTERN } from "@cpm/shared";
import { findAgentRowByAgentId, listAgents } from "../models/agents";
import { clearSetting, getSetting, setSetting } from "../settings";

/** Long enough for a stack coming up together, or an agent redialling a rebuilt controller. */
export const BOOTSTRAP_TOKEN_TTL_MS = 30 * 60_000;

/** The agentId that last paired with a bootstrap token, which is what makes it the bundled one. */
const BUNDLED_AGENT_KEY = "agent_bootstrap_agent_id";
/** Set when an operator unpairs the bundled agent, so it does not pair itself straight back. */
const AUTO_PAIR_DISABLED_KEY = "agent_bootstrap_disabled";

type IssuedToken = { token: string; expiresAt: number; agentId: string | null };

/**
 * The token this process wrote. Only this is ever accepted: a file left by an earlier process, or
 * written by anything else with access to the volume, redeems nothing.
 */
let issued: IssuedToken | null = null;

/**
 * Where the shared volume is mounted. Named for the setting it originally served so a deployment
 * that already points it at a scratch directory - every test rig does - keeps working.
 */
function dataDir(): string {
  return process.env.L4_PORTS_DIR || "/app/data";
}

export function bootstrapPath(): string {
  return join(dataDir(), AGENT_BOOTSTRAP_FILE);
}

function secureEquals(a: string, b: string): boolean {
  // Hashed to a fixed width first: timingSafeEqual throws on a length mismatch, which would itself
  // be an oracle for how long the token is.
  const left = createHmac("sha256", "compare").update(Buffer.from(a, "utf8")).digest();
  const right = createHmac("sha256", "compare").update(Buffer.from(b, "utf8")).digest();
  return timingSafeEqual(left, right);
}

function removeToken(): void {
  issued = null;
  try {
    rmSync(bootstrapPath(), { force: true });
  } catch (error) {
    console.warn("[cpm] could not remove the agent bootstrap token:", error);
  }
}

/**
 * Write a fresh token, readable by the agent. `agentId` binds it to one agent: an operator
 * re-pairing the bundled agent. Null lets it pair an agent this controller has never seen.
 *
 * 0640: the agent reads it through the controller's group, which compose adds it to, and nothing
 * else in the stack has any business reading it. Chmodded after the write as well, because a mode
 * given to writeFileSync only applies to a file it creates - overwriting one left at 0600 by a
 * release whose agent ran as root would keep that mode, unreadable to the agent that no longer is.
 */
export function issueBootstrapToken(agentId: string | null, now = Date.now()): boolean {
  const path = bootstrapPath();
  // Long enough that guessing is hopeless, and shaped so it cannot be confused with a typed code.
  const token = randomBytes(32).toString("hex");
  try {
    writeFileSync(path, token, { encoding: "utf-8", mode: 0o640 });
    chmodSync(path, 0o640);
  } catch (error) {
    // No shared volume - a controller running without the bundled agent, or a read-only mount.
    // Not an error: that deployment pairs with a typed code like any remote one.
    console.warn(`[cpm] could not write the agent bootstrap token to ${path}:`, error);
    issued = null;
    return false;
  }
  issued = { token, expiresAt: now + BOOTSTRAP_TOKEN_TTL_MS, agentId };
  return true;
}

export async function bundledAgentId(): Promise<string | null> {
  const value = await getSetting<string>(BUNDLED_AGENT_KEY);
  return typeof value === "string" && value.length > 0 ? value : null;
}

export async function isBundledAgent(agentId: string): Promise<boolean> {
  return (await bundledAgentId()) === agentId;
}

export async function autoPairingDisabled(): Promise<boolean> {
  return (await getSetting<boolean>(AUTO_PAIR_DISABLED_KEY)) === true;
}

/**
 * Whether the bundled agent should be able to pair itself right now.
 *
 * With no record of which agent is bundled - a deployment paired before this was recorded - any
 * paired agent reads as "already paired". That operator can still turn auto-pairing on by hand.
 */
async function wantsToken(): Promise<boolean> {
  if (await autoPairingDisabled()) return false;
  const bundled = await bundledAgentId();
  if (bundled) return (await findAgentRowByAgentId(bundled)) === null;
  return (await listAgents()).length === 0;
}

/**
 * Write a token if the bundled agent needs one, and remove a stale one if it does not.
 *
 * Called at startup, and returns whether a live token is on disk. A token an operator bound to one
 * agent is left alone: that was asked for, and startup is not a reason to take it back.
 */
export async function ensureBootstrapToken(now = Date.now()): Promise<boolean> {
  if (!(await wantsToken())) {
    if (!issued?.agentId) removeToken();
    return issued !== null && issued.expiresAt > now;
  }
  if (issued && issued.expiresAt > now) return true;
  return issueBootstrapToken(null, now);
}

/**
 * Whether `submitted` is the live token for this agent, deleting it if so.
 *
 * Synchronous from the comparison to the claim, so two redemptions in this process cannot both see
 * it live. The rename is the claim between processes: only one rename of the same file succeeds.
 * A wrong guess leaves the token in place - burning it on a mismatch would let anyone who can reach
 * the pair route keep the bundled agent from ever pairing.
 */
export function redeemBootstrapToken(
  submitted: string,
  agentId: string,
  alreadyPaired: boolean,
  now = Date.now(),
): boolean {
  const live = issued;
  if (!live) return false;
  if (live.expiresAt <= now) {
    removeToken();
    return false;
  }
  if (!secureEquals(live.token, submitted.trim())) return false;
  // Unbound, it may only pair an agent this controller has never seen: displacing an existing agent
  // takes an operator's re-pair, which binds the token to that one agent.
  if (live.agentId === null ? alreadyPaired : live.agentId !== agentId) return false;

  issued = null;
  const path = bootstrapPath();
  const claimed = `${path}.redeemed-${randomBytes(6).toString("hex")}`;
  try {
    renameSync(path, claimed);
  } catch {
    return false;
  }
  try {
    rmSync(claimed, { force: true });
  } catch {
    // Already claimed; a leftover file holding a dead token redeems nothing.
  }
  return true;
}

/** Remember which agent a bootstrap token paired, so the unpair and re-pair actions know it. */
export async function recordBundledAgent(agentId: string): Promise<void> {
  await setSetting(BUNDLED_AGENT_KEY, agentId);
}

/**
 * An operator unpaired this agent. If it is the bundled one, auto-pairing goes off, or the agent
 * would find a fresh token and pair itself straight back.
 *
 * With no record of which agent is bundled, any unpair counts: switching auto-pairing off for a
 * deployment that did not need it costs one click to undo.
 */
export async function forgetBootstrapAgent(agentId: string): Promise<void> {
  const bundled = await bundledAgentId();
  if (bundled !== null && bundled !== agentId) return;
  await setSetting(AUTO_PAIR_DISABLED_KEY, true);
  removeToken();
}

/** Let the bundled agent pair itself again. Explicit, so it writes a token whatever is paired. */
export async function enableAutoPairing(now = Date.now()): Promise<boolean> {
  await clearSetting(AUTO_PAIR_DISABLED_KEY);
  return issueBootstrapToken(null, now);
}

/** Shape check, so the pair route can tell a bootstrap token from a typed six-letter code. */
export function looksLikeBootstrapToken(value: string): boolean {
  return AGENT_BOOTSTRAP_TOKEN_PATTERN.test(value.trim());
}

/** Test seam: forget the issued token without touching the disk or the database. */
export function resetBootstrapState(): void {
  issued = null;
}
