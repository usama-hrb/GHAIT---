import { expect, type Page, test } from '@playwright/test';
import {
  addProduct,
  addToBill,
  connectivity,
  fillStock,
  openRestock,
  payInFull,
  restock,
  signIn,
  submitRestock,
  waitForAppShell,
} from './helpers';

const overviewOf = (page: Page) => page.getByRole('region', { name: 'المخزون', exact: true });
const batchesOf = (page: Page) => page.getByRole('region', { name: 'دفعات المخزون' });
const historyOf = (page: Page) => page.getByRole('region', { name: 'سجل الحركات' });
const figure = (page: Page, label: string) =>
  overviewOf(page).locator('div', { has: page.getByText(label, { exact: true }) });

test('the product page is a workspace: stock figures, batches, history, and Quick Add Stock that stays in view', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signIn(page);
  await waitForAppShell(page);
  // 50 m at 320 rial a metre: 16,000 rial.
  const id = await addProduct(page, { name: 'ساتان - عاجي', code: 'SAT-9' });
  await page.setViewportSize({ width: 1280, height: 520 });
  await page.goto(`/inventory/product?id=${id}`);

  // What it is, how much there is, and what it is worth.
  await expect(page.getByRole('heading', { level: 2, name: 'ساتان - عاجي' })).toBeVisible();
  await expect(page.getByText('SAT-9').first()).toBeVisible();
  await expect(figure(page, 'المتوفر').first()).toContainText('50');
  await expect(figure(page, 'قيمة المخزون').first()).toContainText(/16[,٬ ]?000/);
  await expect(figure(page, 'الدفعات').first()).toContainText('1');
  // Selling prices are details of the product, not of its stock.
  await expect(overviewOf(page)).not.toContainText('السعر الأدنى');

  // The batch keeps what it cost: 320 rial a metre, 16,000 rial in all, 16,000 left.
  const batches = batchesOf(page);
  await expect(batches.getByRole('listitem')).toHaveCount(1);
  await expect(batches).toContainText(/B-[A-Z]+\d{4}/);
  await expect(batches).toContainText('320');
  await expect(batches).toContainText(/16[,٬ ]?000/);

  // One purchase in the history: a stock-in of 50 m, from its purchase, at its cost.
  const history = historyOf(page);
  await expect(history.getByRole('listitem')).toHaveCount(1);
  await expect(history).toContainText('شراء');
  await expect(history).toContainText('+50');
  await expect(history.getByRole('link', { name: /شراء/ })).toHaveAttribute(
    'href',
    /\/purchases\/view\?id=/,
  );

  // The page is taller than the window; the panel and its button stay in view all the way down.
  const panel = page.getByRole('region', { name: 'إضافة مخزون', exact: true });
  const save = panel.getByRole('button', { name: 'إضافة المخزون', exact: true });
  await page.evaluate(() => {
    window.scrollTo(0, document.documentElement.scrollHeight);
  });
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await expect(save).toBeInViewport();
  await page.evaluate(() => {
    window.scrollTo(0, 0);
  });

  // In a right-to-left page the panel is on the left, beside the content.
  const panelBox = await panel.boundingBox();
  const batchesBox = await batches.boundingBox();
  expect(panelBox && batchesBox && panelBox.x + panelBox.width <= batchesBox.x + 1).toBe(true);

  // Quick add: 20 m at 400 rial a metre. The total is worked out as it is typed.
  await panel.getByLabel('الطول المستلم', { exact: true }).fill('20');
  await panel.getByLabel('تكلفة شراء المتر', { exact: true }).fill('400');
  await expect(panel.locator('dl', { hasText: 'إجمالي الشراء' })).toContainText(/8[,٬ ]?000/);
  await submitRestock(panel);
  await expect(page.getByText('أُضيف المخزون').first()).toBeVisible();

  // The same product has a second batch, at its own cost; nothing was duplicated.
  await expect(batches.getByRole('listitem')).toHaveCount(2);
  await expect(batches).toContainText('320');
  await expect(batches).toContainText('400');
  await expect(figure(page, 'المتوفر').first()).toContainText('70');
  await expect(figure(page, 'قيمة المخزون').first()).toContainText(/24[,٬ ]?000/);
  await expect(figure(page, 'الدفعات').first()).toContainText('2');
  await expect(history.getByRole('listitem')).toHaveCount(2);
  await expect(history).toContainText('+20');
  await expect(connectivity(page)).not.toContainText(/معلّق/);
  await page.goto('/inventory');
  await expect(page.getByRole('row', { name: /ساتان - عاجي/ })).toHaveCount(1);
});

