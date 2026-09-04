/**
 * Migrating a 3.0 installation, in a browser.
 *
 * Runs against `web-migrate` (port 3005): its own empty PostgreSQL database, no `ADMIN_USERNAME`,
 * and a real pre-3.1 SQLite file bind-mounted where the application scans for one. The database is
 * built from `drizzle/legacy-sqlite` — the migrations every 3.0 deployment actually ran — so what
 * the browser sees is a database the application discovered, not one a test injected.
 *
 * One page for the whole block, for the same reason as the setup spec: this is a sequence walked
 * through in a single session, and a fresh context per test would sign the operator out between
 * every step.
 *
 * The importer is covered by tests/integration/legacy-migration.test.ts. What is only provable
 * here is the operator's path through it: the offer comes before account creation, the migrated
 * account is the one they then sign in with, and their data is there at the end.
 */
import { type Page, expect, test } from '@playwright/test';
import {
  LEGACY_CONTAINER_PATH,
  LEGACY_FIXTURE,
  buildLegacyDatabase,
  removeLegacyDatabase,
} from '../helpers/legacy-db';

const MIGRATE_ORIGIN = 'http://localhost:3005';
const LEGACY_PASSWORD = 'LegacyPassword2026!';

let page: Page;

function field(name: string) {
  return page.locator(`input[name="${name}"]`);
}

test.beforeAll(async ({ browser }) => {
  // Spawned rather than imported: Playwright runs this file under Node, which cannot load
  // bun:sqlite. See tests/helpers/build-legacy-db.ts.
  buildLegacyDatabase(LEGACY_PASSWORD);

  const context = await browser.newContext({
    baseURL: MIGRATE_ORIGIN,
    storageState: { cookies: [], origins: [] },
  });
  page = await context.newPage();
});

test.afterAll(async () => {
  await page.context().close();
  removeLegacyDatabase();
});

test.describe.configure({ mode: 'serial' });

test.describe('Migrating an existing installation', () => {
  test('an unconfigured instance with an old database is offered the migration first', async () => {
    // Before account creation, not after: an operator with an old database wants its accounts, not
    // a new one alongside them.
    await page.goto('/');
    await expect(page).toHaveURL(/\/setup\/migrate$/);
    await expect(
      page.getByRole('heading', { name: 'Migrate an existing installation' }),
    ).toBeVisible();
  });

  test('the database it found is named, so an operator can tell which one it is', async () => {
    await expect(page.getByText(LEGACY_CONTAINER_PATH)).toBeVisible();
  });

  test('migrating sends them to sign in with an account it just imported', async () => {
    await page.getByRole('button', { name: 'Migrate this database' }).click();

    // The importer copies thirty tables; the redirect is the signal it finished.
    await expect(page).toHaveURL(/\/login$/, { timeout: 60_000 });
  });

  test('the migrated administrator can sign in with their old password', async () => {
    // The whole point of migrating rather than starting fresh. A user row without its credential
    // account row would leave this account existing and unusable.
    await page.goto('/login');
    await field('username').fill(LEGACY_FIXTURE.adminUsername);
    await field('password').fill(LEGACY_PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();

    // Into the settings step: migrating brings the data across, but the deployment is not
    // configured until that step is saved.
    await expect(page).toHaveURL(/\/setup\/settings$/, { timeout: 30_000 });
  });

  test('finishing setup ends on the summary a migrated deployment is owed', async () => {
    // Not the dashboard: an operator who has just replaced their database needs to be told where
    // the old one is and what to remove from their .env before they go anywhere else.
    await page.getByRole('button', { name: 'Save and finish setup' }).click();
    await expect(page).toHaveURL(/\/setup\/done$/, { timeout: 30_000 });
    await expect(page.getByRole('heading', { name: 'Migration complete' })).toBeVisible();
    await expect(page.getByRole('link', { name: /download the old database/i })).toBeVisible();
  });

  test('the proxy hosts it had are there', async () => {
    await page.goto('/proxy-hosts');
    await expect(
      page.getByRole('table').getByText(LEGACY_FIXTURE.proxyHostName, { exact: true }),
    ).toBeVisible({ timeout: 15_000 });
  });

  test('the settings it had came across too', async () => {
    await page.goto('/settings');
    await expect(page.locator('input[name="primaryDomain"]')).toHaveValue(
      LEGACY_FIXTURE.primaryDomain,
      { timeout: 15_000 },
    );
  });

  test('the old database is still offered for download afterwards', async () => {
    // It was read, not moved. An operator who has just replaced their database wants a copy of the
    // one they came from before they delete anything.
    const response = await page.request.get('/api/setup/backup');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-disposition']).toContain('caddy-proxy-manager.db');
  });

  test('the migration offer does not come back', async () => {
    await page.goto('/setup/migrate');
    await expect(page).not.toHaveURL(/\/setup\/migrate$/);
  });
});
