import { test, expect } from '@playwright/test';

/** Empty geoblock config used to reset state between tests. */
const EMPTY_GEOBLOCK = {
  enabled: false,
  block_countries: [],
  block_continents: [],
  block_asns: [],
  block_cidrs: [],
  block_ips: [],
  allow_countries: [],
  allow_continents: [],
  allow_asns: [],
  allow_cidrs: [],
  allow_ips: [],
  trusted_proxies: [],
  fail_closed: false,
  response_status: 403,
  response_body: 'Forbidden',
  response_headers: {},
  redirect_url: '',
};

/**
 * RFC 5737 TEST-NET ranges — routable nowhere, so they won't block real
 * traffic when applied to Caddy during tests (unlike 0.0.0.0/0).
 */
const SAFE_BLOCK_CIDR = '198.51.100.0/24'; // TEST-NET-2
const SAFE_ALLOW_CIDR = '203.0.113.0/24'; // TEST-NET-3
const SAFE_BLOCK_CIDR_2 = '192.0.2.0/24'; // TEST-NET-1
const SAFE_ALLOW_CIDR_2 = '233.252.0.0/24'; // MCAST-TEST-NET

const API_GEOBLOCK = 'http://localhost:3000/api/v1/settings/geoblock';
const ORIGIN = 'http://localhost:3000';

/**
 * Find the visible text input inside a TagInput component by its hidden input name.
 */
function cidrInput(
  parent: ReturnType<(typeof test)['info']> extends never ? never : any,
  name: string,
) {
  return parent.locator(`div:has(> input[name="${name}"])`).locator('input[type="text"]');
}

