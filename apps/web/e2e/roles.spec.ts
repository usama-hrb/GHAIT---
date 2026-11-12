import { expect, test } from '@playwright/test';
import {
  addProduct,
  connectivity,
  openLastSale,
  payInFull,
  pickProduct,
  serverGet,
  serverRecords,
  signIn,
  waitForAppShell,
} from './helpers';
import { E2E } from './stack';

test('a cashier sells and sees no cost or profit; the owner sees the sale’s profit', async ({
  browser,
  page,
  request,
}) => {
  // The owner stocks the shop: 50 m at 320 rial/m.
  await signIn(page);
  await waitForAppShell(page);
  const productId = await addProduct(page, { name: 'مخمل - أحمر' });
  await expect(connectivity(page)).not.toContainText(/معلّق/);
  await expect
    .poll(
      async () =>
        (await serverRecords<{ productId: string }>(request, 'product_batch')).filter(
          (batch) => batch.productId === productId,
        ).length,
    )
    .toBeGreaterThan(0);

  // The cashier's own device.
  const till = await (await browser.newContext()).newPage();
  await signIn(till, E2E.cashier);
  await waitForAppShell(till);

  // Only the till's screens are in the menu.
  const menu = till.getByRole('navigation').first();
  for (const name of ['بيع', 'المخزون', 'الزبائن']) {
    await expect(menu.getByRole('link', { name, exact: true }).first()).toBeVisible();
  }
  for (const name of ['المصروفات', 'الشركاء', 'التسوية', 'الزكاة', 'التقارير', 'شراء']) {
    await expect(menu.getByRole('link', { name, exact: true })).toHaveCount(0);
  }
  // A typed address does not open them.
  await till.goto('/purchases/view');
  await expect(till.getByText('هذه الشاشة ليست لحساب العامل')).toBeVisible();
  await till.goto('/reports');
  await expect(till.getByText('هذه الشاشة ليست لحساب العامل')).toBeVisible();
  // Settings: read-only for a cashier, and the partners are not among its sections.
  await till.goto('/settings/partners');
  await expect(till.getByText('هذه الشاشة ليست لحساب العامل')).toBeVisible();
  await till.goto('/settings');
  const sections = till.getByRole('navigation', { name: 'أقسام الإعدادات' });
  await expect(sections.getByRole('link', { name: /العملة/ })).toBeVisible();
  await expect(sections.getByRole('link', { name: /الشركاء/ })).toHaveCount(0);
  await expect(till.getByLabel('الاسم', { exact: true })).toBeDisabled();
  await expect(till.getByRole('button', { name: 'حفظ التغييرات' })).toHaveCount(0);

  // The product: its stock, never its cost.
  await expect
    .poll(async () => {
      await till.goto(`/inventory/product?id=${productId}`);
      const codes = till
        .getByRole('region', { name: 'دفعات المخزون' })
        .getByText(/^B-[A-Z]+\d{4}$/);
      // The page renders after `load` (hydration, then the local read): give it a moment before counting.
      await codes
        .first()
        .waitFor({ timeout: 3_000 })
        .catch(() => undefined);
      return codes.count();
    })
    .toBeGreaterThan(0);
  await expect(till.getByText('التكلفة', { exact: true })).toHaveCount(0);
  await expect(till.getByText('التكلفة للوحدة')).toHaveCount(0);
  await expect(till.getByText('قيمة المخزون')).toHaveCount(0);

  // A sale at the till: 2 m of the red at 400 rial/m = 800 rial. No profit anywhere.
  await till.goto('/pos');
  const dialog = await pickProduct(till, 'مخمل - أحمر');
  await dialog.getByLabel('الطول', { exact: true }).fill('2');
  await expect(dialog.getByText('مجموع السطر')).toBeVisible();
  await expect(till.getByText('الربح')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'أضف إلى الفاتورة' }).click();
  await expect(till.getByText('الربح')).toHaveCount(0);
  await payInFull(till);
  // The history's drawer shows the whole sale to the till as well, but never its cost or profit,
  // and no way to return goods (the owner's).
  await till.goto('/pos/history');
  await till
    .getByRole('table')
    .getByRole('button', { name: /^افتح بيع/ })
    .first()
    .click();
  const sheet = till.getByRole('dialog', { name: 'تفاصيل البيع' });
  await expect(sheet).toContainText('مخمل - أحمر');
  await expect(sheet.getByRole('button', { name: 'شارك الفاتورة' })).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'إرجاع بضاعة' })).toHaveCount(0);
  await expect(sheet).not.toContainText(/الربح|التكلفة/);
  await till.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  const saleId = await openLastSale(till);
  await expect(till.getByText('الربح')).toHaveCount(0);
  await expect(till.getByText('التكلفة', { exact: true })).toHaveCount(0);
  await expect(till.getByRole('button', { name: 'إرجاع بضاعة' })).toHaveCount(0);
  await expect.poll(() => connectivity(till).textContent()).not.toMatch(/معلّق/);

  // The server priced it with the real cost; the owner sees what it earned.
  const sale = await serverGet<{
    figures?: { capitalCents: number; profitCents: number; totalCents: number };
  }>(request, `/sales/${saleId}`);
  expect(sale.figures).toMatchObject({ totalCents: 4000, capitalCents: 3200, profitCents: 800 });
  await page.goto(`/pos/view?id=${saleId}`);
  await expect(page.getByText('الربح').first()).toBeVisible();
});
