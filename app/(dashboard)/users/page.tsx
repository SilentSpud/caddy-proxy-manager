import UsersClient from "./UsersClient";
import { listUsers } from "@/src/lib/models/user";
import { requireAdmin } from "@/src/lib/auth";
import { config } from "@/src/lib/config";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Users",
};

export default async function UsersPage() {
  await requireAdmin();
  const allUsers = await listUsers();
  // Strip password hashes before sending to client
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const safeUsers = allUsers.map(({ passwordHash, ...rest }) => rest);
  return <UsersClient users={safeUsers} localUsersEnabled={!config.auth.disableLocalUsers} />;
}
