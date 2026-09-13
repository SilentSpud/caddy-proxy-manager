import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { getIPFromHeader, isValidIP, normalizeIP } from "@better-auth/core/utils/ip";
import { expandPrivateRanges } from "./caddy-utils";
import { config } from "./config";
import { PEER_ADDRESS_HEADER, isPeerAddressStamped } from "./peer-address";
import { lastHeaderValue } from "./request-headers";

/** Set on requests handed to better-auth, whose rate limiter reads the address from it alone. */
export const CLIENT_IP_HEADER = "x-cpm-client-ip";

const LOOPBACK = ["127.0.0.0/8", "::1/128"];
const TRUSTED_CACHE_MS = 30_000;
let trustedCache: { at: number; ranges: string[] } | null = null;

/**
 * Peers allowed to say who the client is: loopback, the Caddy this controller administers (whatever
 * its admin URL resolves to), and Settings -> Trusted Proxies.
 */
async function trustedProxies(): Promise<string[]> {
  if (trustedCache && Date.now() - trustedCache.at < TRUSTED_CACHE_MS) return trustedCache.ranges;

  const ranges = [...LOOPBACK];
  try {
    const host = new URL(config.caddyApiUrl).hostname.replace(/^\[|\]$/g, "");
    if (isIP(host)) ranges.push(host);
    else if (host) ranges.push(...(await lookup(host, { all: true })).map((a) => a.address));
  } catch {
    // Caddy not resolvable from here: only the configured ranges vouch for anyone.
  }
  try {
    // Imported lazily so reading headers never drags the database into a module that does not need it.
    const { getTrustedProxiesSettings } = await import("./settings");
    ranges.push(...expandPrivateRanges((await getTrustedProxiesSettings())?.ranges ?? []));
  } catch {
    // Settings unreadable: fall back to the peer address, which is never worse than trusting a header.
  }

  trustedCache = { at: Date.now(), ranges };
  return ranges;
}

/**
 * The address a request came from, for rate limiting. Null when nothing trustworthy is known.
 *
 * X-Forwarded-For counts only when the socket peer is a trusted proxy, walked right to left past
 * further trusted hops - the rule better-auth applies to the same ranges. X-Real-IP never counts:
 * nothing in the stack sets or strips it.
 */
export async function getClientIp(headers: Headers, trusted?: string[]): Promise<string | null> {
  const forwardedFor = headers.get("x-forwarded-for");

  if (!isPeerAddressStamped()) {
    // No socket address under `vinext dev`/`start`: the hop the nearest proxy appended is the best
    // left, and a client reaching the port directly can forge it - the per-account limit still holds.
    const last = lastHeaderValue(forwardedFor);
    return isValidIP(last) ? normalizeIP(last) : null;
  }

  const peer = headers.get(PEER_ADDRESS_HEADER)?.trim() ?? "";
  if (!isValidIP(peer)) return null;

  const ranges = trusted ?? (await trustedProxies());
  // With trusted ranges given, a lone address comes back null exactly when it is itself trusted.
  const peerIsTrusted = getIPFromHeader(peer, { trustedProxies: ranges }) === null;
  if (!peerIsTrusted || !forwardedFor) return normalizeIP(peer);
  return getIPFromHeader(forwardedFor, { trustedProxies: ranges }) ?? normalizeIP(peer);
}
