import UsersClient from "./UsersClient";
import { listUsers } from "@/src/lib/models/user";
import { requireAdmin } from "@/src/lib/auth";
import { config } from "@/src/lib/config";
import { resolveAvatar } from "@/src/lib/avatar";
import { isGravatarEnabled } from "@/src/lib/settings";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Users",
};

export default async function UsersPage() {
  await requireAdmin();
  const allUsers = await listUsers();
  const gravatarEnabled = await isGravatarEnabled();
  // Strip password hashes before sending to client, and resolve each row's icon
  // here — Gravatar hashing needs node:crypto.
  const safeUsers = allUsers.map(({ passwordHash, ...rest }) => ({
    ...rest,
    avatar: resolveAvatar(rest, 72, { gravatar: gravatarEnabled }),
  }));
  return <UsersClient users={safeUsers} localUsersEnabled={!config.auth.disableLocalUsers} />;
}
