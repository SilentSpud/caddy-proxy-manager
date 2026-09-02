import { type NextRequest, NextResponse } from "next/server";
import { auth, checkSameOrigin } from "@/src/lib/auth";
import { getUserById, updateUserPassword } from "@/src/lib/models/user";
import { createAuditEvent } from "@/src/lib/models/audit";
import { isRateLimited, registerFailedAttempt, resetAttempts } from "@/src/lib/rate-limit";
import { config } from "@/src/lib/config";
import { hashPassword, verifyPassword } from "@/src/lib/password";
import { passwordPolicyError } from "@/src/lib/password-policy";

export async function POST(request: NextRequest) {
  const originCheck = checkSameOrigin(request);
  if (originCheck) return originCheck;

  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // No local passwords exist in OIDC-only mode — setting one would create a
    // credential path around the IdP.
    if (config.auth.disableLocalUsers) {
      return NextResponse.json(
        { error: "Password management is disabled. Sign-in is handled by the OIDC provider." },
        { status: 403 },
      );
    }

    // Rate limit password change attempts to prevent brute-forcing current password
    const rateLimitKey = `password-change:${session.user.id}`;
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

    const body = await request.json();
    const { currentPassword, newPassword } = body;

    const policyError = passwordPolicyError(newPassword ?? "", "New password");
    if (policyError) {
      return NextResponse.json({ error: policyError }, { status: 400 });
    }

    const userId = Number(session.user.id);
    const user = await getUserById(userId);

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // If user has a password, verify current password
    if (user.passwordHash) {
      if (!currentPassword) {
        return NextResponse.json({ error: "Current password is required" }, { status: 400 });
      }

      const isValid = await verifyPassword(currentPassword, user.passwordHash);
      if (!isValid) {
        await registerFailedAttempt(rateLimitKey);
        return NextResponse.json({ error: "Current password is incorrect" }, { status: 401 });
      }
    }

    // Password verified successfully — reset rate limit counter
    resetAttempts(rateLimitKey);

    // Hash new password
    const newPasswordHash = await hashPassword(newPassword);

    // Update password
    await updateUserPassword(userId, newPasswordHash);

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
    return NextResponse.json({ error: "Failed to change password" }, { status: 500 });
  }
}
