import type { ReactNode } from "react";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { getLocaleDirection } from "@astryxdesign/core/i18n";
import "./globals.css";
import Providers from "./providers";
import { config } from "@/src/lib/config";
import { LOCALE_COOKIE, parsePreference } from "@/src/lib/locale";
import { THEME_COOKIE, parseThemeMode, themeAttr } from "@/src/lib/theme-mode";

// Each page sets its own `title`; the template appends APP_NAME. A page opts out with
// `title: { absolute: "..." }` — the forward auth portal does, since it runs on someone else's
// domain and should not name the product guarding the app.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("app");
  return {
    title: {
      default: config.appName,
      template: `%s · ${config.appName}`,
    },
    description: t("description"),
    // Pointed at the route unconditionally rather than looked up here: this is the root layout, so a
    // database read would run on every page of every request. The route answers 404 when no icon has
    // been uploaded, which the browser treats exactly as it treated the missing /favicon.ico before.
    icons: { icon: "/api/branding/favicon" },
  };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const cookieStore = await cookies();
  const themeMode = parseThemeMode(cookieStore.get(THEME_COOKIE)?.value);
  // getLocale() resolves through src/i18n/request.ts, so the cookie and Accept-Language
  // negotiation happen in exactly one place. The preference itself is read separately: the
  // switcher has to tell "chose English" from "we guessed English".
  const locale = await getLocale();
  const messages = await getMessages();
  const localePreference = parsePreference(cookieStore.get(LOCALE_COOKIE)?.value);

  return (
    // data-theme is rendered from the cookie so the first paint is already in the right mode;
    // omitted for "system", which Astryx's reset.css reads as `color-scheme: light dark`.
    // suppressHydrationWarning stays — Astryx's Theme writes data-theme itself once mounted.
    <html
      lang={locale}
      dir={getLocaleDirection(locale)}
      data-theme={themeAttr(themeMode)}
      suppressHydrationWarning
    >
      <body>
        <Providers
          initialThemeMode={themeMode}
          locale={locale}
          localePreference={localePreference}
          messages={messages}
        >
          {children}
        </Providers>
      </body>
    </html>
  );
}
