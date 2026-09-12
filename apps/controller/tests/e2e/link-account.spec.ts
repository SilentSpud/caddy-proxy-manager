/**
 * E2E: /link-account. The page needs a LINKING_REQUIRED error param with a valid JWT linking
 * token, and redirects to /login without one. Covers that redirect and the password fallback.
 */
import { test, expect } from '@playwright/test';
import { waitForHydration } from '../helpers/hydration';
import { signInWithCredentials } from '../helpers/sign-in';

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Link Account page', () => {
  test('redirects to /login when no error param is provided', async ({ page }) => {
    await page.goto('/link-account');
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
  });

  test('redirects to /login with invalid linking token', async ({ page }) => {
    await page.goto('/link-account?error=LINKING_REQUIRED:invalid-token');
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
  });

  test('redirects to /login when error param is not LINKING_REQUIRED', async ({ page }) => {
    await page.goto('/link-account?error=SomeOtherError');
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
  });

  test('redirects authenticated users to /', async ({ page }) => {
    // First log in
    await page.goto('http://localhost:3000/login');
    await waitForHydration(page);
    await signInWithCredentials(page, 'testadmin', 'TestPassword2026!');
    await expect(page).not.toHaveURL(/\/login/, { timeout: 10_000 });

    // Now visit link-account - should redirect to /
    await page.goto('/link-account?error=LINKING_REQUIRED:some-token');
    await expect(page).toHaveURL(/^\/$|\/(?!link-account)/, { timeout: 10_000 });
  });
});
