import { defaultDashboardSettings } from "@/src/lib/dashboard-host";
import SettingsClient from "../SettingsClient";
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
  getDashboardSettings,
  getTailscaleSettings,
  defaultTailscaleSettings,
} from "@/src/lib/settings";
import { getPrimaryProviderId, listOAuthProviders } from "@/src/lib/models/oauth-providers";
import { getAllAgentBuildSettings, listAgents } from "@/src/lib/models/agents";
import { getAllAgentStatuses, listAgentOptions } from "@/src/lib/agent/client";
import { autoPairingDisabled } from "@/src/lib/agent/bootstrap";
import { getFavicon } from "@/src/lib/branding";
import { getUpdateStatus } from "@/src/lib/updates";
import { analyticsView, geoipView } from "@/src/lib/settings/optional-features";
import { DNS_PROVIDERS } from "@/src/lib/dns-providers";
import { redactTailscaleSettingsForApi } from "@/src/lib/caddy-tailscale";
import { config } from "@/src/lib/config";
import { getPublicBaseUrl } from "@/src/lib/public-url";
import { requireAdmin } from "@/src/lib/auth";
import { stagedView } from "@/src/lib/settings/staged-view";
import { stagedOverlay } from "@/src/lib/settings/staging";
import { withStagedReads } from "@/src/lib/settings/staging-context";
import { redactDnsProviderSettingsForApi } from "@/src/lib/dns-providers";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { storedErrorMessage } from "@/src/lib/actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("settings") };
}

/**
 * One settings section. The client keeps its own active-section state for instant switching, so
 * this route only decides which section a fresh load or a deep link opens on.
 */
export default async function SettingsSectionPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const session = await requireAdmin();
  const { section } = await params;
  const userId = Number(session.user.id);

  // Every read below resolves against this operator's staged set, so a form shows what they have
  // pending rather than what is stored. Without it a staged edit looks like it was discarded the
  // moment the page reloaded.
  const overlay = await stagedOverlay(userId);
  // The root translator, for the stored update-check and GeoIP failures this page shows.
  const tRoot = await getTranslations();

  // The agent and staging reads sit outside the staged scope on purpose - they are not settings -
  // but run alongside it: the scope is AsyncLocalStorage, so a sibling promise cannot see the
  // overlay. getAllAgentStatuses reports per agent and never throws.
  const [
    [
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
      primaryProviderId,
      avatarSettings,
      passwordPolicySettings,
      caddyBuild,
      tailscale,
      dashboard,
      analytics,
      geoip,
      favicon,
      updates,
    ],
    pairedAgents,
    agentStatuses,
    agentBuildSelections,
    staged,
    agentOptions,
    autoPairingOff,
    publicBaseUrl,
  ] = await Promise.all([
    withStagedReads(overlay, () =>
      Promise.all([
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
        getPrimaryProviderId(),
        getAvatarSettings(),
        getPasswordPolicySettings(),
        getCaddyBuildSettings(),
        getTailscaleSettings(),
        getDashboardSettings(),
        analyticsView(),
        geoipView(tRoot),
        getFavicon(),
        getUpdateStatus(),
      ]),
    ),
    listAgents(),
    getAllAgentStatuses(),
    getAllAgentBuildSettings(),
    stagedView(userId),
    listAgentOptions().catch(() => []),
    autoPairingDisabled().catch(() => false),
    // Outside the staged scope: the callback URLs shown must be the ones sign-in uses right now.
    getPublicBaseUrl(),
  ]);
  const connectedAgentIds = new Set(agentOptions.filter((a) => a.connected).map((a) => a.id));

  return (
    <SettingsClient
      initialSection={section}
      staged={staged}
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
      primaryProviderId={primaryProviderId}
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
      agentBuildTargets={pairedAgents.map((agent) => ({
        id: agent.id,
        name: agent.name,
        connected: connectedAgentIds.has(agent.id),
      }))}
      // A Map does not survive the server/client boundary as one; the client reads it by id.
      agentBuildSelections={Object.fromEntries(agentBuildSelections)}
      // The auth key never leaves the server: the page ships only whether one is stored, so
      // the form can say "leave blank to keep the current key" without shipping it.
      tailscale={redactTailscaleSettingsForApi(tailscale ?? defaultTailscaleSettings())}
      // Never null downstream: an unset blob means the feature has not been decided, which the
      // form and the route builder both read as off with a domain to fill in.
      dashboard={dashboard ?? defaultDashboardSettings()}
      // Only whether one exists: the image itself is served by its own route, so shipping it in
      // this page's HTML would be a couple of hundred kilobytes of base64 for nothing.
      hasFavicon={favicon !== null}
      updates={{
        ...updates,
        error: updates.error ? storedErrorMessage(tRoot, updates.error, updates.errorCode) : null,
      }}
      analytics={analytics}
      geoip={geoip}
      // Starting or stopping the optional containers needs an agent to run compose. Without one the
      // settings still save and still gate the features; only the container management is missing.
      canManageServices={agentStatuses.some((result) => result.ok)}
      baseUrl={publicBaseUrl}
      agents={{
        paired: pairedAgents,
        // A failure this side worded, such as an agent that has not reported yet, carries a code.
        statuses: agentStatuses.map((result) =>
          result.ok || !result.code
            ? result
            : {
                ...result,
                error: storedErrorMessage(tRoot, result.error, { code: result.code, params: {} }),
              },
        ),
        autoPairingDisabled: autoPairingOff,
      }}
    />
  );
}
