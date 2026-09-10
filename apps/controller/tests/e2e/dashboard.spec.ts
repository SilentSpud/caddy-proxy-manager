/**
 * E2E: dashboard overview - resource shortcuts, the metric tiles that drive the chart
 * and request log, and the server-event pane beside it.
 *
 * The e2e stack has no proxied traffic, so the traffic bands render their empty states.
 * That is the state worth pinning: it is what a fresh install sees, and the one case
 * where the two logs must behave differently - server events are recorded whether or
 * not access logging was ever switched on.
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
    // `${label}: ${count}` - label first, then the number.
    await expect(page.getByRole('link', { name: /^Proxy Hosts:\s*\d+/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /^Certificates:\s*\d+/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /^Access Lists:\s*\d+/ })).toBeVisible();
  });

  /**
   * ClickableCard's visually-hidden <a> exists only to name the card; the click target is the card
   * surface. Click the parent, and match the exact accessible name to stay off the sidebar links.
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

  test('View analytics link navigates to /analytics', async ({ page }) => {
    await page.getByRole('link', { name: 'View analytics' }).click();
    await expect(page).toHaveURL(/\/analytics/);
  });

  test('shows every metric tile', async ({ page }) => {
    for (const label of [
      'Requests',
      'Server log',
      '5xx responses',
      '4xx responses',
      'Bandwidth out',
      'Blocked requests',
    ]) {
      await expect(page.getByRole('checkbox', { name: label, exact: true })).toBeVisible();
    }
  });

  test('selecting a tile drives the chart below it', async ({ page }) => {
    const tile = page.getByRole('checkbox', { name: '5xx responses', exact: true });
    // SelectableCard's input is visually hidden under the card surface, the same way
    // ClickableCard hides its <a>: a plain click is intercepted by the card's own text.
    await tile.click({ force: true });
    await expect(tile).toBeChecked();
    // The chart is titled by whichever tile is selected, so the heading is the visible
    // proof that the selection reached the bands below.
    await expect(page.getByRole('heading', { name: '5xx responses', level: 2 })).toBeVisible();
  });

  test('offers the time range control', async ({ page }) => {
    await expect(page.getByRole('radio', { name: '24h' })).toBeVisible();
    await page.getByRole('radio', { name: '7d' }).click();
    await expect(page.getByRole('radio', { name: '7d' })).toBeChecked();
  });

  test('shows the request log and its source', async ({ page }) => {
    await expect(page.getByText('Request log')).toBeVisible();
    await expect(page.getByText(/traffic_events in ClickHouse/i)).toBeVisible();
  });

  test('shows server events beside the request log, recorded without access logging', async ({
    page,
  }) => {
    await expect(page.getByText('Server events')).toBeVisible();
    await expect(page.getByText(/Recorded whether or not access logging is on/i)).toBeVisible();
  });

  test('shows the agents card beside the chart', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Agents', level: 2 })).toBeVisible();
  });

  test('the Proxy Hosts shortcut counts enabled against the total', async ({ page }) => {
    // A disabled host still exists, so the card names both numbers.
    await expect(
      page.getByRole('link', { name: /^Proxy Hosts:\s*\d+ of \d+ enabled$/ }),
    ).toBeVisible();
  });

  test('server events survive an empty traffic window', async ({ page }) => {
    // No proxied traffic in the e2e stack, so both traffic bands are empty - while the
    // server-event pane still has the sign-in that got us here. That difference is the
    // point of keeping the two logs side by side.
    await expect(page.getByText(/No traffic in this range/i)).toBeVisible();
    await expect(page.getByText(/No requests match this tile/i)).toBeVisible();
    await expect(page.getByRole('main').getByRole('listitem').first()).toBeVisible();
  });
});
