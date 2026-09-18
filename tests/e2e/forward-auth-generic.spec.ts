/**
 * E2E: Generic Forward Auth (Authelia etc.) — issue #188.
 *
 * Covers the UI and persistence path:
 *  - The "Forward Auth Defaults" settings section saves provider/upstream/endpoint
 *  - The create dialog is prefilled from those defaults when the section is enabled
 *  - A host created through the dialog persists the split browser/API settings
 *    (apiSplit, bypass headers) and they survive an edit round-trip
 */
import { test, expect } from '@playwright/test';

const API_PROXY_HOSTS = 'http://localhost:3000/api/v1/proxy-hosts';
const API_FORWARD_AUTH_SETTINGS = 'http://localhost:3000/api/v1/settings/forward-auth';

test.describe('Generic Forward Auth UI', () => {
  test('forward auth defaults can be saved in settings and prefill the create dialog', async ({ page }) => {
    const origin = new URL(page.url()).origin;
    const defaultSettings = {
      provider: 'authelia',
      authUpstream: 'http://authelia.internal:9091',
      authEndpoint: '/api/authz/forward-auth',
    };

    const originalSettings = await (await page.request.get(API_FORWARD_AUTH_SETTINGS)).json() as Record<string, unknown>;

    try {
      await page.goto('/settings');
      const sidebar = page.locator('aside[aria-label="Settings navigation"]');
      const navBtn = sidebar.getByRole('button', { name: 'Forward Auth Defaults', exact: true });
      await expect(navBtn).toBeVisible({ timeout: 10_000 });
      await navBtn.click();

      await page.locator('select[name="provider"]').selectOption('authelia');
      await page.locator('input[name="authUpstream"]').fill(defaultSettings.authUpstream);
      await page.locator('input[name="authEndpoint"]').fill(defaultSettings.authEndpoint);
      await page.getByRole('button', { name: /save forward auth defaults/i }).click();
      await expect(page.getByText(/forward auth defaults saved successfully/i)).toBeVisible({ timeout: 10_000 });

      const saved = await (await page.request.get(API_FORWARD_AUTH_SETTINGS)).json();
      expect(saved).toEqual(defaultSettings);

      // Create dialog prefilled from the saved defaults.
      await page.goto('/proxy-hosts');
      await page.getByRole('button', { name: /create host/i }).click();
      await expect(page.getByRole('dialog')).toBeVisible();

      const dialog = page.getByRole('dialog');
      const faSection = dialog.locator('div:has(> input[name="forwardAuthPresent"])');
      const faSwitch = faSection.getByRole('switch').first();
      await faSwitch.click();
      await expect(faSwitch).toHaveAttribute('data-state', 'checked');

      await expect(dialog.locator('input[name="forwardAuthUpstream"]')).toHaveValue(defaultSettings.authUpstream);
      await expect(dialog.locator('input[name="forwardAuthEndpoint"]')).toHaveValue(defaultSettings.authEndpoint);
    } finally {
      if (originalSettings && Object.keys(originalSettings).length > 0) {
        await page.request.put(API_FORWARD_AUTH_SETTINGS, {
          headers: { Origin: origin },
          data: originalSettings,
        });
      }
    }
  });

  test('create host with generic forward auth — split API settings persist and survive an edit', async ({ page }) => {
    const origin = new URL(page.url()).origin;
    const hostName = 'Generic FA UI Test';
    const domain = 'generic-fa-ui.local';

    try {
      await page.goto('/proxy-hosts');
      await page.getByRole('button', { name: /create host/i }).click();
      await expect(page.getByRole('dialog')).toBeVisible();

      const dialog = page.getByRole('dialog');
      await dialog.locator('input[name="name"]').fill(hostName);
      await dialog.locator('textarea[name="domains"]').fill(domain);
      await dialog.locator('input[placeholder="10.0.0.5:8080"]').fill('localhost:9988');

      const faSection = dialog.locator('div:has(> input[name="forwardAuthPresent"])');
      const faSwitch = faSection.getByRole('switch').first();
      await faSwitch.click();
      await expect(faSwitch).toHaveAttribute('data-state', 'checked');

      await dialog.locator('input[name="forwardAuthUpstream"]').fill('http://authelia:9091');
      await dialog.locator('input[name="forwardAuthEndpoint"]').fill('/api/authz/forward-auth');
      // Enable the API split (401 for non-browser clients).
      const apiSplitSwitch = dialog.locator('#forwardAuthApiSplitToggle');
      await apiSplitSwitch.click();
      await expect(apiSplitSwitch).toHaveAttribute('data-state', 'checked');
      await dialog.locator('input[name="forwardAuthApiBypassHeaders"]').fill('X-Api-Key, Authorization');

      await page.getByRole('button', { name: /^create$/i }).click();
      await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10_000 });
      await expect(page.getByRole('table').getByText(hostName)).toBeVisible({ timeout: 10_000 });

      // Verify persisted state via the API.
      const listResp = await page.request.get(API_PROXY_HOSTS);
      const hosts = await listResp.json() as Array<{ id: number; name: string; forwardAuth: Record<string, unknown> | null }>;
      const created = hosts.find((h) => h.name === hostName);
      expect(created).toBeTruthy();
      expect(created!.forwardAuth).not.toBeNull();
      expect(created!.forwardAuth!.enabled).toBe(true);
      expect(created!.forwardAuth!.provider).toBe('authelia');
      expect(created!.forwardAuth!.authUpstream).toBe('http://authelia:9091');
      expect(created!.forwardAuth!.authEndpoint).toBe('/api/authz/forward-auth');
      expect(created!.forwardAuth!.apiSplit).toBe(true);
      expect(created!.forwardAuth!.apiBypassHeaders).toEqual(['X-Api-Key', 'Authorization']);
      // Authelia preset defaults applied to copy headers.
      expect(created!.forwardAuth!.copyHeaders).toContain('Remote-User');

      // Edit round-trip: disable the split, verify the change persists.
      const createdId = created!.id;
      const row = page.locator('tr', { hasText: hostName });
      await row.getByRole('button', { name: /open menu/i }).click();
      await page.getByRole('menuitem', { name: 'Edit' }).click();
      const editDialog = page.getByRole('dialog');
      await expect(editDialog).toBeVisible();

      await expect(editDialog.locator('input[name="forwardAuthUpstream"]')).toHaveValue('http://authelia:9091');
      const editSplitSwitch = editDialog.locator('#forwardAuthApiSplitToggle');
      await expect(editSplitSwitch).toHaveAttribute('data-state', 'checked');
      await editSplitSwitch.click();
      await expect(editSplitSwitch).toHaveAttribute('data-state', 'unchecked');

      await page.getByRole('button', { name: /save changes/i }).click();
      await expect(editDialog).not.toBeVisible({ timeout: 10_000 });

      const getResp = await page.request.get(`${API_PROXY_HOSTS}/${createdId}`);
      const updated = await getResp.json() as { forwardAuth: { apiSplit: boolean } | null };
      expect(updated.forwardAuth?.apiSplit).toBe(false);
    } finally {
      const listResp = await page.request.get(API_PROXY_HOSTS);
      const body = await listResp.json() as unknown;
      const hosts = Array.isArray(body) ? body as Array<{ id: number; name: string }> : [];
      for (const h of hosts.filter((h) => h.name === hostName)) {
        await page.request.delete(`${API_PROXY_HOSTS}/${h.id}`, { headers: { Origin: origin } });
      }
    }
  });
});
