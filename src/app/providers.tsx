"use client";

import type { ReactNode } from "react";
import NextLink from "next/link";
import { Toaster } from "sonner";
import { LinkProvider } from "@astryxdesign/core/Link";
import { ThemeModeProvider } from "@/src/components/theme/ThemeModeProvider";
import type { ThemeMode } from "@/src/lib/theme-mode";

export default function Providers({
  children,
  initialThemeMode,
}: {
  children: ReactNode;
  initialThemeMode: ThemeMode;
}) {
  return (
    /* Astryx owns light/dark end to end: ThemeModeProvider holds the
       preference and passes it to Astryx's <Theme>, which sets color-scheme
       and syncs `data-theme` to <html>. The theme's tokens are light-dark()
       pairs, so the browser resolves them — including "system". */
    <ThemeModeProvider initialMode={initialThemeMode}>
      {/* Every Astryx component that renders a link (Button, Link, Tab,
          ClickableCard, ...) routes through this, so an href stays a
          client-side navigation instead of a full page load. */}
      <LinkProvider component={NextLink}>
        {/* Astryx's Tooltip manages its own layer, so no tooltip provider is
            needed here any more. */}
        {children}
        <Toaster richColors position="bottom-right" />
      </LinkProvider>
    </ThemeModeProvider>
  );
}
