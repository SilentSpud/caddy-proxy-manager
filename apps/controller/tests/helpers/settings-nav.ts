/**
 * Opening a section of the settings page, without losing the click to hydration.
 *
 * The sidebar is server-rendered, so its buttons are visible and clickable before React attaches
 * their handlers. A click landing in that window is swallowed: the detail pane stays on General
 * and the caller waits out its timeout on a heading that will never appear. Six specs had written
 * this navigation out by hand, so the race had six places to surface and each CI round fixed one.
 *
 * Same race `openCreateHostDialog` rides out in ./proxy-api.ts, and the same answer — retry the
 * click rather than inflate a timeout and call it fixed.
 */
import { expect, type Page } from '@playwright/test';

export const SETTINGS_SIDEBAR = '[role="navigation"][aria-label="Settings navigation"]';

/**
 * Click a settings section and wait until it is really showing.
 *
 * The wait is on the section's own level-1 heading, which `DetailHeader` renders from the active
 * item's name — the one thing that cannot be true while the click is still unhandled. Card titles
 * inside a section are level 2, so a section whose name matches one of them is unambiguous.
 *
 * `expectHeading` is for the two sections whose heading is not their nav label.
 */
export async function goToSettingsSection(
  page: Page,
  sectionName: string,
  options: { expectHeading?: string } = {},
): Promise<void> {
  await page.goto('/settings');
  await clickSettingsSection(page, sectionName, options);
}

/**
 * The same, for a page already on /settings — after a reload, say, where navigating again would
 * throw away what the test just did.
 */
export async function clickSettingsSection(
  page: Page,
  sectionName: string,
  options: { expectHeading?: string } = {},
): Promise<void> {
  const sidebar = page.locator(SETTINGS_SIDEBAR);
  const navButton = sidebar.getByRole('button', { name: sectionName, exact: true });
  await expect(navButton).toBeVisible({ timeout: 10_000 });

  const heading = options.expectHeading
    ? page.getByRole('heading', { name: options.expectHeading })
    : page.getByRole('heading', { level: 1, name: sectionName });

  await expect(async () => {
    await navButton.click();
    await expect(heading).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
}
