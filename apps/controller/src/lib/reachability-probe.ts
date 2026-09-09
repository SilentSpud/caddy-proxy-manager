/**
 * Proving that a domain reaches *this* instance, without asking anybody else.
 *
 * The question the dashboard host's HTTPS toggle depends on is "does this name arrive here?", and
 * the honest way to answer it is to try. The controller is already serving - the operator is
 * reading a page it rendered - so a request to the domain that comes back here is proof the path
 * works end to end: DNS, the port, whatever NAT sits in between, and Caddy's route.
 *
 * Comparing a DNS record against a public IP looked up from a third-party echo service was the
 * alternative. It answers a narrower question (what the record says, not whether traffic arrives),
 * and it does it by telling someone else's server that this deployment exists.
 *
 * **The answer is signed, because reaching *a* server proves nothing.** The probe sends a nonce
 * and expects an HMAC of it under this instance's session secret. Any other server can echo a
 * nonce back; only this one can sign it. So a domain pointed at somebody else's machine reads as
 * "something answered, but it was not this instance" rather than as success.
 *
 * What it still cannot tell you, and why the UI says so:
 *
 * - **Split-horizon DNS.** A resolver inside the network that points the name here while public
 *   DNS points somewhere else passes this check and still fails an ACME order.
 * - **No NAT hairpin.** A network that will not let a request leave and come back by its public
 *   address fails this check while the outside world reaches the deployment perfectly well.
 *
 * Both are wrong in a recoverable direction: the toggle is a default the operator can override,
 * and the message says what was found rather than only whether it passed.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { config } from "./config";

/** Path the probe asks for. Public, and already exempt from authentication in `proxy.ts`. */
export const PROBE_PATH = "/api/health";

/** Query parameter carrying the nonce. */
export const PROBE_PARAM = "probe";

/**
 * Bounded so the endpoint cannot be turned into a signing oracle for arbitrary long inputs, and
 * so a nonce is unmistakably a nonce.
 */
export const MAX_NONCE_LENGTH = 64;

/** The signature this instance answers a nonce with. */
export function signProbe(nonce: string): string {
  return createHmac("sha256", config.sessionSecret).update(nonce).digest("hex");
}

export function createProbeNonce(): string {
  return randomBytes(16).toString("hex");
}

/** Constant-time, so a wrong answer cannot be walked towards a right one. */
export function probeSignatureMatches(nonce: string, answer: string): boolean {
  const expected = Buffer.from(signProbe(nonce), "utf8");
  const received = Buffer.from(answer, "utf8");
  if (expected.length !== received.length) return false;
  return timingSafeEqual(expected, received);
}
