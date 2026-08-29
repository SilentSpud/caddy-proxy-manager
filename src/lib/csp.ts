const isDev = process.env.NODE_ENV === "development";

/** A nonce-based CSP per request; Next.js reads the nonce from the CSP request header. */
export function buildCsp(nonce: string): string {
  const directives = [
    "default-src 'self'",
    isDev
      ? `script-src 'self' 'nonce-${nonce}' 'unsafe-eval'`
      : `script-src 'self' 'nonce-${nonce}'`,
    // style-src still needs 'unsafe-inline' for React JSX inline style props
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    // gravatar.com is named explicitly rather than opening img-src to all https:, so a provider's
    // `picture` claim stays blocked and the avatar steps down to Gravatar or the initial.
    "img-src 'self' data: blob: https://www.gravatar.com https://secure.gravatar.com",
    // 'self' is needed by maplibre-gl v6, which loads its tile worker from a
    // bundled /_next/static asset instead of the blob: URL it used in v5.
    "worker-src 'self' blob:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
  ];
  return directives.join("; ");
}
