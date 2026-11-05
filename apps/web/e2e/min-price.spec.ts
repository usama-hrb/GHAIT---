import { expect, type Locator, test } from '@playwright/test';
import {
  addProduct,
  connectivity,
  openLastSale,
  payInFull,
  pickProduct,
  serverGet,
  signIn,
  waitForAppShell,
} from './helpers';
import { E2E } from './stack';

const ADD = 'أضف إلى الفاتورة';
const MIN_SWITCH = 'أؤكد البيع بأقل من الحد الأدنى للسعر';
const COST_SWITCH = 'أؤكد البيع دون التكلفة';

/** The keypad's keys, tapped one by one like a finger would. */
async function tap(dialog: Locator, keys: string): Promise<void> {
  const pad = dialog.getByRole('group', { name: 'لوحة الأرقام' });
  for (const key of keys) {
    await pad
      .getByRole('button', { name: key === '.' ? 'الفاصلة العشرية' : key, exact: true })
      .click();
  }
}

interface ServerLine {
  minOverrideBy: string | null;
  actualPriceCents: number;
  minPriceCents: number;
  lineTotalCents: number;
}

test('a cashier cannot sell under the minimum price; the owner can after confirming, and it is recorded', async ({
  browser,
  page,
  request,
}) => {
  test.setTimeout(150_000);
  // The owner stocks a product: 50 m costing 320 rial/m, sold at 400, never under 360.
  await signIn(page);
  await waitForAppShell(page);
  await addProduct(page, { name: 'ساتان - أحمر' });
  await expect(connectivity(page)).not.toContainText(/معلّق/);

  // The cashier: under the minimum the line cannot be added, and there is nothing to confirm.
  const till = await (await browser.newContext()).newPage();
  await signIn(till, E2E.cashier);
  await waitForAppShell(till);
  await expect
    .poll(async () => {
      await till.goto('/pos');
      const tile = till.getByRole('button', { name: /ساتان - أحمر/ });
      // The page renders after `load` (hydration, then the local read): give it a moment before counting.
      await tile
        .first()
        .waitFor({ timeout: 3_000 })
        .catch(() => undefined);
      return tile.count();
    })
    .toBeGreaterThan(0);
  const cashier = await pickProduct(till, 'ساتان - أحمر');
  await cashier.getByLabel('الطول', { exact: true }).fill('2');
  const cashierPrice = cashier.getByLabel('سعر المتر', { exact: true });
  await cashierPrice.fill('359');
  await expect(cashier.getByRole('alert')).toContainText(
    'لا يحق للكاشير البيع بأقل من الحد الأدنى للسعر',
  );
  await expect(cashier.getByRole('button', { name: 'أضف إلى الفاتورة' })).toBeDisabled();
  await expect(cashier.getByRole('switch')).toHaveCount(0);
  // At the minimum itself it is allowed.
  await cashierPrice.fill('360');
  await expect(cashier.getByRole('button', { name: 'أضف إلى الفاتورة' })).toBeEnabled();
  await expect(cashier.getByRole('alert')).toHaveCount(0);

  // The owner, at 340 rial: it needs an explicit confirmation before the line can be added.
  await page.goto('/pos');
  const owner = await pickProduct(page, 'ساتان - أحمر');
  await owner.getByLabel('الطول', { exact: true }).fill('2');
  await owner.getByLabel('سعر المتر', { exact: true }).fill('340');
  await expect(owner.getByRole('alert')).toContainText('الحد الأدنى للسعر');
  await expect(owner.getByRole('button', { name: 'أضف إلى الفاتورة' })).toBeDisabled();
  await owner.getByRole('switch', { name: 'أؤكد البيع بأقل من الحد الأدنى للسعر' }).click();
  await owner.getByRole('button', { name: 'أضف إلى الفاتورة' }).click();
  const bill = page.getByRole('region', { name: 'الفاتورة' });
  await expect(bill.getByText(/أكّده owner/)).toBeVisible();
  // 340 rial is above the cost of 320: no under-cost warning, only the minimum one.
  await expect(bill.getByText('دون التكلفة')).toHaveCount(0);
  await payInFull(page);

  // The sale keeps who confirmed it and the price it went at.
  const saleId = await openLastSale(page);
  await expect(page.getByText(/أكّده owner/)).toBeVisible();
  await expect(connectivity(page)).not.toContainText(/معلّق/);
  await expect
    .poll(async () =>
      (await serverGet<{ lines?: ServerLine[] }>(request, `/sales/${saleId}`)).lines?.map(
        (line) => [
          line.minOverrideBy,
          line.actualPriceCents,
          line.minPriceCents,
          line.lineTotalCents,
        ],
      ),
    )
    .toEqual([['owner', 1700, 1800, 3400]]);
  const audit = await serverGet<{
    items: { entity: string; reason: string | null; after: { minOverrideBy?: string } }[];
  }>(request, '/audit?entity=sale_line');
  expect(
    audit.items.filter(
      (entry) =>
        entry.reason === 'sold under the minimum price' && entry.after.minOverrideBy === 'owner',
    ),
  ).toHaveLength(1);
});

