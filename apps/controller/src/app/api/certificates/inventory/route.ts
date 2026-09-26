import { NextResponse } from "next/server";
import { requireAdmin } from "@/src/lib/auth";
import { listAgentCertificates } from "@/src/lib/agent/client";
import { applyCaddyConfig } from "@/src/lib/caddy";
import { renewalsPending, settleRenewals } from "@/src/lib/certificate-renewals";

/**
 * What every agent's Caddy has in storage, for the Certificates page. Also where a pending
 * "Renew now" finds out it's done: once a newer certificate shows up, the name goes back to its
 * ordinary policy.
 */
export async function GET() {
  await requireAdmin();
  const agents = await listAgentCertificates();
  const certificates = agents.flatMap((agent) => agent.certificates ?? []);
  if (settleRenewals(certificates)) {
    await applyCaddyConfig().catch((error) =>
      console.error("[certificates] Reverting a finished renewal failed:", error),
    );
  }
  return NextResponse.json(
    { agents, renewing: [...renewalsPending().keys()] },
    { headers: { "Cache-Control": "no-store" } },
  );
}
