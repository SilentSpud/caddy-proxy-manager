import { test, expect, type Page } from '@playwright/test';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** The settings page has its own sidebar — an astryx LayoutPanel that renders a <div> carrying
 *  the landmark role and label rather than an <aside>. Use this selector everywhere. */
const SETTINGS_SIDEBAR = '[role="navigation"][aria-label="Settings navigation"]';

/** Mutating v1 API calls are same-origin checked and 403 without this header. */
const SETTINGS_ORIGIN = 'http://localhost:3000';

/**
 * Opens the settings command palette by keyboard.
 *
 * The shortcut binds to `window` in a useEffect, and the control waited for below is
 * server-rendered — so it can be visible a moment before the handler exists, and a single press
 * lands on nothing. Retrying the press is the only way to wait for a listener with no DOM of its
 * own; waiting harder before the first one just moves the race.
 */
async function openPaletteWithKeyboard(page: Page) {
  await expect(page.locator(SETTINGS_SIDEBAR).getByText('Jump to setting...')).toBeVisible();
  await expect(async () => {
    await page.keyboard.press('ControlOrMeta+k');
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
}

/** Navigate to a specific settings section via the sidebar. */
/**
 * Open a settings section, retrying the click itself.
 *
 * The sidebar is server-rendered, so the button is visible and clickable before React attaches its
 * handler: a click landing in that window is swallowed and the section never changes, leaving the
 * detail pane on General and the caller waiting for a heading that will never appear. Same race
 * openCreateHostDialog rides out in tests/helpers/proxy-api.ts, and this page has grown enough
 * sections for hydration on a CI runner to be slow enough to hit it.
 *
 * Waiting for the heading rather than an "active" class is deliberate: the heading is what every
 * caller goes on to assert against, so this cannot report success on a section that has not
 * actually rendered.
 */
async function goToSection(page: Page, sectionName: string) {
  await page.goto('/settings');
  const sidebar = page.locator(SETTINGS_SIDEBAR);
  const navButton = sidebar.getByRole('button', { name: sectionName, exact: true });
  await expect(navButton).toBeVisible({ timeout: 10_000 });
  await expect(async () => {
    await navButton.click();
    await expect(page.getByRole('heading', { level: 1, name: sectionName })).toBeVisible({
      timeout: 2_000,
    });
  }).toPass({ timeout: 30_000 });
}

// ─── Page load & layout ──────────────────────────────────────────────────────

test.describe('Settings — page load & layout', () => {
  test('settings page loads without redirecting to login', async ({ page }) => {
    await page.goto('/settings');
    await expect(page).not.toHaveURL(/login/);
    await expect(page.locator('body')).toBeVisible();
  });

  test('settings page defaults to the General section', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'General' })).toBeVisible();
  });

  test('sidebar is visible and shows all group headers', async ({ page }) => {
    await page.goto('/settings');
    const sidebar = page.locator(SETTINGS_SIDEBAR);
    await expect(sidebar).toBeVisible();
    await expect(sidebar.getByText('System')).toBeVisible();
    await expect(sidebar.getByText('Networking')).toBeVisible();
    await expect(sidebar.getByText('Security')).toBeVisible();
    await expect(sidebar.getByText('Observability')).toBeVisible();
  });

  test('sidebar shows settings navigation items', async ({ page }) => {
    await page.goto('/settings');
    const sidebar = page.locator(SETTINGS_SIDEBAR);
    const expectedItems = [
      'General',
      'ACME Server',
      'Default Response',
      'DNS Providers',
      'DNS Resolvers',
      'Upstream DNS Pinning',
      'Global Geoblocking',
      'Authentik Defaults',
      'OAuth Providers',
      'Metrics & Monitoring',
      'Access Logging',
    ];
    for (const name of expectedItems) {
      await expect(sidebar.getByRole('button', { name, exact: true })).toBeVisible();
    }
  });

  test('sidebar search button is visible with keyboard hint', async ({ page }) => {
    await page.goto('/settings');
    const sidebar = page.locator(SETTINGS_SIDEBAR);
    await expect(sidebar.getByText('Jump to setting...')).toBeVisible();
    await expect(sidebar.locator('kbd').first()).toBeVisible();
  });
});

// ─── Sidebar navigation ─────────────────────────────────────────────────────

