import { expect, test } from '@playwright/test';
import {
  addFabric,
  choose,
  connectivity,
  payInFull,
  pickColor,
  reviewAndSave,
  serverGet,
  signIn,
  startPurchase,
  waitForAppShell,
} from './helpers';

test('a sale across two rolls at a negotiated price, finished offline, shared and synced', async ({
  page,
  request,
}) => {
  await signIn(page);
  await waitForAppShell(page);
  await addFabric(page, 'شيفون');

  // Two red rolls: a ready piece of 2.3 m for 600 rial (older), then 50 m at 320 rial/m.
  await startPurchase(page, 'قطعة جاهزة', 'شيفون');
  await choose(page, 'اللون', 'أحمر');
  await page.getByLabel('طول القطعة').fill('2.3');
  await page.getByLabel('سعر القطعة').fill('600');
  await reviewAndSave(page);
  await startPurchase(page, 'بالمتر', 'شيفون');
  await page.getByLabel('سعر المتر').fill('320');
  await page.getByRole('button', { name: 'كل الألوان' }).click();
  await reviewAndSave(page);

  // 51 m is more than either roll: the piece first (oldest), the rest from the 50 m roll.
  await page.goto('/pos');
  const dialog = await pickColor(page, 'شيفون', 'أحمر');
  await dialog.getByLabel('الطول', { exact: true }).fill('51');
  await expect(dialog.getByText('يُقسَّم على رولين')).toBeVisible();
  // Negotiated down from the 400 rial reference, above the 360 minimum: no warning.
  const price = dialog.getByLabel('سعر المتر', { exact: true });
  await expect(price).toHaveValue('400');
  await price.fill('380');
  await expect(dialog.getByText('مجموع السطر')).toBeVisible();
  await expect(dialog.getByText(/أقل من/)).toHaveCount(0);

  // The connection drops in the middle of the sale; it is finished and saved on the device.
  await page.context().setOffline(true);
  await dialog.getByRole('button', { name: 'أضف إلى الفاتورة' }).click();
  const cart = page.getByRole('region', { name: 'الفاتورة' });
  await expect(cart.getByText('شيفون · أحمر')).toBeVisible();
  await expect(cart.getByText(/أقل من/)).toHaveCount(0);
  await expect(page.getByText('19,380').first()).toBeVisible();
  await payInFull(page);
  await expect(page).toHaveURL(/\/pos\/view\?id=/);
  const saleId = new URL(page.url()).searchParams.get('id') ?? '';
  await expect(connectivity(page)).toContainText(/معلّق/);

  // The invoice as WhatsApp text.
  const whatsapp = page.getByRole('link', { name: 'واتساب' });
  const text = decodeURIComponent(
    new URL((await whatsapp.getAttribute('href')) ?? '').searchParams.get('text') ?? '',
  );
  expect(text).toContain('غيث');
  expect(text).toContain('شيفون أحمر: 2.3 م × 380 ريال = 874 ريال');
  expect(text).toContain('شيفون أحمر: 48.7 م × 380 ريال = 18,506 ريال');
  expect(text).toContain('الإجمالي: 19,380 ريال');
  expect(text).toContain('الباقي: 0 ريال');

  await page.context().setOffline(false);
  await expect(connectivity(page)).not.toContainText(/معلّق/);
  await expect
    .poll(async () => {
      const sale = await serverGet<{
        lines?: { soldCm: number; lineTotalCents: number }[];
        figures?: { totalCents: number; paidCents: number; dueCents: number };
      }>(request, `/sales/${saleId}`);
      return [sale.lines?.map((line) => [line.soldCm, line.lineTotalCents]), sale.figures];
    })
    .toEqual([
      [
        [230, 4370],
        [4870, 92_530],
      ],
      expect.objectContaining({ totalCents: 96_900, paidCents: 96_900, dueCents: 0 }),
    ]);

  // Voided with a reason: the cloth goes back on the rolls, the payment is refunded.
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
