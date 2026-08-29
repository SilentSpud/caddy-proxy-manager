import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import crypto from "node:crypto";
import { auth } from "@/src/lib/auth";

/** Next.js Proxy: defense-in-depth auth at the edge, before page components. Node runtime. */

const isDev = process.env.NODE_ENV === "development";

/** A nonce-based CSP per request; Next.js reads the nonce from the CSP request header. */
function buildCsp(nonce: string): string {
  const directives = [
    "default-src 'self'",
    isDev
      ? `script-src 'self' 'nonce-${nonce}' 'unsafe-eval' https://cdn.jsdelivr.net`
      : `script-src 'self' 'nonce-${nonce}' https://cdn.jsdelivr.net`,
    // style-src still needs 'unsafe-inline' for React JSX inline style props
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net",
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
    // Anti-clickjacking for public pages (/login, /portal): the authenticated branch below sets the
    // full header set, but public responses carried none, leaving those forms framable.
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
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  );

  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except _next/static, _next/image, favicon.ico, the public folder, and maplibre
     * (the tile worker must load as a module script even with an expired session, or the redirect
     * to /login is parsed as JS and the map breaks).
     */
    "/((?!_next/static|_next/image|favicon.ico|maplibre/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