test.describe('Settings — sidebar navigation', () => {
  test('clicking a nav item switches the detail pane', async ({ page }) => {
    await page.goto('/settings');
    // Default: General
    await expect(page.getByRole('heading', { name: 'General' })).toBeVisible();

    await page
      .locator(SETTINGS_SIDEBAR)
      .getByRole('button', { name: 'ACME Server', exact: true })
      .click();
    await expect(page.getByRole('heading', { name: 'ACME Server' })).toBeVisible();
    // The section it came from is gone, not merely scrolled off.
    await expect(page.getByRole('heading', { name: 'General' })).not.toBeVisible();
  });

  test('breadcrumb shows correct group for each section', async ({ page }) => {
    await page.goto('/settings');
    const breadcrumb = page.getByTestId('settings-breadcrumb');

    // General is under System
    await expect(breadcrumb.getByText('System')).toBeVisible();

    // Navigate to DNS Providers under Networking
    await page
      .locator(SETTINGS_SIDEBAR)
      .getByRole('button', { name: 'DNS Providers', exact: true })
      .click();
    await expect(breadcrumb.getByText('Networking')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'DNS Providers' })).toBeVisible();
  });

  test('navigating through all sections renders correct headings', async ({ page }) => {
    await page.goto('/settings');
    const sidebar = page.locator(SETTINGS_SIDEBAR);

    const sections = [
      'General',
      'Default Response',
      'DNS Providers',
      'DNS Resolvers',
      'Upstream DNS Pinning',
      'Global Geoblocking',
      'Authentik Defaults',
      'OAuth Providers',
      'Metrics & Monitoring',
      'Access Logging',
    ];

    for (const name of sections) {
      await sidebar.getByRole('button', { name, exact: true }).click();
      await expect(page.getByRole('heading', { name })).toBeVisible();
    }
  });

  test('only one section is visible at a time', async ({ page }) => {
    await page.goto('/settings');

    // On General, the ACME section's save button must not be in the document at all.
    await expect(page.getByRole('button', { name: /save general settings/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /save acme settings/i })).not.toBeVisible();

    await page
      .locator(SETTINGS_SIDEBAR)
      .getByRole('button', { name: 'ACME Server', exact: true })
      .click();
    await expect(page.getByRole('button', { name: /save acme settings/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /save general settings/i })).not.toBeVisible();
  });
});

// ─── Cmd-K palette ───────────────────────────────────────────────────────────

test.describe('Settings — Cmd-K palette', () => {
  test('Cmd+K opens the command palette', async ({ page }) => {
    await page.goto('/settings');
    await openPaletteWithKeyboard(page);
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByPlaceholder(/search/i)).toBeVisible();
  });

  test('clicking the search button opens the command palette', async ({ page }) => {
    await page.goto('/settings');
    await page.locator(SETTINGS_SIDEBAR).getByText('Jump to setting...').click();
    await expect(page.getByRole('dialog')).toBeVisible();
  });

  test('palette shows all settings items', async ({ page }) => {
    await page.goto('/settings');
    await openPaletteWithKeyboard(page);
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('General')).toBeVisible();
    await expect(dialog.getByText('Default Response')).toBeVisible();
    await expect(dialog.getByText('DNS Providers')).toBeVisible();
    await expect(dialog.getByText('Metrics & Monitoring')).toBeVisible();
  });

  test('typing in the palette filters results', async ({ page }) => {
    await page.goto('/settings');
    await openPaletteWithKeyboard(page);
    const dialog = page.getByRole('dialog');
    const input = dialog.getByPlaceholder(/search/i);
    // "geob" is specific enough that cmdk's fuzzy matching cannot reach an unrelated item.
    await input.fill('geob');
    await expect(dialog.getByText('Global Geoblocking')).toBeVisible();
    // Non-matching items should be hidden
    await expect(dialog.getByText('Access Logging')).not.toBeVisible();
  });

  test('selecting a palette result navigates to that section', async ({ page }) => {
    await page.goto('/settings');
    await openPaletteWithKeyboard(page);
    const dialog = page.getByRole('dialog');
    const input = dialog.getByPlaceholder(/search/i);
    await input.fill('logging');
    await dialog.getByText('Access Logging').click();
    // Palette should close
    await expect(dialog).not.toBeVisible();
    // Detail pane should show logging section
    await expect(page.getByRole('heading', { name: 'Access Logging' })).toBeVisible();
  });

  test('Escape closes the palette', async ({ page }) => {
    await page.goto('/settings');
    await openPaletteWithKeyboard(page);
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).not.toBeVisible();
  });

  test('palette shows "no match" for gibberish query', async ({ page }) => {
    await page.goto('/settings');
    await openPaletteWithKeyboard(page);
    const dialog = page.getByRole('dialog');
    await dialog.getByPlaceholder(/search/i).fill('zzzzxyzzy');
    await expect(dialog.getByText(/no settings match/i)).toBeVisible();
  });
});

// ─── General section ─────────────────────────────────────────────────────────

