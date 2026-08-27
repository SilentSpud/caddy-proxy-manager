import type { ReactNode } from "react";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import "./globals.css";
import Providers from "./providers";
import { config } from "@/src/lib/config";
import { THEME_COOKIE, parseThemeMode, themeAttr } from "@/src/lib/theme-mode";

// Each page sets its own `title`; the template appends the app name so tabs read
// "Proxy Hosts · Caddy Proxy Manager". APP_NAME renames it everywhere.
//
// A page opts out of the suffix with `title: { absolute: "..." }`, which Next
// uses verbatim instead of filling the template. The forward auth portal does
// this: it is served on someone else's domain, so it should not announce which
// product is guarding the app behind it.
export const metadata: Metadata = {
  title: {
    default: config.appName,
    template: `%s · ${config.appName}`,
  },
  description: "Web UI for managing Caddy reverse proxies, certificates, and access control.",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const themeMode = parseThemeMode((await cookies()).get(THEME_COOKIE)?.value);

  return (
    // data-theme is rendered here, from the cookie, so the very first paint is
    // already in the right mode — Astryx's reset.css maps the attribute to
    // color-scheme, and its tokens are light-dark() pairs that follow. Omitted
    // for "system", which reset.css treats as `color-scheme: light dark`.
    //
    // suppressHydrationWarning stays: Astryx's Theme also writes data-theme and
    // data-astryx-theme onto <html> once mounted.
    <html lang="en" data-theme={themeAttr(themeMode)} suppressHydrationWarning>
      <body>
        <Providers initialThemeMode={themeMode}>{children}</Providers>
      </body>
    </html>
  );
}
