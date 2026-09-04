/**
 * Verifying a request that came *from* an agent.
 *
 * The one route that runs this way. The shared secret is symmetric, so an agent can sign with the
 * same primitive the controller uses and the controller verifies against the row it stored at
 * pairing — no second credential, and no bearer token to leak.
 *
 * The local agent has no row, and needs none: it shares the volume the databases are on, so it
 * never fetches them.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  AGENT_CLOCK_SKEW_MS,
  AGENT_ID_HEADER,
  AGENT_SIGNATURE_HEADER,
  AGENT_TIMESTAMP_HEADER,
  signatureBase,
} from "@cpm/shared";
import db from "../db";
import { agents } from "../db/schema";
import { decryptSecret } from "../secret";

/** Constant-time comparison that tolerates length differences without leaking them by timing. */
function secureEquals(a: string, b: string): boolean {
  const left = createHmac("sha256", "compare").update(a, "utf8").digest();
  const right = createHmac("sha256", "compare").update(b, "utf8").digest();
  return timingSafeEqual(left, right);
}

/**
 * The agent that signed this request, or null.
 *
 * Null for every reason: no headers, an unknown agent, a stale timestamp, a bad signature. The
 * caller answers 404 rather than 401 — an unauthenticated caller should not learn that this route
 * exists, let alone which agent ids are real.
 */
export async function agentFromRequest(
  request: Request,
  pathname: string,
  now = Date.now(),
): Promise<{ id: number; name: string } | null> {
  const agentId = request.headers.get(AGENT_ID_HEADER);
  const timestampRaw = request.headers.get(AGENT_TIMESTAMP_HEADER);
  const signature = request.headers.get(AGENT_SIGNATURE_HEADER);
  if (!agentId || !timestampRaw || !signature) return null;

  const timestamp = Number.parseInt(timestampRaw, 10);
  if (!Number.isFinite(timestamp)) return null;
  if (Math.abs(now - timestamp) > AGENT_CLOCK_SKEW_MS) return null;

  const [row] = await db.select().from(agents).where(eq(agents.agentId, agentId)).limit(1);
  if (!row?.enabled) return null;

  let secret: string;
  try {
    secret = decryptSecret(row.secret);
  } catch {
    return null;
  }

  // GET only, so the body hash is always the hash of the empty string — the same value the agent
  // signs. Keeping the field in the base string means both directions share one canonical form.
  const emptyBody = new Bun.CryptoHasher("sha256").update("").digest("hex");
  const expected = createHmac("sha256", secret)
    .update(signatureBase(request.method, pathname, timestamp, emptyBody))
    .digest("hex");

  if (!secureEquals(expected, signature)) return null;
  return { id: row.id, name: row.name };
}