test.describe('Settings — General', () => {
  // FormRow uses <div> labels (not <Label htmlFor>), so we target inputs by name attribute
  test('shows primary domain and ACME email fields', async ({ page }) => {
    await goToSection(page, 'General');
    await expect(page.locator('input[name="primaryDomain"]')).toBeVisible();
    await expect(page.locator('input[name="acmeEmail"]')).toBeVisible();
    await expect(page.getByRole('button', { name: /save general settings/i })).toBeVisible();
  });

  test('fill primary domain and save', async ({ page }) => {
    await goToSection(page, 'General');
    const domainInput = page.locator('input[name="primaryDomain"]');
    await domainInput.fill('test.local');
    await page.getByRole('button', { name: /save general settings/i }).click();
    await expect(page.getByRole('button', { name: /save general settings/i })).toBeEnabled({
      timeout: 10_000,
    });
  });

  test('primary domain persists after save and page reload', async ({ page }) => {
    await goToSection(page, 'General');
    const domainInput = page.locator('input[name="primaryDomain"]');
    await domainInput.fill('persist-test.local');
    await page.getByRole('button', { name: /save general settings/i }).click();
    await expect(page.getByText(/saved|success/i).first()).toBeVisible({ timeout: 10_000 });

    // Reload and navigate back
    await goToSection(page, 'General');
    await expect(page.locator('input[name="primaryDomain"]')).toHaveValue('persist-test.local');

    // Reset
    await page.locator('input[name="primaryDomain"]').fill('caddyproxymanager.com');
    await page.getByRole('button', { name: /save general settings/i }).click();
    await expect(page.getByText(/saved|success/i).first()).toBeVisible({ timeout: 10_000 });
  });

  test('a changed text field still reads as changed after the save', async ({ page }) => {
    // The text-field half of the form-reset question the toggle test covers, and the answer is that
    // text is already safe: React re-asserts a controlled input's value on every commit, so the
    // reset that strands a checkbox is written straight back here. Pinned rather than assumed —
    // it is the reason ui/FormBooleanControls repairs only the boolean controls, and a change that
    // made TextInput manage its own value the way the base Switch does would silently break it.
    // Deliberately no reload before the assertion: the test above reloads, which repopulates from
    // the database and would hide exactly this.
    await goToSection(page, 'General');
    const domain = page.locator('input[name="primaryDomain"]');
    const save = page.getByRole('button', { name: /save general settings/i });
    const original = await domain.inputValue();

    await domain.fill('reset-check.local');
    await save.click();
    await expect(page.getByText(/saved|success/i).first()).toBeVisible({ timeout: 15_000 });
    await expect(domain).toHaveValue('reset-check.local');

    // Put the stored value back, so this leaves the shared stack as it found it.
    await domain.fill(original);
    await save.click();
    await expect(page.getByText(/saved|success/i).first()).toBeVisible({ timeout: 15_000 });
  });

  test('ACME email field accepts email input', async ({ page }) => {
    await goToSection(page, 'General');
    const emailInput = page.locator('input[name="acmeEmail"]');
    await emailInput.fill('test@example.com');
    await expect(emailInput).toHaveValue('test@example.com');
  });
});

// ─── Default Response section (unknown hosts — issue #241) ──────────────────

test.describe('Settings — Default Response', () => {
  test('shows all supported behaviors and conditional custom fields', async ({ page }) => {
    await goToSection(page, 'Default Response');
    const behavior = page.getByRole('combobox', { name: 'Behavior' });
    await expect(behavior).toBeVisible();
    await behavior.click();
    await expect(page.getByRole('option', { name: 'Caddy native behavior' })).toBeVisible();
    await expect(page.getByRole('option', { name: 'Custom HTTP response' })).toBeVisible();
    await expect(page.getByRole('option', { name: 'Redirect' })).toBeVisible();
    await expect(
      page.getByRole('option', { name: 'No response (abort connection)' }),
    ).toBeVisible();
    await page.getByRole('option', { name: 'Custom HTTP response' }).click();

    await expect(page.locator('input[name="status"]')).toHaveValue('404');
    await expect(page.locator('textarea[name="body"]')).toBeVisible();
    await expect(page.locator('textarea[name="headers"]')).toBeVisible();
    await expect(page.getByRole('button', { name: /save default response/i })).toBeVisible();
  });

  test('saves and reloads a custom response through the settings form', async ({ page }) => {
    await goToSection(page, 'Default Response');
    let behavior = page.getByRole('combobox', { name: 'Behavior' });
    await behavior.click();
    await page.getByRole('option', { name: 'Custom HTTP response' }).click();
    await page.locator('input[name="status"]').fill('451');
    await page.locator('textarea[name="body"]').fill('Unavailable for legal reasons');
    await page
      .locator('textarea[name="headers"]')
      .fill('Content-Type: text/plain; charset=utf-8\nX-Cpm-Ui: saved');
    await page.getByRole('button', { name: /save default response/i }).click();
    await expect(page.getByText('Default response saved and applied successfully')).toBeVisible({
      timeout: 10_000,
    });

    await goToSection(page, 'Default Response');
    behavior = page.getByRole('combobox', { name: 'Behavior' });
    await expect(behavior).toContainText('Custom HTTP response');
    await expect(page.locator('input[name="status"]')).toHaveValue('451');
    await expect(page.locator('textarea[name="body"]')).toHaveValue(
      'Unavailable for legal reasons',
    );
    await expect(page.locator('textarea[name="headers"]')).toHaveValue(
      'Content-Type: text/plain; charset=utf-8\nX-Cpm-Ui: saved',
    );

    await behavior.click();
    await page.getByRole('option', { name: 'Caddy native behavior' }).click();
    await page.getByRole('button', { name: /save default response/i }).click();
    await expect(page.getByText('Default response saved and applied successfully')).toBeVisible({
      timeout: 10_000,
    });
  });
});

// ─── ACME Server section (custom ACME directory URL — issue #192) ─────────────

