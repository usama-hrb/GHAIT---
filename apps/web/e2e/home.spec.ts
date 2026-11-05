import { expect, type Locator, type Page, test } from '@playwright/test';
import {
  addProduct,
  addToBill,
  connectivity,
  payInFull,
  serverPut,
  signIn,
  waitForAppShell,
} from './helpers';
import { E2E } from './stack';

/** A money figure on the page as a number of rial ("1,234.5 ريال" → 1234.5). */
async function rial(locator: Locator): Promise<number> {
  const text = await locator.innerText();
  return Number(text.replace(/[^\d.]/g, ''));
}

const card = (page: Page, name: string) => page.getByRole('link', { name: new RegExp(name) });
const figure = (link: Locator) => link.locator('p').first();

test('the owner’s home shows the day, flags what needs doing, and each part opens its page', async ({
  page,
  request,
}) => {
  await signIn(page);
  await waitForAppShell(page);
  // One product with stock to sell (6 m at 100 rial/m cost, sold at 200), one with none (out).
  await addProduct(page, {
    name: 'قطن الواجهة',
    price: '200',
    min: '180',
    stock: { quantity: '6', cost: '100' },
  });
  await addProduct(page, { name: 'حرير الواجهة', stock: null });

  // The three actions, and the one gold action is Sell.
  await page.goto('/home');
  const actions = page.getByRole('group', { name: 'إجراءات سريعة' });
  await expect(actions.getByRole('link')).toHaveCount(3);
  await expect(actions.getByRole('link', { name: 'بيع' })).toBeVisible();
  await expect(actions.getByRole('link', { name: 'شراء جديد' })).toBeVisible();
  await expect(actions.getByRole('link', { name: 'مصروف جديد' })).toBeVisible();

  const sales = card(page, 'مبيعات اليوم');
  const profit = card(page, 'الربح الإجمالي اليوم');
  await expect(sales).toBeVisible();
  await expect(profit).toBeVisible();
  const salesBefore = await rial(figure(sales));
  const profitBefore = await rial(figure(profit));

  // A credit sale of 1 m (200 rial) to a new customer raises what customers owe by exactly that,
  // and the customer is on the debts page with the same amount.
  const owedBefore = await rial(figure(card(page, 'ديون الزبائن')));
  await page.goto('/pos');
  await addToBill(page, 'قطن الواجهة', '1');
  await page.getByRole('button', { name: 'دفعة جزئية', exact: true }).click();
  await page.getByRole('button', { name: 'زبون جديد' }).click();
  const customer = page.getByRole('dialog');
  await customer.getByLabel('الاسم').fill('زبون الواجهة');
  await customer.getByLabel(/الهاتف/).fill('0600000042');
  await customer.getByRole('button', { name: 'حفظ' }).click();
  await expect(page.getByLabel('الزبون', { exact: true })).toContainText('زبون الواجهة');
  await page.getByLabel('المدفوع الآن').fill('0');
  await page.getByRole('button', { name: 'إتمام البيع' }).click();
  await expect(page.getByText('لا أصناف').first()).toBeVisible();
  await page.goto('/home');
  await expect.poll(() => rial(figure(card(page, 'ديون الزبائن')))).toBe(owedBefore + 200);
  await card(page, 'ديون الزبائن').click();
  await expect(page.getByRole('row').filter({ hasText: 'زبون الواجهة' })).toContainText('200');
  await expect(connectivity(page)).not.toContainText(/معلّق/);

  // An unpaid bill (made on another device) is listed under "needs attention" and opens the
  // expenses already narrowed to the unpaid ones.
  await serverPut(request, `/expenses/${crypto.randomUUID()}`, {
    date: new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Casablanca' }).format(new Date()),
    category: 'water',
    amountCents: 4000,
    paidDate: null,
    note: 'e2e فاتورة الواجهة',
  });
  await page.goto('/home');
  await page
    .getByRole('region', { name: 'يحتاج إلى انتباهك' })
    .getByRole('link', { name: /غير مدفوع/ })
    .click();
  await expect(page).toHaveURL(/\/expenses\?status=unpaid$/);
  await expect(page.getByRole('row').filter({ hasText: 'e2e فاتورة الواجهة' })).toBeVisible();

  // Sell 2 m at 200 offline: the figures move at once, from this device's records (sales: the
  // credit sale's 200 and this 400).
  await page.context().setOffline(true);
  await page.goto('/pos');
  await addToBill(page, 'قطن الواجهة', '2');
  await payInFull(page);
  await page.goto('/home');
  await expect.poll(() => rial(figure(card(page, 'مبيعات اليوم')))).toBe(salesBefore + 600);
  // Profit = sales less the cost of the cloth sold: 3 m (the credit sale and this one) × (200 − 100).
  await expect
    .poll(() => rial(figure(card(page, 'الربح الإجمالي اليوم'))))
    .toBe(profitBefore + 300);

  // The chart: seven days, then thirty; the table behind it holds every day.
  const chart = page.getByRole('region', { name: 'المبيعات', exact: true });
  const days = chart.getByRole('table', { name: 'المبيعات يوماً بيوم' }).getByRole('row');
  await expect(days).toHaveCount(8);
  await chart.getByRole('tab', { name: 'آخر 30 يوماً' }).click();
  await expect(days).toHaveCount(31);
  await chart.getByRole('tab', { name: 'آخر 7 أيام' }).click();
  await expect(days).toHaveCount(8);
  // Today's bar equals the card (both are the day's sales net of returns).
  await expect.poll(() => rial(days.last().getByRole('cell'))).toBe(salesBefore + 600);

  // Needs attention: the product with no stock opens the inventory already filtered to it.
  const attention = page.getByRole('region', { name: 'يحتاج إلى انتباهك' });
  await attention.getByRole('link', { name: /نفد/ }).first().click();
  await expect(page).toHaveURL(/\/inventory\?filter=out/);
  await expect(page.getByRole('button', { name: 'نفد', pressed: true })).toBeVisible();
  await expect(page.getByText('حرير الواجهة').first()).toBeVisible();
  await expect(page.getByText('قطن الواجهة')).toBeHidden();

  // Recent activity: the sale is the newest event and opens its invoice.
  await page.goto('/home');
  const activity = page.getByRole('region', { name: 'آخر الحركات' });
  await activity.getByRole('link').first().click();
  await expect(page).toHaveURL(/\/pos\/view\?id=/);

  // Each figure card and quick action opens its own page.
  await page.goto('/home');
  await card(page, 'مبيعات اليوم').click();
  await expect(page).toHaveURL(/\/pos\/history$/);
  await page.goto('/home');
  await card(page, 'ديون الزبائن').click();
  await expect(page).toHaveURL(/\/customers\/debts$/);
  await page.goto('/home');
  await card(page, 'ديون الموردين').click();
  await expect(page).toHaveURL(/\/payables$/);
  await page.goto('/home');
  await card(page, 'الربح الإجمالي اليوم').click();
  await expect(page).toHaveURL(/\/reports$/);
  await page.goto('/home');
  await page
    .getByRole('group', { name: 'إجراءات سريعة' })
    .getByRole('link', { name: 'بيع' })
    .click();
  await expect(page).toHaveURL(/\/pos$/);
  await page.goto('/home');
  await page
    .getByRole('group', { name: 'إجراءات سريعة' })
    .getByRole('link', { name: 'مصروف جديد' })
    .click();
  await expect(page).toHaveURL(/\/expenses$/);

  await page.context().setOffline(false);
  await expect(connectivity(page)).not.toContainText(/معلّق/);
});

