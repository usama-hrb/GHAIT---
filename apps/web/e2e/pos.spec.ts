import { expect, test } from '@playwright/test';
import {
  addProduct,
  addToBill,
  connectivity,
  openLastSale,
  payInFull,
  pickProduct,
  restock,
  serverGet,
  signIn,
  waitForAppShell,
} from './helpers';

test('a sale across two batches at a negotiated price, finished offline, shared and synced', async ({
  page,
  request,
}) => {
  await signIn(page);
  await waitForAppShell(page);

  // Two batches of the red chiffon: a ready piece of 2.3 m at 260 rial/m (older), then 50 m at
  // 320 rial/m.
  const productId = await addProduct(page, {
    name: 'شيفون - أحمر',
    stock: { quantity: '2.3', cost: '260' },
  });
  await restock(page, productId, { quantity: '50', cost: '320' });

  // 51 m is more than either batch: the piece first (oldest), the rest from the 50 m batch.
  await page.goto('/pos');
  const dialog = await pickProduct(page, 'شيفون - أحمر');
  await dialog.getByLabel('الطول', { exact: true }).fill('51');
  await expect(dialog.getByText('يُقسَّم على دفعتين')).toBeVisible();
  // Negotiated down from the 400 rial normal price, above the 360 minimum: no warning.
  const price = dialog.getByLabel('سعر المتر', { exact: true });
  await expect(price).toHaveValue('400');
  await price.fill('380');
  await expect(dialog.getByText('مجموع السطر')).toBeVisible();
  await expect(dialog.getByText(/أقل من/)).toHaveCount(0);

  // The connection drops in the middle of the sale; it is finished and saved on the device.
  await page.context().setOffline(true);
  await dialog.getByRole('button', { name: 'أضف إلى الفاتورة' }).click();
  const bill = page.getByRole('region', { name: 'الفاتورة' });
  await expect(bill.getByText('شيفون - أحمر')).toBeVisible();
  await expect(bill.getByText(/أقل من/)).toHaveCount(0);
  await expect(page.getByText('19,380').first()).toBeVisible();
  await payInFull(page);
  const saleId = await openLastSale(page);
  await expect(connectivity(page)).toContainText(/معلّق/);

  // The invoice as WhatsApp text.
  const whatsapp = page.getByRole('link', { name: 'واتساب' });
  const text = decodeURIComponent(
    new URL((await whatsapp.getAttribute('href')) ?? '').searchParams.get('text') ?? '',
  );
  expect(text).toContain('غيث');
  // The unit follows its number after a non-breaking space.
  expect(text).toContain('شيفون - أحمر: 2.3\u00a0م × 380\u00a0ريال = 874\u00a0ريال');
  expect(text).toContain('شيفون - أحمر: 48.7\u00a0م × 380\u00a0ريال = 18,506\u00a0ريال');
  expect(text).toContain('الإجمالي: 19,380\u00a0ريال');
  expect(text).toContain('الباقي: 0\u00a0ريال');

  await page.context().setOffline(false);
  await expect(connectivity(page)).not.toContainText(/معلّق/);
  await expect
    .poll(async () => {
      const sale = await serverGet<{
        lines?: { quantity: number; lineTotalCents: number }[];
        figures?: { totalCents: number; paidCents: number; dueCents: number };
      }>(request, `/sales/${saleId}`);
      return [sale.lines?.map((line) => [line.quantity, line.lineTotalCents]), sale.figures];
    })
    .toEqual([
      [
        [230, 4370],
        [4870, 92_530],
      ],
      expect.objectContaining({ totalCents: 96_900, paidCents: 96_900, dueCents: 0 }),
    ]);

  // Voided with a reason: the cloth goes back on the batches, the payment is refunded.
  await page.getByRole('button', { name: 'إلغاء البيع' }).click();
  await page.getByRole('dialog').getByLabel('السبب').fill('أرجع الزبون القماش');
  await page.getByRole('dialog').getByRole('button', { name: 'تأكيد الإلغاء' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByText('ملغاة', { exact: true })).toBeVisible();
  await expect
    .poll(async () => {
      const sale = await serverGet<{
        sale?: { voidedAt: string | null };
        saleVoid?: { reason: string } | null;
      }>(request, `/sales/${saleId}`);
      return [sale.sale?.voidedAt !== null, sale.saleVoid?.reason];
    })
    .toEqual([true, 'أرجع الزبون القماش']);
});

test('a bill of several products: a second product, and the first again, are added without a crash', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  await signIn(page);
  await waitForAppShell(page);

  // A: 50 m at 320 rial/m, sold at 400. B: 20 m at 500 rial/m, sold at 700.
  await addProduct(page, { name: 'ستان - أ' });
  await addProduct(page, {
    name: 'ستان - ب',
    price: '700',
    min: '640',
    stock: { quantity: '20', cost: '500' },
  });

  // 0.5 m of A, then 1 m of B (the second line used to fail: the bill's hold on A's batch was
  // handed to B's proposal), then 2 m of A again.
  await page.goto('/pos');
  await addToBill(page, 'ستان - أ', '0.5');
  await addToBill(page, 'ستان - ب', '1');
  await addToBill(page, 'ستان - أ', '2');
  const bill = page.getByRole('region', { name: 'الفاتورة' });
  await expect(bill.getByText('ستان - أ')).toHaveCount(2);
  await expect(bill.getByText('ستان - ب')).toHaveCount(1);
  // Next's route announcer is an empty alert; any alert with text is a refusal or a crash.
  await expect(page.getByRole('alert').filter({ hasText: /\S/ })).toHaveCount(0);

  await payInFull(page);
  const saleId = await openLastSale(page);
  await expect(connectivity(page)).not.toContainText(/معلّق/);
  await expect
    .poll(async () => {
      const sale = await serverGet<{
        lines?: { quantity: number; lineTotalCents: number }[];
        figures?: { totalCents: number; capitalCents: number };
      }>(request, `/sales/${saleId}`);
      return [
        sale.lines?.map((line) => [line.quantity, line.lineTotalCents]),
        sale.figures?.totalCents,
        sale.figures?.capitalCents,
      ];
    })
    // 0.5 m at 20 dh, 1 m at 35 dh, 2 m at 20 dh; costing 16 dh/m, 25 dh/m and 16 dh/m.
    .toEqual([
      [
        [50, 1000],
        [100, 3500],
        [200, 4000],
      ],
      8500,
      800 + 2500 + 3200,
    ]);
});
