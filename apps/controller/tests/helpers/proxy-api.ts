/**
 * Helpers for creating proxy hosts and access lists in functional E2E tests. Each takes a
 * Playwright `Page` (pre-authenticated via the global storageState).
 */
import { expect, type Download, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { injectFormFields } from './http';

export interface ProxyHostConfig {
  name: string;
  domain: string;
  upstream: string; // e.g. "echo-server:8080"
  accessListName?: string; // name of an existing access list to attach
  certificateName?: string;
  mtlsCaNames?: string[];
  mtlsProtectedPaths?: string[];
  mtlsExcludedPaths?: string[];
  enableWaf?: boolean; // enable WAF with OWASP CRS in blocking mode
  wafMode?: 'merge' | 'override';
  wafLoadOwaspCrs?: boolean;
  wafCustomDirectives?: string;
}

export interface ImportedCertificateConfig {
  name: string;
  domains: string[];
  certificatePem: string;
  privateKeyPem: string;
}

export interface GeneratedCaConfig {
  name: string;
  commonName?: string;
  validityDays?: number;
}

export interface IssuedClientCertificateConfig {
  caName: string;
  commonName: string;
  exportPassword: string;
  validityDays?: number;
}

async function openCertificatesTab(page: Page, tabName: RegExp): Promise<void> {
  await page.goto('/certificates');
  await page.getByRole('button', { name: tabName }).click();
}

async function expandCaRow(page: Page, caName: string): Promise<void> {
  const row = page.locator('tr').filter({ hasText: caName }).first();
  await expect(row).toBeVisible({ timeout: 10_000 });
  await row.locator('button').first().click();
  // The phrase also appears as the title and empty-state copy of the "Manage" dialog, a native
  // <dialog> that stays in the DOM while closed. Exact + visible narrows this to the row's panel.
  await expect(
    page.getByText('Issued Client Certificates', { exact: true }).filter({ visible: true }),
  ).toBeVisible({ timeout: 10_000 });
}

/**
 * Click "Create Host" and wait for its dialog, retrying the click itself.
 *
 * The button is in the server-rendered HTML before React attaches its handler, so a click that
 * lands during hydration is swallowed and no dialog ever opens. By the time the later functional
 * specs run, this page carries every host the earlier ones left behind, which makes hydration slow
 * enough on a CI runner for that window to be hit -- it never reproduced on a developer machine.
 * Retrying the click rides out the race without inflating a timeout and calling it fixed.
 */
export async function openCreateHostDialog(page: Page): Promise<void> {
  await expect(async () => {
    await page.getByRole('button', { name: /create host/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
}

/**
 * Create a proxy host via the browser UI. ssl_forced is always false so functional tests can use
 * plain HTTP.
 */
export async function createProxyHost(page: Page, config: ProxyHostConfig): Promise<void> {
  await page.goto('/proxy-hosts');
  await openCreateHostDialog(page);

  await page.getByLabel('Name').fill(config.name);
  await page.getByLabel(/^domains/i).fill(config.domain);

  // Support multiple upstreams separated by newlines.
  const upstreamList = config.upstream
    .split('\n')
    .map((u) => u.trim())
    .filter(Boolean);
  // Fill the first (always-present) upstream input
  await page
    .getByPlaceholder('10.0.0.5:8080')
    .first()
    .fill(upstreamList[0] ?? '');
  // Add additional upstreams via the "Add Upstream" button
  for (let i = 1; i < upstreamList.length; i++) {
    await page.getByRole('button', { name: /add upstream/i }).click();
    await page.getByPlaceholder('10.0.0.5:8080').nth(i).fill(upstreamList[i]);
  }

  if (config.certificateName) {
    const certTrigger = page.getByRole('combobox', { name: /certificate/i });
    await certTrigger.scrollIntoViewIfNeeded();
    await certTrigger.click();
    const certOption = page.getByRole('option', { name: config.certificateName, exact: true });
    await expect(certOption).toBeVisible({ timeout: 5_000 });
    await certOption.click();
  }

  if (config.accessListName) {
    // shadcn/Radix Select — click trigger to open portal dropdown, wait for option, then click
    const accessListTrigger = page.getByRole('combobox', { name: /access list/i });
    await accessListTrigger.scrollIntoViewIfNeeded();
    await accessListTrigger.click();
    const option = page.getByRole('option', { name: config.accessListName });
    await expect(option).toBeVisible({ timeout: 10_000 });
    await option.click();
  }

  if (config.mtlsCaNames?.length) {
    // Enable mTLS: scroll to the section, then click the switch in the containing card
    const mtlsCard = page.locator('input[name="mtlsEnabled"]').locator('..');
    await mtlsCard.scrollIntoViewIfNeeded();
    await mtlsCard.getByRole('switch').click();

    await expect(page.getByText(/trusted certificates/i)).toBeVisible({ timeout: 10_000 });

    // Click each CA group header to select all issued certs from that CA
    for (const caName of config.mtlsCaNames) {
      const caLabel = page.locator('label').filter({ hasText: caName });
      await caLabel.scrollIntoViewIfNeeded();
      await caLabel.click();
    }
    // Verify at least one cert was selected (each CA group selects its certs)
    const certInputs = page.locator('input[name="mtlsCertId"]');
    await expect(certInputs.first()).toBeAttached({ timeout: 5_000 });

    if (config.mtlsProtectedPaths?.length) {
      await page.locator('[name="mtlsProtectedPaths"]').fill(config.mtlsProtectedPaths.join(', '));
    }

    if (config.mtlsExcludedPaths?.length) {
      await page.locator('[name="mtlsExcludedPaths"]').fill(config.mtlsExcludedPaths.join(', '));
    }
  }

  // Inject hidden fields:
  //  sslForcedPresent=on  → tells the action the field was in the form
  //  (sslForced absent)   → parseCheckbox(null) = false → no HTTPS redirect
  const extraFields: Record<string, string> = { sslForcedPresent: 'on' };

  if (config.enableWaf) {
    Object.assign(extraFields, {
      wafPresent: 'on',
      wafEnabled: 'on',
      wafEngineMode: 'On', // blocking mode (the host form only accepts On/Off)
      wafLoadOwaspCrs: config.wafLoadOwaspCrs === false ? '' : 'on',
      wafMode: config.wafMode ?? 'override',
      wafCustomDirectives: config.wafCustomDirectives ?? '',
    });
  }

  await injectFormFields(page, extraFields);

  await page.getByRole('button', { name: /^create$/i }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('table').getByText(config.name, { exact: true })).toBeVisible({
    timeout: 10_000,
  });
}

export async function importCertificate(
  page: Page,
  config: ImportedCertificateConfig,
): Promise<void> {
  await openCertificatesTab(page, /^Imported/i);
  await page.getByRole('button', { name: /import certificate/i }).click();
  await expect(page.getByRole('heading', { name: /^import certificate$/i })).toBeVisible();

  await page.getByRole('textbox', { name: /^Name/ }).fill(config.name);
  await page.getByLabel(/domains \(one per line\)/i).fill(config.domains.join('\n'));
  await page.locator('[name="certificate_pem"]').fill(config.certificatePem);
  await page.getByRole('button', { name: /show private key/i }).click();
  await page.locator('[name="private_key_pem"]').fill(config.privateKeyPem);
  // Scope the submit to the sheet's form: the page-level trigger that opened
  // the sheet carries the same label and stays in the DOM behind it.
  await page.locator('button[form="import-cert-form"]').click();

  // Wait for the import sheet to close, then verify the cert appears in the table
  await expect(page.getByRole('heading', { name: /^import certificate$/i })).not.toBeVisible({
    timeout: 10_000,
  });
  await page.waitForTimeout(500); // allow page to revalidate
  await expect(page.locator('table').getByText(config.name, { exact: true }).first()).toBeVisible({
    timeout: 10_000,
  });
}

export async function generateCaCertificate(page: Page, config: GeneratedCaConfig): Promise<void> {
  await openCertificatesTab(page, /^CA \/ mTLS/i);
  await page.getByRole('button', { name: /add ca certificate/i }).click();
  await expect(page.getByRole('heading', { name: /^add ca certificate$/i })).toBeVisible();

  await page.getByRole('textbox', { name: /^Name/ }).fill(config.name);
  if (config.commonName) {
    await page
      .getByRole('textbox', { name: 'Common Name (CN)', exact: true })
      .fill(config.commonName);
  }
  if (config.validityDays !== undefined) {
    await page
      .getByRole('spinbutton', { name: 'Validity', exact: true })
      .fill(String(config.validityDays));
  }

  await page.getByRole('button', { name: /generate ca certificate/i }).click();
  await expect(page.getByRole('heading', { name: /^add ca certificate$/i })).not.toBeVisible({
    timeout: 10_000,
  });
  await expect(page.locator('table').getByText(config.name, { exact: true }).first()).toBeVisible({
    timeout: 15_000,
  });
}

export async function issueClientCertificate(
  page: Page,
  config: IssuedClientCertificateConfig,
): Promise<Buffer> {
  await openCertificatesTab(page, /^CA \/ mTLS/i);
  await expandCaRow(page, config.caName);
  await page.getByRole('button', { name: /^issue cert$/i }).click();
  // Every CA row mounts its own issue dialog, and a closed native <dialog> stays in the DOM — so
  // scope field lookups to the open one. (getByRole skips hidden elements; getByLabel does not.)
  const dialog = page.getByRole('dialog', { name: /issue client certificate/i });
  await expect(dialog).toBeVisible();

  // Required fields render their accessible name with a "Required" suffix, so
  // an exact match can never hit them — anchor on the prefix instead.
  await dialog.getByRole('textbox', { name: /^Common Name \(CN\)/ }).fill(config.commonName);
  if (config.validityDays !== undefined) {
    await dialog.getByRole('spinbutton', { name: /^Validity/ }).fill(String(config.validityDays));
  }
  await dialog.getByRole('textbox', { name: /^Export Password/ }).fill(config.exportPassword);

  await dialog.getByRole('button', { name: /issue certificate/i }).click();
  await expect(dialog.getByRole('button', { name: /download client certificate/i })).toBeVisible({
    timeout: 15_000,
  });

  const downloadPromise = page.waitForEvent('download');
  await dialog.getByRole('button', { name: /download client certificate/i }).click();
  const download = await downloadPromise;
  const downloadPath = await saveDownload(download);

  await dialog.getByRole('button', { name: /^done$/i }).click();
  await expect(dialog).not.toBeVisible({ timeout: 10_000 });

  return readFile(downloadPath);
}

export async function revokeIssuedClientCertificate(
  page: Page,
  caName: string,
  commonName: string,
): Promise<void> {
  await openCertificatesTab(page, /^CA \/ mTLS/i);
  await expandCaRow(page, caName);
  await page.getByRole('button', { name: /^manage$/i }).click();
  const dialog = page.getByRole('dialog', { name: /issued client certificates/i });
  await expect(dialog).toBeVisible();

  // Each issued cert renders as a design-system Card; the old '.rounded-lg.border' Tailwind
  // classes are no longer emitted.
  const certCard = dialog.locator('.astryx-card').filter({ hasText: commonName });
  await expect(certCard).toBeVisible({ timeout: 10_000 });
  await certCard.getByRole('button', { name: /^revoke$/i }).click();
  // Revoked certs are filtered out of the list unless "Show revoked" is on, so
  // the whole card goes away rather than just its button.
  await expect(certCard).toHaveCount(0, { timeout: 15_000 });
  await dialog
    .getByRole('button', { name: /^close$/i })
    .first()
    .click();
}

async function saveDownload(download: Download): Promise<string> {
  const downloadPath = await download.path();
  if (!downloadPath) {
    throw new Error('Playwright download did not produce a local file path');
  }
  return downloadPath;
}

export interface AccessListUser {
  username: string;
  password: string;
}

/**
 * Create an access list with initial users via the browser UI: opens the "New" dialog, fills in
 * name + seed members, and creates.
 */
export async function createAccessList(
  page: Page,
  name: string,
  users: AccessListUser[],
): Promise<void> {
  await page.goto('/access-lists');

  // Open the create dialog
  await page.getByRole('button', { name: /^new$/i }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 5_000 });

  // Fill the name
  await dialog.getByPlaceholder(/internal.*engineering/i).fill(name);

  // Fill seed members
  if (users.length > 0) {
    // Fill the first seed member row
    await dialog.getByPlaceholder('username').first().fill(users[0].username);
    await dialog.getByPlaceholder('password').first().fill(users[0].password);

    // Add additional seed member rows
    for (let i = 1; i < users.length; i++) {
      await dialog.getByRole('button', { name: 'Add another member' }).click();
      await dialog.getByPlaceholder('username').nth(i).fill(users[i].username);
      await dialog.getByPlaceholder('password').nth(i).fill(users[i].password);
    }
  }

  await dialog.getByRole('button', { name: /create list/i }).click();

  // Wait for the dialog to close and the list to appear in the rail
  await expect(dialog).not.toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('heading', { name }).first()).toBeVisible({ timeout: 10_000 });
}
