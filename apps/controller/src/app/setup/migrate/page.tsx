import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { auth } from "@/src/lib/auth";
import { scanForLegacyDatabases } from "@/src/lib/migration/legacy-database";
import { getSetupState, SETUP_PATHS } from "@/src/lib/setup";
import SetupMigrateClient from "./SetupMigrateClient";

export const metadata: Metadata = {
  title: { absolute: "Migrate an existing installation" },
};

export default async function SetupMigratePage() {
  const session = await auth();
  const { stage } = await getSetupState(!!session?.user);
  if (stage !== "migrate") {
    redirect(SETUP_PATHS[stage]);
  }

  const { candidates, rejected } = scanForLegacyDatabases();

  return (
    <SetupMigrateClient
      candidates={candidates.map((candidate) => ({
        path: candidate.path,
        sizeBytes: candidate.sizeBytes,
        users: candidate.counts.users,
        proxyHosts: candidate.counts.proxyHosts,
        certificates: candidate.counts.certificates,
        lastUpdatedAt: candidate.lastUpdatedAt,
      }))}
      rejected={rejected}
    />
  );
}
