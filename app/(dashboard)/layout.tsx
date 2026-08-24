import type { ReactNode } from "react";
import { requireUser } from "@/src/lib/auth";
import { config } from "@/src/lib/config";
import { resolveAvatar } from "@/src/lib/avatar";
import { isGravatarEnabled } from "@/src/lib/settings";
import { getModuleGateState } from "@/src/lib/caddy-build";
import { ModuleGateProvider } from "@/components/caddy-modules/ModuleGate";
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
  // Resolved once for the whole dashboard rather than per page: every page that
  // shows a module-backed control needs the same answer, and it only changes
  // when an admin saves Settings → Caddy Build.
  const moduleGate = await getModuleGateState();
  return (
    <ModuleGateProvider value={moduleGate}>
      <DashboardLayoutClient user={session.user} avatar={avatar} appName={config.appName}>
        {children}
      </DashboardLayoutClient>
    </ModuleGateProvider>
  );
}