test.describe('Settings — ACME Server', () => {
  const API_SETTINGS_ACME = 'http://localhost:3000/api/v1/settings/acme';
  const CUSTOM_DIR = 'https://ca.internal.example.com/acme/acme/directory';

  test.afterEach(async ({ page }) => {
    // Reset to the Let's Encrypt default so other runs start clean. The Origin header is required:
    // mutating v1 API calls are same-origin checked and 403 without it, which made this a no-op.
    const res = await page.request.put(API_SETTINGS_ACME, {
      headers: { Origin: SETTINGS_ORIGIN },
      data: { caUrl: '', caRootPem: '' },
    });
    expect(res.ok(), `ACME reset failed: ${res.status()}`).toBe(true);
  });

  test('shows the custom directory URL and CA root fields', async ({ page }) => {
    await goToSection(page, 'ACME Server');
    await expect(page.locator('input[name="caUrl"]')).toBeVisible();
    await expect(page.locator('textarea[name="caRootPem"]')).toBeVisible();
    await expect(page.getByRole('button', { name: /save acme settings/i })).toBeVisible();
  });

  test('saves a custom directory URL and persists it', async ({ page }) => {
    await goToSection(page, 'ACME Server');
    await page.locator('input[name="caUrl"]').fill(CUSTOM_DIR);
    await page.getByRole('button', { name: /save acme settings/i }).click();
    await expect(page.getByText(/saved|success/i).first()).toBeVisible({ timeout: 10_000 });

    await goToSection(page, 'ACME Server');
    await expect(page.locator('input[name="caUrl"]')).toHaveValue(CUSTOM_DIR);
  });

  test('rejects a non-HTTPS directory URL', async ({ page }) => {
    await goToSection(page, 'ACME Server');
    await page.locator('input[name="caUrl"]').fill('http://ca.internal.example.com/directory');
    await page.getByRole('button', { name: /save acme settings/i }).click();
    await expect(page.getByText(/must use HTTPS/i)).toBeVisible({ timeout: 10_000 });
  });

  test('UI save is reflected in the REST API', async ({ page }) => {
    await goToSection(page, 'ACME Server');
    await page.locator('input[name="caUrl"]').fill(CUSTOM_DIR);
    await page.getByRole('button', { name: /save acme settings/i }).click();
    await expect(page.getByText(/saved|success/i).first()).toBeVisible({ timeout: 10_000 });

    const res = await page.request.get(API_SETTINGS_ACME);
    const data = await res.json();
    expect(data.caUrl).toBe(CUSTOM_DIR);
  });
});

// ─── DNS Providers section ───────────────────────────────────────────────────

test.describe('Settings — DNS Providers', () => {
  test('shows provider selector and add form', async ({ page }) => {
    await goToSection(page, 'DNS Providers');
    await expect(page.getByRole('heading', { name: 'DNS Providers' })).toBeVisible();
    // Should have a select for provider
    await expect(page.getByText(/select/i).first()).toBeVisible();
  });

  test('selecting a provider reveals its credential fields', async ({ page }) => {
    await goToSection(page, 'DNS Providers');
    // Click the provider select and pick one (Cloudflare or first available)
    // Selector runs with hasSearch, so the trigger is deliberately NOT a combobox — the popup's
    // search input owns that role. The trigger is the form's only listbox-opening button.
    const providerSelect = page.locator('form#dnsp-add-form button[aria-haspopup="listbox"]');

    await providerSelect.click();
    // Select the first non-"Select" option
    const firstProvider = page
      .getByRole('option')
      .filter({ hasNot: page.locator('text=/select/i') })
      .first();
    await firstProvider.click();
    // Credential input fields should now appear
    // Most providers have at least one field (API token, etc.)
    const formInputs = page.locator(
      // The Selector's own popover search box is a text input inside the form, so exclude
      // comboboxes — otherwise `.first()` picks the hidden search field, not a credential field.
      'form#dnsp-add-form input[type="text"]:not([role="combobox"]), form#dnsp-add-form input[type="password"]',
    );
    await expect(formInputs.first()).toBeVisible({ timeout: 3000 });
  });
});

// ─── DNS Resolvers section ───────────────────────────────────────────────────

test.describe('Settings — DNS Resolvers', () => {
  test('shows enable checkbox and resolver textareas', async ({ page }) => {
    await goToSection(page, 'DNS Resolvers');
    await expect(page.getByRole('heading', { name: 'DNS Resolvers' })).toBeVisible();
    await expect(page.getByLabel('Enable custom DNS resolvers')).toBeVisible();
    await expect(page.locator('textarea[name="resolvers"]')).toBeVisible();
    await expect(page.locator('textarea[name="fallbacks"]')).toBeVisible();
    await expect(page.getByRole('button', { name: /save dns settings/i })).toBeVisible();
  });

  test('timeout field is visible', async ({ page }) => {
    await goToSection(page, 'DNS Resolvers');
    await expect(page.locator('input[name="timeout"]')).toBeVisible();
  });
});

// ─── Upstream DNS Pinning section ────────────────────────────────────────────

