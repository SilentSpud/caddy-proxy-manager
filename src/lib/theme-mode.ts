/**
 * Colour-mode preference: what the user picked, not the mode in effect — "system" stays "system".
 * Astryx handles it natively: `<Theme mode="system">` leaves `data-theme` off `<html>`, which its
 * reset.css maps to `color-scheme: light dark`, so it needs no JS and no media-query listener.
 */
export type ThemeMode = "light" | "dark" | "system";

/**
 * Cookie rather than localStorage: the server must know the mode to render `<html data-theme>` on
 * the first paint, and localStorage is unreadable there — which is why the old next-themes setup
 * needed a render-blocking inline script and a CSP nonce. Not HttpOnly; the toggle writes it from
 * the client and a display preference is not worth protecting.
 */
export const THEME_COOKIE = "cpm-theme";

/** A year — long enough that the preference outlives ordinary session churn. */
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === "light" || value === "dark" || value === "system";
}

/** Narrows an untrusted cookie value, falling back to following the OS. */
export function parseThemeMode(value: string | undefined): ThemeMode {
  return isThemeMode(value) ? value : "system";
}

/**
 * The `data-theme` value for `<html>`, or undefined to leave it off. Astryx's reset.css reads a
 * missing attribute as `color-scheme: light dark`, so "system" must omit it — the server cannot
 * know the OS preference, and guessing causes a flash.
 */
export function themeAttr(mode: ThemeMode): "light" | "dark" | undefined {
  return mode === "system" ? undefined : mode;
}
