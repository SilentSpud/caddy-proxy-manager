/**
 * Functional: Path Blocks and Path Rewrites. A host blocks /dns-query → 403, rewrites /secretpath →
 * /dns-query, and otherwise proxies to whoami-server. A rewrite onto a blocked path does NOT
 * re-match the block, since subroute routes run sequentially. Domain: func-path-rules.test
 */
import { test, expect } from '@playwright/test';
import { httpGet, injectFormFields, waitForRoute } from '../../helpers/http';

const DOMAIN = 'func-path-rules.test';

test.describe
  .serial('Path Blocks and Path Rewrites', () => {
    test('setup: create proxy host with path blocks and rewrites', async ({ page }) => {
      await page.goto('/proxy-hosts');
      await page.getByRole('button', { name: /create host/i }).click();
      await expect(page.getByRole('dialog')).toBeVisible();

      await page.getByLabel('Name').fill('Functional Path Blocks/Rewrites Test');
      await page.getByLabel(/^domains/i).fill(DOMAIN);
      // whoami-server echoes the full request line, letting us assert the
      // rewritten URI is what the upstream received.
      await page.getByPlaceholder('10.0.0.5:8080').first().fill('whoami-server:80');

      await injectFormFields(page, {
        sslForcedPresent: 'on',
        pathBlocksJson: JSON.stringify([
          { path: '/dns-query', status: 403, body: 'Forbidden' },
          { path: '/admin/*', status: 404 },
        ]),
        pathRewritesJson: JSON.stringify([
          { from: '/secretpath', to: '/dns-query' },
          { from: '/oldapi', to: '/v2/api' },
        ]),
      });

      await page.getByRole('button', { name: /^create$/i }).click();
      await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 15_000 });
      await expect(
        page.getByRole('table').getByText('Functional Path Blocks/Rewrites Test', { exact: true }),
      ).toBeVisible({ timeout: 10_000 });

      await waitForRoute(DOMAIN);
    });

    test('blocked exact path returns the configured status and body', async () => {
      const res = await httpGet(DOMAIN, '/dns-query');
      expect(res.status).toBe(403);
      expect(res.body).toBe('Forbidden');
    });

    test('blocked path is terminal — request never reaches the upstream', async () => {
      const res = await httpGet(DOMAIN, '/dns-query');
      // whoami-server echoes "GET /dns-query HTTP/..." when proxied. The block
      // returns a static_response, so that echo must NOT appear in the body.
      expect(res.body).not.toMatch(/GET \/dns-query HTTP/);
    });

    test('wildcard block matches subpaths with the configured status', async () => {
      const res = await httpGet(DOMAIN, '/admin/users');
      expect(res.status).toBe(404);
    });

    test('rewrite changes the URI seen by the upstream', async () => {
      // whoami-server echoes the request line, so the upstream should see /dns-query. Even though
      // that path is blocked, the block route matched the ORIGINAL URI (/secretpath) and does not
      // re-evaluate after the rewrite.
      const res = await httpGet(DOMAIN, '/secretpath');
      expect(res.status).toBe(200);
      expect(res.body).toContain('/dns-query');
      expect(res.body).not.toMatch(/GET \/secretpath HTTP/);
    });

    test('second rewrite rule also takes effect', async () => {
      const res = await httpGet(DOMAIN, '/oldapi');
      expect(res.status).toBe(200);
      expect(res.body).toContain('/v2/api');
    });

    test('unmatched path is proxied normally to the upstream', async () => {
      const res = await httpGet(DOMAIN, '/healthz');
      expect(res.status).toBe(200);
      expect(res.body).toContain('/healthz');
    });
  });

// A second host that uses Path Allows to carve exceptions out of a catch-all block.
// This validates the "allow first, block second" emission order in the subroute,
// which is the entire point of the pathAllows feature.
const ALLOW_DOMAIN = 'func-path-allows.test';

test.describe
  .serial('Path Allows override Path Blocks', () => {
    test('setup: create host that blocks /* but allows /secret and /public/*', async ({ page }) => {
      await page.goto('/proxy-hosts');
      await page.getByRole('button', { name: /create host/i }).click();
      await expect(page.getByRole('dialog')).toBeVisible();

      await page.getByLabel('Name').fill('Functional Path Allows Test');
      await page.getByLabel(/^domains/i).fill(ALLOW_DOMAIN);
      await page.getByPlaceholder('10.0.0.5:8080').first().fill('whoami-server:80');

      await injectFormFields(page, {
        sslForcedPresent: 'on',
        pathAllowsJson: JSON.stringify([{ path: '/secret' }, { path: '/public/*' }]),
        pathBlocksJson: JSON.stringify([{ path: '/*', status: 403, body: 'Blocked' }]),
      });

      await page.getByRole('button', { name: /^create$/i }).click();
      await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 15_000 });
      await expect(
        page.getByRole('table').getByText('Functional Path Allows Test', { exact: true }),
      ).toBeVisible({
        timeout: 10_000,
      });

      await waitForRoute(ALLOW_DOMAIN);
    });

    test('allowed exact path reaches the upstream despite the /* block', async () => {
      const res = await httpGet(ALLOW_DOMAIN, '/secret');
      expect(res.status).toBe(200);
      expect(res.body).toContain('/secret');
      expect(res.body).not.toBe('Blocked');
    });

    test('allowed wildcard subpath reaches the upstream', async () => {
      const res = await httpGet(ALLOW_DOMAIN, '/public/index.html');
      expect(res.status).toBe(200);
      expect(res.body).toContain('/public/index.html');
    });

    test('non-allowed path is still blocked by the /* catch-all', async () => {
      const res = await httpGet(ALLOW_DOMAIN, '/anything-else');
      expect(res.status).toBe(403);
      expect(res.body).toBe('Blocked');
    });

    test('a path that does not match any allow pattern is still blocked', async () => {
      // /notsecret is clearly disjoint from /secret under both exact and prefix
      // path-matching semantics, so this case is independent of Caddy version.
      const res = await httpGet(ALLOW_DOMAIN, '/notsecret');
      expect(res.status).toBe(403);
      expect(res.body).toBe('Blocked');
    });
  });