test('a cashier’s home is the till: sales and stock only, no cost, profit, buying or bills', async ({
  browser,
  page,
}) => {
  // The owner stocks a product; the cashier's own device sells it.
  await signIn(page);
  await waitForAppShell(page);
  await addProduct(page, { name: 'ثوب الصندوق', stock: { quantity: '5', cost: '100' } });
  await expect(connectivity(page)).not.toContainText(/معلّق/);

  const till = await (await browser.newContext()).newPage();
  await signIn(till, E2E.cashier);
  await waitForAppShell(till);
  await till.goto('/pos');
  await addToBill(till, 'ثوب الصندوق', '1');
  await payInFull(till);
  await till.goto('/home');

  const actions = till.getByRole('group', { name: 'إجراءات سريعة' });
  await expect(actions.getByRole('link', { name: 'بيع' })).toBeVisible();
  await expect(actions.getByRole('link')).toHaveCount(1);
  await expect(card(till, 'مبيعات اليوم')).toBeVisible();
  await expect(card(till, 'ديون الزبائن')).toBeVisible();
  for (const hidden of ['الربح الإجمالي اليوم', 'ديون الموردين']) {
    await expect(card(till, hidden)).toHaveCount(0);
  }
  // The feed has the sale just made and no cost-side event; no attention link goes to a screen
  // the cashier cannot open.
  const activity = till.getByRole('region', { name: 'آخر الحركات' });
  await expect(activity.getByRole('link').first()).toContainText('بيع');
  await expect(activity).not.toContainText(/استلام مخزون|دفعة لمورد|مصروف|ربح/);
  await expect(
    till
      .getByRole('region', { name: 'يحتاج إلى انتباهك' })
      .locator('a[href^="/expenses"], a[href="/zakat"]'),
  ).toHaveCount(0);
  await till.context().close();
});

