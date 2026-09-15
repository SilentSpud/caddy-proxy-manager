/**
 * Which time zone the dashboard shows timestamps in: the reader's own.
 *
 * The server cannot see a browser's time zone, so it travels the way the language does (see
 * `locale.ts`): the browser detects it and writes a cookie, `src/i18n/request.ts` hands it to
 * next-intl, and the server render and the browser's re-render then format every timestamp alike.
 * Before the first detection there is no cookie and the page renders in UTC, which is also what the
 * tooltip on every timestamp shows.
 */

export const TIME_ZONE_COOKIE = "cpm-tz";

/** A year, matching the locale and theme cookies. */
export const TIME_ZONE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export const DEFAULT_TIME_ZONE = "UTC";

/**
 * An IANA zone name the runtime knows, in its canonical spelling, or undefined. The cookie is
 * client-written, so anything else is dropped rather than handed to `Intl`, which would throw.
 */
export function parseTimeZone(value: string | null | undefined): string | undefined {
  if (!value || value.length > 64 || !/^[A-Za-z][A-Za-z0-9_+\-/]*$/.test(value)) return undefined;
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: value }).resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

/** The zone to render with: the cookie's when it names a real one, otherwise UTC. */
export function resolveTimeZone(cookieValue: string | null | undefined): string {
  return parseTimeZone(cookieValue) ?? DEFAULT_TIME_ZONE;
}
