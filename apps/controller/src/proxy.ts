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
  //
  // Listed one path at a time rather than as `/api/setup/*`: that prefix also holds
  // /api/setup/backup, which streams the migrated SQLite file — every account in the deployment —
  // and is admin-only for that reason. Each route below guards itself as well.
  const isSetupEntry =
    pathname === "/setup" ||
    pathname === "/setup/migrate" ||
    pathname === "/api/setup" ||
    pathname === "/api/setup/migrate" ||
    pathname === "/api/setup/restart";

  /** The sparse header set a page nobody has signed in for still needs. */
  const publicPageResponse = () => {
    const response = NextResponse.next();
    // Anti-clickjacking for public pages (/login, /portal): the authenticated branch below sets the
    // full header set, but public responses carried none, leaving those forms framable.
    response.headers.set("X-Frame-Options", "DENY");
    response.headers.set("Content-Security-Policy", "frame-ancestors 'none'");
    response.headers.set("X-Content-Type-Options", "nosniff");
    return response;
  };

  // Allow public routes.
  //
  // `/login` is deliberately NOT here. It used to be, and the effect was that a deployment which
  // had never been set up could not be set up through a browser at all: `/` redirected to `/login`
  // before the setup check ran, and `/login` returned early before it could redirect on to
  // `/setup`. An operator saw a sign-in form for an account that did not exist, with no way
  // forward but guessing the URL. It is handled below instead, after the setup state is known.
  if (
    pathname === "/portal" ||
    isSetupEntry ||
    pathname.startsWith("/api/auth") ||
    pathname === "/api/health" ||
    // The login, portal and setup pages all render before there is a session, and a favicon that
    // redirected to /login would leave every unauthenticated page without one. It is branding, not
    // a secret: anyone who can reach the instance can already see it in their tab.
    pathname === "/api/branding/favicon" ||
    pathname.startsWith("/api/v1/") ||
    // Authenticates itself: an agent signs with the secret agreed at pairing, and an unsigned
    // caller is answered 404 rather than being redirected to a login page it cannot use.
    pathname.startsWith("/api/agent/") ||
    pathname.startsWith("/api/forward-auth/")
  ) {
    return publicPageResponse();
  }

  // Check authentication for protected routes
  const session = await auth(req);
  const isAuthenticated = !!session?.user;

  // An unconfigured deployment serves nothing but the setup flow.
  //
  // Before the sign-in redirect, so an unconfigured deployment sends an operator somewhere they
  // can act rather than to a form nothing can answer. After authentication, so the stage can tell
  // "has an account but has not signed in" from "signed in, still configuring" — and only for page
  // requests, since an API call gets its own answer rather than a redirect to HTML.
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

  // Redirect unauthenticated users to login
  if (!isAuthenticated && !pathname.startsWith("/login")) {
    const loginUrl = new URL("/login", req.url);
    return NextResponse.redirect(loginUrl);
  }

  // Reached only once the setup gate above is satisfied, which is what lets an unconfigured
  // deployment redirect away from here instead of showing a form nothing can answer.
  if (pathname.startsWith("/login")) {
    return publicPageResponse();
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