test('the home reads in English left to right and in Arabic right to left, without sideways scrolling', async ({
  page,
}) => {
  await signIn(page);
  await waitForAppShell(page);
  await page.goto('/home');

  const sideways = () =>
    page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
  for (const size of [
    { width: 1280, height: 800 },
    { width: 820, height: 1100 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(size);
    await expect(page.getByRole('region', { name: 'آخر الحركات' })).toBeVisible();
    expect(await sideways()).toBeLessThanOrEqual(0);
  }

  // Wide: the activity is a column beside the chart. Narrow: everything stacks, attention first.
  const box = async (name: string) => {
    const found = await page.getByRole('region', { name, exact: true }).boundingBox();
    if (!found) throw new Error(`no box for ${name}`);
    return found;
  };
  await page.setViewportSize({ width: 1280, height: 800 });
  const [wideChart, wideActivity] = [await box('المبيعات'), await box('آخر الحركات')];
  expect(Math.abs(wideChart.y - wideActivity.y)).toBeLessThan(4);
  // Arabic: the main column is on the right, the activity column on the left of it.
  expect(wideActivity.x + wideActivity.width).toBeLessThanOrEqual(wideChart.x + 1);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  expect(wideActivity.x).toBeLessThan(wideChart.x);
  await page.setViewportSize({ width: 390, height: 844 });
  const [attention, narrowChart, narrowActivity] = [
    await box('يحتاج إلى انتباهك'),
    await box('المبيعات'),
    await box('آخر الحركات'),
  ];
  expect(attention.y).toBeLessThan(narrowChart.y);
  expect(narrowChart.y).toBeLessThan(narrowActivity.y);

  // English: left to right, the activity on the right.
  await page.evaluate(() => {
    localStorage.setItem('fabric.language', 'en');
  });
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await expect(
    page.getByRole('group', { name: 'Quick actions' }).getByRole('link', { name: 'Sell' }),
  ).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 800 });
  const english = async (name: string) => {
    const found = await page.getByRole('region', { name, exact: true }).boundingBox();
    if (!found) throw new Error(`no box for ${name}`);
    return found;
  };
  const [chartEn, activityEn] = [await english('Sales'), await english('Recent activity')];
  expect(activityEn.x).toBeGreaterThan(chartEn.x);
  expect(await sideways()).toBeLessThanOrEqual(0);
});
