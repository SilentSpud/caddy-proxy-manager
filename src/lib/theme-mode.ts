/**
 * Colour-mode preference: the value the user picked, not the mode in effect.
 *
 * "system" is a real preference rather than a resolved value — it means "keep
 * following the OS". Astryx handles it natively: `<Theme mode="system">` leaves
 * `data-theme` off `<html>`, which its reset.css maps to `color-scheme: light
 * dark`, and every theme token is a `light-dark()` pair that resolves from
 * there. So "system" needs no JS to resolve and no media-query listener — the
 * browser does it.
 */
export type ThemeMode = "light" | "dark" | "system";

/**
 * Cookie carrying the preference, rather than localStorage.
 *
 * The server has to know the mode to render `<html data-theme>` on the first
 * paint; localStorage is unreadable there, which is why the previous
 * next-themes setup needed a render-blocking inline script (and a CSP nonce to
 * go with it). A cookie is on the request, so the server emits the right
 * attribute directly and there is no flash and no inline script.
 *
 * Not HttpOnly: the toggle writes it from the client, and a display preference
 * carries nothing worth protecting.
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
 * The `data-theme` value for `<html>`, or undefined to leave the attribute off.
 *
 * Astryx's reset.css treats a missing attribute as `color-scheme: light dark`,
 * so "system" must omit it rather than write some resolved guess — the server
 * cannot know the OS preference, and guessing is what causes a flash.
 */
export function themeAttr(mode: ThemeMode): "light" | "dark" | undefined {
  return mode === "system" ? undefined : mode;
}
