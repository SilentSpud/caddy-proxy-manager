"use server";

import { revalidatePath } from "next/cache";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireAdmin } from "@/src/lib/auth";
import { actionSuccess, extractErrorMessage, type ActionState } from "@/src/lib/actions";
import { createWafPreset, deleteWafPreset, updateWafPreset } from "@/src/lib/models/waf-presets";
import {
  checkCrsPluginUpdates,
  installCrsPlugin,
  listCrsRegistry,
  setCrsPluginConfig,
  uninstallCrsPlugin,
  updateCrsPlugin,
} from "@/src/lib/models/crs-plugins";
import type { CrsRegistryEntry } from "@/src/lib/crs-plugins/registry";

type FallbackKey =
  | "presetSaveFailed"
  | "presetDeleteFailed"
  | "pluginRegistryFailed"
  | "pluginInstallFailed"
  | "pluginUpdateFailed"
  | "pluginConfigFailed"
  | "pluginUninstallFailed";

async function failure(error: unknown, fallbackKey: FallbackKey) {
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

// ── CRS plugins ──────────────────────────────────────────────────────

export type CrsRegistryListing =
  | { status: "success"; entries: (CrsRegistryEntry & { installedId: number | null })[] }
  | { status: "error"; message: string };

/** Asked for when the tab opens rather than on page load, which would wait on GitHub. */
export async function listCrsRegistryAction(): Promise<CrsRegistryListing> {
  try {
    await requireAdmin();
    return { status: "success", entries: await listCrsRegistry() };
  } catch (error) {
    const result = await failure(error, "pluginRegistryFailed");
    return { status: "error", message: result.message };
  }
}

export async function installCrsPluginAction(name: string): Promise<ActionState> {
  try {
    const session = await requireAdmin();
    const plugin = await installCrsPlugin(name, Number(session.user.id));
    revalidatePath("/waf");
    const t = await getTranslations("waf");
    return actionSuccess(t("pluginInstalled", { name: plugin.name, version: plugin.version }));
  } catch (error) {
    return failure(error, "pluginInstallFailed");
  }
}

export type CrsPluginUpdateCheck =
  | { status: "success"; updates: Record<number, string> }
  | { status: "error"; message: string };

export async function checkCrsPluginUpdatesAction(): Promise<CrsPluginUpdateCheck> {
  try {
    await requireAdmin();
    return { status: "success", updates: Object.fromEntries(await checkCrsPluginUpdates()) };
  } catch (error) {
    const result = await failure(error, "pluginUpdateFailed");
    return { status: "error", message: result.message };
  }
}

export async function updateCrsPluginAction(id: number): Promise<ActionState> {
  try {
    const session = await requireAdmin();
    const plugin = await updateCrsPlugin(id, Number(session.user.id));
    revalidatePath("/waf");
    const t = await getTranslations("waf");
    return actionSuccess(t("pluginUpdated", { name: plugin.name, version: plugin.version }));
  } catch (error) {
    return failure(error, "pluginUpdateFailed");
  }
}

export async function saveCrsPluginConfigAction(
  id: number,
  config: string | null,
): Promise<ActionState> {
  try {
    const session = await requireAdmin();
    const plugin = await setCrsPluginConfig(id, config, Number(session.user.id));
    revalidatePath("/waf");
    const t = await getTranslations("waf");
    return actionSuccess(t("pluginConfigSaved", { name: plugin.name }));
  } catch (error) {
    return failure(error, "pluginConfigFailed");
  }
}

export async function uninstallCrsPluginAction(id: number): Promise<ActionState> {
  try {
    const session = await requireAdmin();
    await uninstallCrsPlugin(id, Number(session.user.id));
    revalidatePath("/waf");
    const t = await getTranslations("waf");
    return actionSuccess(t("pluginUninstalled"));
  } catch (error) {
    return failure(error, "pluginUninstallFailed");
  }
}
