"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { requireUser } from "@/src/lib/auth";
import { setMoreDrawerPins } from "@/src/lib/models/nav-preferences";
import { MORE_DRAWER_SLOTS, moreDestinations } from "@/src/lib/nav/destinations";

export type SaveDrawerResult = { ok: true } | { ok: false; error: string };

/** Save which pages the signed-in user keeps in their More drawer, in the order given. */
export async function saveMoreDrawerPinsAction(ids: string[]): Promise<SaveDrawerResult> {
  const session = await requireUser();
  const t = await getTranslations("nav.more");

  // Checked against what this user may open, not just against the list of pages that exist: a
  // client that posts "settings" for an operator must not get a pin for a page that refuses them.
  const allowed = new Set(moreDestinations(session.user.role).map((d) => d.id));
  const chosen = [...new Set(ids)].filter((id) => allowed.has(id as never));

  if (chosen.length !== new Set(ids).size) {
    return { ok: false, error: t("errorUnknownPage") };
  }
  if (chosen.length > MORE_DRAWER_SLOTS) {
    return { ok: false, error: t("errorTooMany", { max: MORE_DRAWER_SLOTS }) };
  }

  await setMoreDrawerPins(
    Number(session.user.id),
    chosen as Parameters<typeof setMoreDrawerPins>[1],
  );
  // The drawer is rendered by the dashboard layout, so every page under it has a stale copy.
  revalidatePath("/", "layout");
  return { ok: true };
}
