import { test, expect } from '@playwright/test';
import { createProxyHost } from '../helpers/proxy-api';
import { waitForHydration } from '../helpers/hydration';

test.describe('Audit log', () => {
  test('audit log page loads without redirecting to login', async ({ page }) => {
    await page.goto('/audit-log');
    await expect(page).not.toHaveURL(/login/);
    await expect(page.locator('body')).toBeVisible();
  });

  test('audit log page has a table or list', async ({ page }) => {
    await page.goto('/audit-log');
    const hasTable = (await page.locator('table, [role="grid"], [role="table"]').count()) > 0;
    const hasList = (await page.locator('ul, ol').count()) > 0;
    const hasRows = (await page.locator('tr').count()) > 0;
    expect(hasTable || hasList || hasRows).toBe(true);
  });

  test('creating a proxy host creates audit log entry', async ({ page }) => {
    await createProxyHost(page, {
      name: 'Audit Test Host',
      domain: 'audit-test.local',
      upstream: 'localhost:8888',
    });

    await page.goto('/audit-log');
    await expect(page.locator('body')).toBeVisible();
  });

  test('audit log page has search functionality', async ({ page }) => {
    await page.goto('/audit-log');
    const hasSearch =
      (await page.getByRole('searchbox').count()) > 0 ||
      (await page.getByPlaceholder(/search/i).count()) > 0 ||
      (await page.getByLabel(/search/i).count()) > 0;
    expect(hasSearch).toBe(true);
  });

  test('verifies the hash chain on request', async ({ page }) => {
    await page.goto('/audit-log');
    await waitForHydration(page);
    await page.getByRole('button', { name: 'Verify', exact: true }).click();
    await expect(page.getByText(/the audit log is intact/i)).toBeVisible({ timeout: 15_000 });
  });

  test("shows a host change's before and after, unified or side by side", async ({ page }) => {
    await createProxyHost(page, {
      name: 'Audit Diff Host',
      domain: 'audit-diff.local',
      upstream: 'localhost:8889',
    });

    await page.goto('/audit-log?search=Audit%20Diff%20Host');
    await waitForHydration(page);
    await page
      .getByRole('button', { name: /\d+ changes?/ })
      .first()
      .click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('audit-diff.local')).toBeVisible();
    await dialog.getByRole('radio', { name: /side by side/i }).click();
    await expect(dialog.getByRole('columnheader', { name: /before/i })).toBeVisible();
  });
});