test('under the minimum and under the cost: each is confirmed once, on the line, and paying does not ask again', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  await signIn(page);
  await waitForAppShell(page);
  await addProduct(page, { name: 'دانتيل - أحمر' });

  // 300 rial a metre is under the minimum (360) and under the cost (320): two rules, two switches.
  await page.goto('/pos');
  const dialog = await pickProduct(page, 'دانتيل - أحمر');
  await dialog.getByLabel('الطول', { exact: true }).fill('1');
  await dialog.getByLabel('سعر المتر', { exact: true }).fill('300');
  const add = dialog.getByRole('button', { name: ADD });
  await expect(dialog.getByRole('switch')).toHaveCount(2);
  // The till shows no profit, to the owner either.
  await expect(dialog.getByText('الربح')).toHaveCount(0);
  await expect(add).toBeDisabled();
  // Confirming the minimum does not confirm the cost.
  await dialog.getByRole('switch', { name: MIN_SWITCH }).click();
  await expect(add).toBeDisabled();
  await dialog.getByRole('switch', { name: COST_SWITCH }).click();
  await expect(add).toBeEnabled();
  await add.click();

  // The invoice shows both authorizations and no profit.
  const bill = page.getByRole('region', { name: 'الفاتورة' });
  await expect(bill.getByText(/أكّده owner/)).toBeVisible();
  await expect(bill.getByText('دون التكلفة، مؤكَّد')).toBeVisible();
  await expect(bill.getByText('الربح')).toHaveCount(0);

  // Paying completes at once: no second dialog asks for either.
  await payInFull(page);
  const saleId = await openLastSale(page);
  await expect(connectivity(page)).not.toContainText(/معلّق/);
  await expect
    .poll(async () => {
      const sale = await serverGet<{
        sale?: { confirmedBelowCost: boolean };
        lines?: ServerLine[];
      }>(request, `/sales/${saleId}`);
      return [sale.sale?.confirmedBelowCost, sale.lines?.map((line) => line.minOverrideBy)];
    })
    .toEqual([true, ['owner']]);
});

