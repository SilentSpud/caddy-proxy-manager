/**
 * Reading headers a reverse proxy sets in front of this app.
 *
 * Bun 1.4 follows the Fetch spec and joins duplicate request headers with
 * `", "`, where it previously kept only the last one. That matters for the
 * `X-Forwarded-*` family: a client can send its own `X-Forwarded-Host`, and
 * Caddy's value is appended after it rather than replacing it, so `.get()` now
 * returns `"client-supplied, real-host"` instead of `"real-host"`.
 *
 * The trailing segment is the one to trust — it is the value the proxy closest
 * to this app wrote — which is also what `.get()` returned before the change.
 */

/**
 * The last comma-separated segment of a possibly-combined header value.
 *
 * Returns "" for a missing or empty header, so callers can treat "absent" and
 * "present but useless" the same way. A single-value header is returned as-is,
 * trimmed.
 */
export function lastHeaderValue(value: string | null | undefined): string {
  if (!value) return "";
  const parts = value.split(",");
  return parts[parts.length - 1]?.trim() ?? "";
}
