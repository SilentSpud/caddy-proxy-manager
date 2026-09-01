/**
 * Functional: controller → agent settings sync for the ACME group (#192). A directory set on
 * web-controller:3002 is pushed to web-agent:3003 and surfaces as the agent's effective setting. Both
 * instances run isolated Caddy sidecars, so this exercises the production settings-apply path.
 * Guards the regression where a new setting group is missing from the SyncSettings allowlist.
 */
import { test, expect, type BrowserContext, type Browser } from '@playwright/test';

const CONTROLLER = 'http://localhost:3002';
const AGENT = 'http://localhost:3003';
const CUSTOM_DIR = 'https://ca.internal.example.com/acme/acme/directory';

/** Log into a standalone instance (no shared storageState) and return its context. */
async function loginContext(browser: Browser, baseURL: string): Promise<BrowserContext> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${baseURL}/login`);
  await page.getByRole('textbox', { name: /username/i }).fill('testadmin');
  await page.getByRole('textbox', { name: /password/i }).fill('TestPassword2026!');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 20_000 });
  await page.close();
  return context;
}

test.describe
  .serial('Instance sync — ACME settings (controller → agent)', () => {
    let controller: BrowserContext;
    let agent: BrowserContext;

    test.beforeAll(async ({ browser }) => {
      controller = await loginContext(browser, CONTROLLER);
      agent = await loginContext(browser, AGENT);
    });

    test.afterAll(async () => {
      // Reset the controller's ACME setting and push the cleared value to the agent.
      await controller.request.put(`${CONTROLLER}/api/v1/settings/acme`, {
        data: { caUrl: '', caRootPem: '' },
        headers: { 'Content-Type': 'application/json', Origin: CONTROLLER },
      });
      await controller.request.post(`${CONTROLLER}/api/v1/instances/sync`, {
        headers: { Origin: CONTROLLER },
      });
      await controller.close();
      await agent.close();
    });

    test('controller propagates a custom ACME directory to the agent', async () => {
      // 1. Set the custom ACME directory on the controller.
      const put = await controller.request.put(`${CONTROLLER}/api/v1/settings/acme`, {
        data: { caUrl: CUSTOM_DIR },
        headers: { 'Content-Type': 'application/json', Origin: CONTROLLER },
      });
      expect(put.status()).toBe(200);

      // Sanity: the controller reads it back.
      const controllerGet = await controller.request.get(`${CONTROLLER}/api/v1/settings/acme`);
      expect((await controllerGet.json()).caUrl).toBe(CUSTOM_DIR);

      // 2. Trigger a push to agents (independent of Caddy reachability).
      const sync = await controller.request.post(`${CONTROLLER}/api/v1/instances/sync`, {
        headers: { Origin: CONTROLLER },
      });
      expect(sync.status()).toBe(200);
      expect(await sync.json()).toMatchObject({ total: 1, success: 1, failed: 0 });

      // 3. The agent's effective ACME setting now reflects the controller's value.
      await expect
        .poll(
          async () => {
            const res = await agent.request.get(`${AGENT}/api/v1/settings/acme`);
            if (res.status() !== 200) return null;
            return (await res.json()).caUrl ?? null;
          },
          { timeout: 20_000, intervals: [500, 1000, 2000] },
        )
        .toBe(CUSTOM_DIR);
    });
  });