test('a confirmation belongs to the price it was given for, to its own line, and does not survive a removal', async ({
  page,
  request,
}) => {
  test.setTimeout(150_000);
  await signIn(page);
  await waitForAppShell(page);
  await addProduct(page, { name: 'تفتا - أخضر' });
  await page.goto('/pos');
  const bill = page.getByRole('region', { name: 'الفاتورة' });

  // Confirmed at 340; another price asks again, even when it is typed back.
  let dialog = await pickProduct(page, 'تفتا - أخضر');
  await dialog.getByLabel('الطول', { exact: true }).fill('1');
  const price = dialog.getByLabel('سعر المتر', { exact: true });
  await price.fill('340');
  const confirm = dialog.getByRole('switch', { name: MIN_SWITCH });
  await confirm.click();
  await expect(confirm).toBeChecked();
  await expect(dialog.getByRole('button', { name: ADD })).toBeEnabled();
  await price.fill('330');
  await expect(confirm).not.toBeChecked();
  await expect(dialog.getByRole('button', { name: ADD })).toBeDisabled();
  await price.fill('340');
  await expect(confirm).not.toBeChecked();
  await expect(dialog.getByRole('button', { name: ADD })).toBeDisabled();
  // At the minimum there is nothing to confirm.
  await price.fill('360');
  await expect(dialog.getByRole('switch')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: ADD })).toBeEnabled();
  await price.fill('340');
  await confirm.click();
  await dialog.getByRole('button', { name: ADD }).click();

  // A second line of the same product has its own: the first one does not carry over.
  dialog = await pickProduct(page, 'تفتا - أخضر');
  await dialog.getByLabel('الطول', { exact: true }).fill('1');
  await dialog.getByLabel('سعر المتر', { exact: true }).fill('340');
  await expect(dialog.getByRole('button', { name: ADD })).toBeDisabled();
  await dialog.getByRole('switch', { name: MIN_SWITCH }).click();
  await dialog.getByRole('button', { name: ADD }).click();
  await expect(bill.getByText(/أكّده owner/)).toHaveCount(2);

  // Raise the first line to 370: its confirmation goes, the other line keeps its own.
  await bill
    .getByRole('button', { name: /^تعديل السطر: تفتا/ })
    .first()
    .click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('سعر المتر', { exact: true }).fill('370');
  await expect(dialog.getByRole('switch')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'تحديث السطر' }).click();
  await expect(bill.getByText(/أكّده owner/)).toHaveCount(1);

  // Remove the remaining confirmed line and make it again: it asks again.
  await bill
    .getByRole('button', { name: /^احذف السطر: تفتا/ })
    .last()
    .click();
  await expect(bill.getByText(/أكّده owner/)).toHaveCount(0);
  dialog = await pickProduct(page, 'تفتا - أخضر');
  await dialog.getByLabel('الطول', { exact: true }).fill('1');
  await dialog.getByLabel('سعر المتر', { exact: true }).fill('340');
  await expect(dialog.getByRole('button', { name: ADD })).toBeDisabled();
  await dialog.getByRole('switch', { name: MIN_SWITCH }).click();
  await dialog.getByRole('button', { name: ADD }).click();

  // Both lines go through with one tap; the server has each line's own override.
  await payInFull(page);
  const saleId = await openLastSale(page);
  await expect(connectivity(page)).not.toContainText(/معلّق/);
  await expect
    .poll(async () =>
      (await serverGet<{ lines?: ServerLine[] }>(request, `/sales/${saleId}`)).lines
        ?.map((line) => [line.lineTotalCents, line.minOverrideBy])
        .sort((left, right) => Number(left[0]) - Number(right[0])),
    )
    .toEqual([
      [1700, 'owner'],
      [1850, null],
    ]);
});

test('a discount that takes the invoice under its cost is the one thing paying still asks for', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  await signIn(page);
  await waitForAppShell(page);
  await addProduct(page, { name: 'شيفون - أزرق' });
  await page.goto('/pos');

  // 1 m at the normal 400 rial is above the cost (320): the line asks for nothing.
  const dialog = await pickProduct(page, 'شيفون - أزرق');
  await dialog.getByLabel('الطول', { exact: true }).fill('1');
  await expect(dialog.getByRole('switch')).toHaveCount(0);
  await dialog.getByRole('button', { name: ADD }).click();

  // 100 rial off makes the invoice 300: under the cost, so paying asks.
  const bill = page.getByRole('region', { name: 'الفاتورة' });
  await bill.getByRole('button', { name: 'أضف خصماً' }).click();
  const discount = page.getByRole('dialog');
  await tap(discount, '100');
  await discount.getByRole('button', { name: 'تطبيق' }).click();
  await bill.getByRole('button', { name: /^ادفع/ }).click();
  const checkout = page.getByRole('dialog');
  await expect(checkout.getByText('بيع دون التكلفة', { exact: true })).toBeVisible();
  await expect(checkout.getByRole('button', { name: 'إتمام البيع' })).toBeDisabled();
  await checkout.getByRole('switch', { name: COST_SWITCH }).click();
  await checkout.getByRole('button', { name: 'إتمام البيع' }).click();
  await expect(page.getByText('لا أصناف').first()).toBeVisible();

  const saleId = await openLastSale(page);
  await expect(connectivity(page)).not.toContainText(/معلّق/);
  await expect
    .poll(async () => {
      const sale = await serverGet<{
        sale?: { confirmedBelowCost: boolean };
        lines?: ServerLine[];
      }>(request, `/sales/${saleId}`);
      return [sale.sale?.confirmedBelowCost, sale.lines?.map((line) => line.minOverrideBy)];
    })
    .toEqual([true, [null]]);
});
