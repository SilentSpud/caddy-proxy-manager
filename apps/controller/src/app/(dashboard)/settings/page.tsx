import { requireAdmin } from "@/src/lib/auth";
import {
  getAcmeSettings,
  getCaddyBuildSettings,
  getDefaultResponseSettings,
  getDnsProviderSettings,
  getGeoBlockSettings,
  getMetricsSettings,
  getTrustedProxiesSettings,
} from "@/src/lib/settings";
import { analyticsView, geoipView } from "@/src/lib/settings/optional-features";
import { listOAuthProviders } from "@/src/lib/models/oauth-providers";
import { listAgents } from "@/src/lib/models/agents";
import { listAgentOptions } from "@/src/lib/agent/client";
import { listCertificates } from "@/src/lib/models/certificates";
import { needsAttention, sectionHealth } from "@/src/lib/settings/health";
import { stagedKeys, stagedView } from "@/src/lib/settings/staged-view";
import SettingsHome from "./SettingsHome";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("settings") };
}

/**
 * The settings landing page.
 *
 * Reads deliberately less than a section page does: every value here feeds one line on one tile,
 * so pulling the full settings surface to render a summary of it would make the cheapest page in
 * the section the most expensive.
 */
export default async function SettingsPage() {
  const session = await requireAdmin();
  const userId = Number(session.user.id);
  // The root translator, for the stored GeoIP failures the health tiles repeat.
  const tRoot = await getTranslations();

  const [
    dnsProvider,
    acme,
    trustedProxies,
    defaultResponse,
    geoBlock,
    geoip,
    analytics,
    metrics,
    caddyBuild,
    oauthProviders,
    certificates,
    keys,
    staged,
    paired,
    connected,
  ] = await Promise.all([
    getDnsProviderSettings(),
    getAcmeSettings(),
    getTrustedProxiesSettings(),
    getDefaultResponseSettings(),
    getGeoBlockSettings(),
    geoipView(tRoot),
    analyticsView(),
    getMetricsSettings(),
    getCaddyBuildSettings(),
    listOAuthProviders(),
    listCertificates(),
    stagedKeys(userId),
    stagedView(userId),
    // Agent reachability is a property of this process and is never allowed to fail the page: an
    // unreachable agent is a tile that says so, not a 500.
    listAgents().catch(() => []),
    listAgentOptions()
      .then((options) => options.filter((option) => option.connected).length)
      .catch(() => 0),
  ]);

  const t = await getTranslations("settings");
  const sections = sectionHealth(
    {
      dnsProvider,
      acmeConfigured: Boolean(acme?.caUrl),
      certificateCount: certificates.length,
      trustedProxies,
      defaultResponse,
      geoBlock,
      geoip,
      analytics,
      metrics,
      caddyBuild,
      oauthProviderCount: oauthProviders.length,
      agentsConnected: connected,
      agentsPaired: paired.length,
      stagedKeys: keys,
    },
    t,
  );

  return <SettingsHome sections={sections} attention={needsAttention(sections)} staged={staged} />;
}
