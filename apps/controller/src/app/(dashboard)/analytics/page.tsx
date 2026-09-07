import { requireAdmin } from "@/src/lib/auth";
import AnalyticsClient from "./AnalyticsClient";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("analytics") };
}

export default async function AnalyticsPage() {
  await requireAdmin();
  return <AnalyticsClient />;
}
