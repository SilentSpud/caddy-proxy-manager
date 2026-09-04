/**
 * Request authentication, and the one-time code that bootstraps it.
 *
 * Requests are signed, not bearer-authenticated: the secret never travels with a request, so it
 * cannot be lifted from a proxy log, a crash dump, or a `curl -v` an operator pasted into an issue.
 * The signature covers the method, path, timestamp and body, which is what stops a captured request
 * from being replayed against a different endpoint.
 */

import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import {
  AGENT_CLOCK_SKEW_MS,
  AGENT_CONTROLLER_HEADER,
  AGENT_SIGNATURE_HEADER,
  AGENT_TIMESTAMP_HEADER,
  PAIRING_CODE_ALPHABET,
  PAIRING_CODE_LENGTH,
  PAIRING_CODE_TTL_MS,
  signatureBase,
  type AgentErrorCode,
} from "@cpm/shared";
import type { AgentStore } from "./db";

export function generateSecret(): string {
  return randomBytes(32).toString("hex");
}

export async function sha256Hex(body: ArrayBuffer | Uint8Array | string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(body as Parameters<Bun.CryptoHasher["update"]>[0]);
  return hasher.digest("hex");
}

/** Constant-time comparison that tolerates length differences without leaking them by timing. */
function secureEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  // timingSafeEqual throws on a length mismatch, which would itself be an oracle. Hashing both to
  // a fixed width first makes every comparison the same shape.
  const leftDigest = createHmac("sha256", "compare").update(left).digest();
  const rightDigest = createHmac("sha256", "compare").update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

export type AuthFailure = { code: AgentErrorCode; message: string };
export type AuthResult = { ok: true; controllerId: string } | ({ ok: false } & AuthFailure);

/**
 * Verify a signed request.
 *
 * Every failure returns the same generic message. Telling a caller whether it got the controller
 * id, the timestamp or the signature wrong turns the endpoint into a probe for which of those it
 * already has right.
 */
export async function verifyRequest(
  store: AgentStore,
  request: Request,
  url: URL,
  body: ArrayBuffer,
  now = Date.now(),
): Promise<AuthResult> {
  const deny: AuthResult = {
    ok: false,
    code: "UNAUTHENTICATED",
    message: "The request is not signed by a paired controller.",
  };

  const controllerId = request.headers.get(AGENT_CONTROLLER_HEADER);
  const timestampRaw = request.headers.get(AGENT_TIMESTAMP_HEADER);
  const signature = request.headers.get(AGENT_SIGNATURE_HEADER);
  if (!controllerId || !timestampRaw || !signature) return deny;

  const timestamp = Number.parseInt(timestampRaw, 10);
  if (!Number.isFinite(timestamp)) return deny;
  if (Math.abs(now - timestamp) > AGENT_CLOCK_SKEW_MS) return deny;

  const paired = store.findController(controllerId);
  if (!paired) return deny;

  const expected = createHmac("sha256", paired.secret)
    .update(signatureBase(request.method, url.pathname, timestamp, await sha256Hex(body)))
    .digest("hex");

  if (!secureEquals(expected, signature)) return deny;
  return { ok: true, controllerId };
}

// ─── Pairing codes ───────────────────────────────────────────────────────────

export type PairingCode = { code: string; expiresAt: number };

/**
 * The rolling one-time code an operator types into the controller to pair a remote agent.
 *
 * Held in memory only: a code that survived a restart would keep working after the operator had
 * given up on it, and a restart is exactly when they will look at the logs for a fresh one.
 */
export class PairingCodeIssuer {
  private current: PairingCode | null = null;
  private failures = 0;

  constructor(
    private readonly enabled: boolean,
    private readonly ttlMs: number = PAIRING_CODE_TTL_MS,
  ) {}

  /** The live code, minting a new one if none is valid. Null when pairing is switched off. */
  ensure(now = Date.now()): PairingCode | null {
    if (!this.enabled) return null;
    if (this.current && this.current.expiresAt > now) return this.current;
    this.current = {
      code: Array.from(
        { length: PAIRING_CODE_LENGTH },
        () => PAIRING_CODE_ALPHABET[randomInt(PAIRING_CODE_ALPHABET.length)],
      ).join(""),
      expiresAt: now + this.ttlMs,
    };
    this.failures = 0;
    return this.current;
  }

  /**
   * Check a submitted code and burn it on success.
   *
   * Burning it is what makes it one-time: a code that stayed valid for its whole five minutes
   * would let anyone who saw the operator's screen pair a second controller. Ten wrong guesses
   * also burn it — 24^6 is large, but not against an attacker who can retry for five minutes.
   */
  redeem(submitted: string, now = Date.now()): { ok: true } | { ok: false; code: AgentErrorCode } {
    if (!this.enabled) return { ok: false, code: "PAIRING_DISABLED" };
    const live = this.current;
    if (!live) return { ok: false, code: "PAIRING_CODE_EXPIRED" };
    if (live.expiresAt <= now) {
      this.current = null;
      return { ok: false, code: "PAIRING_CODE_EXPIRED" };
    }
    if (!secureEquals(live.code, submitted.trim().toUpperCase())) {
      this.failures += 1;
      if (this.failures >= 10) this.current = null;
      return { ok: false, code: "PAIRING_CODE_INVALID" };
    }
    this.current = null;
    return { ok: true };
  }
}
