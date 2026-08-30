import { requireAdmin } from "@/src/lib/auth";
import ApiDocsClient from "./ApiDocsClient";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "API Docs",
};

export default async function ApiDocsPage() {
  await requireAdmin();

  return <ApiDocsClient />;
}
