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
  ]);

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
      baseUrl={config.baseUrl}
    />
  );
}
