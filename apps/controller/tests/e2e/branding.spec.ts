/**
 * The custom favicon: upload, serve, remove.
 *
 * The interesting half is the route rather than the form. It is deliberately public — every
 * unauthenticated page declares the icon — and it hands back a Content-Type derived from the bytes
 * rather than from what the browser claimed on upload, which is what stops a file being stored as
 * an image and served as a document.
 */
import { test, expect, type Page } from '@playwright/test';

const FAVICON_URL = '/api/branding/favicon';

/** The smallest valid PNG: a 1×1 transparent pixel. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

async function goToBranding(page: Page) {
  await page.goto('/settings');
  const sidebar = page.locator('[role="navigation"][aria-label="Settings navigation"]');
  await sidebar.getByRole('button', { name: 'Branding', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Favicon' })).toBeVisible();
}

async function removeIfPresent(page: Page) {
  const remove = page.getByRole('button', { name: 'Remove favicon' });
  if (await remove.isVisible().catch(() => false)) {
    await remove.click();
    await expect(page.getByText('Custom favicon removed')).toBeVisible({ timeout: 15_000 });
  }
}

test.describe('Branding — custom favicon', () => {
  test.afterEach(async ({ page }) => {
    // Shared stack: leave no icon behind for the specs that assert on unauthenticated pages.
    await goToBranding(page);
    await removeIfPresent(page);
  });

  test('serves 404 until one is uploaded, without redirecting to login', async ({ page }) => {
    // Public on purpose: the login, portal and setup pages all declare the icon before there is a
    // session, so a redirect here would leave every unauthenticated page without one.
    const response = await page.request.get(FAVICON_URL);
    expect(response.status()).toBe(404);
  });

  test('every page declares the icon, signed in or not', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', FAVICON_URL);
  });

  test('an uploaded PNG is stored and served back with its own type', async ({ page }) => {
    await goToBranding(page);
    await page.locator('input[type="file"]').setInputFiles({
      name: 'logo.png',
      mimeType: 'image/png',
      buffer: PNG,
    });
    await page.getByRole('button', { name: 'Save favicon' }).click();
    await expect(page.getByText('Favicon updated')).toBeVisible({ timeout: 15_000 });

    const response = await page.request.get(FAVICON_URL);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toBe('image/png');
    expect(Buffer.from(await response.body())).toEqual(PNG);
    // An ETag is what lets the browser revalidate rather than re-download on every page.
    expect(response.headers().etag).toMatch(/^"[0-9a-f]{32}"$/);
  });

  test('removing it goes back to 404', async ({ page }) => {
    await goToBranding(page);
    await page.locator('input[type="file"]').setInputFiles({
      name: 'logo.png',
      mimeType: 'image/png',
      buffer: PNG,
    });
    await page.getByRole('button', { name: 'Save favicon' }).click();
    await expect(page.getByText('Favicon updated')).toBeVisible({ timeout: 15_000 });
    expect((await page.request.get(FAVICON_URL)).status()).toBe(200);

    await page.getByRole('button', { name: 'Remove favicon' }).click();
    await expect(page.getByText('Custom favicon removed')).toBeVisible({ timeout: 15_000 });
    expect((await page.request.get(FAVICON_URL)).status()).toBe(404);
  });

  test('a file that only claims to be an image is refused', async ({ page }) => {
    // The property the sniffing exists for. The browser's mimeType is attacker-controlled, and the
    // stored type is what the route later serves — so believing this claim would let someone put a
    // document behind an image URL on the app's own origin.
    await goToBranding(page);
    await page.locator('input[type="file"]').setInputFiles({
      name: 'evil.png',
      mimeType: 'image/png',
      buffer: Buffer.from('<html><script>alert(document.domain)</script></html>'),
    });
    await page.getByRole('button', { name: 'Save favicon' }).click();

    await expect(page.getByText(/does not look like an image/i)).toBeVisible({ timeout: 15_000 });
    expect((await page.request.get(FAVICON_URL)).status()).toBe(404);
  });
});
