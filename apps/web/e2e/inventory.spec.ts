import { expect, type Page, test } from '@playwright/test';
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

/** From the stock screen to the colour's (only) roll. */
async function openRoll(page: Page, fabric: string, color: string): Promise<string> {
  await page.goto('/inventory');
  await page
    .getByRole('region', { name: fabric })
    .getByRole('link', { name: color, exact: true })
    .click();
  await page
    .getByRole('link', { name: /^R-[A-Z]+\d{4}$/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/inventory\/roll\?id=/);
  return new URL(page.url()).searchParams.get('id') ?? '';
}

test('measuring a kg roll re-costs it; a loss offline costs its share and syncs', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  await signIn(page);
  await waitForAppShell(page);
  await addFabric(page, 'حرير');

  // T4: 20 kg for 400 dh (8000 rial) at 4 m/kg → an estimated 80 m roll at 5 dh/m (100 rial).
  await startPurchase(page, 'بالكيلو', 'حرير');
  await choose(page, 'اللون', 'أزرق');
  await page.getByLabel('الوزن', { exact: true }).fill('20');
  await page.getByLabel('السعر', { exact: true }).fill('8000');
  await page.getByLabel('الأمتار في الكيلو (تقديري)').fill('4');
  await reviewAndSave(page);
  await openRoll(page, 'حرير', 'أزرق');
  await expect(page.getByText('تقديري').first()).toBeVisible();

  // Measured at 76 m: the preview and then the roll show 5.26 dh/m (105.2 rial); no longer estimated.
  await page.getByRole('button', { name: 'قياس الطول' }).click();
  const measure = page.getByRole('dialog');
  await measure.getByLabel('الطول المقيس الآن').fill('76');
  await expect(measure).toContainText('105.2');
  await measure.getByRole('button', { name: 'حفظ' }).click();
  await expect(page.locator('dl')).toContainText('105.2');
  await expect(page.getByText('تقديري')).toHaveCount(0);
  await expect(page.getByRole('cell', { name: 'قياس', exact: true })).toBeVisible();

  // The fabric's estimate follows the measurement: 7600 cm / 20 kg = 3.8 m/kg.
  await page.goto('/inventory');
  await page
    .getByRole('region', { name: 'حرير' })
    .getByRole('link', { name: 'حرير' })
    .first()
    .click();
  await expect(page.getByLabel('الأمتار في الكيلو (تقديري)')).toHaveValue('3.8');

  // T12: a 50 m roll at 16 dh/m (320 rial); offline, 30 cm of damage costs 4.80 dh (96 rial).
  await startPurchase(page, 'بالمتر', 'حرير');
  await page.getByLabel('سعر المتر').fill('320');
  await page.getByLabel('أحمر', { exact: true }).check();
  await reviewAndSave(page);
  const rollId = await openRoll(page, 'حرير', 'أحمر');

  await page.context().setOffline(true);
  await page.getByRole('button', { name: 'تسجيل تالف' }).click();
  const loss = page.getByRole('dialog');
  await loss.getByLabel('الطول التالف').fill('0.3');
  await loss.getByLabel('السبب').fill('بقعة');
  await expect(loss).toContainText('96');
  await loss.getByRole('button', { name: 'حفظ' }).click();
  await expect(page.locator('dl')).toContainText('49.7');
  await expect(page.getByRole('cell', { name: 'تالف', exact: true })).toBeVisible();
  await expect(connectivity(page)).toContainText(/معلّق/);

  await page.context().setOffline(false);
  await expect(connectivity(page)).toContainText('متصل');
  await expect(connectivity(page)).not.toContainText(/معلّق/);
  await expect
    .poll(async () => {
      const detail = await serverGet<{
        ledger?: { remainingCm: number; costs: { costCents: number }[] };
      }>(request, `/rolls/${rollId}`);
      return (
        detail.ledger && [
          detail.ledger.remainingCm,
          detail.ledger.costs.map((cost) => cost.costCents),
        ]
      );
    })
    .toEqual([4970, [480]]);
});
