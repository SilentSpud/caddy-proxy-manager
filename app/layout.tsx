import type { ReactNode } from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
import Providers from "./providers";

// Each page sets its own `title`; the template appends the product name so tabs
// read "Proxy Hosts · Caddy Proxy Manager". A page that should not carry the
// product name — the forward auth portal, which is served on someone else's
// domain — opts out with `title: { absolute: ... }`.
export const metadata: Metadata = {
  title: {
    default: "Caddy Proxy Manager",
    template: "%s · Caddy Proxy Manager",
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
