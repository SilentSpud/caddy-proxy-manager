"use client";

import type { ReactNode } from "react";
import NextLink from "next/link";
import { Toaster } from "sonner";
import { NextIntlClientProvider } from "next-intl";
import type { AbstractIntlMessages } from "next-intl";
import { LinkProvider } from "@astryxdesign/core/Link";
import { LocaleProvider } from "@/src/components/locale/LocaleProvider";
import { ThemeModeProvider } from "@/src/components/theme/ThemeModeProvider";
import type { Locale, LocalePreference } from "@/src/lib/locale";
import type { ThemeMode } from "@/src/lib/theme-mode";

export default function Providers({
  children,
  initialThemeMode,
  locale,
  localePreference,
  messages,
}: {
  children: ReactNode;
  initialThemeMode: ThemeMode;
  locale: Locale;
  localePreference: LocalePreference;
  messages: AbstractIntlMessages;
}) {
  return (
    /* `locale` and `messages` are passed explicitly rather than inherited from the request config.
       vinext renders RSC and SSR in separate environments, and next-intl's server context does not
       cross that boundary — left to infer them, the provider throws during the SSR pass and the
       page 500s with the RSC payload already rendered correctly. */
    <NextIntlClientProvider locale={locale} messages={messages}>
      {/* Holds the language preference and hands the locale to Astryx, whose own components carry
          strings this app never writes. */}
      <LocaleProvider locale={locale} preference={localePreference}>
        {/* Astryx owns light/dark end to end: ThemeModeProvider holds the
            preference and passes it to Astryx's <Theme>, which sets color-scheme
            and syncs `data-theme` to <html>. The theme's tokens are light-dark()
            pairs, so the browser resolves them — including "system". */}
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
      </LocaleProvider>
    </NextIntlClientProvider>
  );
}
