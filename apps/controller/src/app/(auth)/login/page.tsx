import { redirect } from "next/navigation";
import { auth } from "@/src/lib/auth";
import { getProviderDisplayList } from "@/src/lib/models/oauth-providers";
import { config } from "@/src/lib/config";
import LoginClient from "@/src/components/auth/LoginClient";
import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { oauthCallbackErrorMessage } from "@/src/lib/oauth-callback-error";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.login");
  return { title: t("metaTitle") };
}

interface LoginPageProps {
  /** Set by Better Auth when a single sign-on attempt comes back refused. */
  searchParams: Promise<{ error?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const session = await auth();
  if (session) {
    redirect("/");
  }

  const enabledProviders = await getProviderDisplayList();
  const t = await getTranslations("auth.login");
  const oauthError = oauthCallbackErrorMessage((await searchParams).error, t);

  return (
    <LoginClient
      enabledProviders={enabledProviders}
      localLoginEnabled={!config.auth.disableLocalUsers}
      appName={config.appName}
      initialError={oauthError}
    />
  );
}
