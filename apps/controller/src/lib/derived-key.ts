import { hkdfSync } from "node:crypto";
import { config } from "./config";

/**
 * An independent key per purpose, derived from SESSION_SECRET. Every HMAC this app hands out or
 * trusts is keyed by one of these, so a value one feature signs on request can never equal a value
 * another feature checks: the public probe once answered with the forward-auth proof, because both
 * were HMACs under the raw secret.
 */
export type KeyPurpose = "reachability-probe:v1" | "forward-auth-proxy-proof:v2";

const derived = new Map<KeyPurpose, { secret: string; key: Buffer }>();

export function derivePurposeKey(purpose: KeyPurpose): Buffer {
  const secret = config.sessionSecret;
  const cached = derived.get(purpose);
  if (cached?.secret === secret) return cached.key;
  const key = Buffer.from(
    hkdfSync("sha256", secret, Buffer.alloc(0), `caddy-proxy-manager:${purpose}`, 32),
  );
  derived.set(purpose, { secret, key });
  return key;
}
