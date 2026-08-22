import { redirect } from "next/navigation";
import { auth } from "@/src/lib/auth";
import { getProviderDisplayList } from "@/src/lib/models/oauth-providers";
import { config } from "@/src/lib/config";
import LoginClient from "@/src/components/auth/LoginClient";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sign In",
};

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
