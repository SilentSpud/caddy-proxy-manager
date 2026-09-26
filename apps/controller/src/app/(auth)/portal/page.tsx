import { localUsersDisabled } from "@/src/lib/auth-policy";
import { auth } from "@/src/lib/auth";
import { getProviderDisplayList } from "@/src/lib/models/oauth-providers";
import {
  isForwardAuthDomain,
  createRedirectIntent,
  redirectIntentWantsCaptcha,
} from "@/src/lib/models/forward-auth";
import { getActiveCaptcha } from "@/src/lib/captcha/settings";
import { cspNonce } from "@/src/lib/csp";
import PortalLoginForm from "./PortalLoginForm";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { oauthCallbackErrorMessage } from "@/src/lib/oauth-callback-error";
import { headers } from "next/headers";
import { getClientIp } from "@/src/lib/client-ip";
import { takeFromWindow } from "@/src/lib/rate-limit";

/** A person opens a handful of protected tabs in ten minutes; a GET loop opens thousands. */
const INTENTS_PER_CLIENT = 30;
const INTENT_WINDOW_MS = 10 * 60_000;

interface PortalPageProps {
  /** `error` is set by Better Auth when a single sign-on attempt comes back refused. */
  searchParams: Promise<{ rd?: string; rid?: string; error?: string }>;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth");
  return {
    // Absolute: the portal fronts other people's apps, so it does not
    // announce the product in the tab title the way the dashboard does.
    title: { absolute: t("authenticationRequired") },
  };
}

export default async function PortalPage({ searchParams }: PortalPageProps) {
  const params = await searchParams;
  const redirectUri = params.rd ?? "";
  // After OAuth callback, the portal is loaded with ?rid= (the opaque ID we created earlier)
  const existingRid = params.rid ?? "";

  // Two entry modes:
  // 1. Fresh from Caddy redirect: ?rd=<full-url> → validate, store server-side, create rid
  // 2. Returning from OAuth: ?rid=<opaque-id> → reuse the existing rid (redirect already stored)
  let targetDomain = "";
  let rid = existingRid;
  if (!rid && redirectUri) {
    try {
      const parsed = new URL(redirectUri);
      if (
        (parsed.protocol === "https:" || parsed.protocol === "http:") &&
        (await isForwardAuthDomain(parsed.hostname))
      ) {
        targetDomain = parsed.hostname;
        // Every GET writes a row, so each client gets a budget; past it the portal shows its
        // generic message rather than another intent.
        const ip = (await getClientIp(await headers())) ?? "unknown";
        if (takeFromWindow(`portal-intent:${ip}`, INTENTS_PER_CLIENT, INTENT_WINDOW_MS)) {
          // Store the redirect URI server-side. The client only gets an opaque ID,
          // so a tampered ?rd= parameter cannot influence the final redirect target.
          rid = await createRedirectIntent(redirectUri);
        }
      }
    } catch {
      // invalid URL - portal will show a generic message
    }
  }

  const [session, enabledProviders, t] = await Promise.all([
    auth(),
    getProviderDisplayList(),
    getTranslations("auth.login"),
  ]);
  const oauthError = oauthCallbackErrorMessage(params.error, t);
  const localLoginEnabled = !(await localUsersDisabled());
  // Per host: an operator can switch it off for one whose users cannot solve it.
  const configured = localLoginEnabled && rid ? await getActiveCaptcha() : null;
  const captcha = configured && (await redirectIntentWantsCaptcha(rid)) ? configured : null;

  return (
    <PortalLoginForm
      rid={rid}
      initialError={oauthError}
      hasRedirect={!!redirectUri || !!existingRid}
      targetDomain={targetDomain}
      enabledProviders={enabledProviders}
      localLoginEnabled={localLoginEnabled}
      captcha={captcha}
      cspNonce={captcha ? cspNonce((await headers()).get("Content-Security-Policy")) : undefined}
      existingSession={
        session
          ? {
              userId: session.user.id,
              name: session.user.name ?? null,
              email: session.user.email ?? null,
            }
          : null
      }
    />
  );
}
