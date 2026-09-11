/**
 * Applying a staged change set from the UI.
 *
 * A settings form no longer writes through on save: it stages, and the change reaches the settings
 * table and Caddy only when the operator applies. So any spec that saves in the UI and then checks
 * the REST API - or Caddy itself - has to apply in between, the way a person would.
 */
import { expect, type Page } from '@playwright/test';

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