test('Quick Add Stock checks its fields next to them and buys once however often it is pressed', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signIn(page);
  await waitForAppShell(page);
  const id = await addProduct(page, { name: 'شيفون - وردي' });
  const panel = await openRestock(page, id);
  const save = panel.getByRole('button', { name: 'إضافة المخزون', exact: true });

  // Nothing typed: each missing field says so under itself, and nothing is bought.
  await save.click();
  await expect(panel.getByText('هذا الحقل مطلوب')).toHaveCount(2);
  await expect(batchesOf(page).getByRole('listitem')).toHaveCount(1);

  // Enter in a field buys it; pressing the button again and again still buys it once.
  await panel.getByLabel('الطول المستلم', { exact: true }).fill('5');
  await panel.getByLabel('تكلفة شراء المتر', { exact: true }).fill('300');
  await panel.getByLabel('تكلفة شراء المتر', { exact: true }).press('Enter');
  await save.dblclick();
  await expect(panel.getByLabel('الطول المستلم', { exact: true })).toHaveValue('');
  await expect(batchesOf(page).getByRole('listitem')).toHaveCount(2);
  await expect(historyOf(page).getByRole('listitem')).toHaveCount(2);
  await expect(figure(page, 'المتوفر').first()).toContainText('55');
});

test('a weight bought without a length waits for a measurement and cannot be sold by the meter', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signIn(page);
  await waitForAppShell(page);
  const id = await addProduct(page, { name: 'قطن - خام' });
  await restock(page, id, { unit: 'kg', quantity: '5', cost: '360' });

  // The 5 kg are counted apart: what can be sold is still the 50 m, and no length was made up.
  await expect(figure(page, 'المتوفر').first()).toContainText('50');
  await expect(figure(page, 'بانتظار القياس').first()).toContainText('5');
  const batches = batchesOf(page);
  await expect(batches.getByRole('listitem')).toHaveCount(2);
  const weight = batches.getByRole('listitem').filter({ hasText: 'بانتظار القياس' });
  await expect(weight).toContainText('5');
  await expect(weight).toContainText(/1[,٬ ]?800/);
  await expect(weight.getByRole('button', { name: 'قياس', exact: true })).toBeVisible();

  // The existing measurement workflow makes it sellable: 5 kg measured at 8 m.
  await weight.getByRole('button', { name: 'قياس', exact: true }).click();
  const measure = page.getByRole('dialog');
  await measure.getByLabel('الطول المقيس').fill('8');
  await measure.getByRole('button', { name: 'حفظ القياس' }).click();
  await expect(measure).toBeHidden();
  await expect(figure(page, 'المتوفر').first()).toContainText('58');
  await expect(overviewOf(page)).not.toContainText('بانتظار القياس');
  // The weight received and the cost it was bought at are still on the batch.
  await expect(batches).toContainText(/1[,٬ ]?800/);
  await expect(batches).toContainText('5');
});

test('the history shows the latest movements first and the whole of it on request', async ({
  page,
}) => {
  test.setTimeout(150_000);
  await signIn(page);
  await waitForAppShell(page);
  const id = await addProduct(page, { name: 'دانتيل - كريمي' });
  const panel = await openRestock(page, id);
  for (let index = 0; index < 10; index += 1) {
    await fillStock(panel, { quantity: '1', cost: '300' });
    await submitRestock(panel);
  }
  const history = historyOf(page);
  await expect(history.getByRole('listitem')).toHaveCount(10);
  await history.getByRole('button', { name: /عرض السجل كاملاً \(11\)/ }).click();
  await expect(history.getByRole('listitem')).toHaveCount(11);
  await history.getByRole('button', { name: 'عرض الأحدث فقط' }).click();
  await expect(history.getByRole('listitem')).toHaveCount(10);
});

