import { type NextRequest, NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { verifyPassword } from "@/src/lib/password";
import db from "@/src/lib/db";
import { config } from "@/src/lib/config";
import { lastHeaderValue } from "@/src/lib/request-headers";
import {
  createForwardAuthSession,
  createExchangeCode,
  checkHostAccess,
  consumeRedirectIntent,
} from "@/src/lib/models/forward-auth";
import { logAuditEvent } from "@/src/lib/audit";
import { isRateLimited, registerFailedAttempt, resetAttempts } from "@/src/lib/rate-limit";

/** Forward auth login - validates credentials and starts the exchange flow, given a rid. */
export async function POST(request: NextRequest) {
  const t = await getTranslations("auth.apiErrors");
  try {
    // CSRF: verify the request originates from the CPM portal
    const origin = request.headers.get("origin");
    const baseOrigin = new URL(config.baseUrl).origin;
    if (!origin || origin !== baseOrigin) {
      return NextResponse.json({ error: t("forbidden") }, { status: 403 });
    }

    // Credential sign-in does not exist in OIDC-only mode; the portal falls
    // back to the provider buttons.
    if (config.auth.disableLocalUsers) {
      return NextResponse.json({ error: t("passwordSignInDisabled") }, { status: 403 });
    }

    const body = await request.json();
    const username = typeof body.username === "string" ? body.username.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const rid = typeof body.rid === "string" ? body.rid : "";

    if (!username || !password) {
      return NextResponse.json({ error: t("credentialsRequired") }, { status: 400 });
    }
    if (!rid) {
      return NextResponse.json({ error: t("missingRedirectIntent") }, { status: 400 });
    }

    // Rate limiting - prefer x-real-ip (set by reverse proxy) over x-forwarded-for
    const ip =
      lastHeaderValue(request.headers.get("x-real-ip")) ||
      lastHeaderValue(request.headers.get("x-forwarded-for")) ||
      "unknown";
    const rateLimitResult = await isRateLimited(ip);
    if (rateLimitResult.blocked) {
      return NextResponse.json({ error: t("tooManyLoginAttempts") }, { status: 429 });
    }

    // Authenticate using the same logic as the credentials provider
    const email = `${username}@localhost`;
    const user = await db.query.users.findFirst({
      where: (table, operators) => operators.eq(table.email, email),
    });

    if (user?.status !== "active" || !user.passwordHash) {
      await registerFailedAttempt(ip);
      await logAuditEvent({
        userId: null,
        action: "forward_auth_login_failed",
        entityType: "user",
        summary: `Forward auth login failed for username: ${username}`,
      });
      return NextResponse.json({ error: t("invalidCredentials") }, { status: 401 });
    }

    const isValid = await verifyPassword(password, user.passwordHash);
    if (!isValid) {
      await registerFailedAttempt(ip);
      await logAuditEvent({
        userId: user.id,
        action: "forward_auth_login_failed",
        entityType: "user",
        entityId: user.id,
        summary: `Forward auth login failed for user ${user.email}`,
      });
      return NextResponse.json({ error: t("invalidCredentials") }, { status: 401 });
    }

    // Successful credential check - reset rate limiter for this IP
    resetAttempts(ip);

    // Consume the redirect intent - returns the server-stored redirect URI.
    // This is a one-time operation: the intent is deleted after consumption.
    const intent = await consumeRedirectIntent(rid);
    if (!intent) {
      return NextResponse.json({ error: t("invalidRedirectIntent") }, { status: 400 });
    }

    const targetUrl = new URL(intent.redirectUri);

    // Check access against the exact proxy-host audience captured by the intent.
    // Re-resolving only by hostname here would allow a changed wildcard mapping
    // to silently change the authorization target mid-flow.
    const hasAccess = await checkHostAccess(user.id, intent.audience.proxyHostId);
    if (!hasAccess) {
      await logAuditEvent({
        userId: user.id,
        action: "forward_auth_access_denied",
        entityType: "proxy_host",
        summary: `Forward auth access denied for user ${user.email} to host ${targetUrl.hostname}`,
      });
      return NextResponse.json({ error: t("noAccessToApplication") }, { status: 403 });
    }

    // Create session and exchange code
    const { session } = await createForwardAuthSession(user.id, intent.audience);
    const { rawCode } = await createExchangeCode(session.id, intent.redirectUri, intent.audience);

    await logAuditEvent({
      userId: user.id,
      action: "forward_auth_login",
      entityType: "user",
      entityId: user.id,
      summary: `Forward auth login for user ${user.email} to ${targetUrl.hostname}`,
    });

    // Build callback URL on the target domain
    const callbackUrl = new URL("/.cpm-auth/callback", intent.audience.origin);
    callbackUrl.searchParams.set("code", rawCode);

    return NextResponse.json({ redirectTo: callbackUrl.toString() });
  } catch (error) {
    console.error("Forward auth login error:", error);
    return NextResponse.json({ error: t("internalServerError") }, { status: 500 });
  }
}
