import { requireUser, getCurrentSessionId } from "@/src/lib/auth";
import { getUserById } from "@/src/lib/models/user";
import { getProviderDisplayList } from "@/src/lib/models/oauth-providers";
import { listApiTokens } from "@/src/lib/models/api-tokens";
import { listUserSessions } from "@/src/lib/models/sessions";
import { config } from "@/src/lib/config";
import { resolveAvatar } from "@/src/lib/avatar";
import { isGravatarEnabled } from "@/src/lib/settings";
import ProfileClient from "./ProfileClient";
import { redirect } from "next/navigation";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Profile",
};

export default async function ProfilePage() {
  const session = await requireUser();
  const userId = Number(session.user.id);

  const user = await getUserById(userId);
  if (!user) {
    redirect("/login");
  }

  const [enabledProviders, apiTokens, userSessions, currentSessionId] = await Promise.all([
    getProviderDisplayList(),
    listApiTokens(userId),
    listUserSessions(userId),
    getCurrentSessionId(),
  ]);

  const sessions = userSessions.map((s) => ({ ...s, current: s.id === currentSessionId }));
  const gravatarEnabled = await isGravatarEnabled();

  return (
    <ProfileClient
      user={user}
      enabledProviders={enabledProviders}
      apiTokens={apiTokens}
      sessions={sessions}
      localPasswordsEnabled={!config.auth.disableLocalUsers}
      avatar={resolveAvatar(user, 160, { gravatar: gravatarEnabled })}
    />
  );
}