test.describe('Settings — Upstream DNS Pinning', () => {
  test('shows enable checkbox and address family selector', async ({ page }) => {
    await goToSection(page, 'Upstream DNS Pinning');
    await expect(page.getByRole('heading', { name: 'Upstream DNS Pinning' })).toBeVisible();
    await expect(page.getByLabel('Enable upstream DNS pinning')).toBeVisible();
    await expect(page.getByRole('button', { name: /save upstream dns/i })).toBeVisible();
  });

  test('address family selector shows three options', async ({ page }) => {
    await goToSection(page, 'Upstream DNS Pinning');
    await page.getByRole('combobox', { name: 'Address family' }).click();
    await expect(page.getByRole('option', { name: /both/i })).toBeVisible();
    await expect(page.getByRole('option', { name: /ipv6 only/i })).toBeVisible();
    await expect(page.getByRole('option', { name: /ipv4 only/i })).toBeVisible();
  });

  test('a changed toggle still reads as changed after the save', async ({ page }) => {
    // React 19 resets the form once the action returns, restoring every control to the value it
    // mounted with — after the last render, so nothing writes the DOM back. The toggle the operator
    // just changed snaps visually back to its old position while the new value is what actually
    // got saved, and the next click then reports the state React already holds, so it appears dead.
    // See ui/FormBooleanControls. Changing it *before* saving is what makes this reproducible: a
    // save in the mounted state resets to the same value and hides the bug entirely.
    await goToSection(page, 'Upstream DNS Pinning');
    const toggle = page.getByLabel('Enable upstream DNS pinning');
    const save = page.getByRole('button', { name: /save upstream dns/i });

    const initial = await toggle.isChecked();
    await toggle.click();
    await expect(toggle).toBeChecked({ checked: !initial });

    await save.click();
    await expect(page.getByText(/saved/i).first()).toBeVisible({ timeout: 15_000 });
    // The assertion the fix exists for: the save must not visually undo what was just saved.
    await expect(toggle).toBeChecked({ checked: !initial });

    // And one click still moves it, rather than reporting the state React already holds.
    await toggle.click();
    await expect(toggle).toBeChecked({ checked: initial });

    // Put the stored value back, so this leaves the shared stack as it found it.
    await save.click();
    await expect(page.getByText(/saved/i).first()).toBeVisible({ timeout: 15_000 });
  });
});

// ─── Authentik Defaults section ──────────────────────────────────────────────

test.describe('Settings — Authentik Defaults', () => {
  test('shows outpost domain, upstream, and auth endpoint fields', async ({ page }) => {
    await goToSection(page, 'Authentik Defaults');
    await expect(page.getByRole('heading', { name: 'Authentik Defaults' })).toBeVisible();
    await expect(page.locator('input[name="outpostDomain"]')).toBeVisible();
    await expect(page.locator('input[name="outpostUpstream"]')).toBeVisible();
    await expect(page.locator('input[name="authEndpoint"]')).toBeVisible();
    await expect(page.getByRole('button', { name: /save authentik/i })).toBeVisible();
  });

  test('fields have appropriate placeholders', async ({ page }) => {
    await goToSection(page, 'Authentik Defaults');
    await expect(page.locator('input[name="outpostDomain"]')).toHaveAttribute(
      'placeholder',
      'outpost.goauthentik.io',
    );
    await expect(page.locator('input[name="outpostUpstream"]')).toHaveAttribute(
      'placeholder',
      'http://authentik-server:9000',
    );
  });
});

// ─── OAuth Providers section ─────────────────────────────────────────────────

