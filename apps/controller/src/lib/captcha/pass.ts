/**
 * Proof that the sign-in CAPTCHA was solved, good for exactly one password attempt.
 *
 * Minted when a provider token checks out, and spent by the password endpoint whatever the
 * password turns out to be, so each guess costs a solve. Spent here, on the server: clearing the
 * cookie only stops a browser, and a script replays whatever it was given. It names the account it
 * was solved for, so one solve cannot be carried to another name either.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { derivePurposeKey } from "../derived-key";
import { accountKey } from "../rate-limit";

export const CAPTCHA_PASS_COOKIE = "cpm-captcha-pass";
/** Only how long a pass may sit unused; spending it is what ends it. */
export const CAPTCHA_PASS_TTL_MS = 10 * 60_000;
/** Both password endpoints read it: Better Auth's under /api/auth, the portal's under /api/forward-auth. */
export const CAPTCHA_PASS_PATH = "/api";
/** Sent with every attempt that spent one, so the browser does not offer it again. */
export const CAPTCHA_PASS_CLEAR_COOKIE = `${CAPTCHA_PASS_COOKIE}=; Path=${CAPTCHA_PASS_PATH}; Max-Age=0; HttpOnly; SameSite=Strict`;

/**
 * Spent nonces, until their pass would have expired anyway. In memory, like every other throttle
 * here: a pass is only ever redeemed by the controller that minted it.
 */
const SPENT = new Map<string, number>();
/** Minting takes a real solve each, so this is a ceiling a caller never reaches by accident. */
const MAX_SPENT = 100_000;

/**
 * Mixed into the key so a restart invalidates every pass minted before it: SPENT is in memory and
 * starts empty, and a pass that outlived it could otherwise be redeemed a second time.
 */
let bootSalt = randomBytes(32);

function signature(account: string, expiresAt: number, nonce: string): string {
  const key = createHmac("sha256", derivePurposeKey("captcha-pass:v1")).update(bootSalt).digest();
  return createHmac("sha256", key).update(`${account}\n${expiresAt}\n${nonce}`).digest("base64url");
}

export function issueCaptchaPass(username: string, now = Date.now()): string {
  const expiresAt = now + CAPTCHA_PASS_TTL_MS;
  const nonce = randomBytes(16).toString("base64url");
  return `${expiresAt}.${nonce}.${signature(accountKey(username), expiresAt, nonce)}`;
}

/** The nonce and expiry of a pass signed for `username`, or null. Spends nothing. */
function verify(
  pass: string | null | undefined,
  username: string,
  now: number,
): { nonce: string; expiresAt: number } | null {
  if (!pass) return null;
  const [expiry, nonce, sig, ...rest] = pass.split(".");
  if (rest.length > 0 || !expiry || !nonce || !sig || !/^\d{1,15}$/.test(expiry)) return null;
  const expiresAt = Number(expiry);
  // Past the TTL from now as well as expired: a pass is never minted further out than that.
  if (expiresAt <= now || expiresAt > now + CAPTCHA_PASS_TTL_MS) return null;
  const expected = Buffer.from(signature(accountKey(username), expiresAt, nonce));
  const given = Buffer.from(sig);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return { nonce, expiresAt };
}

/** Whether `pass` would admit an attempt for `username` right now, without spending it. */
export function isValidCaptchaPass(
  pass: string | null | undefined,
  username: string,
  now = Date.now(),
): boolean {
  const verified = verify(pass, username, now);
  return verified !== null && !SPENT.has(verified.nonce);
}

/**
 * Admit one password attempt: true, and the pass is spent, or false and nothing changed.
 * Synchronous from check to record, so two requests replaying one pass cannot both get through.
 */
export function redeemCaptchaPass(
  pass: string | null | undefined,
  username: string,
  now = Date.now(),
): boolean {
  const verified = verify(pass, username, now);
  if (!verified || SPENT.has(verified.nonce)) return false;
  if (SPENT.size >= MAX_SPENT) {
    for (const [nonce, expiresAt] of SPENT) if (expiresAt <= now) SPENT.delete(nonce);
    // Refused rather than evicting a live entry, which would let that pass be replayed.
    if (SPENT.size >= MAX_SPENT) return false;
  }
  SPENT.set(verified.nonce, verified.expiresAt);
  return true;
}

/** Test seam: what a restart does - a new key, and nothing remembered as spent. */
export function restartCaptchaPasses(): void {
  bootSalt = randomBytes(32);
  SPENT.clear();
}

/** The pass from a Cookie header, for route handlers that hold a raw request. */
export function captchaPassFromCookieHeader(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === CAPTCHA_PASS_COOKIE) return value.join("=");
  }
  return null;
}
