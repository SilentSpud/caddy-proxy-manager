import { getUserById } from "../models/user";
import { isLegacyPasswordHash } from "../password";
import { isLegacyPasswordChangeRequired } from "../settings";

/**
 * Whether this user has to change their password before they may use the app.
 *
 * True only when the policy is switched on *and* the user still has a bcrypt
 * hash. Changing the password rehashes it with argon2id, which is what clears
 * the requirement — so this is self-resolving rather than a permanent gate.
 *
 * Federated users are never caught by it: an OAuth/OIDC account has no password
 * hash at all, so there is nothing for them to change and no way for them to
 * satisfy the check if it were enforced.
 */
export async function requiresLegacyPasswordChange(userId: number): Promise<boolean> {
  if (!(await isLegacyPasswordChangeRequired())) return false;
  const user = await getUserById(userId);
  return isLegacyPasswordHash(user?.passwordHash);
}