test.describe('Settings — OAuth Providers', () => {
  test('section renders with Add Provider button', async ({ page }) => {
    await goToSection(page, 'OAuth Providers');
    await expect(page.getByRole('heading', { name: 'OAuth Providers' })).toBeVisible();
    await expect(page.getByRole('button', { name: /add provider/i })).toBeVisible();
  });

  test('clicking Add Provider opens dialog', async ({ page }) => {
    await goToSection(page, 'OAuth Providers');
    await page.getByRole('button', { name: /add provider/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel(/name/i)).toBeVisible();
    await expect(dialog.getByLabel(/client id/i)).toBeVisible();
    await expect(dialog.getByLabel(/client secret/i)).toBeVisible();
  });

  test('create and delete an OAuth provider', async ({ page }) => {
    await goToSection(page, 'OAuth Providers');
    await page.getByRole('button', { name: /add provider/i }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(/^name/i).fill('E2E Test Provider');
    await dialog.getByLabel(/client id/i).fill('test-client-id-12345');
    await dialog.getByLabel(/client secret/i).fill('test-client-secret-12345');
    // Skip issuer URL — it's optional and avoids potential OIDC discovery issues
    await dialog.getByRole('button', { name: /create provider/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 30_000 });

    // Provider should appear in the list
    await expect(page.getByText('E2E Test Provider')).toBeVisible({ timeout: 10_000 });

    // The delete control is labelled "Delete <provider>", which is unique on the
    // page; "Delete provider" is only its tooltip.
    await page.getByRole('button', { name: 'Delete E2E Test Provider' }).click();
    // Confirmation is an AlertDialog (role="alertdialog", not "dialog") whose
    // action is labelled "Delete provider".
    const confirm = page.getByRole('alertdialog', { name: /delete oauth provider/i });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Delete provider', exact: true }).click();
    await expect(page.getByText('E2E Test Provider', { exact: true })).not.toBeVisible({
      timeout: 10_000,
    });
  });

  test('existing OAuth secrets never cross the API or React browser boundary', async ({ page }) => {
    await page.goto('/settings');
    const origin = new URL(page.url()).origin;
    const secret = `oauth-browser-secret-${Date.now()}`;
    const providerName = `Write-only OAuth ${Date.now()}`;
    const createResponse = await page.request.post(`${origin}/api/v1/oauth-providers`, {
      headers: { Origin: origin },
      data: {
        name: providerName,
        type: 'oidc',
        clientId: 'browser-boundary-client-id',
        clientSecret: secret,
        scopes: 'openid email profile',
      },
    });
    const createBody = await createResponse.text();
    const created = JSON.parse(createBody) as { id: string; hasClientSecret: boolean };

    expect(createResponse.ok()).toBeTruthy();
    expect(created.hasClientSecret).toBe(true);
    expect(createBody).not.toContain(secret);
    expect(createBody).not.toContain('clientSecret');

    try {
      const navigation = await page.goto('/settings');
      const initialRscHtml = await navigation!.text();
      expect(initialRscHtml).not.toContain(secret);
      expect(initialRscHtml).not.toContain('clientSecret');
      expect(await page.content()).not.toContain(secret);

      const itemResponse = await page.request.get(`${origin}/api/v1/oauth-providers/${created.id}`);
      const itemBody = await itemResponse.text();
      expect(itemResponse.ok()).toBeTruthy();
      expect(itemBody).not.toContain(secret);
      expect(itemBody).not.toContain('clientSecret');

      await page
        .locator(SETTINGS_SIDEBAR)
        .getByRole('button', { name: 'OAuth Providers', exact: true })
        .click();
      // Scoping to the card meant guessing at its classes; the button's own accessible name
      // already carries the provider name, which the timestamp makes unique.
      await page.getByRole('button', { name: `Edit ${providerName}` }).click();

      const dialog = page.getByRole('dialog');
      await expect(dialog.getByText(/existing value cannot be viewed/i)).toBeVisible();
      await expect(dialog.getByLabel(/client secret/i)).toHaveCount(0);
      await dialog.getByRole('button', { name: /rotate secret/i }).click();
      await expect(dialog.getByLabel(/new client secret/i)).toHaveValue('');
      await dialog.getByRole('button', { name: /keep existing/i }).click();

      await dialog.getByLabel(/^name/i).fill(`${providerName} renamed`);
      await dialog.getByRole('button', { name: /update provider/i }).click();
      await expect(dialog).not.toBeVisible({ timeout: 10_000 });

      const preservedResponse = await page.request.get(
        `${origin}/api/v1/oauth-providers/${created.id}`,
      );
      const preserved = (await preservedResponse.json()) as { hasClientSecret: boolean };
      expect(preserved.hasClientSecret).toBe(true);
    } finally {
      await page.request
        .delete(`${origin}/api/v1/oauth-providers/${created.id}`, {
          headers: { Origin: origin },
        })
        .catch(() => undefined);
    }
  });
});

// ─── Global Geoblocking section ──────────────────────────────────────────────

test.describe('Settings — Global Geoblocking', () => {
  test('section renders with save button', async ({ page }) => {
    await goToSection(page, 'Global Geoblocking');
    await expect(page.getByRole('heading', { name: 'Global Geoblocking' })).toBeVisible();
    await expect(page.getByRole('button', { name: /save geoblocking/i })).toBeVisible();
  });
});

// ─── Metrics & Monitoring section ────────────────────────────────────────────

test.describe('Settings — Metrics & Monitoring', () => {
  test('shows enable checkbox and port field', async ({ page }) => {
    await goToSection(page, 'Metrics & Monitoring');
    await expect(page.getByRole('heading', { name: 'Metrics & Monitoring' })).toBeVisible();
    await expect(page.getByLabel('Enable metrics endpoint')).toBeVisible();
    await expect(page.locator('input[name="port"]')).toBeVisible();
    await expect(page.getByRole('button', { name: /save metrics/i })).toBeVisible();
  });

  test('port field has default value 9090', async ({ page }) => {
    await goToSection(page, 'Metrics & Monitoring');
    await expect(page.locator('input[name="port"]')).toHaveValue('9090');
  });

  test('info callout mentions Docker network scrape endpoint', async ({ page }) => {
    await goToSection(page, 'Metrics & Monitoring');
    await expect(page.getByText(/caddy-proxy-manager-caddy/i)).toBeVisible();
  });
});

// ─── Access Logging section ──────────────────────────────────────────────────

test.describe('Settings — Access Logging', () => {
  test('shows enable checkbox and format selector', async ({ page }) => {
    await goToSection(page, 'Access Logging');
    await expect(page.getByRole('heading', { name: 'Access Logging' })).toBeVisible();
    await expect(page.getByLabel('Enable access logging')).toBeVisible();
    await expect(page.getByRole('button', { name: /save logging/i })).toBeVisible();
  });

  test('format selector has JSON and Console options', async ({ page }) => {
    await goToSection(page, 'Access Logging');
    await page.getByRole('combobox', { name: 'Format' }).click();
    await expect(page.getByRole('option', { name: 'JSON' })).toBeVisible();
    await expect(page.getByRole('option', { name: /console/i })).toBeVisible();
  });

  test('info callout mentions docker exec command', async ({ page }) => {
    await goToSection(page, 'Access Logging');
    await expect(page.getByText(/docker exec/)).toBeVisible();
  });
});

// ─── Updates section ─────────────────────────────────────────────────────────

test.describe('Settings — Updates', () => {
  test('shows the running version, the toggle and the repository', async ({ page }) => {
    await goToSection(page, 'Updates');
    await expect(page.getByRole('heading', { name: 'Release updates' })).toBeVisible();
    await expect(page.getByLabel('Check for updates')).toBeVisible();

    // The substitution the setting exists for: a fork points this at its own namespace.
    await expect(page.locator('input[name="updateImageRepository"]')).toHaveValue(
      /^[a-z0-9.]+\/[a-z0-9._/-]+$/,
    );
    await expect(page.getByRole('button', { name: 'Check now' })).toBeVisible();
  });

  test('the repository field takes a different namespace', async ({ page }) => {
    // Typed, not saved: saving would reach the registry, and this suite must not depend on
    // ghcr.io being up. What the check does with the value is covered by the unit tests.
    await goToSection(page, 'Updates');
    const repository = page.locator('input[name="updateImageRepository"]');
    await repository.fill('ghcr.io/somerandomuser/caddy-proxy-manager');
    await expect(repository).toHaveValue('ghcr.io/somerandomuser/caddy-proxy-manager');
  });

  test('turning the check off disables the repository field', async ({ page }) => {
    // Nothing to point at when no request is going to be made, and it says so rather than
    // leaving a field that looks live.
    await goToSection(page, 'Updates');
    await page.getByLabel('Check for updates').click();
    // By role, not by name: a disabled Astryx input drops its name attribute, so the selector the
    // other tests use stops matching at exactly the moment this asserts. That the field submits
    // nothing while disabled is why the action treats an absent value as "leave it alone".
    await expect(page.getByRole('textbox', { name: 'Image repository' })).toBeDisabled();
  });
});

// ─── Cross-section navigation ────────────────────────────────────────────────

test.describe('Settings — cross-section navigation', () => {
  test('rapid section switching renders correct content each time', async ({ page }) => {
    await page.goto('/settings');
    const sidebar = page.locator(SETTINGS_SIDEBAR);

    // Click General → verify heading → click Metrics → verify heading
    await sidebar.getByRole('button', { name: 'General', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'General' })).toBeVisible();

    await sidebar.getByRole('button', { name: 'Metrics & Monitoring', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Metrics & Monitoring' })).toBeVisible();

    await sidebar.getByRole('button', { name: 'OAuth Providers', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'OAuth Providers' })).toBeVisible();

    await sidebar.getByRole('button', { name: 'General', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'General' })).toBeVisible();
  });

  test('Cmd-K to navigate, then sidebar to navigate back', async ({ page }) => {
    await page.goto('/settings');

    // Use Cmd-K to go to Access Logging
    await openPaletteWithKeyboard(page);
    const dialog = page.getByRole('dialog');
    await dialog.getByPlaceholder(/search/i).fill('access');
    await dialog.getByText('Access Logging').click();
    await expect(page.getByRole('heading', { name: 'Access Logging' })).toBeVisible();

    // Then use sidebar to go to General
    await page
      .locator(SETTINGS_SIDEBAR)
      .getByRole('button', { name: 'General', exact: true })
      .click();
    await expect(page.getByRole('heading', { name: 'General' })).toBeVisible();
  });
});

// ─── Mobile layout ───────────────────────────────────────────────────────────

test.describe('Settings — mobile layout', () => {
  test.use({ viewport: { width: 393, height: 852 } });

  test('sidebar is hidden on mobile', async ({ page }) => {
    await page.goto('/settings');
    // At mobile width the sidebar panel gives way to the compact section nav.
    await expect(page.locator(SETTINGS_SIDEBAR)).not.toBeVisible();
  });

  test('mobile section navigation is visible', async ({ page }) => {
    await page.goto('/settings');
    // The compact nav is a section dropdown, not a row of pills; it shows the
    // active section as its value.
    const mobileNav = page.getByTestId('mobile-settings-nav');
    const sectionSelect = mobileNav.getByRole('combobox', { name: 'Settings section' });
    await expect(sectionSelect).toBeVisible();
    await expect(sectionSelect).toContainText('General');
  });

  test('mobile search button is visible', async ({ page }) => {
    await page.goto('/settings');
    const mobileNav = page.getByTestId('mobile-settings-nav');
    await expect(mobileNav.getByText('Jump to setting...')).toBeVisible();
  });

  test('choosing a section in the mobile nav switches the detail pane', async ({ page }) => {
    await page.goto('/settings');
    const mobileNav = page.getByTestId('mobile-settings-nav');
    await mobileNav.getByRole('combobox', { name: 'Settings section' }).click();
    await page.getByRole('option', { name: 'General', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'General' })).toBeVisible();
  });

  test('mobile search opens Cmd-K palette', async ({ page }) => {
    await page.goto('/settings');
    const mobileNav = page.getByTestId('mobile-settings-nav');
    await mobileNav.getByText('Jump to setting...').click();
    await expect(page.getByRole('dialog')).toBeVisible();
  });

  test('Cmd-K palette works on mobile', async ({ page }) => {
    await page.goto('/settings');
    const mobileNav = page.getByTestId('mobile-settings-nav');
    await mobileNav.getByText('Jump to setting...').click();
    const dialog = page.getByRole('dialog');
    await dialog.getByPlaceholder(/search/i).fill('metrics');
    await dialog.getByText('Metrics & Monitoring').click();
    await expect(page.getByRole('heading', { name: 'Metrics & Monitoring' })).toBeVisible();
  });

  test('detail content does not overflow viewport width', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth = page.viewportSize()?.width ?? 393;
    expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 5);
  });
});

