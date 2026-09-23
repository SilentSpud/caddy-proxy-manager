"use server";

import { revalidatePath } from "next/cache";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireAdmin } from "@/src/lib/auth";
import { actionSuccess, extractErrorMessage, type ActionState } from "@/src/lib/actions";
import { createWafPreset, deleteWafPreset, updateWafPreset } from "@/src/lib/models/waf-presets";

async function failure(error: unknown, fallbackKey: "presetSaveFailed" | "presetDeleteFailed") {
  const [t, format] = await Promise.all([getTranslations(), getFormatter()]);
  return {
    status: "error",
    message: extractErrorMessage(t, error, t(`waf.${fallbackKey}`), format),
  } satisfies ActionState;
}

/** Creates when the form carries no id, updates otherwise. */
export async function saveWafPresetAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const session = await requireAdmin();
    const userId = Number(session.user.id);
    const input = {
      name: String(formData.get("name") ?? ""),
      description: String(formData.get("description") ?? ""),
      directives: String(formData.get("directives") ?? ""),
    };
    const id = Number(formData.get("id"));
    const t = await getTranslations("waf");
    if (Number.isInteger(id) && id > 0) {
      await updateWafPreset(id, input, userId);
      revalidatePath("/waf");
      return actionSuccess(t("presetUpdated", { name: input.name.trim() }));
    }
    await createWafPreset(input, userId);
    revalidatePath("/waf");
    return actionSuccess(t("presetCreated", { name: input.name.trim() }));
  } catch (error) {
    return failure(error, "presetSaveFailed");
  }
}

export async function deleteWafPresetAction(id: number): Promise<ActionState> {
  try {
    const session = await requireAdmin();
    await deleteWafPreset(id, Number(session.user.id));
    revalidatePath("/waf");
    const t = await getTranslations("waf");
    return actionSuccess(t("presetDeleted"));
  } catch (error) {
    return failure(error, "presetDeleteFailed");
  }
}
