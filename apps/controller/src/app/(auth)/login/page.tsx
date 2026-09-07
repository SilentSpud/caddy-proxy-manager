import { redirect } from "next/navigation";
import { auth } from "@/src/lib/auth";
import { getProviderDisplayList } from "@/src/lib/models/oauth-providers";
import { config } from "@/src/lib/config";
import LoginClient from "@/src/components/auth/LoginClient";
import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.login");
  return { title: t("metaTitle") };
}

export default async function LoginPage() {
  const session = await auth();
  if (session) {
    redirect("/");
  }

  const enabledProviders = await getProviderDisplayList();

  return (
    <LoginClient
      enabledProviders={enabledProviders}
      localLoginEnabled={!config.auth.disableLocalUsers}
      appName={config.appName}
    />
  );
}
