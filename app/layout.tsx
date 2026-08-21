import type { ReactNode } from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
import Providers from "./providers";
import { config } from "@/src/lib/config";

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

function getNonce(csp: string | null): string | undefined {
  if (!csp) return undefined;
  const m = csp.match(/'nonce-([A-Za-z0-9+/=]+)'/);
  return m?.[1];
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const h = await headers();
  const nonce = getNonce(h.get("Content-Security-Policy"));

  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Providers nonce={nonce}>{children}</Providers>
      </body>
    </html>
  );
}
