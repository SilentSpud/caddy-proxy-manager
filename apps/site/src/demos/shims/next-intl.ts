/**
 * Stands in for `next-intl` inside the demos (see the alias in astro.config.mjs).
 *
 * next-intl is a thin Next.js wrapper around `use-intl`, and the controller's components only reach
 * for its client hooks - `useTranslations`, plus `useLocale` and `useFormatter` for country names
 * and relative times. Re-exporting the framework-agnostic package keeps the real message catalog
 * and the real formatting behaviour without pulling a Next runtime into a static Astro site. `IntlProvider` is next-intl's `NextIntlClientProvider` under another name.
 */
export {
  IntlProvider,
  useFormatter,
  useLocale,
  useNow,
  useTimeZone,
  useTranslations,
} from "use-intl";
