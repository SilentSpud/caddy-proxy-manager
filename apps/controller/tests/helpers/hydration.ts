/**
 * Waiting for React to take over a server-rendered page.
 *
 * Astryx's root `<Theme>` writes `data-astryx-theme` onto `<html>` from a layout effect, and the
 * root layout never renders that attribute itself - src/app/layout.tsx writes only `lang`, `dir`
 * and `data-theme`. So the attribute appears exactly when the client root commits, and because
 * nothing puts a Suspense boundary between `<Providers>` and a page (there is no loading.tsx or
 * template.tsx in the app), that is the same commit which attaches every handler below it.
 *
 * Until then the markup is live but inert, and both ways it fails are silent:
 *
 * - `fill` writes straight to the DOM while the component's state stays empty, so a controlled
 *   input looks filled and submits nothing.
 * - a click on a submit button runs the browser's native form submit instead of `onSubmit`. The
 *   form carries no `action`, so the browser GETs the current URL with the fields in the query
 *   string - which is how a lost login click surfaces as `/login?username=...&password=...`.
 *
 * Same family of race as the swallowed clicks `goToSettingsSection` rides out in ./settings-nav.ts.
 * That one retries the click because re-clicking a nav button is free; a sign-in is not, so this
 * waits for the page to be ready instead and leaves a genuine auth failure to fail on its own.
 */
import { expect, type Page } from '@playwright/test';

/** Resolve once the page's React root has hydrated and its handlers are attached. */
export async function waitForHydration(page: Page, timeout = 15_000): Promise<void> {
  await expect(page.locator('html')).toHaveAttribute('data-astryx-theme', /\S/, { timeout });
}
