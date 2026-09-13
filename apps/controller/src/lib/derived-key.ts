import { hkdfSync } from "node:crypto";
import { config } from "./config";

/**
 * An independent key per purpose, derived from SESSION_SECRET. Every HMAC this app hands out or
 * trusts, and the settings encryption key, is keyed by one of these, so a value one feature signs
 * on request can never equal a value another feature checks: the public probe once answered with
 * the forward-auth proof, because both were HMACs under the raw secret.
 */
export type KeyPurpose = "secret:v1" | "reachability-probe:v1" | "forward-auth-proxy-proof:v2";

const derived = new Map<KeyPurpose, { secret: string; key: Buffer }>();

/** `secret` is only ever another deployment's, for the migration importer reading its database. */
export function derivePurposeKey(purpose: KeyPurpose, secret = config.sessionSecret): Buffer {
  const cached = derived.get(purpose);
  if (cached?.secret === secret) return cached.key;
  const key = Buffer.from(
    hkdfSync("sha256", secret, Buffer.alloc(0), `caddy-proxy-manager:${purpose}`, 32),
  );
  derived.set(purpose, { secret, key });
  return key;
}
