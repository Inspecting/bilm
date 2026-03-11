import { test, expect } from '@playwright/test';

test('core routes render', async ({ page }) => {
  await page.goto('/home/');
  await expect(page.locator('main')).toBeVisible();

  await page.goto('/movies/show.html?id=447365');
  await expect(page.locator('main')).toBeVisible();

  await page.goto('/tv/show.html?id=1399');
  await expect(page.locator('main')).toBeVisible();

  await page.goto('/settings/');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
});

test('watch player menus are mutually exclusive', async ({ page }) => {
  await page.goto('/movies/watch/viewer.html?id=447365');
  await expect(page.locator('#playexBar')).toBeVisible();

  await page.click('#subtitleBtn');
  await expect(page.locator('#subtitleDropdown')).toBeVisible();

  await page.click('#serverBtn');
  await expect(page.locator('#serverDropdown')).toBeVisible();
  await expect(page.locator('#subtitleDropdown')).toBeHidden();
});

test('anime watch keeps subtitles disabled', async ({ page }) => {
  await page.goto('/tv/watch/viewer.html?anime=1&aid=21459&type=tv');
  await expect(page.locator('#playexBar')).toBeVisible();
  await expect(page.locator('#subtitleBtn')).toBeHidden();
  await expect(page.locator('#autoplayBtn')).toHaveCount(0);
});

test('settings exposes diagnostics controls', async ({ page }) => {
  await page.goto('/settings/');
  await expect(page.locator('#openMaintenanceBtn')).toBeVisible();
  await page.click('#openMaintenanceBtn');
  await expect(page).toHaveURL(/\/settings\/maintenance\/?$/);
  await expect(page.locator('#runHealthCheckBtn')).toBeVisible();
  await expect(page.locator('#restoreMigrationBtn')).toBeVisible();
});
