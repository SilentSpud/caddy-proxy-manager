/**
 * Which language the UI renders in. Deliberately no `/[locale]` URL segment: `src/proxy.ts`
 * authorizes on path prefixes, forward auth runs the portal on someone else's domain, and the
 * REST API is versioned by path — a locale prefix would have to be threaded through all three.
 * The preference is a cookie instead, exactly like the colour mode in `theme-mode.ts`.
 */

/** Every locale with a catalog in `messages/`. Adding one is a file here and a file there. */
export const LOCALES = ["en"] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

/**
 * Cookie rather than localStorage, for the same reason the theme is: the server picks the catalog
 * and renders `<html lang>` on the first paint, so it has to know the choice before React runs.
 * Not HttpOnly — the switcher writes it from the client, and a language needs no guarding.
 *
 * The value is a locale the user picked, or one prefixed `auto:` that the browser was detected as
 * preferring. Both render the same; the prefix is what lets a later visit re-detect instead of
 * freezing someone into a language they never chose. See `LocalePreference`.
 */
export const LOCALE_COOKIE = "cpm-locale";

/** Marks a cookie value as detected rather than chosen. */
const AUTO_PREFIX = "auto:";

/** A year, matching THEME_COOKIE_MAX_AGE: a language preference outlives session churn. */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** Narrows an untrusted locale string. */
export function parseLocale(value: string | undefined): Locale | undefined {
  return isLocale(value) ? value : undefined;
}

/**
 * What the locale cookie means: nothing stored, a language the browser was detected as wanting, or
 * one the user picked. Only the last is authoritative — the others are re-negotiated per request.
 */
export type LocalePreference =
  | { source: "unset" }
  | { source: "detected"; locale: Locale }
  | { source: "chosen"; locale: Locale };

/** Narrows an untrusted cookie value. An unknown locale reads as no preference at all. */
export function parsePreference(value: string | undefined): LocalePreference {
  if (!value) return { source: "unset" };
  if (value.startsWith(AUTO_PREFIX)) {
    const locale = parseLocale(value.slice(AUTO_PREFIX.length));
    return locale ? { source: "detected", locale } : { source: "unset" };
  }
  const locale = parseLocale(value);
  return locale ? { source: "chosen", locale } : { source: "unset" };
}

/** The cookie value for a preference; `null` means clear it and go back to detecting. */
export function preferenceCookieValue(preference: LocalePreference): string | null {
  switch (preference.source) {
    case "unset":
      return null;
    case "detected":
      return `${AUTO_PREFIX}${preference.locale}`;
    case "chosen":
      return preference.locale;
  }
}

/**
 * The best supported match for one BCP 47 tag, walking up the subtag chain — `pt-BR` tries `pt`
 * before giving up, so a region we ship no catalog for still lands on the right language.
 */
function matchTag(tag: string): Locale | undefined {
  let candidate = tag.trim().toLowerCase();
  if (!candidate) return undefined;
  while (candidate) {
    const hit = LOCALES.find((locale) => locale.toLowerCase() === candidate);
    if (hit) return hit;
    const cut = candidate.lastIndexOf("-");
    if (cut === -1) return undefined;
    candidate = candidate.slice(0, cut);
  }
  return undefined;
}

/**
 * Pick a locale from an ordered list of tags — `navigator.languages`, or an `Accept-Language`
 * header already sorted by weight. Returns undefined rather than the default so callers can tell
 * "asked for nothing we have" from "asked for English".
 */
export function negotiateLocale(tags: readonly string[]): Locale | undefined {
  for (const tag of tags) {
    const hit = matchTag(tag);
    if (hit) return hit;
  }
  return undefined;
}

/**
 * `Accept-Language` in preference order. Ignores `q` beyond sorting and drops `*`, which asks for
 * anything and would otherwise beat a later tag we actually ship.
 */
export function parseAcceptLanguage(header: string | null | undefined): string[] {
  if (!header) return [];
  return header
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.split(";");
      const q = params.find((p) => p.trim().startsWith("q="));
      const weight = q ? Number.parseFloat(q.trim().slice(2)) : 1;
      return { tag: tag.trim(), weight: Number.isFinite(weight) ? weight : 0 };
    })
    .filter((entry) => entry.tag && entry.tag !== "*" && entry.weight > 0)
    .sort((a, b) => b.weight - a.weight)
    .map((entry) => entry.tag);
}

/**
 * The locale to render with. A chosen preference wins outright; otherwise the request's own
 * `Accept-Language` beats a stored detection, which may predate a change to the browser's settings.
 */
export function resolveLocale(
  cookieValue: string | undefined,
  acceptLanguage: string | null,
): Locale {
  const preference = parsePreference(cookieValue);
  if (preference.source === "chosen") return preference.locale;

  const negotiated = negotiateLocale(parseAcceptLanguage(acceptLanguage));
  if (negotiated) return negotiated;

  return preference.source === "detected" ? preference.locale : DEFAULT_LOCALE;
}
