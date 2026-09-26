import { type NextRequest, NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { checkSameOrigin, requireAdmin } from "@/src/lib/auth";
import { checkDomainReachability, isCheckableDomain } from "@/src/lib/domain-reachability";
import { askLetsDebug } from "@/src/lib/letsdebug";
import { getProxyHost } from "@/src/lib/models/proxy-hosts";

/**
 * Whether each of a host's domains reaches this Caddy over plain HTTP. With `letsDebug` naming one
 * of them, that domain is also sent to Let's Debug for a check from outside - only on request,
 * since it tells a third party the name. Only the host's own domains: this never fetches an
 * address someone typed.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const forbidden = checkSameOrigin(request);
  if (forbidden) return forbidden;
  await requireAdmin();
  const t = await getTranslations("certificates");
  const { id } = await params;
  const host = await getProxyHost(Number(id));
  if (!host) return NextResponse.json({ error: t("downloadNotFound") }, { status: 404 });
  const body = await request.json().catch(() => ({}));

  const domains = host.domains.map((domain) => domain.trim().toLowerCase());
  if (typeof body.letsDebug === "string") {
    const domain = body.letsDebug.toLowerCase();
    if (!domains.includes(domain) || !isCheckableDomain(domain)) {
      return NextResponse.json({ error: t("renewInvalidName") }, { status: 400 });
    }
    return NextResponse.json({ domain, letsDebug: await askLetsDebug(domain) });
  }
  const results = await Promise.all(
    domains
      .slice(0, 20)
      .map((domain) =>
        domain.startsWith("*.") || isCheckableDomain(domain)
          ? checkDomainReachability(domain)
          : Promise.resolve(null),
      ),
  );
  return NextResponse.json({ results: results.filter(Boolean) });
}
