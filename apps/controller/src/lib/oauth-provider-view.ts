import type { OAuthGroupMapping, OAuthProvider } from "./models/oauth-providers";

/**
 * OAuth provider data that is safe to serialize to React clients and ordinary
 * API responses. Use an explicit allowlist so future server-side fields do not
 * cross the browser boundary automatically.
 */
export type OAuthProviderView = OAuthGroupMapping & {
  id: string;
  name: string;
  type: string;
  clientId: string;
  hasClientSecret: boolean;
  issuer: string | null;
  authorizationUrl: string | null;
  tokenUrl: string | null;
  userinfoUrl: string | null;
  scopes: string;
  autoLink: boolean;
  enabled: boolean;
  source: string;
  createdAt: string;
  updatedAt: string;
};

export function toOAuthProviderView(provider: OAuthProvider): OAuthProviderView {
  return {
    // The OIDC group mapping drives the provider form, so it crosses the boundary in full.
    groupsClaim: provider.groupsClaim,
    groupPrefix: provider.groupPrefix,
    roleMappingEnabled: provider.roleMappingEnabled,
    adminGroup: provider.adminGroup,
    userGroup: provider.userGroup,
    viewerGroup: provider.viewerGroup,
    defaultRole: provider.defaultRole,
    syncGroups: provider.syncGroups,
    id: provider.id,
    name: provider.name,
    type: provider.type,
    clientId: provider.clientId,
    hasClientSecret: provider.clientSecret.length > 0,
    issuer: provider.issuer,
    authorizationUrl: provider.authorizationUrl,
    tokenUrl: provider.tokenUrl,
    userinfoUrl: provider.userinfoUrl,
    scopes: provider.scopes,
    autoLink: provider.autoLink,
    enabled: provider.enabled,
    source: provider.source,
    createdAt: provider.createdAt,
    updatedAt: provider.updatedAt,
  };
}

/** Better Auth 1.7 uses the standard social-provider callback route. */
export function oauthCallbackUrl(baseUrl: string, providerId: string): string {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");
  return `${normalizedBaseUrl}/api/auth/callback/${encodeURIComponent(providerId)}`;
}

/**
 * Where an identity provider sends OIDC back-channel logout notifications.
 *
 * One URL for every provider, unlike the callback: a logout token names its own issuer, and that
 * is what selects the provider it is verified against.
 */
export function oidcBackchannelLogoutUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/api/auth/oidc/backchannel-logout`;
}

/**
 * Preserve the stored secret unless the administrator explicitly supplies a
 * replacement. Omitting the property is important: an empty string would
 * otherwise rotate the provider to an unusable credential.
 */
export function withOAuthClientSecretRotation<T extends object>(
  update: T,
  replacement: string | undefined,
): T & { clientSecret?: string } {
  const clientSecret = replacement?.trim();
  return clientSecret ? { ...update, clientSecret } : update;
}
