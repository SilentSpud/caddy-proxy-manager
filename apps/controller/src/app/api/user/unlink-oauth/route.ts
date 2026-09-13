import { type NextRequest, NextResponse } from "next/server";
import { auth, checkSameOrigin } from "@/src/lib/auth";
import { getUserById } from "@/src/lib/models/user";
import { createAuditEvent } from "@/src/lib/models/audit";
import { isRateLimited, registerFailedAttempt, resetAttempts } from "@/src/lib/rate-limit";
import { verifyPassword } from "@/src/lib/password";
import db from "@/src/lib/db";
import { accounts } from "@/src/lib/db/schema";
import { and, eq, ne } from "drizzle-orm";

/**
 * Unlink the signed-in user's providers, leaving their password as the only way in.
 *
 * The current password is asked for, as remove-password asks for it from the other side: a
 * borrowed session must not be enough to strip the owner's single sign-on.
 */
export async function POST(request: NextRequest) {
  const originCheck = checkSameOrigin(request);
  if (originCheck) return originCheck;

  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = Number(session.user.id);
    // The change-password budget: every route verifying this password shares one counter.
    const rateLimitKey = `password-change:${userId}`;
    const rateCheck = await isRateLimited(rateLimitKey);
    if (rateCheck.blocked) {
      return NextResponse.json(
        { error: "Too many attempts. Please try again later." },
        {
          status: 429,
          headers: rateCheck.retryAfterMs
            ? { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) }
            : undefined,
        },
      );
    }

    const user = await getUserById(userId);

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Must have a password before unlinking OAuth
    if (!user.passwordHash) {
      return NextResponse.json(
        { error: "Cannot unlink OAuth: You must set a password first" },
        { status: 400 },
      );
    }

    // Check if user has any OAuth account links
    const oauthAccounts = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.userId, userId), ne(accounts.providerId, "credential")));

    if (oauthAccounts.length === 0) {
      return NextResponse.json({ error: "No OAuth account to unlink" }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const currentPassword = typeof body?.currentPassword === "string" ? body.currentPassword : "";
    if (!currentPassword) {
      return NextResponse.json({ error: "Current password is required" }, { status: 400 });
    }
    if (!(await verifyPassword(currentPassword, user.passwordHash))) {
      await registerFailedAttempt(rateLimitKey);
      return NextResponse.json({ error: "Current password is incorrect" }, { status: 401 });
    }
    resetAttempts(rateLimitKey);

    const previousProvider = oauthAccounts[0].providerId;

    // Delete the OAuth account link(s)
    await db
      .delete(accounts)
      .where(and(eq(accounts.userId, userId), ne(accounts.providerId, "credential")));

    // Re-derive users.provider/subject from the (now OAuth-free) accounts rows
    // so the Profile page stops reporting the account as linked (#261).
    const { syncUserOAuthIdentity } = await import("@/src/lib/models/user");
    await syncUserOAuthIdentity(userId);

    // Audit log
    await createAuditEvent({
      userId,
      action: "oauth_unlinked",
      entityType: "user",
      entityId: userId,
      summary: `User unlinked OAuth account: ${previousProvider}`,
      data: JSON.stringify({ provider: previousProvider }),
    });

    return NextResponse.json({
      success: true,
      message: "OAuth account unlinked successfully",
    });
  } catch (error) {
    console.error("OAuth unlink error:", error);
    return NextResponse.json({ error: "Failed to unlink OAuth account" }, { status: 500 });
  }
}
