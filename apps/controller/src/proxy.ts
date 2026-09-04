import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import crypto from "node:crypto";
import { auth } from "@/src/lib/auth";
import { buildCsp } from "@/src/lib/csp";

/** Next.js Proxy: defense-in-depth auth at the edge, before page components. Node runtime. */

export default async function proxy(req: NextRequest) {
  const pathname = req.nextUrl.pathname;

  // Everything the setup flow needs before there is an account to authenticate with. The settings
  // step is deliberately absent: it runs after sign-in and is protected like any other page.
  const isSetupEntry =
    pathname === "/setup" || pathname === "/setup/migrate" || pathname === "/api/setup";

  // Allow public routes
  if (
    pathname === "/login" ||
    pathname === "/portal" ||
    isSetupEntry ||
    pathname.startsWith("/api/auth") ||
    pathname === "/api/health" ||
    pathname.startsWith("/api/v1/") ||
    // Authenticates itself: an agent signs with the secret agreed at pairing, and an unsigned
    // caller is answered 404 rather than being redirected to a login page it cannot use.
    pathname.startsWith("/api/agent/") ||
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

  // An unconfigured deployment serves nothing but the setup flow. Checked after authentication so
  // the stage can tell "has an account but has not signed in" from "signed in, still configuring",
  // and only for page requests — an API call gets its own answer rather than a redirect to HTML.
  if (!pathname.startsWith("/api/")) {
    const { getSetupState, SETUP_PATHS } = await import("@/src/lib/setup");
    const { stage, required } = await getSetupState(isAuthenticated);
    const destination = SETUP_PATHS[stage];
    if (required && pathname !== destination) {
      return NextResponse.redirect(new URL(destination, req.url));
    }
    // Setup is done; nothing should linger on its pages. /setup/done is the exception — it is the
    // summary a migrated deployment is shown *after* completion, and it guards itself.
    if (!required && pathname.startsWith("/setup") && pathname !== "/setup/done") {
      return NextResponse.redirect(new URL("/", req.url));
    }
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
