import SettingsClient from "./SettingsClient";
import {
  getGeneralSettings,
  getAcmeSettings,
  getAuthentikSettings,
  getMetricsSettings,
  getLoggingSettings,
  getDnsSettings,
  getDnsProviderSettings,
  getUpstreamDnsResolutionSettings,
  getGeoBlockSettings,
  getErrorPagesSettings,
  getTrustedProxiesSettings,
  getDefaultResponseSettings,
  getAvatarSettings,
  getPasswordPolicySettings,
  getCaddyBuildSettings,
} from "@/src/lib/settings";
import { listOAuthProviders } from "@/src/lib/models/oauth-providers";
import { listAgents } from "@/src/lib/models/agents";
import { getAllAgentStatuses } from "@/src/lib/agent/client";
import { getFavicon } from "@/src/lib/branding";
import { getUpdateStatus } from "@/src/lib/updates";
import { analyticsView, geoipView } from "@/src/lib/settings/optional-features";
import { DNS_PROVIDERS } from "@/src/lib/dns-providers";
import { config } from "@/src/lib/config";
import { requireAdmin } from "@/src/lib/auth";
import { redactDnsProviderSettingsForApi } from "@/src/lib/dns-providers";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Settings",
};

export default async function SettingsPage() {
  await requireAdmin();

  const [
    general,
    acme,
    dnsProvider,
    authentik,
    metrics,
    logging,
    dns,
    upstreamDnsResolution,
    globalGeoBlock,
    globalErrorPages,
    trustedProxies,
    defaultResponse,
    oauthProviders,
    avatarSettings,
    passwordPolicySettings,
    caddyBuild,
    analytics,
    geoip,
    favicon,
    updates,
  ] = await Promise.all([
    getGeneralSettings(),
    getAcmeSettings(),
    getDnsProviderSettings(),
    getAuthentikSettings(),
    getMetricsSettings(),
    getLoggingSettings(),
    getDnsSettings(),
    getUpstreamDnsResolutionSettings(),
    getGeoBlockSettings(),
    getErrorPagesSettings(),
    getTrustedProxiesSettings(),
    getDefaultResponseSettings(),
    listOAuthProviders(),
    getAvatarSettings(),
    getPasswordPolicySettings(),
    getCaddyBuildSettings(),
    analyticsView(),
    geoipView(),
    getFavicon(),
    getUpdateStatus(),
  ]);

  // Separate from the settings reads above: these go out over the network to each agent, so a slow
  // or absent one must not hold up the rest of the page. getAllAgentStatuses reports per agent and
  // never throws, for exactly that reason.
  const [pairedAgents, agentStatuses] = await Promise.all([listAgents(), getAllAgentStatuses()]);

  return (
    <SettingsClient
      general={general}
      acme={acme}
      dnsProvider={dnsProvider ? redactDnsProviderSettingsForApi(dnsProvider) : null}
      dnsProviderDefinitions={DNS_PROVIDERS}
      authentik={authentik}
      metrics={metrics}
      logging={logging}
      dns={dns}
      upstreamDnsResolution={upstreamDnsResolution}
      trustedProxies={trustedProxies}
      defaultResponse={defaultResponse}
      globalGeoBlock={globalGeoBlock}
      globalErrorPages={globalErrorPages}
      oauthProviders={oauthProviders}
      localUsersDisabled={config.auth.disableLocalUsers}
      avatars={{
        // The stored toggle only applies when AVATAR_GRAVATAR leaves the choice open.
        gravatarEnabled: config.avatars.gravatarFromEnv ?? avatarSettings?.gravatarEnabled ?? true,
        fromEnv: config.avatars.gravatarFromEnv !== null,
      }}
      passwordPolicy={{
        // The stored toggle only applies when the env var leaves the choice open.
        requireChangeOnLegacyHash:
          config.auth.requirePasswordChangeOnLegacyHashFromEnv ??
          passwordPolicySettings?.requireChangeOnLegacyHash ??
          false,
        fromEnv: config.auth.requirePasswordChangeOnLegacyHashFromEnv !== null,
      }}
      caddyBuild={caddyBuild}
      // Only whether one exists: the image itself is served by its own route, so shipping it in
      // this page's HTML would be a couple of hundred kilobytes of base64 for nothing.
      hasFavicon={favicon !== null}
      updates={updates}
      analytics={analytics}
      geoip={geoip}
      // Starting or stopping the optional containers needs an agent to run compose. Without one the
      // settings still save and still gate the features; only the container management is missing.
      canManageServices={agentStatuses.some((result) => result.ok)}
      baseUrl={config.baseUrl}
      agents={{ paired: pairedAgents, statuses: agentStatuses }}
    />
  );
}
