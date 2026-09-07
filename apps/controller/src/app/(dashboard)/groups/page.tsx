import GroupsClient from "./GroupsClient";
import { listGroups } from "@/src/lib/models/groups";
import { listUsers } from "@/src/lib/models/user";
import { requireAdmin } from "@/src/lib/auth";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("groups") };
}

export default async function GroupsPage() {
  await requireAdmin();
  const [allGroups, allUsers] = await Promise.all([listGroups(), listUsers()]);
  const userList = allUsers.map((u) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
  }));
  return <GroupsClient groups={allGroups} users={userList} />;
}
