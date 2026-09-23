import { localUsersDisabled } from "@/src/lib/auth-policy";
import { type NextRequest, NextResponse } from "next/server";
import {
  auth,
  checkSameOrigin,
  FRESH_SESSION_MAX_AGE_MS,
  getCurrentSessionInfo,
  isFreshSession,
} from "@/src/lib/auth";
import { getUserById, updateUserPassword } from "@/src/lib/models/user";
import { revokeSessionsAfterPasswordChange } from "@/src/lib/models/sessions";
import { createAuditEvent } from "@/src/lib/models/audit";
import { isRateLimited, registerFailedAttempt, resetAttempts } from "@/src/lib/rate-limit";
import { hashPassword, verifyPassword } from "@/src/lib/password";
import { getTranslations } from "next-intl/server";
import { isDemoAdmin } from "@/src/lib/demo-mode";
import { passwordPolicyMessage } from "@/src/lib/password-policy-message";

export async function POST(request: NextRequest) {
  const originCheck = checkSameOrigin(request);
  if (originCheck) return originCheck;

  // Outside the try: the catch below answers in the reader's language too. The profile screen and
  // the forced password change both show `error` as it comes.
  const t = await getTranslations();
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: t("auth.apiErrors.unauthorized") }, { status: 401 });
    }

    // No local passwords exist in OIDC-only mode - setting one would create a
    // credential path around the IdP.
    if (await localUsersDisabled()) {
      return NextResponse.json(
        { error: t("auth.apiErrors.passwordManagementDisabled") },
        { status: 403 },
      );
    }

    // Before the rate limit: this is not a guess, and the model would refuse it anyway.
    if (isDemoAdmin(Number(session.user.id))) {
      return NextResponse.json({ error: t("errors.demoAdminProtected") }, { status: 403 });
    }

    // Rate limit password change attempts to prevent brute-forcing current password
    const rateLimitKey = `password-change:${session.user.id}`;
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

    const body = await request.json();
    const { currentPassword, newPassword } = body;

    const policyError = passwordPolicyMessage(
      t,
      newPassword ?? "",
      t("passwordPolicy.subject.newPassword"),
    );
    if (policyError) {
      return NextResponse.json({ error: policyError }, { status: 400 });
    }

    const userId = Number(session.user.id);
    const user = await getUserById(userId);

    if (!user) {
      return NextResponse.json({ error: t("auth.apiErrors.userNotFound") }, { status: 404 });
    }

    const currentSession = await getCurrentSessionInfo(request);

    // If user has a password, verify current password
    if (user.passwordHash) {
      if (!currentPassword) {
        return NextResponse.json(
          { error: t("auth.apiErrors.currentPasswordRequired") },
          { status: 400 },
        );
      }

      const isValid = await verifyPassword(currentPassword, user.passwordHash);
      if (!isValid) {
        await registerFailedAttempt(rateLimitKey);
        return NextResponse.json(
          { error: t("auth.apiErrors.currentPasswordIncorrect") },
          { status: 401 },
        );
      }
    } else if (!isFreshSession(currentSession)) {
      // A first password is a new way in, and a password lets the IdP be unlinked afterwards - so a
      // borrowed session must not be enough, as remove-password already insists. With no current
      // password to ask for, a recent provider sign-in is the proof.
      return NextResponse.json(
        {
          error: t("profile.reauthRequiredToSetPassword", {
            minutes: FRESH_SESSION_MAX_AGE_MS / 60_000,
          }),
          code: "reauth-required",
        },
        { status: 403 },
      );
    }

    // Password verified successfully - reset rate limit counter
    resetAttempts(rateLimitKey);

    // Hash new password
    const newPasswordHash = await hashPassword(newPassword);

    // Update password
    await updateUserPassword(userId, newPasswordHash);

    // A changed password has to end whoever else was signed in with the old one.
    await revokeSessionsAfterPasswordChange(userId, currentSession?.id ?? null);

    // Audit log
    await createAuditEvent({
      userId,
      action: user.passwordHash ? "password_changed" : "password_set",
      entityType: "user",
      entityId: userId,
      summary: user.passwordHash ? "User changed their password" : "User set a password",
    });

    return NextResponse.json({
      success: true,
      message: "Password updated successfully",
    });
  } catch (error) {
    console.error("Password change error:", error);
    return NextResponse.json({ error: t("auth.passwordChange.failed") }, { status: 500 });
  }
}
