/**
 * Which `settings` rows each navigation section writes.
 *
 * One map, because three things ask the question and none of them can derive it: the sidebar marks
 * a section holding staged work, the home tiles mark theirs, and the review sheet labels a staged
 * key with the section it came from. The spellings genuinely differ - the `dns-providers` section
 * writes `dns_provider` - so anything that guesses one from the other lands on the wrong section.
 *
 * Framework-free on purpose: the navigation catalogue imports icons, and the server-side health
 * resolver has no business pulling those in to answer a question about storage keys.
 */

/**
 * `label` is what the review sheet calls a staged change. Deliberately not the navigation's label
 * for the same section - the rail says "Global Geoblocking" where a change list reads better as
 * "Geo-Block" - so the two are allowed to differ and neither is derived from the other.
 */
export type SectionKeys = { label: string; keys: readonly string[] };

export const SECTION_STORAGE_KEYS: Record<string, SectionKeys> = {
  general: { label: "General", keys: ["general"] },
  acme: { label: "ACME Server", keys: ["acme"] },
  "default-response": { label: "Default Response", keys: ["default_response"] },
  avatars: { label: "User Avatars", keys: ["avatars"] },
  updates: { label: "Updates", keys: ["update_settings"] },
  "caddy-build": { label: "Caddy Build", keys: ["caddy_build"] },
  dashboard: { label: "Dashboard Host", keys: ["dashboard"] },
  "dns-providers": { label: "DNS Providers", keys: ["dns_provider", "cloudflare"] },
  "dns-resolvers": { label: "DNS Resolvers", keys: ["dns"] },
  "upstream-dns": { label: "Upstream DNS", keys: ["upstream_dns_resolution"] },
  "trusted-proxies": { label: "Trusted Proxies", keys: ["trusted_proxies"] },
  tailscale: { label: "Tailscale", keys: ["tailscale"] },
  geoblock: { label: "Geo-Block", keys: ["geoblock"] },
  "error-pages": { label: "Error Pages", keys: ["error_pages"] },
  authentik: { label: "Authentik", keys: ["authentik"] },
  "password-policy": { label: "Password Policy", keys: ["password_policy"] },
  metrics: { label: "Metrics", keys: ["metrics"] },
  logging: { label: "Logging", keys: ["logging"] },
  waf: { label: "WAF", keys: ["waf"] },
};

/** The storage keys a section writes, or none for a section that writes another table. */
export function storageKeysForSection(id: string): readonly string[] {
  return SECTION_STORAGE_KEYS[id]?.keys ?? [];
}

/** The section a storage key belongs to, with its change-list label, or null if nothing claims it. */
export function sectionForStorageKey(key: string): { id: string; label: string } | null {
  for (const [id, entry] of Object.entries(SECTION_STORAGE_KEYS)) {
    if (entry.keys.includes(key)) return { id, label: entry.label };
  }
  return null;
}
