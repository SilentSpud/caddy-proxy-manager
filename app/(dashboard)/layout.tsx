import type { ReactNode } from "react";
import { requireUser } from "@/src/lib/auth";
import { config } from "@/src/lib/config";
import DashboardLayoutClient from "./DashboardLayoutClient";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const session = await requireUser();
  return (
    <DashboardLayoutClient user={session.user} appName={config.appName}>
      {children}
    </DashboardLayoutClient>
  );
}
