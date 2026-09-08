/**
 * The one-time code an operator carries from this controller to an agent.
 *
 * Minted here now, where it used to be minted by the agent and read off its logs. That inversion is
 * the point of the whole flow: an operator installing an agent on a new host has a browser open on
 * the controller already, and asking them to go and read the new host's container logs was the step
 * that made remote agents awkward to add.
 *
 * Held in memory only. A code that survived a restart would keep working after the operator had
 * given up on it, and a restart is exactly when they will come back for a fresh one.
 */

import { randomInt } from "node:crypto";
import { createHmac, timingSafeEqual } from "node:crypto";
import { PAIRING_CODE_ALPHABET, PAIRING_CODE_LENGTH, PAIRING_CODE_TTL_MS } from "@cpm/shared";

export type PairingCode = { code: string; expiresAt: number };

/**
 * Wrong guesses before the live code is burned.
 *
 * 24^6 is large, but not against an attacker who can retry for five minutes against an endpoint
 * that has to stay unauthenticated.
 */
const MAX_FAILURES = 10;

let current: PairingCode | null = null;
let failures = 0;

function secureEquals(a: string, b: string): boolean {
  const left = createHmac("sha256", "compare").update(Buffer.from(a, "utf8")).digest();
  const right = createHmac("sha256", "compare").update(Buffer.from(b, "utf8")).digest();
  return timingSafeEqual(left, right);
}

/** The live code, minting a new one if none is valid. */
export function ensurePairingCode(now = Date.now()): PairingCode {
  if (current && current.expiresAt > now) return current;
  current = {
    code: Array.from(
      { length: PAIRING_CODE_LENGTH },
      () => PAIRING_CODE_ALPHABET[randomInt(PAIRING_CODE_ALPHABET.length)],
    ).join(""),
    expiresAt: now + PAIRING_CODE_TTL_MS,
  };
  failures = 0;
  return current;
}

/** Throw the live code away, so the next read mints a fresh one. */
export function revokePairingCode(): void {
  current = null;
  failures = 0;
}

export type RedeemResult = { ok: true } | { ok: false; error: string };

/**
 * Check a submitted code and burn it on success.
 *
 * Burning it is what makes it one-time: a code that stayed valid for its whole five minutes would
 * let anyone who saw the operator's screen pair a second agent.
 */
export function redeemPairingCode(submitted: string, now = Date.now()): RedeemResult {
  const live = current;
  const expired = {
    ok: false as const,
    error: "That pairing code has expired. Generate a new one.",
  };
  if (!live) return expired;
  if (live.expiresAt <= now) {
    current = null;
    return expired;
  }

  if (!secureEquals(live.code, submitted.trim().toUpperCase())) {
    failures += 1;
    if (failures >= MAX_FAILURES) current = null;
    return { ok: false, error: "That pairing code is not valid." };
  }

  current = null;
  return { ok: true };
}

/** Test seam: forget any live code so one suite cannot see another's. */
export function resetPairingCodes(): void {
  current = null;
  failures = 0;
}
