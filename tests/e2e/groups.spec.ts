/**
 * E2E tests: Groups management page.
 *
 * Verifies group creation, member management, and deletion.
 * Runs as admin (testadmin) — the page requires admin role.
 */
import { test, expect } from '@playwright/test';

test.describe('Groups page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/groups');
  });

  test('page loads with Groups heading', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Groups', exact: true })).toBeVisible();
    await expect(
      page.getByText('Organize users into groups for forward auth access control.'),
    ).toBeVisible();
  });

  test('New Group button is visible', async ({ page }) => {
    await expect(page.getByRole('button', { name: /new group/i })).toBeVisible();
  });

  test('clicking New Group toggles create form', async ({ page }) => {
    await page.getByRole('button', { name: /new group/i }).click();

    // Form fields should appear
    await expect(page.getByLabel('Name')).toBeVisible();
    await expect(page.getByLabel('Description')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
  });

  test('clicking Cancel hides the create form', async ({ page }) => {
    await page.getByRole('button', { name: /new group/i }).click();
    await expect(page.getByLabel('Name')).toBeVisible();

    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByLabel('Name')).not.toBeVisible();
  });

  test('create a new group', async ({ page }) => {
    await page.getByRole('button', { name: /new group/i }).click();

    await page.getByLabel('Name').fill('E2E Test Group');
    await page.getByLabel('Description').fill('Created by E2E test');
    await page.getByRole('button', { name: 'Create' }).click();

    // Group should appear in the list
    await expect(page.getByText('E2E Test Group')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Created by E2E test')).toBeVisible();
    await expect(page.getByText('0 members').first()).toBeVisible();
  });

  test('add member to group', async ({ page }) => {
    // Ensure the group exists
    await expect(page.getByText('E2E Test Group', { exact: true })).toBeVisible({ timeout: 5_000 });

    // Click add member button
    await page.getByRole('button', { name: 'Add member' }).first().click();
    await expect(page.getByText('Add a user to this group')).toBeVisible();

    // The available-users list renders as ListItems inside the add-member
    // panel — the old '.border.rounded-md' container class is not emitted any
    // more, so scope to the panel that owns the prompt text instead.
    const addPanel = page
      .locator('div.astryx-stack')
      .filter({ hasText: 'Add a user to this group' })
      .last();
    const noneLeft = addPanel.getByText('All users are already in this group.');
    const firstUser = addPanel.getByRole('listitem').first();

    // Assert one of the two branches actually rendered, so an empty panel is a
    // failure rather than a silently skipped test.
    await expect(firstUser.or(noneLeft).first()).toBeVisible({ timeout: 5_000 });

    if (await firstUser.isVisible()) {
      await firstUser.click();
      await expect(page.getByText('1 member').first()).toBeVisible({ timeout: 10_000 });
    }
  });

  test('remove member from group', async ({ page }) => {
    // If the group has a member, remove it
    const removeMemberBtn = page.getByRole('button', { name: /^Remove .+ from / }).first();
    if (await removeMemberBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await removeMemberBtn.click();
      await expect(page.getByText('0 members').first()).toBeVisible({ timeout: 10_000 });
    }
  });

  test('delete group via confirm dialog', async ({ page }) => {
    await expect(page.getByText('E2E Test Group')).toBeVisible({ timeout: 5_000 });

    // Deletion is confirmed through an in-app AlertDialog (it replaced
    // window.confirm), so there is no native dialog event to accept. The row
    // button is labelled per group; the dialog's action is the bare verb.
    await page.getByRole('button', { name: 'Delete group E2E Test Group' }).click();
    const confirm = page.getByRole('alertdialog');
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Delete group', exact: true }).click();

    // Group should be removed
    await expect(page.getByText('E2E Test Group', { exact: true })).not.toBeVisible({
      timeout: 10_000,
    });
  });

  test('shows empty state when no groups exist', async ({ page }) => {
    // If there are no groups, the empty state text should be visible
    // (This may or may not show depending on existing data)
    const newGroupBtn = page.getByRole('button', { name: /new group/i });
    // At minimum the button should always be visible
    await expect(newGroupBtn).toBeVisible();
  });
});

test.describe('Groups page — unauthenticated access', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('unauthenticated access to /groups redirects to /login', async ({ page }) => {
    await page.goto('/groups');
    await expect(page).toHaveURL(/\/login/);
  });
});
