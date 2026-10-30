import { expect, test } from '@playwright/test';
import {
  addFabric,
  choose,
  connectivity,
  reviewAndSave,
  serverGet,
  signIn,
  startPurchase,
  waitForAppShell,
} from './helpers';

test('purchases by the metre, piece and kg make rolls; one made offline syncs', async ({
  page,
  request,
}) => {
  await signIn(page);
  await waitForAppShell(page);
  await addFabric(page, 'كريب');

  // T1, scaled to two colours: 50 m at 16 dh (320 rial) → two rolls of 800 dh (16,000 rial).
  await startPurchase(page, 'بالمتر', 'كريب');
  await page.getByLabel('سعر المتر').fill('320');
  await page.getByRole('button', { name: 'كل الألوان' }).click();
  await expect(page.getByText('32,000')).toBeVisible();
  await page.getByRole('button', { name: 'مراجعة الشراء' }).click();
  const dialog = page.getByRole('dialog');
  // This browser's device code (every browser profile is a device: A, B… in sign-in order).
  const first = (await dialog.getByText(/^R-[A-Z]+0001$/).textContent()) ?? '';
  const prefix = first.slice(0, -4);
  await expect(dialog.getByText(`${prefix}0002`)).toBeVisible();
  await expect(dialog.getByText('16,000')).toHaveCount(2);
  await dialog.getByRole('button', { name: 'حفظ الشراء' }).click();
  await expect(page).toHaveURL(/\/purchases\/view\?id=/);
  await expect(page.getByRole('cell', { name: `${prefix}0001` })).toBeVisible();

  // T2: a piece of 2.3 m for 100 dh (2000 rial) → 43.48 dh/m, shown live as 869.6 rial.
  await startPurchase(page, 'قطعة جاهزة', 'كريب');
  await choose(page, 'اللون', 'أحمر');
  await page.getByLabel('طول القطعة').fill('2.3');
  await page.getByLabel('سعر القطعة').fill('2000');
  await expect(page.getByText('869.6')).toBeVisible();
  await reviewAndSave(page);

  // T4: 20 kg for 400 dh (8000 rial) at 4 m/kg → an estimated 80 m roll.
  await startPurchase(page, 'بالكيلو', 'كريب');
  await choose(page, 'اللون', 'أزرق');
  await page.getByLabel('الوزن', { exact: true }).fill('20');
  await page.getByLabel('السعر', { exact: true }).fill('8000');
  await page.getByLabel('الأمتار في الكيلو (تقديري)').fill('4');
  await expect(page.getByText('80 م')).toBeVisible();
  await reviewAndSave(page);
  await expect(page.getByText('تقديري').first()).toBeVisible();

  // Offline: a dearer batch by the metre (17 dh/m) warns about renewal cost, saves, then syncs.
  await page.context().setOffline(true);
  await startPurchase(page, 'بالمتر', 'كريب');
  await page.getByLabel('سعر المتر').fill('340');
  await page.getByRole('button', { name: 'كل الألوان' }).click();
  await page.getByRole('button', { name: 'مراجعة الشراء' }).click();
  await expect(page.getByRole('dialog').getByText('تكلفة التجديد أعلى')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'حفظ الشراء' }).click();
  await expect(page).toHaveURL(/\/purchases\/view\?id=/);
  const offlineId = new URL(page.url()).searchParams.get('id') ?? '';
  // One or more waiting (Arabic plural forms: معلّقة، معلّقتان…).
  await expect(connectivity(page)).toContainText(/معلّق/);

  await page.context().setOffline(false);
  await expect(connectivity(page)).toContainText('متصل');
  await expect(connectivity(page)).not.toContainText(/معلّق/);
  await expect
    .poll(async () => {
      const detail = await serverGet<{ rolls?: { shortCode: string; costTotalCents: number }[] }>(
        request,
        `/purchases/${offlineId}`,
      );
      return detail.rolls?.map((roll) => [roll.shortCode, roll.costTotalCents]);
    })
    .toEqual([
      [`${prefix}0005`, 85_000],
      [`${prefix}0006`, 85_000],
    ]);
  // The specs share one server: at least this test's four purchases are there.
  const purchases = await serverGet<unknown[]>(request, '/purchases');
  expect(purchases.length).toBeGreaterThanOrEqual(4);
});
