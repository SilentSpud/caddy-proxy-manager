import { NextResponse } from "next/server";
import { domainErrorMessage } from "@/src/lib/domain-error";
import { TWO_FACTOR_SETUP_PATH, mustEnrollTwoFactor } from "@/src/lib/two-factor-policy";
import { CONSOLE_RESET_TWO_FACTOR_PATH } from "@/src/lib/console-command";
import type { NextRequest } from "next/server";
import crypto from "node:crypto";
import { auth } from "@/src/lib/auth";
import { config as appConfig } from "@/src/lib/config";
import { buildCsp, type CspAdditions } from "@/src/lib/csp";

/** Next.js Proxy: defense-in-depth auth at the edge, before page components. Node runtime. */

const PERMISSIONS_POLICY = "camera=(), microphone=(), geolocation=(), interest-cohort=()";

/** The headers every response this proxy lets through carries, whatever branch it took. */
function applySecurityHeaders(response: NextResponse, csp: string): NextResponse {
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", PERMISSIONS_POLICY);
  // Only over HTTPS: a browser pinned to a scheme this origin does not serve cannot be unpinned.
  if (appConfig.baseUrl.toLowerCase().startsWith("https:")) {
    response.headers.set("Strict-Transport-Security", "max-age=31536000");
  }
  return response;
}

/** A page response with a per-request nonce CSP. vinext reads the nonce from the request's copy. */
function nonceCspResponse(req: NextRequest, extra?: CspAdditions): NextResponse {
  const nonce = crypto.randomBytes(16).toString("base64");
  const csp = buildCsp(nonce, extra);
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("Content-Security-Policy", csp);
  return applySecurityHeaders(NextResponse.next({ request: { headers: requestHeaders } }), csp);
}

/** The configured CAPTCHA's origins, which only the sign-in pages are allowed to load from. */
async function loginCspAdditions(): Promise<CspAdditions | undefined> {
  try {
    const [{ getActiveCaptcha }, { captchaCspSources }] = await Promise.all([
      import("@/src/lib/captcha/settings"),
      import("@/src/lib/captcha/providers"),
    ]);
    const captcha = await getActiveCaptcha();
    return captcha ? captchaCspSources(captcha) : undefined;
  } catch (error) {
    // The widget will be blocked and the form says so; the sign-in page itself must still load.
    console.warn("[proxy] Could not read the CAPTCHA settings:", error);
    return undefined;
  }
}

export default async function proxy(req: NextRequest) {
  const pathname = req.nextUrl.pathname;

  // Everything the setup flow needs before there is an account to authenticate with. The settings
  // step is deliberately absent: it runs after sign-in and is protected like any other page.
  //
  // Listed one path at a time rather than as `/api/setup/*`: that prefix also holds
  // /api/setup/backup, which streams the migrated SQLite file - every account in the deployment -
  // and is admin-only for that reason. Each route below guards itself as well.
  const isSetupEntry =
    pathname === "/setup" ||
    pathname === "/setup/migrate" ||
    pathname === "/api/setup" ||
    pathname === "/api/setup/migrate" ||
    pathname === "/api/setup/restart";

  /** What a request nobody has signed in for gets: /login, /portal and setup pages, public APIs. */
  const publicResponse = async () => {
    // Pages get the same nonce CSP as the dashboard; the sign-in forms are what an injected script
    // would most want to read.
    if (pathname === "/portal") return nonceCspResponse(req, await loginCspAdditions());
    if (!pathname.startsWith("/api/")) return nonceCspResponse(req);

    // Not HTML, so no script policy to enforce - only framing, which still applies to a response
    // a browser renders (better-auth's error page, a JSON viewer).
    const response = applySecurityHeaders(NextResponse.next(), "frame-ancestors 'none'");
    // Says so in the protocol, not only in the README. A client that never reads our docs still
    // sees this on every call, which is the only way a deprecation reaches an integration written
    // years ago by somebody who has moved on.
    if (pathname.startsWith("/api/v1/")) {
      response.headers.set("Deprecation", "true");
      response.headers.set("Link", '</api/graphql>; rel="successor-version"');
    }
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
    // Authenticates itself, twice over: a Bearer token or session for the operator API, and an
    // agent signature for the agent's subscription and mutations. Redirecting an unauthenticated
    // call to /login would answer a GraphQL client with an HTML page it cannot use, and would take
    // the agent protocol down with it.
    pathname === "/api/graphql" ||
    // Authenticates itself: an agent signs with the secret agreed at pairing, and an unsigned
    // caller is answered 404 rather than being redirected to a login page it cannot use.
    pathname.startsWith("/api/agent/") ||
    pathname.startsWith("/api/forward-auth/") ||
    // The sign-in CAPTCHA, solved before there is a session to have.
    pathname === "/api/sign-in/captcha" ||
    // Signed by `cpm-server --reset-2fa` and answered only to loopback; see the route.
    pathname === CONSOLE_RESET_TWO_FACTOR_PATH
  ) {
    return publicResponse();
  }

  // Check authentication for protected routes
  const session = await auth(req);
  const isAuthenticated = !!session?.user;

  // An unconfigured deployment serves nothing but the setup flow.
  //
  // Before the sign-in redirect, so an unconfigured deployment sends an operator somewhere they
  // can act rather than to a form nothing can answer. After authentication, so the stage can tell
  // "has an account but has not signed in" from "signed in, still configuring" - and only for page
  // requests, since an API call gets its own answer rather than a redirect to HTML.
  if (!pathname.startsWith("/api/")) {
    const { getSetupState, SETUP_PATHS } = await import("@/src/lib/setup");
    const { stage, required } = await getSetupState(isAuthenticated);
    const destination = SETUP_PATHS[stage];
    if (required && pathname !== destination) {
      return NextResponse.redirect(new URL(destination, req.url));
    }
    // Setup is done; nothing should linger on its pages. /setup/done is the exception - it is the
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

  // An admin the two-factor policy has caught can only turn it on, or sign out - which lives under
  // /api/auth, public above. Everything else, server actions included, waits until then.
  if (
    isAuthenticated &&
    pathname !== TWO_FACTOR_SETUP_PATH &&
    (await mustEnrollTwoFactor(session))
  ) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { code: "TWO_FACTOR_REQUIRED", error: domainErrorMessage("twoFactorRequired") },
        { status: 403 },
      );
    }
    return NextResponse.redirect(new URL(TWO_FACTOR_SETUP_PATH, req.url));
  }

  // Reached only once the setup gate above is satisfied, which is what lets an unconfigured
  // deployment redirect away from here instead of showing a form nothing can answer.
  if (pathname.startsWith("/login")) {
    return nonceCspResponse(req, await loginCspAdditions());
  }

  return nonceCspResponse(req);
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
