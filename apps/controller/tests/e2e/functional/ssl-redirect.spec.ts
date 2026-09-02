/**
 * Functional: HTTP→HTTPS redirect with ssl_forced enabled — plain HTTP gets a 308.
 * Domain: func-ssl.test
 */
import { test, expect } from '@playwright/test';
import { httpGet, waitForRoute } from '../../helpers/http';
import { injectFormFields } from '../../helpers/http';

const DOMAIN = 'func-ssl.test';

test.describe
  .serial('SSL Redirect (ssl_forced)', () => {
    test('setup: create proxy host with ssl_forced=true', async ({ page }) => {
      // Navigate to proxy-hosts and open the create dialog manually so we can
      // inject ssl_forced=true without the ssl_forced_present bypass.
      await page.goto('/proxy-hosts');
      await page.getByRole('button', { name: /create host/i }).click();
      await expect(page.getByRole('dialog')).toBeVisible();

      await page.getByLabel('Name').fill('Functional SSL Redirect Test');
      await page.getByLabel(/^domains/i).fill(DOMAIN);
      await page.getByPlaceholder('10.0.0.5:8080').fill('echo-server:8080');

      // Inject ssl_forced=true (default form behavior — no override)
      await injectFormFields(page, {
        sslForcedPresent: 'on',
        sslForced: 'on', // checkbox checked → ssl_forced = true
      });

      await page.getByRole('button', { name: /^create$/i }).click();
      await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 15_000 });
      await expect(
        page.getByRole('table').getByText('Functional SSL Redirect Test', { exact: true }),
      ).toBeVisible({
        timeout: 10_000,
      });

      await waitForRoute(DOMAIN);
    });

    test('HTTP request receives 308 redirect to HTTPS', async () => {
      const res = await httpGet(DOMAIN, '/');
      // Caddy redirects HTTP→HTTPS when ssl_forced=true
      expect(res.status).toBe(308);
    });

    test('redirect Location header points to HTTPS', async () => {
      const res = await httpGet(DOMAIN, '/');
      expect(res.status).toBe(308);
      const location = res.headers.location;
      const locationStr = Array.isArray(location) ? location[0] : (location ?? '');
      expect(locationStr).toMatch(/^https:\/\//);
      expect(locationStr).toContain(DOMAIN);
    });

    test('redirect preserves the request path', async () => {
      const res = await httpGet(DOMAIN, '/some/path');
      expect(res.status).toBe(308);
      const location = res.headers.location;
      const locationStr = Array.isArray(location) ? location[0] : (location ?? '');
      expect(locationStr).toContain('/some/path');
    });
  });
