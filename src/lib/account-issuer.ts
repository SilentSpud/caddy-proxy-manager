/**
 * Account identity namespacing for better-auth 1.7.
 *
 * From 1.7 an account is keyed by `(issuer, accountId)` rather than
 * `(providerId, accountId)`. better-auth stamps the issuer itself on the paths
 * it owns (sign-up, sign-in, OAuth callback); this module exists for the rows
 * CPM writes directly — the bootstrap admin, user creation, and the manual
 * OAuth linking flows — so those rows carry the same issuer better-auth would
 * have written for the same identity. Get this wrong and the account simply
 * does not resolve at sign-in.
 *
 * Mirrors `createLocalAccountIssuer` / `createOAuthAccountIssuer` in
 * @better-auth/core, and is kept in step with the backfill in
 * drizzle/0024_account_issuer.sql.
 */

/** Issuer better-auth uses for its built-in password ("credential") accounts. */
export const CREDENTIAL_ISSUER = "local:credential";

/**
 * The issuer an account row should carry.
 *
 * @param providerId  The account's providerId — `"credential"` for password
 *                    accounts, otherwise an entry in `oauth_providers`.
 * @param providerIssuer  That provider's configured issuer URL, when it has
 *                    one. OIDC providers do; plain OAuth2 providers configured
 *                    with explicit endpoints do not, and fall back to a
 *                    synthetic namespace so a provider id can never collide
 *                    with a local authentication method.
 */
export function accountIssuerFor(providerId: string, providerIssuer?: string | null): string {
  if (providerId === "credential") return CREDENTIAL_ISSUER;
  if (providerIssuer) return providerIssuer;
  return `local:oauth:${encodeURIComponent(providerId)}`;
}
