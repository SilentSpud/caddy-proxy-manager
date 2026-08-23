"use client";

import type { ReactNode } from "react";
import NextLink from "next/link";
import { ThemeProvider, useTheme } from "next-themes";
import { Toaster } from "sonner";
import { Theme } from "@astryxdesign/core";
import { LinkProvider } from "@astryxdesign/core/Link";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";

/**
 * Feeds next-themes' current mode into Astryx.
 *
 * next-themes already owns the toggle and writes the `class` attribute the
 * app's own CSS variables key off, so it stays the source of truth; Astryx is
 * told the same mode rather than being given a second, competing one. `theme`
 * (not `resolvedTheme`) is passed through because Astryx handles "system"
 * itself, and resolvedTheme is undefined on the server and the first client
 * render — using it would flash the wrong mode on load.
 */
function AstryxTheme({ children }: { children: ReactNode }) {
  const { theme } = useTheme();
  const mode = theme === "light" || theme === "dark" ? theme : "system";

  return (
    <Theme theme={neutralTheme} mode={mode}>
      {children}
    </Theme>
  );
}

export default function Providers({ children, nonce }: { children: ReactNode; nonce?: string }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      nonce={nonce}
    >
      <AstryxTheme>
        {/* Every Astryx component that renders a link (Button, Link, Tab,
            ClickableCard, ...) routes through this, so an href stays a
            client-side navigation instead of a full page load. */}
        <LinkProvider component={NextLink}>
          {/* Astryx's Tooltip manages its own layer, so no tooltip provider is
              needed here any more. */}
          {children}
          <Toaster richColors position="bottom-right" />
        </LinkProvider>
      </AstryxTheme>
    </ThemeProvider>
  );
}
