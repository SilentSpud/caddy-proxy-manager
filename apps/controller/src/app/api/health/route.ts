import { NextResponse } from "next/server";
import { MAX_NONCE_LENGTH, PROBE_PARAM, signProbe } from "@/src/lib/reachability-probe";

/**
 * Health check endpoint for Docker container health monitoring.
 *
 * It doubles as the answer to the reachability probe. `?probe=<nonce>` adds a signature of that
 * nonce under this instance's session secret, which is what lets a request sent to the dashboard's
 * domain prove it arrived *here* rather than at some other server that happens to reply. See
 * `src/lib/reachability-probe.ts`.
 *
 * Public, like the rest of this route: the probe is made through Caddy from outside any session,
 * and the signature reveals nothing - it is an HMAC of a nonce the caller already chose, and
 * cannot be worked backwards into the secret.
 */
export async function GET(request: Request) {
  const nonce = new URL(request.url).searchParams.get(PROBE_PARAM);

  // Bounded before it is signed, so this cannot be used to sign arbitrary content.
  if (nonce && nonce.length <= MAX_NONCE_LENGTH) {
    return NextResponse.json({ status: "ok", probe: signProbe(nonce) }, { status: 200 });
  }

  return NextResponse.json({ status: "ok" }, { status: 200 });
}
