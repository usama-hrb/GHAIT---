import { expect, test } from '@playwright/test';
import { signIn, waitForAppShell } from './helpers';

test('reports open offline from the device’s records, and export as CSV', async ({ page }) => {
  await signIn(page);
  await waitForAppShell(page);
  await page.context().setOffline(true);
  await page.goto('/reports');
  await expect(page.getByRole('tab', { name: 'الأرباح شهراً بشهر' })).toBeVisible();
  const profit = page.getByRole('region', { name: 'الأرباح شهراً بشهر' });
  await expect(profit.getByRole('table')).toBeVisible();
  const download = page.waitForEvent('download');
  await profit.getByRole('button', { name: 'تصدير CSV' }).click();
  expect((await download).suggestedFilename()).toBe('profit-by-month.csv');

  await page.getByRole('tab', { name: 'قيمة المخزون' }).click();
  await expect(page.getByRole('region', { name: 'قيمة المخزون' })).toBeVisible();
  await page.context().setOffline(false);
});
