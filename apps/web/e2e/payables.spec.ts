import { expect, test } from '@playwright/test';
import {
  addFabric,
  choose,
  connectivity,
  reviewAndSave,
  serverGet,
  serverPut,
  signIn,
  startPurchase,
  waitForAppShell,
} from './helpers';

test('a purchase part paid is owed to the supplier; paid down offline, it syncs', async ({
  page,
  request,
}) => {
  await signIn(page);
  await waitForAppShell(page);
  const supplierId = crypto.randomUUID();
  await serverPut(request, `/suppliers/${supplierId}`, { name: 'مورد الساتان' });
  await addFabric(page, 'ساتان');
  await page.reload();
  await waitForAppShell(page);

  // 100 m in two colours at 16 dh (320 rial/m) = 32,000 rial; 10,000 rial paid, 22,000 rial owed.
  await startPurchase(page, 'بالمتر', 'ساتان');
  await choose(page, 'المورد', 'مورد الساتان');
  await page.getByLabel('سعر المتر').fill('320');
  await page.getByRole('button', { name: 'كل الألوان' }).click();
  await page.getByLabel('المدفوع الآن').fill('10000');
  await expect(page.getByText('الباقي للمورد').first()).toBeVisible();
  await reviewAndSave(page);
  await expect(page.getByText('الباقي للمورد').first()).toBeVisible();

  await expect(connectivity(page)).not.toContainText(/معلّق/);
  await expect
    .poll(async () => {
      const rows = await serverGet<{ supplier: { id: string }; account: { owedCents: number } }[]>(
        request,
        '/supplier-payables',
      );
      return rows.find((row) => row.supplier.id === supplierId)?.account.owedCents;
    })
    .toBe(110_000); // 22,000 rial

  // Who the shop owes, and one payment of 5,000 rial made offline.
  await page.goto('/payables');
  await page.getByRole('link', { name: 'مورد الساتان' }).click();
  await expect(page.getByRole('heading', { name: 'مورد الساتان' })).toBeVisible();
  await expect(page.getByText('22,000').first()).toBeVisible();
  await page.context().setOffline(true);
  await page.getByRole('button', { name: 'دفع للمورد' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('المبلغ').fill('5000');
  await dialog.getByRole('button', { name: 'حفظ' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('17,000').first()).toBeVisible();
  await expect(connectivity(page)).toContainText(/معلّق/);

  // More than is owed is refused, on the device.
  await page.getByRole('button', { name: 'دفع للمورد' }).click();
  await dialog.getByLabel('المبلغ').fill('17001');
  await dialog.getByRole('button', { name: 'حفظ' }).click();
  await expect(page.getByText('أكثر مما علينا لهذا المورد')).toBeVisible();
  await dialog.getByRole('button', { name: 'إلغاء' }).click();

  await page.context().setOffline(false);
  await expect(connectivity(page)).not.toContainText(/معلّق/);
  await expect
    .poll(async () => {
      const rows = await serverGet<{ supplier: { id: string }; account: { owedCents: number } }[]>(
        request,
        '/supplier-payables',
      );
      return rows.find((row) => row.supplier.id === supplierId)?.account.owedCents;
    })
    .toBe(85_000); // 17,000 rial
  const integrity = await serverGet<{ ok: boolean }>(request, '/integrity');
  expect(integrity.ok).toBe(true);
});
