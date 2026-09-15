/**
 * What an administrator may do to an account, shared by the Users page actions, `/api/v1/users`
 * and GraphQL. Each used to keep its own rules, and a string one of them never checked went
 * straight into the role column.
 */

import { domainError } from "./domain-error";
import { isEmailAddress } from "./email-address";
import { APP_ROLES, type AppRole } from "./oidc-groups";
import { isPasswordAcceptable, MIN_PASSWORD_LENGTH } from "./password-policy";

export const USER_STATUSES = ["active", "disabled"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export function isUserRole(value: unknown): value is AppRole {
  return typeof value === "string" && (APP_ROLES as readonly string[]).includes(value);
}

export function isUserStatus(value: unknown): value is UserStatus {
  return typeof value === "string" && (USER_STATUSES as readonly string[]).includes(value);
}

export function assertUserRole(value: unknown): AppRole {
  if (!isUserRole(value)) throw domainError("invalidUserRole");
  return value;
}

export function assertUserStatus(value: unknown): UserStatus {
  if (!isUserStatus(value)) throw domainError("invalidUserStatus");
  return value;
}

/** An administrator acting on their own account could remove the last way to administer this one. */
export function assertNotSelf(
  actorId: number,
  targetId: number,
  code: "cannotChangeOwnRole" | "cannotChangeOwnStatus" | "cannotDeleteOwnAccount",
): void {
  if (actorId === targetId) throw domainError(code);
}

/**
 * Email syntax for an account an administrator creates or edits. Not in the model: an OAuth sign-in
 * writes whatever address its provider asserts, and refusing it there would lock that user out.
 */
export function assertEmailAddress(email: string): void {
  if (!isEmailAddress(email)) throw domainError("emailInvalid");
}

/** The password policy, for a password an administrator chooses on someone else's behalf. */
export function assertAcceptablePassword(password: string): void {
  if (!isPasswordAcceptable(password)) {
    throw domainError("passwordDoesNotMeetPolicy", { min: MIN_PASSWORD_LENGTH });
  }
}
