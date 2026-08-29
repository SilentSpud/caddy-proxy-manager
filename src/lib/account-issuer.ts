/**
 * Account identity namespacing for better-auth 1.7, which keys accounts by `(issuer, accountId)`.
 * better-auth stamps the issuer on paths it owns; this covers the rows CPM writes directly, which
 * must match or the account never resolves at sign-in. Mirrors `createLocalAccountIssuer` /
 * `createOAuthAccountIssuer` in @better-auth/core and drizzle/0024_account_issuer.sql.
 */

/** Issuer better-auth uses for its built-in password ("credential") accounts. */
export const CREDENTIAL_ISSUER = "local:credential";

/**
 * The issuer an account row should carry.
 * @param providerId  `"credential"` for password accounts, else an `oauth_providers` entry.
 * @param providerIssuer  The provider's issuer URL when it has one (OIDC does, plain OAuth2 with
 *                    explicit endpoints does not), else a synthetic namespace that cannot collide.
 */
export function accountIssuerFor(providerId: string, providerIssuer?: string | null): string {
  if (providerId === "credential") return CREDENTIAL_ISSUER;
  if (providerIssuer) return providerIssuer;
  return `local:oauth:${encodeURIComponent(providerId)}`;
}
