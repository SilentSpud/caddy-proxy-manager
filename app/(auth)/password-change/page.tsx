import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { requireUser } from "@/src/lib/auth";
import { requiresLegacyPasswordChange } from "@/src/lib/services/legacy-password";
import LegacyPasswordChangeForm from "@/src/components/auth/LegacyPasswordChangeForm";

export const metadata: Metadata = {
  title: "Update your password",
};

/**
 * Lives outside the dashboard route group on purpose: the dashboard layout
 * redirects here, so being inside it would loop.
 */
export default async function PasswordChangePage() {
  const session = await requireUser();

  // Reached directly by someone who does not need it — including right after a
  // successful change, when the hash is argon2id and the gate no longer matches.
  if (!(await requiresLegacyPasswordChange(Number(session.user.id)))) {
    redirect("/");
  }

  return <LegacyPasswordChangeForm />;
}
