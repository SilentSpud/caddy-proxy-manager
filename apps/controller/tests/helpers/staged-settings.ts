/**
 * Applying a staged change set from the UI.
 *
 * A settings form no longer writes through on save: it stages, and the change reaches the settings
 * table and Caddy only when the operator applies. So any spec that saves in the UI and then checks
 * the REST API - or Caddy itself - has to apply in between, the way a person would.
 */
import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Open the review sheet and apply everything staged.
 *
 * The bar is only rendered when something is pending, so calling this with an empty change set is
 * a mistake worth failing on rather than skipping quietly.
 */
export async function applyStagedChanges(page: Page): Promise<void> {
  const bar = page.getByTestId('staged-bar');
  await expect(bar).toBeVisible({ timeout: 10_000 });

  await bar.getByRole('button', { name: /review & apply/i }).click();

  const apply = page.getByRole('button', { name: /^apply to caddy$/i });
  await expect(apply).toBeVisible({ timeout: 10_000 });
  await apply.click();

  // The bar disappears when the change set empties, which is the signal that the apply committed
  // rather than merely that the click landed.
  await expect(bar).toBeHidden({ timeout: 30_000 });
}

/**
 * Wait for a settings form to confirm that its save was staged.
 *
 * Asserts on the confirmation itself - the status banner the form renders - rather than on any text
 * matching /staged|saved/. Settings persist between specs, so an earlier one's saved value (a
 * response header reading "X-Cpm-Ui: saved", say) can sit in the DOM hidden and be the first match
 * for a loose pattern, failing a save that in fact succeeded.
 */
export async function expectStaged(scope: Page | Locator, timeout = 10_000): Promise<void> {
  await expect(
    scope
      .getByRole('status')
      .filter({ hasText: /^Staged\. Review and apply/ })
      .first(),
  ).toBeVisible({ timeout });
}
