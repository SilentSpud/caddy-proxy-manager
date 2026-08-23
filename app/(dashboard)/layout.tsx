import type { ReactNode } from "react";
import { requireUser } from "@/src/lib/auth";
import { config } from "@/src/lib/config";
import { resolveAvatar } from "@/src/lib/avatar";
import { isGravatarEnabled } from "@/src/lib/settings";
import DashboardLayoutClient from "./DashboardLayoutClient";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const session = await requireUser();
  // auth() reads email/role fresh from the database, so the session already
  // carries everything the avatar needs.
  const avatar = resolveAvatar(
    { name: session.user.name, email: session.user.email, avatarUrl: session.user.image },
    64,
    { gravatar: await isGravatarEnabled() },
  );
  return (
    <DashboardLayoutClient user={session.user} avatar={avatar} appName={config.appName}>
      {children}
    </DashboardLayoutClient>
  );
}
