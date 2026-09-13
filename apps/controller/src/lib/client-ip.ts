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
 * The bundled stack's Caddy service. Its admin URL names `caddy-admin`, an alias that resolves only
 * on the internal admin network, while Caddy reaches this controller over caddy-network - so the
 * address its requests arrive from is the one the service name resolves to.
 */
const CADDY_SERVICE_NAME = "caddy";

/**
 * Peers allowed to say who the client is: loopback, the Caddy this controller administers (whatever
 * its admin URL and the bundled service name resolve to), and Settings -> Trusted Proxies.
 */
async function trustedProxies(): Promise<string[]> {
  if (trustedCache && Date.now() - trustedCache.at < TRUSTED_CACHE_MS) return trustedCache.ranges;

  const ranges = [...LOOPBACK];
  let adminHost = "";
  try {
    adminHost = new URL(config.caddyApiUrl).hostname.replace(/^\[|\]$/g, "");
  } catch {
    // An unparseable admin URL vouches for nobody.
  }
  for (const host of new Set([adminHost, CADDY_SERVICE_NAME])) {
    if (!host) continue;
    if (isIP(host)) {
      ranges.push(host);
      continue;
    }
    try {
      ranges.push(...(await lookup(host, { all: true })).map((a) => a.address));
    } catch {
      // Not resolvable from here: only the configured ranges vouch for anyone.
    }
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
