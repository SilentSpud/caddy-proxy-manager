/**
 * Maintenance commands `cpm-server` sends to the server already running in the same container,
 * for the one situation the UI cannot help with: the only administrator has lost their
 * authenticator and their backup codes.
 *
 * Signed with a key derived from SESSION_SECRET, which `docker compose exec` hands the command the
 * same as the server. Dependency-free on purpose: the binary's entry imports it before, and apart
 * from, the app, and importing the app's config would validate the whole environment first.
 */
import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";

export const CONSOLE_RESET_TWO_FACTOR_PATH = "/api/internal/reset-2fa";
/** Clock skew allowed between the command and the server, which share one machine. */
export const CONSOLE_COMMAND_MAX_AGE_MS = 60_000;

function key(secret: string): Buffer {
  return Buffer.from(
    hkdfSync("sha256", secret, Buffer.alloc(0), "caddy-proxy-manager:console-command:v1", 32),
  );
}

export function signConsoleCommand(secret: string, username: string, timestamp: number): string {
  return createHmac("sha256", key(secret))
    .update(`reset-2fa\n${timestamp}\n${username}`)
    .digest("base64url");
}

export function verifyConsoleCommand(
  secret: string,
  body: { username?: unknown; timestamp?: unknown; signature?: unknown },
  now = Date.now(),
): string | null {
  const { username, timestamp, signature } = body;
  if (typeof username !== "string" || !username.trim()) return null;
  if (typeof timestamp !== "number" || !Number.isInteger(timestamp)) return null;
  if (typeof signature !== "string") return null;
  if (Math.abs(now - timestamp) > CONSOLE_COMMAND_MAX_AGE_MS) return null;
  const expected = Buffer.from(signConsoleCommand(secret, username, timestamp));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return username;
}

/** A loopback socket, however the stack wrote it down. */
export function isLoopbackAddress(address: string | null | undefined): boolean {
  if (!address) return false;
  const bare = address.replace(/^::ffff:/i, "");
  return bare === "::1" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(bare);
}
