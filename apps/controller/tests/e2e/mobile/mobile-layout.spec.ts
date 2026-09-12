import { test, expect } from '@playwright/test';
import { openCreateHostDialog } from '../../helpers/proxy-api';

// Force a mobile viewport even under the desktop Chromium project so these
// checks validate responsive behavior instead of self-skipping.
test.use({ viewport: { width: 393, height: 852 } });

test.describe('Mobile layout', () => {
  test('tab bar is the navigation - no hamburger drawer beside it', async ({ page }) => {
    await page.goto('/');
    const tabBar = page.getByRole('navigation', { name: 'Main navigation' });
    await expect(tabBar).toBeVisible();
    for (const name of ['Overview', 'Hosts', 'Agents', 'Analytics']) {
      await expect(tabBar.getByRole('link', { name, exact: true })).toBeVisible();
    }
    await expect(tabBar.getByRole('button', { name: 'More', exact: true })).toBeVisible();
    // Two persistent ways to navigate cost a screen's worth of chrome for one job, so AppShell's
    // own hamburger is switched off on a phone.
    await expect(page.getByRole('button', { name: /open navigation/i })).toHaveCount(0);
  });

  test('the current tab is marked, not just coloured', async ({ page }) => {
    await page.goto('/l4-proxy-hosts');
    const tabBar = page.getByRole('navigation', { name: 'Main navigation' });
    // Hosts owns both host pages.
    await expect(tabBar.getByRole('link', { name: 'Hosts', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  test('More opens the drawer, and Escape closes it', async ({ page }) => {
    await page.goto('/');
    const drawer = page.getByRole('dialog', { name: 'Jump to' });
    await expect(drawer).toHaveCount(0);
    await page.getByRole('button', { name: 'More', exact: true }).click();
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole('link', { name: 'All pages' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
  });

  test('picking a page in the drawer goes there and closes the drawer', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'More', exact: true }).click();
    const drawer = page.getByRole('dialog', { name: 'Jump to' });
    await drawer.getByRole('link', { name: 'Users', exact: true }).click();
    await expect(page).toHaveURL('/users');
    await expect(drawer).toHaveCount(0);
  });

  test('All pages in the drawer opens the full More page', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'More', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Jump to' })
      .getByRole('link', { name: 'All pages' })
      .click();
    await expect(page).toHaveURL('/more');
    await expect(page.getByRole('heading', { name: 'More', level: 1 })).toBeVisible();
  });

  test('the drawer stops offering to be customized once it has been', async ({ page }) => {
    await page.goto('/more/customize');
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page).toHaveURL('/more');

    await page.goto('/');
    await page.getByRole('button', { name: 'More', exact: true }).click();
    const drawer = page.getByRole('dialog', { name: 'Jump to' });
    await expect(drawer.getByRole('link', { name: 'All pages' })).toBeVisible();
    await expect(drawer.getByRole('link', { name: /customize this drawer/i })).toHaveCount(0);
  });

  test('proxy hosts page shows card list, not a table', async ({ page }) => {
    await page.goto('/proxy-hosts');
    // On mobile with mobileCard, there should be no <table> element
    // (DataTable renders cards instead)
    await expect(page.locator('table')).not.toBeVisible();
  });

  test('page header action button appears below title on mobile', async ({ page }) => {
    await page.goto('/proxy-hosts');
    // level 1 pins this to the page title; the empty state renders its own
    // "No proxy hosts found" heading.
    const title = page.getByRole('heading', { name: /proxy hosts/i, level: 1 });
    const button = page.getByRole('button', { name: /create host/i });
    await expect(title).toBeVisible();
    await expect(button).toBeVisible();
    // Button should be below the title - its Y coordinate should be greater
    const titleBox = await title.boundingBox();
    const buttonBox = await button.boundingBox();
    expect(titleBox).not.toBeNull();
    expect(buttonBox).not.toBeNull();
    expect(buttonBox!.y).toBeGreaterThan(titleBox!.y + titleBox!.height - 1);
  });

  test('create host dialog is usable at mobile width', async ({ page }) => {
    await page.goto('/proxy-hosts');
    await openCreateHostDialog(page);
    const dialog = page.getByRole('dialog');
    // Dialog should not overflow - check it fits in viewport
    const dialogBox = await dialog.boundingBox();
    const viewportWidth = page.viewportSize()?.width ?? 393;
    expect(dialogBox).not.toBeNull();
    expect(dialogBox!.width).toBeLessThanOrEqual(viewportWidth + 1); // +1 for rounding
    // Key form fields should be visible
    await expect(page.getByLabel(/^domains/i)).toBeVisible();
  });

  test('card edit and delete actions reachable without scrolling', async ({ page }) => {
    await page.goto('/proxy-hosts');
    // Create a host so there is at least one card to inspect
    await openCreateHostDialog(page);
    await page.getByLabel('Name').fill('Mobile Test Host');
    await page.getByLabel(/^domains/i).fill('mobile-test.local');
    await page.getByPlaceholder('10.0.0.5:8080').fill('localhost:9999');
    await page.getByRole('button', { name: /^create$/i }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10_000 });
    // The card's action menu is an astryx MoreMenu, whose icon-only trigger is
    // labelled "Actions for <host name>".
    const moreButton = page.getByRole('button', { name: /^Actions for / }).first();
    await expect(moreButton).toBeVisible();
    await moreButton.click();
    await expect(page.getByRole('menuitem', { name: /edit/i })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /delete/i })).toBeVisible();
  });

  test('analytics page loads without horizontal body overflow', async ({ page }) => {
    await page.goto('/analytics');
    // Wait for content to load
    await page.waitForLoadState('networkidle');
    // The document body should not be wider than the viewport
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth = page.viewportSize()?.width ?? 393;
    expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 5); // 5px tolerance
  });
});
