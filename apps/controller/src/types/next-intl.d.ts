import type messages from "../../messages/en.json";
import type { Locale } from "@/src/lib/locale";

/**
 * Ties next-intl's generics to this app: `getLocale()` returns our union rather than `string`, and
 * `t("...")` only accepts keys that exist. English is the source catalog — a key added to another
 * locale but missing here is a typo, not a translation.
 */
declare module "next-intl" {
  interface AppConfig {
    Locale: Locale;
    Messages: typeof messages;
  }
}