test.describe('Geo Blocking — form persistence', () => {
  /**
   * Mutating v1 API calls are same-origin checked, so one without an Origin header 403s. This reset
   * silently did nothing while it lacked one, leaving tests running against the persisted volume.
   */
  async function resetGeoblock(page: any) {
    const res = await page.request.put(API_GEOBLOCK, {
      headers: { Origin: ORIGIN },
      data: EMPTY_GEOBLOCK,
    });
    expect(res.ok(), `geoblock reset failed: ${res.status()}`).toBe(true);
  }

  test.beforeEach(async ({ page }) => {
    await resetGeoblock(page);
    await page.goto('/settings');
    // Navigate to Global Geoblocking section in the settings sidebar
    const sidebar = page.locator('[role="navigation"][aria-label="Settings navigation"]');
    await sidebar.getByRole('button', { name: 'Global Geoblocking', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Global Geoblocking' })).toBeVisible();
  });

  test.afterEach(async ({ page }) => {
    await resetGeoblock(page);
  });

  /**
   * Regression: Radix Tabs unmount inactive content, so only the visible tab's hidden inputs were
   * submitted — saving on "Block Rules" wiped every allow rule. Uses RFC 5737 ranges.
   */
  test('saving block rules does not wipe allow rules', async ({ page }) => {
    const geoSection = page.locator('form', {
      has: page.getByRole('button', { name: /save geoblocking settings/i }),
    });
    const enableSwitch = geoSection.getByRole('switch');
    if (!(await enableSwitch.isChecked())) {
      await enableSwitch.click();
    }

    await geoSection.getByRole('button', { name: /allow rules/i }).click();
    const allowInput = cidrInput(geoSection, 'geoblockAllowCidrs');
    await allowInput.fill(SAFE_ALLOW_CIDR);
    await allowInput.press('Enter');
    await expect(geoSection.locator(`text=${SAFE_ALLOW_CIDR}`)).toBeVisible();

    await geoSection.getByRole('button', { name: /block rules/i }).click();
    const blockInput = cidrInput(geoSection, 'geoblockBlockCidrs');
    await blockInput.fill(SAFE_BLOCK_CIDR);
    await blockInput.press('Enter');
    await expect(geoSection.locator(`text=${SAFE_BLOCK_CIDR}`)).toBeVisible();

    await geoSection.getByRole('button', { name: /save geoblocking settings/i }).click();
    await expect(geoSection.locator('text=/saved|success/i')).toBeVisible({ timeout: 10000 });

    // Check what actually landed before reloading. The banner also shows for
    // the "saved, but could not apply to Caddy" path, so a green message is not
    // proof the config persisted — and separating the two tells a persistence
    // bug apart from a stale render.
    const saved = await (await page.request.get(API_GEOBLOCK)).json();
    expect(saved, 'geoblock config was not persisted by the save').toMatchObject({
      enabled: true,
      block_cidrs: [SAFE_BLOCK_CIDR],
      allow_cidrs: [SAFE_ALLOW_CIDR],
    });

    await page.reload();
    await page
      .locator('[role="navigation"][aria-label="Settings navigation"]')
      .getByRole('button', { name: 'Global Geoblocking', exact: true })
      .click();
    const fresh = page.locator('form', {
      has: page.getByRole('button', { name: /save geoblocking settings/i }),
    });

    // The rule tabs only exist while geoblocking is enabled, so assert that the
    // enabled state survived the reload first — otherwise a persistence failure
    // shows up as an opaque timeout hunting for a tab that was never rendered.
    await expect(fresh.getByRole('switch')).toBeChecked();

    await fresh.getByRole('button', { name: /block rules/i }).click();
    await expect(fresh.locator(`text=${SAFE_BLOCK_CIDR}`)).toBeVisible({ timeout: 5000 });

    await fresh.getByRole('button', { name: /allow rules/i }).click();
    await expect(fresh.locator(`text=${SAFE_ALLOW_CIDR}`)).toBeVisible({ timeout: 5000 });
  });

  /**
   * Regression: the tag inputs call onEnter without preventing the keypress default, so adding a
   * CIDR also submitted the form — persisting a half-finished config and re-applying Caddy.
   */
  test('adding a rule with Enter does not submit the form', async ({ page }) => {
    const geoSection = page.locator('form', {
      has: page.getByRole('button', { name: /save geoblocking settings/i }),
    });
    const enableSwitch = geoSection.getByRole('switch');
    if (!(await enableSwitch.isChecked())) {
      await enableSwitch.click();
    }
    await expect(enableSwitch).toBeChecked();

    await geoSection.getByRole('button', { name: /block rules/i }).click();
    const blockInput = cidrInput(geoSection, 'geoblockBlockCidrs');
    await blockInput.fill(SAFE_BLOCK_CIDR);
    await blockInput.press('Enter');

    // The chip is added client-side...
    await expect(geoSection.locator(`text=${SAFE_BLOCK_CIDR}`)).toBeVisible();

    // ...but nothing is persisted until Save is pressed. beforeEach reset the
    // config, so any stored rule here means the Enter submitted the form.
    await page.waitForTimeout(2_000);
    const stored = await (await page.request.get(API_GEOBLOCK)).json();
    expect(stored.block_cidrs, 'pressing Enter in a tag input saved the form').toEqual([]);
    expect(stored.enabled, 'pressing Enter in a tag input saved the form').toBe(false);
  });

  test('saving allow rules does not wipe block rules', async ({ page }) => {
    const geoSection = page.locator('form', {
      has: page.getByRole('button', { name: /save geoblocking settings/i }),
    });
    const enableSwitch = geoSection.getByRole('switch');
    if (!(await enableSwitch.isChecked())) {
      await enableSwitch.click();
    }

    await geoSection.getByRole('button', { name: /block rules/i }).click();
    const blockInput = cidrInput(geoSection, 'geoblockBlockCidrs');
    await blockInput.fill(SAFE_BLOCK_CIDR_2);
    await blockInput.press('Enter');
    await expect(geoSection.locator(`text=${SAFE_BLOCK_CIDR_2}`)).toBeVisible();

    await geoSection.getByRole('button', { name: /allow rules/i }).click();
    const allowInput = cidrInput(geoSection, 'geoblockAllowCidrs');
    await allowInput.fill(SAFE_ALLOW_CIDR_2);
    await allowInput.press('Enter');
    await expect(geoSection.locator(`text=${SAFE_ALLOW_CIDR_2}`)).toBeVisible();

    await geoSection.getByRole('button', { name: /save geoblocking settings/i }).click();
    await expect(geoSection.locator('text=/saved|success/i')).toBeVisible({ timeout: 10000 });

    await page.reload();
    await page
      .locator('[role="navigation"][aria-label="Settings navigation"]')
      .getByRole('button', { name: 'Global Geoblocking', exact: true })
      .click();
    const fresh = page.locator('form', {
      has: page.getByRole('button', { name: /save geoblocking settings/i }),
    });

    await fresh.getByRole('button', { name: /block rules/i }).click();
    await expect(fresh.locator(`text=${SAFE_BLOCK_CIDR_2}`)).toBeVisible({ timeout: 5000 });

    await fresh.getByRole('button', { name: /allow rules/i }).click();
    await expect(fresh.locator(`text=${SAFE_ALLOW_CIDR_2}`)).toBeVisible({ timeout: 5000 });
  });

  /**
   * Regression: Radix Accordion unmounts closed content, so advanced settings (redirect URL,
   * trusted proxies, response status/body) were wiped when saving with it collapsed.
   */
  test('advanced settings survive save when accordion is collapsed', async ({ page }) => {
    const geoSection = page.locator('form', {
      has: page.getByRole('button', { name: /save geoblocking settings/i }),
    });
    const enableSwitch = geoSection.getByRole('switch');
    if (!(await enableSwitch.isChecked())) {
      await enableSwitch.click();
    }

    // Collapsible now defaults to open (defaultIsOpen ?? true), so drive it by
    // aria-expanded rather than assuming a starting state — this test is
    // specifically about saving while the section is *collapsed*.
    const advancedTrigger = geoSection
      .locator('button[aria-expanded]')
      .filter({ hasText: /trusted proxies/i });
    const setAdvancedExpanded = async (expanded: boolean) => {
      if ((await advancedTrigger.getAttribute('aria-expanded')) !== String(expanded)) {
        await advancedTrigger.click();
      }
      await expect(advancedTrigger).toHaveAttribute('aria-expanded', String(expanded));
    };

    await setAdvancedExpanded(true);
    const redirectInput = geoSection.locator('input[name="geoblockRedirectUrl"]');
    await expect(redirectInput).toBeVisible();
    await redirectInput.fill('https://example.com/blocked');

    await setAdvancedExpanded(false);
    await expect(redirectInput).toBeHidden();

    await geoSection.getByRole('button', { name: /save geoblocking settings/i }).click();
    await expect(geoSection.locator('text=/saved|success/i')).toBeVisible({ timeout: 10000 });

    await page.reload();
    await page
      .locator('[role="navigation"][aria-label="Settings navigation"]')
      .getByRole('button', { name: 'Global Geoblocking', exact: true })
      .click();
    const fresh = page.locator('form', {
      has: page.getByRole('button', { name: /save geoblocking settings/i }),
    });
    // Scope to the Collapsible trigger: the section also contains an
    // "Add to Trusted Proxies" button that a plain name match picks up.
    const freshTrigger = fresh
      .locator('button[aria-expanded]')
      .filter({ hasText: /trusted proxies/i });
    if ((await freshTrigger.getAttribute('aria-expanded')) !== 'true') {
      await freshTrigger.click();
    }
    await expect(fresh.locator('input[name="geoblockRedirectUrl"]')).toHaveValue(
      'https://example.com/blocked',
      { timeout: 5000 },
    );
  });

  /**
   * Regression (#241): after saving, the form appeared to revert to the pre-save values until a
   * manual browser refresh. revalidatePath delivers fresh props, but the form state was seeded
   * from useState and never re-synced. The form must show the saved values immediately — no
   * page reload.
   */
  test('form reflects saved values immediately without reload', async ({ page }) => {
    const geoSection = page.locator('form', {
      has: page.getByRole('button', { name: /save geoblocking settings/i }),
    });
    const enableSwitch = geoSection.getByRole('switch');
    if (!(await enableSwitch.isChecked())) {
      await enableSwitch.click();
    }

    const advancedTrigger = geoSection
      .locator('button[aria-expanded]')
      .filter({ hasText: /trusted proxies/i });
    if ((await advancedTrigger.getAttribute('aria-expanded')) !== 'true') {
      await advancedTrigger.click();
    }

    const redirectInput = geoSection.locator('input[name="geoblockRedirectUrl"]');
    await expect(redirectInput).toBeVisible();
    await redirectInput.fill('https://example.com/no-refresh');

    const statusInput = geoSection.locator('input[name="geoblockResponseStatus"]');
    await statusInput.fill('418');

    await geoSection.getByRole('button', { name: /save geoblocking settings/i }).click();
    await expect(geoSection.locator('text=/saved|success/i')).toBeVisible({ timeout: 10000 });

    // No page.reload() here — the visible form must already reflect the save.
    await expect(geoSection.locator('input[name="geoblockRedirectUrl"]')).toHaveValue(
      'https://example.com/no-refresh',
      { timeout: 10_000 },
    );
    await expect(geoSection.locator('input[name="geoblockResponseStatus"]')).toHaveValue('418');
  });

  /**
   * Tests the LAN Only (RFC1918) preset — values must survive tab switching.
   * This test does NOT save, so no Caddy config is affected.
   */
  test('LAN Only preset: values survive tab switching', async ({ page }) => {
    const geoSection = page.locator('form', {
      has: page.getByRole('button', { name: /save geoblocking settings/i }),
    });
    const enableSwitch = geoSection.getByRole('switch');
    if (!(await enableSwitch.isChecked())) {
      await enableSwitch.click();
    }

    await geoSection.getByRole('button', { name: /lan only/i }).click();

    await expect(geoSection.locator('text=0.0.0.0/0')).toBeVisible();

    await geoSection.getByRole('button', { name: /allow rules/i }).click();
    await expect(geoSection.locator('text=10.0.0.0/8')).toBeVisible();
    await expect(geoSection.locator('text=172.16.0.0/12')).toBeVisible();
    await expect(geoSection.locator('text=192.168.0.0/16')).toBeVisible();

    await geoSection.getByRole('button', { name: /block rules/i }).click();
    await expect(geoSection.locator('text=0.0.0.0/0')).toBeVisible();

    await geoSection.getByRole('button', { name: /allow rules/i }).click();
    await expect(geoSection.locator('text=10.0.0.0/8')).toBeVisible();
  });

  /**
   * The LAN Only preset persists after save. Reads back via API immediately and resets Caddy, to
   * minimise the window where 0.0.0.0/0 blocks all traffic.
   */
  test('LAN Only preset: values persist after save', async ({ page }) => {
    const geoSection = page.locator('form', {
      has: page.getByRole('button', { name: /save geoblocking settings/i }),
    });
    const enableSwitch = geoSection.getByRole('switch');
    if (!(await enableSwitch.isChecked())) {
      await enableSwitch.click();
    }

    await geoSection.getByRole('button', { name: /lan only/i }).click();
    await geoSection.getByRole('button', { name: /save geoblocking settings/i }).click();
    await expect(geoSection.locator('text=/saved|success/i')).toBeVisible({ timeout: 10000 });

    // Read saved values via API, then immediately reset to stop blocking traffic
    const res = await page.request.get(API_GEOBLOCK);
    await resetGeoblock(page);

    const saved = await res.json();
    expect(saved.block_cidrs).toContain('0.0.0.0/0');
    expect(saved.allow_cidrs).toContain('10.0.0.0/8');
    expect(saved.allow_cidrs).toContain('172.16.0.0/12');
    expect(saved.allow_cidrs).toContain('192.168.0.0/16');
  });
});
