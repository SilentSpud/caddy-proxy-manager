import { requireAdmin } from "@/src/lib/auth";
import { recentRevisions } from "@/src/lib/settings/apply";
import {
  compareRevisions,
  countRevisions,
  oldestRestorable,
  revisionIds,
} from "@/src/lib/settings/revisions";
import { stagedView } from "@/src/lib/settings/staged-view";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import HistoryClient from "./HistoryClient";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings");
  return { title: t("history.title") };
}

const PER_PAGE = 20;

/** A non-negative integer from the query string, or null for anything else. */
function readId(raw: string | string[] | undefined): number | null {
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) return null;
  return Number(raw);
}

/**
 * The applied revisions, and a comparison between two of them.
 *
 * The selection lives in the query string so a comparison is a link an operator can send someone,
 * and the diff is rendered here rather than fetched: it needs the config builder, which only runs
 * on the server anyway.
 */
export default async function SettingsHistoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireAdmin();
  const params = await searchParams;

  const [staged, total, ids, restorableFrom] = await Promise.all([
    stagedView(Number(session.user.id)),
    countRevisions(),
    revisionIds(),
    oldestRestorable(),
  ]);

  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const page = Math.min(Math.max(readId(params.page) ?? 1, 1), pages);
  const revisions = await recentRevisions(PER_PAGE, (page - 1) * PER_PAGE);

  const latest = ids[0] ?? 0;
  const known = new Set([0, ...ids]);
  // By default the latest revision against the one before it: "what did the last apply do".
  const to = readId(params.to) ?? latest;
  const from = readId(params.from) ?? ids.find((id) => id < to) ?? 0;
  const valid = latest > 0 && known.has(to) && known.has(from) && from !== to;
  const comparison = valid ? await compareRevisions(from, to) : null;

  return (
    <HistoryClient
      staged={staged}
      revisions={revisions}
      page={page}
      perPage={PER_PAGE}
      total={total}
      ids={ids}
      latest={latest}
      restorableFrom={restorableFrom}
      selection={latest > 0 ? { from, to } : null}
      comparison={comparison}
    />
  );
}
