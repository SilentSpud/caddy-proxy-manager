import { requireAdmin } from "@/src/lib/auth";
import ApiDocsClient from "./ApiDocsClient";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("apiDocs") };
}

export default async function ApiDocsPage() {
  await requireAdmin();

  return <ApiDocsClient />;
}
