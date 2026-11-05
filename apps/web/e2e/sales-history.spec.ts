import { expect, type Page, test } from '@playwright/test';
import { addProduct, addToBill, signIn, waitForAppShell } from './helpers';

/** A credit sale of `meters` to a new customer who pays `paid` rial now; the sale is saved. */
async function creditSale(page: Page, meters: string, customer: string, paid: string) {
  await page.goto('/pos');
  await addToBill(page, 'حرير - سجل', meters);
  await page.getByRole('button', { name: 'دفعة جزئية', exact: true }).click();
  await page.getByRole('button', { name: 'زبون جديد' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('الاسم').fill(customer);
  await dialog.getByLabel(/الهاتف/).fill('0612345678');
  await dialog.getByRole('button', { name: 'حفظ' }).click();
  await expect(page.getByLabel('الزبون', { exact: true })).toContainText(customer);
  await page.getByLabel('المدفوع الآن').fill(paid);
  await page.getByRole('button', { name: 'إتمام البيع' }).click();
  await expect(page.getByText('لا أصناف').first()).toBeVisible();
}

const metrics = (page: Page) => page.getByRole('region', { name: 'إجماليات المبيعات المعروضة' });
const rowsOf = (page: Page) => page.getByRole('table').getByRole('row');

test('the sales history: figures, filters, pages of rows, details drawer, offline', async ({
  page,
}) => {
  await signIn(page);
  await waitForAppShell(page);
  await addProduct(page, { name: 'حرير - سجل', stock: { quantity: '50', cost: '320' } });

  // 1 m at 400 rial, paid in full; 2 m (800) with 300 paid; 1 m (400) with nothing paid.
  await creditSale(page, '1', 'مشتري سجل أ', '400');
  await creditSale(page, '2', 'مشتري سجل ب', '300');
  await creditSale(page, '1', 'مشتري سجل ج', '0');

  await page.goto('/pos/history');
  await expect(page.getByRole('heading', { name: 'سجل المبيعات' })).toBeVisible();
  // The way back to selling.
  await expect(page.getByRole('link', { name: 'بيع جديد' })).toHaveAttribute('href', '/pos');

  // Narrow to these three customers: the figures follow what is shown.
  await page.getByRole('searchbox').fill('سجل');
  await expect(rowsOf(page)).toHaveCount(4); // header + 3
  await expect(metrics(page)).toContainText(/المبيعات\s*3/);
  await expect(metrics(page)).toContainText(/إجمالي المبيعات\s*1,600/);
  await expect(metrics(page)).toContainText(/المحصَّل\s*700/);
  await expect(metrics(page)).toContainText(/المتبقي\s*900/);

  // Payment chips: each with its count; the figures follow the chip.
  const chip = (name: RegExp) =>
    page.getByRole('group', { name: 'الدفع' }).getByRole('button', { name });
  await expect(chip(/^الكل/)).toContainText('3');
  await expect(chip(/^مدفوع جزئيًا/)).toContainText('1');
  await chip(/^غير مدفوع/).click();
  await expect(rowsOf(page)).toHaveCount(2);
  await expect(rowsOf(page).nth(1)).toContainText('مشتري سجل ج');
  await expect(metrics(page)).toContainText(/المتبقي\s*400/);
  await chip(/^مدفوع جزئيًا/).click();
  await expect(rowsOf(page)).toHaveCount(2);
  await expect(rowsOf(page).nth(1)).toContainText('مشتري سجل ب');
  await expect(rowsOf(page).nth(1)).toContainText('500');
  await chip(/^مدفوع \d/).click();
  await expect(rowsOf(page).nth(1)).toContainText('مشتري سجل أ');

  // Filters together, the active ones shown, and reset.
  await page.getByRole('searchbox').fill('مشتري سجل ب');
  await expect(page.getByText('لا مبيعات مطابقة')).toBeVisible();
  await page.getByRole('button', { name: 'مسح التصفية' }).first().click();
  await expect(page.getByRole('searchbox')).toHaveValue('');
  await expect(chip(/^الكل/)).toHaveAttribute('aria-pressed', 'true');

  // The period: a day in the future shows nothing, today shows the sales.
  await page.getByRole('combobox', { name: 'الفترة' }).click();
  await page.getByRole('option', { name: 'اختر الأيام' }).click();
  await page.getByLabel('من', { exact: true }).fill('2999-01-01');
  await expect(page.getByText('لا مبيعات مطابقة')).toBeVisible();
  await page.getByRole('button', { name: 'مسح التصفية' }).first().click();
  await page.getByRole('combobox', { name: 'الفترة' }).click();
  await page.getByRole('option', { name: 'اليوم' }).click();
  await page.getByRole('searchbox').fill('سجل');
  await expect(rowsOf(page)).toHaveCount(4);

  // The details drawer: opens from a row, shows the sale, no cost or profit, closes with Escape.
  await page.getByRole('searchbox').fill('مشتري سجل ب');
  await page
    .getByRole('table')
    .getByRole('button', { name: /مشتري سجل ب/ })
    .click();
  const drawer = page.getByRole('dialog', { name: 'تفاصيل البيع' });
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText('مشتري سجل ب');
  await expect(drawer).toContainText('حرير - سجل');
  await expect(drawer).toContainText('800');
  await expect(drawer).toContainText(/المدفوع\s*300/);
  await expect(drawer).toContainText(/الباقي\s*500/);
  await expect(drawer).not.toContainText(/الربح|التكلفة/);
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();

  // Offline: the history, its filters and its drawer all work from the device.
  await page.context().setOffline(true);
  await page.getByRole('searchbox').fill('سجل');
  await expect(rowsOf(page)).toHaveCount(4);
  await page
    .getByRole('table')
    .getByRole('button', { name: /مشتري سجل ج/ })
    .click();
  await expect(page.getByRole('dialog', { name: 'تفاصيل البيع' })).toContainText(/الباقي\s*400/);
  await page.context().setOffline(false);

  // From the drawer to the full invoice.
  await page.getByRole('link', { name: 'افتح الفاتورة' }).click();
  await expect(page).toHaveURL(/\/pos\/view\?id=/);
});

test('the history on a tablet held upright and a phone: cards, a full-screen sheet, no side scroll', async ({
  page,
}) => {
  await signIn(page);
  await waitForAppShell(page);
  for (const size of [
    { width: 800, height: 1280 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(size);
    await page.goto('/pos/history');
    await expect(page.getByRole('heading', { name: 'سجل المبيعات' })).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(0);
    const cards = page.getByRole('button', { name: /^افتح بيع/ });
    await expect(cards.first()).toBeVisible();
    // No horizontal scroll of the page.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await cards.first().click();
    const sheet = page.getByRole('dialog', { name: 'تفاصيل البيع' });
    await expect(sheet).toBeVisible();
    // Full screen: as wide as the viewport.
    const box = await sheet.boundingBox();
    expect(Math.round(box?.width ?? 0)).toBe(size.width);
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
  }
});
