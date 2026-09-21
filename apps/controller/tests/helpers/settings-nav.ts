/**
 * Opening a section of the settings page.
 *
 * The items are real links now - each section is its own route - so a click before hydration
 * navigates rather than being swallowed. The retry below is kept anyway: it costs nothing when the
 * first click lands, and it still covers the case where the rail re-renders under the pointer.
 *
 * Same shape as `openCreateHostDialog` in ./proxy-api.ts - retry the click rather than inflate a
 * timeout and call it fixed.
 */
import { expect, type Locator, type Page } from '@playwright/test';
import { waitForHydration } from './hydration';

// Settings takes the app's own rail over. Found by test id rather than by role: at mobile width the
// app shell adds a second navigation landmark - the bar holding the menu button - so
// '[role="navigation"]' matches that too, and a check that the rail is off-canvas would find the
// bar instead and fail.
export const SETTINGS_SIDEBAR = '[data-testid="settings-rail"]';

/**
 * Click a settings section and wait until it is really showing.
 *
 * The wait is on the section's own level-1 heading, which `DetailHeader` renders from the active
 * item's name - the one thing that cannot be true while the click is still unhandled. Card titles
 * inside a section are level 2, so a section whose name matches one of them is unambiguous.
 *
 * `expectHeading` is for the two sections whose heading is not their nav label.
 */
export async function goToSettingsSection(
  page: Page,
  sectionName: string,
  options: { expectHeading?: string } = {},
): Promise<void> {
  // `/settings` is the tile overview and has no sidebar; the section routes are what render it.
  // General is the cheapest one to land on, and the click below moves off it immediately.
  await page.goto('/settings/general');
  await clickSettingsSection(page, sectionName, options);
}

/**
 * The page's one Save button.
 *
 * A settings page saves every block it has from a single bar at its foot, and the bar is only
 * there while something is unsaved - so this is also how a test says "there is something to save".
 * By test id because a page can hold another Save that is not this one: the favicon card saves a
 * file rather than a setting, and keeps its own.
 */
export function pageSave(page: Page) {
  return page.getByTestId('settings-page-save');
}

/**
 * Save whatever the page is holding.
 *
 * Waits for the bar first. Filling a field before the page has hydrated leaves the value in the
 * DOM with nothing watching it, so the bar never appears - waiting here turns that into a clear
 * failure about the bar rather than a timeout on a click.
 */
export async function savePage(page: Page, timeout = 15_000): Promise<void> {
  const save = pageSave(page);
  await expect(save).toBeVisible({ timeout });
  // Forced: the bar is sticky, so Playwright's own scroll-into-view moves it and it never reads
  // as "stable". It has just been asserted visible, which is the check that matters here.
  await save.click({ force: true });
}

/**
 * Type a value and save it, retrying the pair until the save is actually pressed.
 *
 * One unit rather than a fill and then a save, because the value can be written back between the
 * two - a field filled while the page is still coming up is reset by hydration, which leaves the
 * page clean and takes the save bar away again. Retrying only the fill does not help: by then the
 * save it was waiting for has already gone.
 */
export async function saveSetting(page: Page, field: Locator, value: string): Promise<void> {
  await expect(async () => {
    await field.fill(value);
    await expect(field).toHaveValue(value, { timeout: 2_000 });
    const save = pageSave(page);
    await expect(save).toBeVisible({ timeout: 2_000 });
    await save.click({ force: true });
  }).toPass({ timeout: 30_000 });
}

/**
 * The page each setting lives on, for the settings that used to be pages of their own.
 *
 * Written out rather than imported from the app: a test that reads the registry it is checking
 * would agree with it however the registry changed, including by accident.
 */
const SETTING_PAGES: Record<string, string> = {
  'ACME Server': 'General',
  Updates: 'General',
  Branding: 'General',
  'User Avatars': 'General',
  'Default Response': 'Responses',
  'Error Pages': 'Responses',
  'DNS Providers': 'DNS',
  'DNS Resolvers': 'DNS',
  'Upstream DNS Pinning': 'DNS',
  'Trusted Proxies': 'Network',
  Tailscale: 'Network',
  'OAuth Providers': 'Authentication',
  'Password Policy': 'Authentication',
  'Authentik Defaults': 'Forward Auth',
  'Forward Auth Defaults': 'Forward Auth',
  'GeoIP Databases': 'Geo-blocking',
  'Global Geoblocking': 'Geo-blocking',
  Analytics: 'Observability',
  'Metrics & Monitoring': 'Observability',
  'Access Logging': 'Observability',
};

/**
 * Open whatever page a setting is on, and wait for the setting itself.
 *
 * Most of what used to be a settings page is one block of one now - `Branding` is a heading on
 * `General`. A spec still says which setting it means, and this knows where it went.
 */
export async function goToSetting(page: Page, name: string): Promise<void> {
  const pageName = SETTING_PAGES[name] ?? name;
  await goToSettingsSection(page, pageName);
  if (pageName === name) return;
  const heading = page.getByRole('heading', { level: 2, name, exact: true });
  await expect(heading).toBeVisible({ timeout: 10_000 });
  await heading.scrollIntoViewIfNeeded();
}

/**
 * The same, for a page already on /settings - after a reload, say, where navigating again would
 * throw away what the test just did.
 */
export async function clickSettingsSection(
  page: Page,
  sectionName: string,
  options: { expectHeading?: string } = {},
): Promise<void> {
  await waitForHydration(page);
  const sidebar = page.locator(SETTINGS_SIDEBAR);
  const navButton = sidebar.getByRole('link', { name: sectionName, exact: true });
  await expect(navButton).toBeVisible({ timeout: 10_000 });

  const heading = options.expectHeading
    ? page.getByRole('heading', { name: options.expectHeading })
    : page.getByRole('heading', { level: 1, name: sectionName });

  await expect(async () => {
    await navButton.click();
    await expect(heading).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  // Again after the navigation: each section is its own route, so the page that matters here is
  // the one that just arrived, not the one the rail was clicked on.
  await waitForHydration(page);
}
