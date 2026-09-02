import { test, expect } from '@playwright/test';

test.describe('WAF', () => {
  test('WAF events period filters support presets, custom range, and reset to all time', async ({
    page,
  }) => {
    const customFrom = '2026-05-01T09:00';
    const customTo = '2026-05-02T09:30';
    const expectedFrom = Math.floor(new Date(customFrom).getTime() / 1000);
    const expectedTo = Math.floor(new Date(customTo).getTime() / 1000);

    await page.goto('/waf');

    await page.getByRole('radio', { name: '24h' }).click();
    await expect(page).toHaveURL(/range=24h/);
    await expect(page.getByRole('radio', { name: '24h' })).toBeVisible();

    await page.getByRole('radio', { name: '7d' }).click();
    await expect(page).toHaveURL(/range=7d/);
    await expect(page.getByRole('radio', { name: '7d' })).toBeVisible();

    await page.getByRole('radio', { name: '30d' }).click();
    await expect(page).toHaveURL(/range=30d/);
    await expect(page.getByRole('radio', { name: '30d' })).toBeVisible();

    await page.getByRole('radio', { name: 'Custom' }).click();

    // DateTimeInput is no longer a native datetime-local control: it renders a
    // date combobox (accepting unambiguous ISO input) plus a separate time
    // field, each committing its pending text on blur.
    const fromDate = page.getByRole('combobox', { name: 'From', exact: true });
    const fromTime = page.getByLabel('From time', { exact: true });
    const toDate = page.getByRole('combobox', { name: 'To', exact: true });
    const toTime = page.getByLabel('To time', { exact: true });
    await expect(fromDate).toBeVisible();

    const [fromDay, fromClock] = customFrom.split('T');
    const [toDay, toClock] = customTo.split('T');
    for (const [field, text] of [
      [fromDate, fromDay],
      [fromTime, fromClock],
      [toDate, toDay],
      [toTime, toClock],
    ] as const) {
      await field.fill(text);
      await field.blur();
    }

    await page.getByRole('button', { name: /apply range/i }).click();

    await expect(page).toHaveURL(
      new RegExp(`range=custom.*from=${expectedFrom}.*to=${expectedTo}`),
    );
    // The committed values are re-rendered in the field's own locale format, so
    // assert the round-trip through the URL (above) and that the fields kept a
    // value rather than pinning the display string.
    await expect(fromDate).not.toHaveValue('');
    await expect(toDate).not.toHaveValue('');

    await page.getByRole('radio', { name: 'All time' }).click();
    await expect(page).not.toHaveURL(/range=/);
    await expect(page).not.toHaveURL(/from=/);
    await expect(page).not.toHaveURL(/to=/);
    await expect(page.getByRole('radio', { name: 'All time' })).toBeVisible();
    await expect(fromDate).toHaveCount(0);
  });

  test('WAF page loads without redirecting to login', async ({ page }) => {
    await page.goto('/waf');
    await expect(page).not.toHaveURL(/login/);
    await expect(page.locator('body')).toBeVisible();
  });

  test('WAF page has global settings visible', async ({ page }) => {
    await page.goto('/waf');
    const hasWafContent = (await page.locator('text=/waf|mode|enabled|owasp/i').count()) > 0;
    expect(hasWafContent).toBe(true);
  });

  test('WAF page has Save WAF settings button', async ({ page }) => {
    await page.goto('/waf');
    // Save button is on the Settings tab
    await page.getByRole('button', { name: /settings/i }).click();
    await expect(page.getByRole('button', { name: /save waf settings/i })).toBeVisible();
  });

  test('WAF page has tabs', async ({ page }) => {
    await page.goto('/waf');
    await expect(page.getByRole('button', { name: /events/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /suppressed rules/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /settings/i })).toBeVisible();
  });

  test('WAF settings toggle persists after save and navigation', async ({ page }) => {
    await page.goto('/waf');
    await page.getByRole('button', { name: /settings/i }).click();
    await expect(page.getByRole('button', { name: /save waf settings/i })).toBeVisible();

    // These were addressed by hand-written DOM ids that the astryx controls do
    // not emit; both expose a proper role and label, and their checked state is
    // real ARIA state rather than a data- attribute.
    const wafSwitch = page.getByRole('switch', { name: /enable waf globally/i });
    const owaspCheckbox = page.getByRole('checkbox', { name: /load owasp core rule set/i });

    // Turn WAF on if not already
    if (!(await wafSwitch.isChecked())) {
      await wafSwitch.click();
      await expect(wafSwitch).toBeChecked();
    }

    // Turn OWASP CRS on if not already
    if (!(await owaspCheckbox.isChecked())) {
      await owaspCheckbox.click();
      await expect(owaspCheckbox).toBeChecked();
    }

    await page.getByRole('button', { name: /save waf settings/i }).click();
    await expect(page.getByRole('button', { name: /save waf settings/i })).toBeEnabled({
      timeout: 10000,
    });

    // Navigate away and back to verify persistence
    await page.goto('/hosts');
    await expect(page).not.toHaveURL(/login/);
    await page.goto('/waf');
    await page.getByRole('button', { name: /settings/i }).click();

    await expect(wafSwitch).toBeChecked();
    await expect(owaspCheckbox).toBeChecked();
  });
});
