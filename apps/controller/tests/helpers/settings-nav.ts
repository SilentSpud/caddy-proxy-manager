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
import { expect, type Page } from '@playwright/test';

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
 * The same, for a page already on /settings - after a reload, say, where navigating again would
 * throw away what the test just did.
 */
export async function clickSettingsSection(
  page: Page,
  sectionName: string,
  options: { expectHeading?: string } = {},
): Promise<void> {
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
}
