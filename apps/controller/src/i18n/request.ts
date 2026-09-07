import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { LOCALE_COOKIE, resolveLocale } from "@/src/lib/locale";

/**
 * vinext discovers this file by path and registers the `next-intl/config` alias itself, so there
 * is no `createNextIntlPlugin` in next.config.mjs — the wrapper reads `next/package.json` and
 * throws under Vite. Moving or renaming this file silently disables next-intl.
 */
export default getRequestConfig(async () => {
  const [cookieStore, headerList] = await Promise.all([cookies(), headers()]);
  const locale = resolveLocale(
    cookieStore.get(LOCALE_COOKIE)?.value,
    headerList.get("accept-language"),
  );

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
