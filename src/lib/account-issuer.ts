/**
 * Account identity namespacing for better-auth 1.7, which keys accounts by `(issuer, accountId)`.
 * Covers the rows CPM writes directly, which must match what better-auth would write or the account
 * never resolves at sign-in. Mirrors @better-auth/core and drizzle/0024_account_issuer.sql.
 */

/** Issuer better-auth uses for its built-in password ("credential") accounts. */
export const CREDENTIAL_ISSUER = "local:credential";

/**
 * The issuer an account row should carry: the provider's issuer URL when it has one (OIDC does),
 * else a synthetic namespace that cannot collide. `providerId` is `"credential"` for passwords.
 */
export function accountIssuerFor(providerId: string, providerIssuer?: string | null): string {
  if (providerId === "credential") return CREDENTIAL_ISSUER;
  if (providerIssuer) return providerIssuer;
  return `local:oauth:${encodeURIComponent(providerId)}`;
}
