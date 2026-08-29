/**
 * Functional: per-path redirect rules — matched paths get the right redirect, unmatched ones are
 * proxied. The redirects_json hidden field is injected directly, so the test need not click
 * through the MUI Select per status code. Domain: func-redirects.test
 */
import { test, expect } from '@playwright/test';
import { httpGet, injectFormFields, waitForRoute } from '../../helpers/http';

const DOMAIN = 'func-redirects.test';

test.describe
  .serial('Per-path Redirect Rules', () => {
    test('setup: create proxy host with redirect rules', async ({ page }) => {
      await page.goto('/proxy-hosts');
      await page.getByRole('button', { name: /create host/i }).click();
      await expect(page.getByRole('dialog')).toBeVisible();

      await page.getByLabel('Name').fill('Functional Redirects Test');
      await page.getByLabel(/^domains/i).fill(DOMAIN);
      await page.getByPlaceholder('10.0.0.5:8080').first().fill('echo-server:8080');

      // Inject redirect rules and form flags directly.
      // redirects_json is a hidden input rendered by RedirectsFields whose value
      // reflects React state; setting .value just before submit works because no
      // React render cycle fires between the injection and form data collection.
      await injectFormFields(page, {
        sslForcedPresent: 'on',
        redirectsJson: JSON.stringify([
          { from: '/.well-known/carddav', to: '/remote.php/dav/', status: 301 },
          { from: '/.well-known/caldav', to: '/remote.php/dav/', status: 302 },
        ]),
      });

      await page.getByRole('button', { name: /^create$/i }).click();
      await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 15_000 });
      await expect(
        page.getByRole('table').getByText('Functional Redirects Test', { exact: true }),
      ).toBeVisible({
        timeout: 10_000,
      });

      await waitForRoute(DOMAIN);
    });

    test('matched path receives the configured 301 redirect', async () => {
      const res = await httpGet(DOMAIN, '/.well-known/carddav');
      expect(res.status).toBe(301);
    });

    test('301 redirect Location header points to the configured destination', async () => {
      const res = await httpGet(DOMAIN, '/.well-known/carddav');
      const location = res.headers.location;
      const locationStr = Array.isArray(location) ? location[0] : (location ?? '');
      expect(locationStr).toBe('/remote.php/dav/');
    });

    test('second matched path receives the configured 302 redirect', async () => {
      const res = await httpGet(DOMAIN, '/.well-known/caldav');
      expect(res.status).toBe(302);
    });

    test('302 redirect Location header points to the configured destination', async () => {
      const res = await httpGet(DOMAIN, '/.well-known/caldav');
      const location = res.headers.location;
      const locationStr = Array.isArray(location) ? location[0] : (location ?? '');
      expect(locationStr).toBe('/remote.php/dav/');
    });

    test('unmatched path is proxied normally to the upstream', async () => {
      const res = await httpGet(DOMAIN, '/some/other/path');
      expect(res.status).toBe(200);
      expect(res.body).toContain('echo-ok');
    });
  });
