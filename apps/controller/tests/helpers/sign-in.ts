import type { Page } from '@playwright/test';

/**
 * Drive the credentials half of /login or /portal.
 *
 * Sign-in is identifier first: the username is entered on its own and `Continue` reveals the
 * password. The password field is mounted from the first paint - hidden, so a password manager can
 * still fill both at once - which is why this steps through the button rather than filling both
 * fields straight away: Playwright cannot fill a field inside a `hidden` subtree, and a hidden
 * subtree is out of the accessibility tree, so `getByRole` would not find it either.
 *
 * The caller decides what to await afterwards - a redirect, an error banner, a forced password
 * change - so this returns as soon as the submit is clicked.
 */
export async function signInWithCredentials(
  page: Page,
  username: string,
  password: string,
): Promise<void> {
  await page.getByRole('textbox', { name: /username/i }).fill(username);
  // Anchored: `Continue with <provider>` is an SSO button on the same screen.
  await page.getByRole('button', { name: /^continue$/i }).click();
  await page.getByRole('textbox', { name: /password/i }).fill(password);
  await page.getByRole('button', { name: /^sign in$/i }).click();
}

/** Step one only, for tests that assert what the password step looks like. */
export async function submitUsername(page: Page, username: string): Promise<void> {
  await page.getByRole('textbox', { name: /username/i }).fill(username);
  await page.getByRole('button', { name: /^continue$/i }).click();
}
