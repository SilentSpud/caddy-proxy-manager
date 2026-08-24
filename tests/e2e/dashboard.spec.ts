/**
 * E2E tests: Dashboard (overview) home page.
 *
 * Verifies stat cards, navigation links, welcome header, and recent activity.
 */
import { test, expect, type Page } from '@playwright/test';

test.describe('Dashboard home page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('displays welcome header with user name', async ({ page }) => {
    await expect(page.getByText(/welcome back/i)).toBeVisible();
  });

  test('shows stat cards for Proxy Hosts, Certificates, and Access Lists', async ({ page }) => {
    // Each stat card is a ClickableCard whose accessible name is built as
    // `${label}: ${count}` — label first, then the number.
    await expect(page.getByRole('link', { name: /^Proxy Hosts:\s*\d+/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /^Certificates:\s*\d+/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /^Access Lists:\s*\d+/ })).toBeVisible();
  });

  test('shows Traffic (24h) card', async ({ page }) => {
    await expect(page.getByText('Traffic (24h)')).toBeVisible();
  });

  /**
   * ClickableCard renders a visually-hidden 1px <a> that exists only to give
   * the card an accessible name — the real click target is the card surface,
   * which carries the navigation handler. Clicking the anchor itself is
   * impossible for a mouse user (card content sits over it), so click the
   * parent surface instead. Matching on the card's exact accessible name also
   * keeps these tests off the sidebar links, which `.first()` used to select.
   */
  async function clickCard(page: Page, name: string | RegExp) {
    await page.getByRole('link', { name }).locator('xpath=..').click();
  }

  test('Proxy Hosts stat card navigates to /proxy-hosts', async ({ page }) => {
    await clickCard(page, /^Proxy Hosts:\s*\d+/);
    await expect(page).toHaveURL(/\/proxy-hosts/);
  });

  test('Certificates stat card navigates to /certificates', async ({ page }) => {
    await clickCard(page, /^Certificates:\s*\d+/);
    await expect(page).toHaveURL(/\/certificates/);
  });

  test('Access Lists stat card navigates to /access-lists', async ({ page }) => {
    await clickCard(page, /^Access Lists:\s*\d+/);
    await expect(page).toHaveURL(/\/access-lists/);
  });

  test('Traffic card navigates to /analytics', async ({ page }) => {
    await clickCard(page, 'Traffic in the last 24 hours');
    await expect(page).toHaveURL(/\/analytics/);
  });

  test('shows Recent Activity section', async ({ page }) => {
    await expect(page.getByText(/recent activity/i)).toBeVisible();
  });
});
