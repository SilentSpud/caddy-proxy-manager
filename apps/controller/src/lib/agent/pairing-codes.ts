/**
 * The one-time codes an operator carries from this controller to an agent.
 *
 * Minted here now, where it used to be minted by the agent and read off its logs. That inversion is
 * the point of the whole flow: an operator installing an agent on a new host has a browser open on
 * the controller already, and asking them to go and read the new host's container logs was the step
 * that made remote agents awkward to add.
 *
 * Two kinds. The live code pairs an agent this controller has never seen. A re-pair code is minted
 * for one existing agent and replaces only that agent's secret - the recovery path for a host whose
 * database was rebuilt, and the only way an already-paired agentId gets a new secret.
 *
 * Held in memory only. A code that survived a restart would keep working after the operator had
 * given up on it, and a restart is exactly when they will come back for a fresh one.
 */

import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { PAIRING_CODE_ALPHABET, PAIRING_CODE_LENGTH, PAIRING_CODE_TTL_MS } from "@cpm/shared";
import { resetWindows, takeFromWindow, windowSpent } from "../rate-limit";

export type PairingCode = { code: string; expiresAt: number };

/**
 * Wrong guesses a code survives, from every caller together.
 *
 * The per-client throttle stops one caller; this stops many. At most 200 guesses reach a code in
 * its five minutes, so the odds of hitting one of 24^6 (about 1.9e8) are roughly 1 in 950,000 per
 * code an operator mints - while one client, held to 5 a minute, cannot burn a code by itself.
 */
const MAX_FAILURES_PER_CODE = 200;

/** Wrong guesses one client address may make per window before it is refused outright. */
const MAX_FAILURES_PER_CLIENT = 5;
const CLIENT_WINDOW_MS = 60_000;
/** The rate-limit window key prefix; its table is bounded against a caller rotating addresses. */
const CLIENT_WINDOW_PREFIX = "pair-client:";

type LiveCode = PairingCode & { failures: number };

let current: LiveCode | null = null;
/** Re-pair codes, keyed by the agentId each one may re-pair. */
const repairCodes = new Map<string, LiveCode>();

function secureEquals(a: string, b: string): boolean {
  const left = createHmac("sha256", "compare").update(Buffer.from(a, "utf8")).digest();
  const right = createHmac("sha256", "compare").update(Buffer.from(b, "utf8")).digest();
  return timingSafeEqual(left, right);
}

function mint(now: number): LiveCode {
  return {
    code: Array.from(
      { length: PAIRING_CODE_LENGTH },
      () => PAIRING_CODE_ALPHABET[randomInt(PAIRING_CODE_ALPHABET.length)],
    ).join(""),
    expiresAt: now + PAIRING_CODE_TTL_MS,
    failures: 0,
  };
}

/** The live code, minting a new one if none is valid. */
export function ensurePairingCode(now = Date.now()): PairingCode {
  if (!current || current.expiresAt <= now) current = mint(now);
  return { code: current.code, expiresAt: current.expiresAt };
}

/** Throw the live code away, so the next read mints a fresh one. */
export function revokePairingCode(): void {
  current = null;
}

/** A fresh code that re-pairs this agent and nothing else, replacing any earlier one for it. */
export function mintRepairCode(agentId: string, now = Date.now()): PairingCode {
  const live = mint(now);
  repairCodes.set(agentId, live);
  return { code: live.code, expiresAt: live.expiresAt };
}

export function revokeRepairCode(agentId: string): void {
  repairCodes.delete(agentId);
}

export type RedeemResult = { ok: true } | { ok: false; error: string };

/**
 * Check a submitted code against one live code, burning it on success unless `keep` is set.
 *
 * Burning it is what makes it one-time: a code that stayed valid for its whole five minutes would
 * let anyone who saw the operator's screen pair a second agent. `keep` is the preview's check - it
 * says whether the code is right without using it up - and a wrong guess still costs the code's
 * budget, so previewing is no cheaper a way to guess than pairing.
 */
function redeem(
  live: LiveCode | null | undefined,
  submitted: string,
  now: number,
  discard: () => void,
  keep = false,
): RedeemResult {
  const expired = {
    ok: false as const,
    error: "That pairing code has expired. Generate a new one.",
  };
  if (!live) return expired;
  if (live.expiresAt <= now) {
    discard();
    return expired;
  }

  if (!secureEquals(live.code, submitted.trim().toUpperCase())) {
    live.failures += 1;
    if (live.failures >= MAX_FAILURES_PER_CODE) discard();
    return { ok: false, error: "That pairing code is not valid." };
  }

  if (!keep) discard();
  return { ok: true };
}

/** Redeem the live code, for an agent this controller has not paired before. */
export function redeemPairingCode(submitted: string, now = Date.now()): RedeemResult {
  return redeem(current, submitted, now, () => {
    current = null;
  });
}

/** Whether the live code is right, without spending it. */
export function checkPairingCode(submitted: string, now = Date.now()): RedeemResult {
  return redeem(
    current,
    submitted,
    now,
    () => {
      current = null;
    },
    true,
  );
}

/** Whether this agent's re-pair code is right, without spending it. */
export function checkRepairCode(
  agentId: string,
  submitted: string,
  now = Date.now(),
): RedeemResult {
  const live = repairCodes.get(agentId);
  if (!live) return redeemRepairCode(agentId, submitted, now);
  return redeem(
    live,
    submitted,
    now,
    () => {
      repairCodes.delete(agentId);
    },
    true,
  );
}

/** Redeem the re-pair code minted for this agent. The live code never re-pairs anyone. */
export function redeemRepairCode(
  agentId: string,
  submitted: string,
  now = Date.now(),
): RedeemResult {
  const live = repairCodes.get(agentId);
  if (!live) {
    return {
      ok: false,
      error:
        "This agent is already paired. Use Re-pair on its row in Settings → Agent to get a code for it.",
    };
  }
  return redeem(live, submitted, now, () => {
    repairCodes.delete(agentId);
  });
}

// ─── Per-client throttle ─────────────────────────────────────────────────────

/** Whether this client has used up its wrong guesses for the current window. */
export function clientThrottled(client: string, now = Date.now()): boolean {
  return windowSpent(`${CLIENT_WINDOW_PREFIX}${client}`, MAX_FAILURES_PER_CLIENT, now);
}

/** Counted only on a wrong guess, and checked before the next one reaches a code's own budget. */
export function recordFailedGuess(client: string, now = Date.now()): void {
  takeFromWindow(
    `${CLIENT_WINDOW_PREFIX}${client}`,
    MAX_FAILURES_PER_CLIENT,
    CLIENT_WINDOW_MS,
    now,
  );
}

/** Test seam: forget every code and every throttle so one suite cannot see another's. */
export function resetPairingCodes(): void {
  current = null;
  repairCodes.clear();
  resetWindows(CLIENT_WINDOW_PREFIX);
}
