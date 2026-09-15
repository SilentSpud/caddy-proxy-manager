"use server";

/**
 * The two things an operator can do to an agent they were granted.
 *
 * Rebuilding and renaming, and nothing else. Pairing, unpairing and disabling an agent decide
 * whether the controller talks to that host at all, which is a question about the fleet rather
 * than about the hosts one team runs - so those stay on Settings, behind `requireAdmin`.
 */

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import {
  type ActionState,
  INITIAL_ACTION_STATE,
  actionError,
  actionSuccess,
} from "@/src/lib/actions";
import { applyCaddyBuild } from "@/src/lib/caddy-build";
import { renameAgent } from "@/src/lib/models/agents";
import { assertCanManage, requireAccess } from "@/src/lib/permissions";

export async function rebuildAgentCaddyAction(
  agentRowId: number,
  _prevState: ActionState = INITIAL_ACTION_STATE,
): Promise<ActionState> {
  void _prevState;
  try {
    const access = await requireAccess();
    assertCanManage(access, "agent", agentRowId);
    const status = await applyCaddyBuild(agentRowId);
    revalidatePath("/agents");
    const t = await getTranslations("agents");
    return actionSuccess(status.message ?? t("rebuildTriggered"));
  } catch (error) {
    const t = await getTranslations();
    console.error("Failed to trigger a Caddy rebuild for agent:", agentRowId, error);
    return actionError(t, error, t("errors.rebuildCaddyFailed"));
  }
}

export async function renameAgentAction(
  agentRowId: number,
  _prevState: ActionState = INITIAL_ACTION_STATE,
  formData?: FormData,
): Promise<ActionState> {
  void _prevState;
  try {
    const access = await requireAccess();
    assertCanManage(access, "agent", agentRowId);
    const name = String(formData?.get("name") ?? "").trim();
    const t = await getTranslations();
    if (!name) return actionError(t, null, t("agents.nameRequired"));
    await renameAgent(agentRowId, name);
    revalidatePath("/agents");
    return actionSuccess(t("agents.renamed"));
  } catch (error) {
    const t = await getTranslations();
    console.error("Failed to rename agent:", agentRowId, error);
    return actionError(t, error, t("errors.renameAgentFailed"));
  }
}
