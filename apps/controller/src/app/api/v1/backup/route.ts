import type { NextRequest } from "next/server";
import { apiErrorResponse, requireApiAdmin } from "@/src/lib/api-auth";
import { logAuditEvent } from "@/src/lib/audit";
import { createBackup } from "@/src/lib/backup/service";
import { backupDownload } from "@/src/lib/backup/respond";

/**
 * A backup for scripts and cron. POST with the passphrase in the body, never the query string.
 * Restoring stays in the UI, behind a recent sign-in.
 */
export async function POST(request: NextRequest) {
  try {
    const { userId } = await requireApiAdmin(request);
    const body = await request.json().catch(() => ({}));
    const file = await createBackup(String(body.passphrase ?? ""), {
      auditLog: body.auditLog === true,
      settingsHistory: body.settingsHistory === true,
    });
    await logAuditEvent({
      userId,
      action: "backup_created",
      entityType: "backup",
      summary: "Downloaded a configuration backup",
    });
    return backupDownload(file);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
