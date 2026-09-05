import type { ReactNode } from "react";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import "./globals.css";
import Providers from "./providers";
import { config } from "@/src/lib/config";
import { THEME_COOKIE, parseThemeMode, themeAttr } from "@/src/lib/theme-mode";

// Each page sets its own `title`; the template appends APP_NAME. A page opts out with
// `title: { absolute: "..." }` — the forward auth portal does, since it runs on someone else's
// domain and should not name the product guarding the app.
export const metadata: Metadata = {
  title: {
    default: config.appName,
    template: `%s · ${config.appName}`,
  },
  description: "Web UI for managing Caddy reverse proxies, certificates, and access control.",
  // Pointed at the route unconditionally rather than looked up here: this is the root layout, so a
  // database read would run on every page of every request. The route answers 404 when no icon has
  // been uploaded, which the browser treats exactly as it treated the missing /favicon.ico before.
  icons: { icon: "/api/branding/favicon" },
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const themeMode = parseThemeMode((await cookies()).get(THEME_COOKIE)?.value);

  return (
    // data-theme is rendered from the cookie so the first paint is already in the right mode;
    // omitted for "system", which Astryx's reset.css reads as `color-scheme: light dark`.
    // suppressHydrationWarning stays — Astryx's Theme writes data-theme itself once mounted.
    <html lang="en" data-theme={themeAttr(themeMode)} suppressHydrationWarning>
      <body>
        <Providers initialThemeMode={themeMode}>{children}</Providers>
      </body>
    </html>
  );
}
