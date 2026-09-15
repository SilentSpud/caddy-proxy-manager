/**
 * DNS provider credentials at rest and in Caddy's config: the half of the provider registry that
 * needs `secret`.
 *
 * Split from dns-providers.ts because that file is reached from client components through the
 * module catalog, and `secret` pulls in `node:crypto` - which Vite's browser build externalizes to
 * a stub that throws the moment the Settings page loads.
 */

import {
  CHALLENGE_OPTION_KEYS,
  type DnsProviderCredentials,
  getProviderDefinition,
} from "./dns-providers";
import { decryptSecret, encryptSecret, isEncryptedSecret } from "./secret";

export type { DnsProviderCredentials };

/** Encrypt password-type credential fields; others and already-encrypted values pass through. */
export function encryptProviderCredentials(
  providerName: string,
  credentials: Record<string, string>,
): Record<string, string> {
  const def = getProviderDefinition(providerName);
  if (!def) return credentials;

  const result = { ...credentials };
  for (const field of def.fields) {
    if (field.type === "password" && result[field.key] && !isEncryptedSecret(result[field.key])) {
      result[field.key] = encryptSecret(result[field.key]);
    }
  }
  return result;
}

/** Decrypt password-type credential fields for use in Caddy config. */
export function decryptProviderCredentials(
  providerName: string,
  credentials: Record<string, string>,
): Record<string, string> {
  const def = getProviderDefinition(providerName);
  if (!def) return credentials;

  const result = { ...credentials };
  for (const field of def.fields) {
    if (field.type === "password" && result[field.key] && isEncryptedSecret(result[field.key])) {
      result[field.key] = decryptSecret(
        result[field.key],
        `DNS provider "${providerName}" credential "${field.key}"`,
      );
    }
  }
  return result;
}

/**
 * The Caddy DNS challenge config for `issuer.challenges.dns`, from a provider + credentials.
 * The challenge options (propagation_delay / propagation_timeout) are hoisted out of the
 * credential map to the challenge level, falling back to the provider's own defaults;
 * `resolvers` comes from the global DNS resolver settings and is passed in separately.
 */
export function buildDnsChallengeConfig(
  providerName: string,
  credentials: Record<string, string>,
  dnsResolvers: string[],
): Record<string, unknown> | null {
  const def = getProviderDefinition(providerName);
  if (!def) return null;

  const decrypted = decryptProviderCredentials(providerName, credentials);

  // Build provider config: { name: "cloudflare", api_token: "..." }.
  // Challenge option keys configure the DNS challenge itself, not the
  // provider module, so they are emitted at the challenge level below.
  const providerConfig: Record<string, string> = { name: providerName };
  for (const [key, value] of Object.entries(decrypted)) {
    if (value && !(CHALLENGE_OPTION_KEYS as readonly string[]).includes(key)) {
      providerConfig[key] = value;
    }
  }

  const dnsChallenge: Record<string, unknown> = { provider: providerConfig };
  if (dnsResolvers.length > 0) {
    dnsChallenge.resolvers = dnsResolvers;
  }

  // Challenge tuning: a stored option value wins over the provider default.
  // The "-1" disable value is emitted as a number because Caddy parses
  // duration strings with time.ParseDuration, which rejects a bare "-1".
  for (const key of CHALLENGE_OPTION_KEYS) {
    const value = decrypted[key] || def.challengeDefaults?.[key];
    if (value) {
      dnsChallenge[key] = value === "-1" ? -1 : value;
    }
  }

  return dnsChallenge;
}
