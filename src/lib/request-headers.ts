/**
 * Reading headers a reverse proxy sets in front of this app. Bun 1.4 follows the Fetch spec and
 * joins duplicate request headers with `", "` instead of keeping the last, so a client-supplied
 * `X-Forwarded-Host` now shows up ahead of Caddy's. The trailing segment — what the nearest proxy
 * wrote — is the one to trust, and is what `.get()` used to return.
 */

/**
 * The last comma-separated segment of a possibly-combined header value. "" for a missing or empty
 * header, so callers treat "absent" and "present but useless" alike; single values pass through.
 */
export function lastHeaderValue(value: string | null | undefined): string {
  if (!value) return "";
  const parts = value.split(",");
  return parts[parts.length - 1]?.trim() ?? "";
}