test('the history can be narrowed by type, batch and days, and cleared', async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page);
  await waitForAppShell(page);
  // Two purchases (two batches), then a sale of 2 m: it comes off the first, the older batch.
  const id = await addProduct(page, { name: 'حرير - فيروزي' });
  await restock(page, id, { quantity: '20', cost: '500' });
  await page.goto('/pos');
  await addToBill(page, 'حرير - فيروزي', '2');
  await payInFull(page);
  await page.goto(`/inventory/product?id=${id}`);

  const history = historyOf(page);
  const items = history.getByRole('listitem');
  const types = history.getByRole('group', { name: 'نوع الحركة' });
  await expect(items).toHaveCount(3);
  await expect(types.getByRole('button', { name: /^الكل/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(types.getByRole('button', { name: /^شراء\s*2$/ })).toBeVisible();
  await expect(types.getByRole('button', { name: /^بيع\s*1$/ })).toBeVisible();
  // A type the product never had is not offered.
  await expect(types.getByRole('button', { name: /^تالف/ })).toHaveCount(0);

  // By type: only the sale.
  await types.getByRole('button', { name: /^بيع/ }).click();
  await expect(items).toHaveCount(1);
  await expect(items.first()).toContainText('بيع');
  await expect(items.first()).toContainText('2');
  await expect(history.getByRole('status')).toHaveText('عرض 1 من 3');
  await expect(types.getByRole('button', { name: /^بيع/ })).toHaveAttribute('aria-pressed', 'true');
  // Two types: the sale and the purchases.
  await types.getByRole('button', { name: /^شراء/ }).click();
  await expect(items).toHaveCount(3);
  // "All" drops the chosen types.
  await types.getByRole('button', { name: /^الكل/ }).click();
  await expect(items).toHaveCount(3);
  await expect(types.getByRole('button', { name: /^بيع/ })).toHaveAttribute(
    'aria-pressed',
    'false',
  );

  // By batch (the one bought first is listed first): it holds its purchase and the sale…
  await history.getByLabel('الدفعة', { exact: true }).click();
  const options = page.getByRole('option');
  await expect(options).toHaveCount(3);
  await options.nth(1).click();
  await expect(items).toHaveCount(2);
  // …the second holds its purchase only, so the sale has nothing to show there.
  await history.getByLabel('الدفعة', { exact: true }).click();
  await page.getByRole('option').nth(2).click();
  await expect(items).toHaveCount(1);
  await expect(items.first()).toContainText('شراء');
  await expect(types.getByRole('button', { name: /^بيع\s*0$/ })).toBeDisabled();
  // Clearing brings back the whole history.
  await history.getByRole('button', { name: 'مسح التصفية' }).first().click();
  await expect(items).toHaveCount(3);
  await expect(history.getByRole('status')).toHaveText('');

  // By days: today holds all three; a window in the past or the future holds none.
  await history.getByLabel('من', { exact: true }).fill('2999-01-01');
  await expect(items).toHaveCount(0);
  await expect(history).toContainText('لا حركات تطابق هذه التصفية.');
  await history.getByLabel('من', { exact: true }).fill('2000-01-01');
  await history.getByLabel('إلى', { exact: true }).fill('2000-12-31');
  await expect(items).toHaveCount(0);
  await history.getByLabel('إلى', { exact: true }).fill('2999-12-31');
  await expect(items).toHaveCount(3);
  await expect(history.getByRole('status')).toHaveText('عرض 3 من 3');
});

test('on a phone Quick Add Stock is the bar under the page and opens as a sheet', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signIn(page);
  await waitForAppShell(page);
  const id = await addProduct(page, { name: 'تول - أبيض' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/inventory/product?id=${id}`);

  // No panel beside the page; one big button, and nothing runs sideways.
  await expect(page.getByRole('region', { name: 'إضافة مخزون', exact: true })).toHaveCount(0);
  const open = page.getByRole('button', { name: 'إضافة مخزون', exact: true });
  await expect(open).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await expect(batchesOf(page)).toContainText('320');

  await open.click();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();
  await fillStock(sheet, { quantity: '4', cost: '350' });
  await expect(sheet.locator('dl', { hasText: 'إجمالي الشراء' })).toContainText(/1[,٬ ]?400/);
  await sheet.getByRole('button', { name: 'إضافة المخزون', exact: true }).click();
  await expect(sheet).toBeHidden();
  await expect(batchesOf(page).getByRole('listitem')).toHaveCount(2);
  await expect(figure(page, 'المتوفر').first()).toContainText('54');
});

test('the workspace reads in English, left to right, with the panel on the right', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signIn(page);
  await waitForAppShell(page);
  const id = await addProduct(page, { name: 'Satin - Ivory' });
  await page.evaluate(() => {
    localStorage.setItem('fabric.language', 'en');
  });
  await page.goto(`/inventory/product?id=${id}`);
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  const panel = page.getByRole('region', { name: 'Add stock', exact: true });
  await expect(panel).toBeVisible();
  await expect(page.getByRole('region', { name: 'Stock batches' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Movement history' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit product' })).toBeVisible();
  const panelBox = await panel.boundingBox();
  const batchesBox = await page.getByRole('region', { name: 'Stock batches' }).boundingBox();
  expect(panelBox && batchesBox && panelBox.x >= batchesBox.x + batchesBox.width - 1).toBe(true);
});
