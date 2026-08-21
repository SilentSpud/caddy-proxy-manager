import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import crypto from "node:crypto";
import { auth } from "@/src/lib/auth";

/**
 * Next.js Proxy for route protection.
 * Provides defense-in-depth by checking authentication at the edge
 * before requests reach page components.
 *
 * Note: Proxy always runs on Node.js runtime.
 */

const isDev = process.env.NODE_ENV === "development";

/**
 * Build a nonce-based Content-Security-Policy per request.
 * Next.js reads the nonce from the CSP request header and applies it
 * to all inline scripts it generates.
 */
function buildCsp(nonce: string): string {
  const directives = [
    "default-src 'self'",
    isDev
      ? `script-src 'self' 'nonce-${nonce}' 'unsafe-eval' https://cdn.jsdelivr.net`
      : `script-src 'self' 'nonce-${nonce}' https://cdn.jsdelivr.net`,
    // style-src still needs 'unsafe-inline' for React JSX inline style props
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net",
    "font-src 'self' https://fonts.gstatic.com",
    // gravatar.com is listed so user icons can fall back to Gravatar. It is
    // named explicitly rather than opening img-src to all of https: — a
    // provider's `picture` claim is also a remote URL and stays blocked, in
    // which case the avatar steps down to the Gravatar or the initial.
    "img-src 'self' data: blob: https://www.gravatar.com https://secure.gravatar.com",
    // 'self' is needed by maplibre-gl v6, which loads its tile worker from a
    // bundled /_next/static asset instead of the blob: URL it used in v5.
    "worker-src 'self' blob:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
  ];
  return directives.join("; ");
}

export default async function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname;

  // Allow public routes
  if (
    pathname === "/login" ||
    pathname === "/portal" ||
    pathname.startsWith("/api/auth") ||
    pathname === "/api/health" ||
    pathname === "/api/instances/sync" ||
    pathname.startsWith("/api/v1/") ||
    pathname.startsWith("/api/forward-auth/")
  ) {
    const publicResponse = NextResponse.next();
    // Anti-clickjacking for public pages (/login, /portal): the authenticated
    // branch below sets the full security-header set, but public pages returned
    // here previously carried none, leaving the login and forward-auth portal
    // forms framable. Apply the framing protections to every public response.
    publicResponse.headers.set("X-Frame-Options", "DENY");
    publicResponse.headers.set("Content-Security-Policy", "frame-ancestors 'none'");
    publicResponse.headers.set("X-Content-Type-Options", "nosniff");
    return publicResponse;
  }

  // Check authentication for protected routes
  const session = await auth(req);
  const isAuthenticated = !!session?.user;

  // Redirect unauthenticated users to login
  if (!isAuthenticated && !pathname.startsWith("/login")) {
    const loginUrl = new URL("/login", req.url);
    return NextResponse.redirect(loginUrl);
  }

  // Generate per-request nonce for CSP
  const nonce = crypto.randomBytes(16).toString("base64");
  const csp = buildCsp(nonce);

  // Set CSP as a request header so Next.js can read the nonce
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });

  // Also set CSP as a response header for browser enforcement
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), interest-cohort=()");

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - maplibre (maplibre-gl's tile worker bundle, staged into public/ at
     *   build time; it must load as a module script even if the session has
     *   expired, otherwise the redirect to /login is parsed as JS and the
     *   analytics map silently breaks)
     * - public folder
     */
    "/((?!_next/static|_next/image|favicon.ico|maplibre/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
