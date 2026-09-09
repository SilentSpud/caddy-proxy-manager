"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/src/lib/auth";
import { domainError } from "@/src/lib/domain-error";
import {
  createUser,
  updateUserProfile,
  updateUserRole,
  updateUserStatus,
  deleteUser,
  type User,
} from "@/src/lib/models/user";
import { logAuditEvent } from "@/src/lib/audit";
import { config } from "@/src/lib/config";
import { hashPassword } from "@/src/lib/password";
import { getTranslations } from "next-intl/server";
import { actionError, actionSuccess, type ActionState } from "@/src/lib/actions";

const VALID_ROLES = new Set<User["role"]>(["admin", "user", "viewer"]);

async function createUserActionUntranslated(formData: FormData) {
  const session = await requireAdmin();
  const actorId = Number(session.user.id);

  if (config.auth.disableLocalUsers) {
    throw domainError("localUserCreationDisabled");
  }

  const email = String(formData.get("email") ?? "").trim();
  const name = formData.get("name") ? String(formData.get("name")).trim() : null;
  const requestedRole = String(formData.get("role") ?? "user");
  const role = VALID_ROLES.has(requestedRole as User["role"])
    ? (requestedRole as User["role"])
    : "user";
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    throw domainError("emailAndPasswordRequired");
  }

  const passwordHash = await hashPassword(password);

  const user = await createUser({
    email,
    name,
    role,
    provider: "credentials",
    subject: email,
    passwordHash,
  });

  await logAuditEvent({
    userId: actorId,
    action: "create",
    entityType: "user",
    entityId: user.id,
    summary: `Created user ${user.id} (${email}) with role ${role}`,
  });

  revalidatePath("/users");
}

async function updateUserRoleActionUntranslated(userId: number, role: User["role"]) {
  const session = await requireAdmin();
  const actorId = Number(session.user.id);

  if (actorId === userId) {
    throw domainError("cannotChangeOwnRole");
  }

  await updateUserRole(userId, role);

  await logAuditEvent({
    userId: actorId,
    action: "update",
    entityType: "user",
    entityId: userId,
    summary: `Changed user ${userId} role to ${role}`,
  });

  revalidatePath("/users");
}

async function updateUserStatusActionUntranslated(userId: number, status: string) {
  const session = await requireAdmin();
  const actorId = Number(session.user.id);

  if (actorId === userId) {
    throw domainError("cannotChangeOwnStatus");
  }

  await updateUserStatus(userId, status);

  await logAuditEvent({
    userId: actorId,
    action: "update",
    entityType: "user",
    entityId: userId,
    summary: `Changed user ${userId} status to ${status}`,
  });

  revalidatePath("/users");
}

async function updateUserInfoActionUntranslated(userId: number, formData: FormData) {
  const session = await requireAdmin();
  const actorId = Number(session.user.id);

  const name = formData.get("name") ? String(formData.get("name")).trim() : undefined;
  const email = formData.get("email") ? String(formData.get("email")).trim() : undefined;

  await updateUserProfile(userId, { name, email });

  await logAuditEvent({
    userId: actorId,
    action: "update",
    entityType: "user",
    entityId: userId,
    summary: `Updated user ${userId} profile`,
  });

  revalidatePath("/users");
}

async function deleteUserActionUntranslated(userId: number) {
  const session = await requireAdmin();
  const actorId = Number(session.user.id);

  if (actorId === userId) {
    throw domainError("cannotDeleteOwnAccount");
  }

  await deleteUser(userId);

  await logAuditEvent({
    userId: actorId,
    action: "delete",
    entityType: "user",
    entityId: userId,
    summary: `Deleted user ${userId}`,
  });

  revalidatePath("/users");
}

/*
 * Failures here used to reach the browser as an unhandled rejection and show the reader nothing.
 * They return an ActionState now, translated on the server, which UsersClient renders - the same
 * shape the proxy-host and L4 actions already use.
 */

export async function createUserAction(formData: FormData): Promise<ActionState> {
  try {
    await createUserActionUntranslated(formData);
    return actionSuccess();
  } catch (error) {
    const t = await getTranslations();
    console.error("createUserAction failed:", error);
    return actionError(t, error, t("errors.createUserFailed"));
  }
}

export async function updateUserRoleAction(
  userId: number,
  role: User["role"],
): Promise<ActionState> {
  try {
    await updateUserRoleActionUntranslated(userId, role);
    return actionSuccess();
  } catch (error) {
    const t = await getTranslations();
    console.error("updateUserRoleAction failed:", error);
    return actionError(t, error, t("errors.updateUserRoleFailed"));
  }
}

export async function updateUserStatusAction(userId: number, status: string): Promise<ActionState> {
  try {
    await updateUserStatusActionUntranslated(userId, status);
    return actionSuccess();
  } catch (error) {
    const t = await getTranslations();
    console.error("updateUserStatusAction failed:", error);
    return actionError(t, error, t("errors.updateUserStatusFailed"));
  }
}

export async function updateUserInfoAction(
  userId: number,
  formData: FormData,
): Promise<ActionState> {
  try {
    await updateUserInfoActionUntranslated(userId, formData);
    return actionSuccess();
  } catch (error) {
    const t = await getTranslations();
    console.error("updateUserInfoAction failed:", error);
    return actionError(t, error, t("errors.updateUserInfoFailed"));
  }
}

export async function deleteUserAction(userId: number): Promise<ActionState> {
  try {
    await deleteUserActionUntranslated(userId);
    return actionSuccess();
  } catch (error) {
    const t = await getTranslations();
    console.error("deleteUserAction failed:", error);
    return actionError(t, error, t("errors.deleteUserFailed"));
  }
}
