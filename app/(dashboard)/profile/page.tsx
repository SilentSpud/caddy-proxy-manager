import { requireUser, getCurrentSessionId } from "@/src/lib/auth";
import { getUserById, listUserOAuthProviders } from "@/src/lib/models/user";
import { getProviderDisplayList } from "@/src/lib/models/oauth-providers";
import { listApiTokens } from "@/src/lib/models/api-tokens";
import { listUserSessions } from "@/src/lib/models/sessions";
import ProfileClient from "./ProfileClient";
import { redirect } from "next/navigation";

export default async function ProfilePage() {
  const session = await requireUser();
  const userId = Number(session.user.id);

  const user = await getUserById(userId);
  if (!user) {
    redirect("/login");
  }

  // OAuth connection state comes from the authoritative accounts table — the
  // informational users.provider/subject columns are only a projection (#261).
  const linkedProviders = await listUserOAuthProviders(userId);

  const [enabledProviders, apiTokens, userSessions, currentSessionId] = await Promise.all([
    getProviderDisplayList(),
    listApiTokens(userId),
    listUserSessions(userId),
    getCurrentSessionId(),
  ]);

  const sessions = userSessions.map((s) => ({ ...s, current: s.id === currentSessionId }));

  return (
    <ProfileClient
      user={user}
      linkedProviders={linkedProviders}
      enabledProviders={enabledProviders}
      apiTokens={apiTokens}
      sessions={sessions}
    />
  );
}
