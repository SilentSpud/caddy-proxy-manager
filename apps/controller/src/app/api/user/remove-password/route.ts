import { type NextRequest, NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { isDemoAdmin } from "@/src/lib/demo-mode";
import { auth, checkSameOrigin } from "@/src/lib/auth";
import { getUserById, listUserOAuthProviders, removeUserPassword } from "@/src/lib/models/user";
import { createAuditEvent } from "@/src/lib/models/audit";
import { isRateLimited, registerFailedAttempt, resetAttempts } from "@/src/lib/rate-limit";
import { verifyPassword } from "@/src/lib/password";

/**
 * Remove the signed-in user's password, so their linked providers are the only way in.
 *
 * The inverse of unlink-oauth, and guarded the same way from the other side: that one refuses to
 * leave an account without a password, this one refuses to leave it without a provider. The
 * current password is asked for again, because a borrowed session should not be enough to lock
 * the owner out of the one credential they hold themselves.
 */
export async function POST(request: NextRequest) {
  const originCheck = checkSameOrigin(request);
  if (originCheck) return originCheck;

  const t = await getTranslations();
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: t("auth.apiErrors.unauthorized") }, { status: 401 });
    }

    const userId = Number(session.user.id);
    // Before the rate limit: this is not a guess, and the model would refuse it anyway.
    if (isDemoAdmin(userId)) {
      return NextResponse.json({ error: t("errors.demoAdminProtected") }, { status: 403 });
    }

    // Shares the change-password budget: both verify the same password, and a separate counter
    // would double the guesses anyone holding the session gets.
    const rateLimitKey = `password-change:${userId}`;
    const rateCheck = await isRateLimited(rateLimitKey);
    if (rateCheck.blocked) {
      return NextResponse.json(
        { error: t("auth.apiErrors.tooManyAttempts") },
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
      return NextResponse.json({ error: t("auth.apiErrors.userNotFound") }, { status: 404 });
    }
    if (!user.passwordHash) {
      return NextResponse.json({ error: t("profile.noPasswordToRemove") }, { status: 400 });
    }

    const providers = await listUserOAuthProviders(userId);
    if (providers.length === 0) {
      return NextResponse.json(
        { error: t("profile.linkProviderBeforeRemovingPassword") },
        { status: 400 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
    if (!currentPassword) {
      return NextResponse.json({ error: t("profile.currentPasswordRequired") }, { status: 400 });
    }
    if (!(await verifyPassword(currentPassword, user.passwordHash))) {
      await registerFailedAttempt(rateLimitKey);
      return NextResponse.json({ error: t("profile.currentPasswordIncorrect") }, { status: 401 });
    }
    resetAttempts(rateLimitKey);

    await removeUserPassword(userId);

    await createAuditEvent({
      userId,
      action: "password_removed",
      entityType: "user",
      entityId: userId,
      summary: `User removed their password; signs in with ${providers.map((p) => p.providerId).join(", ")}`,
      data: JSON.stringify({ providers: providers.map((p) => p.providerId) }),
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Remove password error:", error);
    return NextResponse.json({ error: t("profile.removePasswordFailed") }, { status: 500 });
  }
}
