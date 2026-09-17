import UsersClient from "./UsersClient";
import { lastSessionByUser, listUsers } from "@/src/lib/models/user";
import { listGroups } from "@/src/lib/models/groups";
import { requireAdmin } from "@/src/lib/auth";
import { config } from "@/src/lib/config";
import { resolveAvatar } from "@/src/lib/avatar";
import { isGravatarEnabled } from "@/src/lib/settings";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("users") };
}

export default async function UsersPage() {
  await requireAdmin();
  const [allUsers, gravatarEnabled, lastSessions, allGroups] = await Promise.all([
    listUsers(),
    isGravatarEnabled(),
    // Best-effort: the list is still useful without it, and a failure here should not take the
    // page with it.
    lastSessionByUser().catch(() => new Map<number, string>()),
    // The same: memberships are a section of the detail, not the page.
    listGroups().catch(() => []),
  ]);
  // Strip password hashes before sending to client, and resolve each row's icon
  // here - Gravatar hashing needs node:crypto.
  const safeUsers = allUsers.map(({ passwordHash, ...rest }) => ({
    ...rest,
    avatar: resolveAvatar(rest, 72, { gravatar: gravatarEnabled }),
    lastSessionAt: lastSessions.get(rest.id) ?? null,
  }));
  // Only what the detail's groups section needs: who is in each group, not their details.
  const groups = allGroups.map((group) => ({
    id: group.id,
    name: group.name,
    source: group.source,
    memberIds: group.members.map((member) => member.userId),
  }));
  return (
    <UsersClient
      users={safeUsers}
      groups={groups}
      localUsersEnabled={!config.auth.disableLocalUsers}
    />
  );
}
