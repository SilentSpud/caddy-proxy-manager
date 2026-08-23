import { config } from "../config";
import {
  getOAuthProviderByName,
  createOAuthProvider,
  updateOAuthProvider,
} from "../models/oauth-providers";

/**
 * Sync OAUTH_* environment variables into the oauthProviders table.
 * Env-sourced providers are created with source="env" and are read-only in the UI.
 * Call this once at server startup.
 */
export async function syncEnvOAuthProviders(): Promise<void> {
  if (!config.oauth.enabled || !config.oauth.clientId || !config.oauth.clientSecret) {
    return;
  }

  const name = config.oauth.providerName;
  const existing = await getOAuthProviderByName(name);

  const validRoles = new Set(["admin", "user", "viewer"]);
  const data = {
    type: "oidc" as const,
    clientId: config.oauth.clientId,
    clientSecret: config.oauth.clientSecret,
    issuer: config.oauth.issuer ?? null,
    authorizationUrl: config.oauth.authorizationUrl ?? null,
    tokenUrl: config.oauth.tokenUrl ?? null,
    userinfoUrl: config.oauth.userinfoUrl ?? null,
    autoLink: config.oauth.allowAutoLinking,
    scopes: config.oauth.scopes ?? "openid email profile",
    groupsClaim: config.oauth.groupsClaim ?? "groups",
    groupPrefix: config.oauth.groupPrefix ?? null,
    roleMappingEnabled: config.oauth.roleMappingEnabled,
    adminGroup: config.oauth.adminGroup ?? null,
    userGroup: config.oauth.userGroup ?? null,
    viewerGroup: config.oauth.viewerGroup ?? null,
    defaultRole: (config.oauth.defaultRole && validRoles.has(config.oauth.defaultRole)
      ? config.oauth.defaultRole
      : "user") as "admin" | "user" | "viewer",
    syncGroups: config.oauth.syncGroups,
  };

  if (existing && existing.source === "env") {
    // Update existing env-sourced provider
    await updateOAuthProvider(existing.id, { name, ...data });
  } else if (!existing) {
    // Create new env-sourced provider
    await createOAuthProvider({ name, ...data, source: "env" });
  }
  // If a UI-sourced provider with the same name exists, don't overwrite it
}
