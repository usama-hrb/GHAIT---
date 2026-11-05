import { expect, test } from '@playwright/test';
import {
  addProduct,
  addToBill,
  connectivity,
  openLastSale,
  payInFull,
  serverGet,
  signIn,
  waitForAppShell,
} from './helpers';

test('goods given back: saved offline, the cloth returns to its batch, the profit is reversed, synced', async ({
  page,
  request,
}) => {
  await signIn(page);
  await waitForAppShell(page);

  // 50 m at 16 dh (320 rial), then 10 m sold at 20 dh (400 rial): 4,000 rial.
  await addProduct(page, { name: 'بروكار - أحمر' });

  await page.goto('/pos');
  await addToBill(page, 'بروكار - أحمر', '10');
  await payInFull(page);
  const saleId = await openLastSale(page);
  await expect.poll(() => connectivity(page).textContent()).not.toMatch(/معلّق/);

  // The customer brings back 4 m. Offline, nothing waits for the server.
  await page.context().setOffline(true);
  await page.getByRole('button', { name: 'إرجاع بضاعة' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('الطول المرجَع بروكار - أحمر').fill('4');
  await dialog.getByLabel('السبب').fill('لم يعجبها اللون');
  // 4 of 10 m at 20 dh = 80 dh = 1,600 rial credited; the 2,400 rial left is what it is worth now.
  await expect(dialog.getByText('1,600').first()).toBeVisible();
  await expect(dialog.getByText('2,400').first()).toBeVisible();
  await dialog.getByRole('button', { name: 'حفظ المرتجع' }).click();
  await expect(dialog).toBeHidden();

  const returns = page.getByRole('region', { name: 'المرتجعات' });
  await expect(returns.getByText('لم يعجبها اللون')).toBeVisible();
  await expect(page.getByText('قيمة الفاتورة الآن')).toBeVisible();
  // A sale with returns is returned further, not voided.
  await expect(page.getByText('خرجت بضاعة من هذه الفاتورة')).toBeVisible();
  await expect(page.getByRole('button', { name: 'إلغاء البيع' })).toHaveCount(0);
  await expect(connectivity(page)).toContainText(/معلّق/);

  await page.context().setOffline(false);
  await expect(connectivity(page)).not.toContainText(/معلّق/);
  await expect
    .poll(async () => {
      const sale = await serverGet<{
        figures?: {
          returnedCents: number;
          netTotalCents: number;
          capitalCents: number;
          profitCents: number;
          paidCents: number;
          dueCents: number;
        };
        returns?: unknown[];
      }>(request, `/sales/${saleId}`);
      return [sale.figures, sale.returns?.length];
    })
    .toEqual([
      expect.objectContaining({
        returnedCents: 8000,
        netTotalCents: 12_000,
        capitalCents: 9600, // 6 m kept, at 16 dh/m
        profitCents: 2400,
        paidCents: 12_000,
        dueCents: 0,
      }),
      1,
    ]);
  const integrity = await serverGet<{ ok: boolean; diffCents: number }>(request, '/integrity');
  expect(integrity).toMatchObject({ ok: true, diffCents: 0 });
});
