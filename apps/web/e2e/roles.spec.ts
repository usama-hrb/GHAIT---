import { expect, test } from '@playwright/test';
import {
  addFabric,
  connectivity,
  payInFull,
  pickColor,
  reviewAndSave,
  serverGet,
  signIn,
  startPurchase,
  waitForAppShell,
} from './helpers';
import { E2E } from './stack';

test('a cashier sells and sees no cost or profit; the owner sees the sale’s profit', async ({
  browser,
  page,
  request,
}) => {
  // The owner stocks the shop.
  await signIn(page);
  await waitForAppShell(page);
  await addFabric(page, 'مخمل');
  await startPurchase(page, 'بالمتر', 'مخمل');
  await page.getByLabel('سعر المتر').fill('320');
  await page.getByRole('button', { name: 'كل الألوان' }).click();
  await reviewAndSave(page);
  const purchaseId = new URL(page.url()).searchParams.get('id') ?? '';
  await expect(connectivity(page)).not.toContainText(/معلّق/);
  await expect
    .poll(async () => {
      const found = await serverGet<{ rolls?: { id: string }[] }>(
        request,
        `/purchases/${purchaseId}`,
      );
      return found.rolls?.length ?? 0;
    })
    .toBeGreaterThan(0);
  const purchase = await serverGet<{ rolls: { id: string }[] }>(
    request,
    `/purchases/${purchaseId}`,
  );
  const rollId = purchase.rolls[0]?.id ?? '';

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
  await till.goto('/purchases');
  await expect(till.getByText('هذه الشاشة ليست لحساب العامل')).toBeVisible();
  await till.goto('/reports');
  await expect(till.getByText('هذه الشاشة ليست لحساب العامل')).toBeVisible();

  // The roll: its length, never its cost.
  await expect
    .poll(async () => {
      await till.goto(`/inventory/roll?id=${rollId}`);
      return till.getByText('المتبقي').count();
    })
    .toBeGreaterThan(0);
  await expect(till.getByText('التكلفة', { exact: true })).toHaveCount(0);
  await expect(till.getByText('تكلفة المتر')).toHaveCount(0);

  // A sale at the till: 2 m of the red at 400 rial/m = 800 rial. No profit anywhere.
  await till.goto('/pos');
  const dialog = await pickColor(till, 'مخمل', 'أحمر');
  await dialog.getByLabel('الطول', { exact: true }).fill('2');
  await expect(dialog.getByText('مجموع السطر')).toBeVisible();
  await expect(till.getByText('الربح')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'أضف إلى الفاتورة' }).click();
  await expect(till.getByText('الربح')).toHaveCount(0);
  await payInFull(till);
  await expect(till).toHaveURL(/\/pos\/view\?id=/);
  const saleId = new URL(till.url()).searchParams.get('id') ?? '';
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
