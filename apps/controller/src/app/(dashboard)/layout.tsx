import type { ReactNode } from "react";
import { requireUser } from "@/src/lib/auth";
import { config } from "@/src/lib/config";
import { resolveAvatar } from "@/src/lib/avatar";
import { isGravatarEnabled } from "@/src/lib/settings";
import { getModuleGateState } from "@/src/lib/caddy-build";
import { getUpdateStatus } from "@/src/lib/updates";
import { ModuleGateProvider } from "@/components/caddy-modules/ModuleGate";
import { requiresLegacyPasswordChange } from "@/src/lib/services/legacy-password";
import { redirect } from "next/navigation";
import DashboardLayoutClient from "./DashboardLayoutClient";
import { stagedKeys } from "@/src/lib/settings/staged-view";
import { getMoreDrawerPins } from "@/src/lib/models/nav-preferences";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const session = await requireUser();

  // Gate the whole dashboard rather than individual pages: a user still on a
  // bcrypt hash must land on the reset screen no matter which URL they opened.
  // The reset page lives outside this layout, so this cannot loop.
  if (await requiresLegacyPasswordChange(Number(session.user.id))) {
    redirect("/password-change");
  }

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
  // A cache read, and a background refresh when it has gone stale - never a network round trip on
  // the render path. See lib/updates.ts.
  const updates = await getUpdateStatus();
  // Only admins reach Settings, so nobody else pays for this: one indexed read of a table that is
  // empty unless someone is mid-edit.
  const staged =
    session.user.role === "admin" ? [...(await stagedKeys(Number(session.user.id)))] : [];
  // One indexed read per request, for the phone's More drawer. Null means the user never chose,
  // which is also what keeps the drawer offering to be customized.
  const morePins = await getMoreDrawerPins(Number(session.user.id));
  return (
    <ModuleGateProvider value={moduleGate}>
      <DashboardLayoutClient
        user={session.user}
        avatar={avatar}
        appName={config.appName}
        updateAvailable={updates.updateAvailable}
        stagedKeys={staged}
        morePins={morePins}
      >
        {children}
      </DashboardLayoutClient>
    </ModuleGateProvider>
  );
}
