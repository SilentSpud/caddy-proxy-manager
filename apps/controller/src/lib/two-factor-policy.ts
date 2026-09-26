import type { Session } from "./auth";
import { getTwoFactorPolicySettings } from "./settings";

/** Where an admin the policy has caught is sent to turn 2FA on. Outside the dashboard layout. */
export const TWO_FACTOR_SETUP_PATH = "/two-factor-setup";

/**
 * Whether this session belongs to an admin who has to turn on 2FA before doing anything else.
 * Only a password account: an admin who signs in through single sign-on has no password for a
 * second factor to protect, and their identity provider decides that.
 */
export async function mustEnrollTwoFactor(session: Session | null): Promise<boolean> {
  const user = session?.user;
  if (user?.role !== "admin" || !user.hasPassword || user.twoFactorEnabled) return false;
  return (await getTwoFactorPolicySettings()).requireForAdmins;
}
