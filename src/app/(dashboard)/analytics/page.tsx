import { requireAdmin } from "@/src/lib/auth";
import AnalyticsClient from "./AnalyticsClient";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Analytics",
};

export default async function AnalyticsPage() {
  await requireAdmin();
  return <AnalyticsClient />;
}