// ─── Form submissions via API ────────────────────────────────────────────────

test.describe('Settings — form data round-trip via API', () => {
  const API_SETTINGS_GENERAL = 'http://localhost:3000/api/v1/settings/general';
  const API_SETTINGS_METRICS = 'http://localhost:3000/api/v1/settings/metrics';
  const API_SETTINGS_LOGGING = 'http://localhost:3000/api/v1/settings/logging';

  test('general settings: UI save is reflected in API', async ({ page }) => {
    await goToSection(page, 'General');
    await page.locator('input[name="primaryDomain"]').fill('api-roundtrip.local');
    await page.getByRole('button', { name: /save general settings/i }).click();
    await expect(page.getByText(/saved|success/i).first()).toBeVisible({ timeout: 10_000 });

    const res = await page.request.get(API_SETTINGS_GENERAL);
    const data = await res.json();
    expect(data.primaryDomain).toBe('api-roundtrip.local');

    // Reset
    await page.request.put(API_SETTINGS_GENERAL, {
      headers: { Origin: SETTINGS_ORIGIN },
      data: { primaryDomain: 'caddyproxymanager.com', acmeEmail: '' },
    });
  });

  test('metrics settings: enable and change port via UI, verify via API', async ({ page }) => {
    await goToSection(page, 'Metrics & Monitoring');
    const enableCheckbox = page.getByLabel('Enable metrics endpoint');
    if (!(await enableCheckbox.isChecked())) {
      await enableCheckbox.click();
    }
    await page.locator('input[name="port"]').fill('9191');
    await page.getByRole('button', { name: /save metrics/i }).click();
    await expect(page.getByText(/saved|success|applied/i).first()).toBeVisible({ timeout: 10_000 });

    const res = await page.request.get(API_SETTINGS_METRICS);
    const data = await res.json();
    expect(data.enabled).toBe(true);
    expect(data.port).toBe(9191);

    // Reset
    await page.request.put(API_SETTINGS_METRICS, {
      headers: { Origin: SETTINGS_ORIGIN },
      data: { enabled: false, port: 9090 },
    });
  });

  test('logging settings: change format via UI, verify via API', async ({ page }) => {
    await goToSection(page, 'Access Logging');
    // Enable logging
    const enableCheckbox = page.getByLabel('Enable access logging');
    if (!(await enableCheckbox.isChecked())) {
      await enableCheckbox.click();
    }
    // Change format to console
    await page.getByRole('combobox', { name: 'Format' }).click();
    await page.getByRole('option', { name: /console/i }).click();
    await page.getByRole('button', { name: /save logging/i }).click();
    await expect(page.getByText(/saved|success|applied/i).first()).toBeVisible({ timeout: 10_000 });

    const res = await page.request.get(API_SETTINGS_LOGGING);
    const data = await res.json();
    expect(data.format).toBe('console');

    // Reset
    await page.request.put(API_SETTINGS_LOGGING, {
      headers: { Origin: SETTINGS_ORIGIN },
      data: { enabled: false, format: 'json' },
    });
  });
});

// ─── Detail header ───────────────────────────────────────────────────────────

test.describe('Settings — detail header', () => {
  test('header shows description text for each section', async ({ page }) => {
    await goToSection(page, 'General');
    await expect(page.getByText('Primary domain and ACME contact email')).toBeVisible();

    await page
      .locator(SETTINGS_SIDEBAR)
      .getByRole('button', { name: 'DNS Providers', exact: true })
      .click();
    await expect(page.getByText('Provider credentials for ACME DNS-01')).toBeVisible();
  });

  test('header breadcrumb trail includes Settings prefix', async ({ page }) => {
    await page.goto('/settings');
    const breadcrumb = page.getByTestId('settings-breadcrumb');
    await expect(breadcrumb.getByText('Settings')).toBeVisible();
  });
});
