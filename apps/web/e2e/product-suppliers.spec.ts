import { expect, test } from '@playwright/test';
import {
  addProduct,
  connectivity,
  serverRecords,
  serverGet,
  signIn,
  waitForAppShell,
} from './helpers';

test('a product names its suppliers, keeps them through an edit, starts a purchase with its one supplier, and has its stock counted from its page', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  await signIn(page);
  await waitForAppShell(page);
  const productId = await addProduct(page, { name: 'مخمل - موردون' });

  // No supplier yet; one is made on the spot and is added to the product.
  const suppliers = page.getByRole('region', { name: 'الموردون', exact: true });
  await expect(suppliers).toContainText('لم يُضف أي مورد بعد.');
  await suppliers.getByRole('button', { name: 'إضافة مورد' }).click();
  // Exact: another spec leaves suppliers named "مورد جديد <tag>" in the shared database.
  await page.getByRole('menuitem', { name: 'مورد جديد', exact: true }).click();
  const made = page.getByRole('dialog');
  await made.getByLabel('الاسم', { exact: true }).fill('مورد المخمل');
  await made.getByRole('button', { name: 'حفظ' }).click();
  await expect(suppliers.getByRole('link', { name: 'مورد المخمل' })).toBeVisible();
  await expect(suppliers).not.toContainText('لم يُضف أي مورد بعد.');

  // Editing the product does not take its suppliers away.
  await page.getByRole('button', { name: 'تعديل المنتج' }).click();
  const edit = page.getByRole('dialog');
  await edit.getByLabel('الرمز (اختياري)').fill('VEL-7');
  await edit.getByRole('button', { name: /^حفظ/ }).click();
  await expect(edit).toBeHidden();
  await expect(page.getByText('VEL-7').first()).toBeVisible();
  await expect(suppliers.getByRole('link', { name: 'مورد المخمل' })).toBeVisible();

  // The one supplier is the one a new purchase starts with.
  const panel = page.getByRole('region', { name: 'إضافة مخزون', exact: true });
  await expect(panel.getByLabel('المورد (اختياري)')).toContainText('مورد المخمل');

  // The list reaches the server and survives a reload.
  await expect(connectivity(page)).not.toContainText(/معلّق/);
  await expect
    .poll(async () => {
      const records = await serverRecords<{ id: string; supplierIds: string[] }>(
        request,
        'product',
      );
      return records.find((record) => record.id === productId)?.supplierIds.length;
    })
    .toBe(1);
  await page.reload();
  await expect(suppliers.getByRole('link', { name: 'مورد المخمل' })).toBeVisible();

  // The stock is edited from the product's page: 50 m on the books, 45 m counted.
  await page.getByRole('button', { name: 'تعديل المخزون' }).click();
  const count = page.getByRole('dialog');
  await expect(count).toContainText('جرد دفعة');
  await count.getByLabel('المعدود الآن', { exact: true }).fill('45');
  await count.getByLabel('السبب', { exact: true }).fill('جرد آخر الشهر');
  await count.getByRole('button', { name: 'حفظ' }).click();
  await expect(count).toBeHidden();
  const overview = page.getByRole('region', { name: 'المخزون', exact: true });
  await expect(
    overview.locator('div', { has: page.getByText('المتوفر', { exact: true }) }).first(),
  ).toContainText('45');

  // A supplier is taken off with its own button; the supplier itself stays in the shop.
  await suppliers.getByRole('button', { name: /إزالة مورد المخمل/ }).click();
  await expect(suppliers).toContainText('لم يُضف أي مورد بعد.');
  await expect(connectivity(page)).not.toContainText(/معلّق/);
  await expect
    .poll(async () => {
      const records = await serverRecords<{ id: string; supplierIds: string[] }>(
        request,
        'product',
      );
      return records.find((record) => record.id === productId)?.supplierIds.length;
    })
    .toBe(0);
  const all = await serverGet<{ name: string }[]>(request, '/suppliers');
  expect(all.some((supplier) => supplier.name === 'مورد المخمل')).toBe(true);
});
