import { getAppName } from "@/src/lib/app-name";
import type { ReactNode } from "react";
import { requireUser } from "@/src/lib/auth";
import { isDemoMode } from "@/src/lib/demo-mode";
import { SQLITE_NOTICE_COOKIE, sqliteNoticeApplies } from "@/src/lib/sqlite-notice";
import { cookies } from "next/headers";
import { resolveAvatar } from "@/src/lib/avatar";
import { isGravatarEnabled } from "@/src/lib/settings";
import { getTranslations } from "next-intl/server";
import { getModuleGateState } from "@/src/lib/caddy-build";
import { caddyModuleName } from "@/src/lib/caddy-module-messages";
import { getUpdateStatus } from "@/src/lib/updates";
import { ModuleGateProvider } from "@/components/caddy-modules/ModuleGate";
import { requiresLegacyPasswordChange } from "@/src/lib/services/legacy-password";
import { redirect } from "next/navigation";
import DashboardLayoutClient from "./DashboardLayoutClient";
import { inArray } from "drizzle-orm";
import db from "@/src/lib/db";
import { groups } from "@/src/lib/db/schema";
import { stagedKeys } from "@/src/lib/settings/staged-view";
import { getMoreDrawerPins } from "@/src/lib/models/nav-preferences";
import { getTableDensity } from "@/src/lib/models/table-density";
import { TableDensityProvider } from "@/components/ui/TableDensity";

/** Names for the banner, in the order the ids were chosen. */
async function groupNames(ids: number[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select({ id: groups.id, name: groups.name })
    .from(groups)
    .where(inArray(groups.id, ids));
  const byId = new Map(rows.map((row) => [row.id, row.name]));
  return ids.map((id) => byId.get(id)).filter((name): name is string => Boolean(name));
}

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const session = await requireUser();
  const userId = Number(session.user.id);
  // For the module names the gate's tooltip gives; the catalog is already loaded for the request.
  const t = await getTranslations();

  // Every read below is independent, so they share one round trip; this runs on every dashboard
  // navigation, which is what makes the serial version worth avoiding.
  const [mustChangePassword, gravatar, moduleGate, updates, stagedSet, morePins, tableDensity] =
    await Promise.all([
      requiresLegacyPasswordChange(userId),
      isGravatarEnabled(),
      // Resolved once for the whole dashboard rather than per page: every page that
      // shows a module-backed control needs the same answer, and it only changes
      // when an admin saves Settings → Caddy Build.
      getModuleGateState((module) => caddyModuleName(t, module)),
      // A cache read, and a background refresh when it has gone stale - never a network round trip
      // on the render path. See lib/updates.ts.
      getUpdateStatus(),
      // Only admins reach Settings, so nobody else pays for this: one indexed read of a table that
      // is empty unless someone is mid-edit.
      session.user.role === "admin" ? stagedKeys(userId) : null,
      // One indexed read per request, for the phone's More drawer. Null means the user never chose,
      // which is also what keeps the drawer offering to be customized.
      getMoreDrawerPins(userId),
      // The same shape of read, for how tightly this user's tables are set.
      getTableDensity(userId),
    ]);

  // Gate the whole dashboard rather than individual pages: a user still on a
  // bcrypt hash must land on the reset screen no matter which URL they opened.
  // The reset page lives outside this layout, so this cannot loop.
  if (mustChangePassword) {
    redirect("/password-change");
  }

  // auth() reads email/role fresh from the database, so the session already
  // carries everything the avatar needs.
  const avatar = resolveAvatar(
    { name: session.user.name, email: session.user.email, avatarUrl: session.user.image },
    64,
    { gravatar },
  );
  const staged = stagedSet ? [...stagedSet] : [];
  const sqliteNotice = sqliteNoticeApplies() && !(await cookies()).get(SQLITE_NOTICE_COOKIE);
  return (
    <ModuleGateProvider value={moduleGate}>
      <TableDensityProvider initial={tableDensity}>
        <DashboardLayoutClient
          user={session.user}
          avatar={avatar}
          appName={await getAppName()}
          demoMode={isDemoMode()}
          sqliteNotice={sqliteNotice}
          updateAvailable={updates.updateAvailable}
          stagedKeys={staged}
          morePins={morePins}
          viewAs={
            session.viewAs
              ? { role: session.viewAs.role, groupNames: await groupNames(session.viewAs.groupIds) }
              : null
          }
        >
          {children}
        </DashboardLayoutClient>
      </TableDensityProvider>
    </ModuleGateProvider>
  );
}
