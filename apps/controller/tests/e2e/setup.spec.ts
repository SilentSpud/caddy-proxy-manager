/**
 * First-run setup, in a browser.
 *
 * Runs against `web-setup` (port 3004): its own empty database and no `ADMIN_USERNAME`, so nothing
 * can sign in and the instance is genuinely in the setup flow rather than being shown the screens
 * out of context.
 *
 * One page for the whole block, created once. Setup is a sequence an operator walks through in a
 * single session — Playwright's default of a fresh context per test would sign them out between
 * every step, which is neither what happens nor what is worth pinning.
 *
 * The integration tests already cover the state machine. What only a browser shows is that the
 * redirects land, the forms submit, and each step leads to the next.
 */
import { type Page, expect, test } from '@playwright/test';

const SETUP_ORIGIN = 'http://localhost:3004';
const USERNAME = 'setupadmin';
const PASSWORD = 'SetupPassword2026!';

let page: Page;

/** Fill an input by name: FormRow labels are divs, not `<label for>`. */
function field(name: string) {
  return page.locator(`input[name="${name}"]`);
}

test.beforeAll(async ({ browser }) => {
  // No storage state: the suite's default is an authenticated admin on the *other* instance, and
  // carrying it here would send a cookie this one has never issued.
  const context = await browser.newContext({
    baseURL: SETUP_ORIGIN,
    storageState: { cookies: [], origins: [] },
  });
  page = await context.newPage();
});

test.afterAll(async () => {
  await page.context().close();
});

test.describe.configure({ mode: 'serial' });

test.describe('First-run setup', () => {
  test('an unconfigured instance sends every page to the setup screen', async () => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/setup$/);
    await expect(page.getByRole('heading', { name: 'Set up Caddy Proxy Manager' })).toBeVisible();
  });

  test('the login page redirects into setup rather than offering a form nothing can answer', async () => {
    // The bug this pins: /login used to be public and returned before the setup check ran, so a
    // fresh deployment showed a sign-in form for an account that did not exist, with no way
    // forward but guessing the URL.
    await page.goto('/login');
    await expect(page).toHaveURL(/\/setup$/);
  });

  test('choosing the agent role explains that agents are set up elsewhere', async () => {
    await page.goto('/setup');
    await page.getByRole('radio', { name: 'Agent' }).click();

    await expect(page.getByText('Agents are set up separately')).toBeVisible();
    // And there is a way back — a dead end here would leave an operator with no route to finishing.
    await page.getByRole('button', { name: 'Back to controller setup' }).click();
    await expect(page.getByRole('button', { name: /create account and sign in/i })).toBeVisible();
  });

  test('the OAuth option offers a provider form instead of an account form', async () => {
    await page.goto('/setup');
    await page.getByRole('radio', { name: 'OAuth provider' }).click();

    await expect(field('issuer')).toBeVisible();
    await expect(field('clientId')).toBeVisible();
    await expect(field('username')).toHaveCount(0);
  });

  test('a mismatched confirmation is refused without creating anything', async () => {
    await page.goto('/setup');
    await field('username').fill(USERNAME);
    await field('password').fill(PASSWORD);
    await field('passwordConfirmation').fill('SomethingElse2026!');
    await page.getByRole('button', { name: /create account and sign in/i }).click();

    await expect(page.getByText('The two passwords do not match.')).toBeVisible();
    // Still on setup: a refused submission that navigated would look like success.
    await expect(page).toHaveURL(/\/setup$/);
  });

  test('creating the first administrator sends them to prove the password works', async () => {
    await page.goto('/setup');
    await field('username').fill(USERNAME);
    await field('password').fill(PASSWORD);
    await field('passwordConfirmation').fill(PASSWORD);
    await page.getByRole('button', { name: /create account and sign in/i }).click();

    // To the login page on purpose: the point of this step is to prove the credentials work before
    // any more configuration is entered.
    await expect(page).toHaveURL(/\/login$/, { timeout: 30_000 });
  });

  test('signing in with the new account carries on into the settings step', async () => {
    await page.goto('/login');
    await field('username').fill(USERNAME);
    await field('password').fill(PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();

    await expect(page).toHaveURL(/\/setup\/settings$/, { timeout: 30_000 });
  });

  test('the settings step shows the values it is about to take over', async () => {
    // The point of this screen: an operator has to see what is being copied into the database
    // before they can be told to delete it from their .env.
    await expect(page.getByRole('heading', { name: 'Finish setting up' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Public URL' })).toHaveValue(SETUP_ORIGIN);
  });

  test('saving the settings finishes setup and opens the dashboard', async () => {
    await page.getByRole('button', { name: 'Save and finish setup' }).click();
    await expect(page).toHaveURL(new RegExp(`^${SETUP_ORIGIN}/?$`), { timeout: 30_000 });
  });

  test('setup is one-way: its screens redirect away once finished', async () => {
    await page.goto('/setup');
    await expect(page).not.toHaveURL(/\/setup$/);

    await page.goto('/setup/migrate');
    await expect(page).not.toHaveURL(/\/setup\/migrate$/);
  });

  test('the account it created can sign in from scratch', async ({ browser }) => {
    // A fresh context: the assertion is that the credentials work, not that the session from the
    // setup flow is still around.
    const context = await browser.newContext({
      baseURL: SETUP_ORIGIN,
      storageState: { cookies: [], origins: [] },
    });
    const fresh = await context.newPage();
    try {
      await fresh.goto('/login');
      await fresh.locator('input[name="username"]').fill(USERNAME);
      await fresh.locator('input[name="password"]').fill(PASSWORD);
      await fresh.getByRole('button', { name: /sign in/i }).click();

      await expect(fresh).toHaveURL(new RegExp(`^${SETUP_ORIGIN}/?$`), { timeout: 30_000 });
    } finally {
      await context.close();
    }
  });
});
