import { expect, type Page, test } from '@playwright/test';
import { connectivity, serverGet, signIn, waitForAppShell } from './helpers';

/** The month's rent bill: 2000 rial. */
const RENT_CENTS = 10_000;

/** Last month in the shop's time zone: its first and last day (YYYY-MM-DD). */
function lastMonth(): { first: string; last: string } {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Casablanca' }).format(
    new Date(),
  );
  const [year = 2026, month = 1] = today.split('-').map(Number);
  const y = month === 1 ? year - 1 : year;
  const m = month === 1 ? 12 : month - 1;
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const prefix = `${String(y)}-${String(m).padStart(2, '0')}`;
  return { first: `${prefix}-01`, last: `${prefix}-${String(days).padStart(2, '0')}` };
}

/** The two partners, set up once (the partners spec may have done it already). */
async function ensurePartners(page: Page) {
  await page.goto('/settings/partners');
  const setup = page.getByLabel('اسم المالك');
  const ready = page.getByRole('region', { name: 'مال المحل حسب السجلات' });
  await expect(setup.or(ready)).toBeVisible();
  if (await setup.isVisible()) {
    await setup.fill('أنا');
    await page.getByLabel('اسم الشريك').fill('شريكي');
    await page.getByRole('button', { name: 'حفظ' }).click();
    await expect(ready).toBeVisible();
  }
}

/** A rent bill of `rial`, dated and paid on `date`, through the expenses screen. */
async function rentPaidOn(page: Page, date: string, rial: string) {
  await page.goto('/expenses');
  await page.getByRole('button', { name: 'مصروف جديد' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('الفئة', { exact: true }).click();
  await page.getByRole('option', { name: 'كراء', exact: true }).click();
  await dialog.getByLabel('المبلغ').fill(rial);
  await dialog.getByLabel('تاريخ المصروف', { exact: true }).fill(date);
  await dialog.getByLabel('تاريخ الدفع', { exact: true }).fill(date);
  await dialog.getByRole('button', { name: 'حفظ' }).click();
}

/**
 * A displayed rial amount ("-1,234.5 ريال") as cents (1 rial = 5 cents). The test works in
 * integer cents like the app, so no figure it compares is a float.
 */
function centsOfRial(text: string): number {
  const rial = Number(text.replace(/−/g, '-').replace(/[^\d.-]/g, ''));
  return Math.round(rial * 5);
}

/**
 * A cash count dated `date` that is `surplusRial` above what the records expect: an over, which
 * the settlement of that month takes as profit. Returns the surplus in cents. The records' cash
 * depends on the specs that ran before (it can be below zero) and the dialog refuses a negative
 * count, so then the count is zero and the surplus is larger; the caller works out its figures
 * from the surplus returned, never from the one asked for. The test voids the count at its end.
 */
async function countWithSurplus(
  page: Page,
  date: string,
  surplusRial: number,
  reason: string,
): Promise<number> {
  await page.goto('/integrity');
  await page.getByRole('button', { name: 'جرد نقدي' }).click();
  const dialog = page.getByRole('dialog');
  const expected = dialog.locator('dt', { hasText: 'المال حسب السجلات' }).locator('xpath=../dd');
  await expect(expected).not.toHaveText('…');
  const expectedCents = centsOfRial(await expected.innerText());
  const countedCents = Math.max(0, expectedCents + surplusRial * 5);
  await dialog.getByLabel('المال المعدود').fill(String(countedCents / 5));
  await dialog.getByLabel('التاريخ', { exact: true }).fill(date);
  await dialog.getByLabel('السبب').fill(reason);
  await dialog.getByRole('button', { name: 'حفظ' }).click();
  await expect(dialog).toBeHidden();
  return countedCents - expectedCents;
}

/** No part of the page is wider than the window: nothing needs a sideways scroll. */
async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test('a month is previewed offline, approved online and locked, then unlocked with a reason', async ({
  page,
  request,
}) => {
  const month = lastMonth();
  await signIn(page);
  await waitForAppShell(page);
  await ensurePartners(page);

  // Nothing settled yet: the history says so.
  await page.goto('/settlements');
  await expect(page.getByText('لم تُسوَّ أي فترة بعد', { exact: true })).toBeVisible();

  // Last month's rent, 2000 rial (100 dh): a losing month.
  await rentPaidOn(page, month.first, '2000');
  await expect(page.getByRole('dialog')).toBeHidden();

  // Offline: the breakdown from this device's records; approving waits for the connection.
  await page.context().setOffline(true);
  await page.goto('/settlements');
  const summary = page.getByRole('region', { name: 'ملخص الفترة' });
  await expect(summary.getByText('جاهزة للاعتماد')).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'الفترة' })).toBeVisible();
  // The month's whole result is its rent: 2000 rial (10 000 cents) lost.
  const net = page.getByTestId('summary-net');
  await expect.poll(async () => centsOfRial((await net.textContent()) ?? '')).toBe(-RENT_CENTS);
  // Every line is shown, a zero one too; the rent is the expenses line.
  const breakdown = page.getByRole('region', { name: 'كيف يتكوّن صافي الربح' });
  await expect(breakdown.getByText('المصروفات المدفوعة')).toBeVisible();
  await expect(breakdown.getByText('تالف', { exact: true })).toBeVisible();
  // A loss shares nothing and says what carries over.
  const distribution = page.getByRole('region', { name: 'توزيع الربح' });
  await expect(distribution.getByText('لا ربح لقسمته في هذه الفترة.')).toBeVisible();
  await expect(distribution.getByText('عجز يُرحَّل إلى الفترة التالية')).toBeVisible();
  await expect(page.getByRole('button', { name: 'مراجعة واعتماد' })).toBeDisabled();
  await expect(page.getByText('الاعتماد يحتاج اتصالاً')).toBeVisible();
  await page.context().setOffline(false);
  await expect(connectivity(page)).not.toContainText(/معلّق/);

  // A count over the records, dated that month: the month now earns the surplus less the rent.
  // Normally 2401 rial over, so 401 rial (2005 cents), an odd amount: a third each in whole cents
  // for the owner and the partner, the odd cents to the shop. The figures are worked out here
  // from the surplus the count really made, whatever cash the earlier specs left in the records.
  const surplusCents = await countWithSurplus(page, month.first, 2401, 'زيادة جرد التسوية');
  const netCents = surplusCents - RENT_CENTS;
  const ownerCents = Math.floor(netCents / 3);
  const shopCents = netCents - 2 * ownerCents;
  expect(netCents).toBeGreaterThan(0);
  await expect(connectivity(page)).not.toContainText(/معلّق/);

  await page.goto('/settlements');
  await expect(summary.getByText('جاهزة للاعتماد')).toBeVisible();
  await expect.poll(async () => centsOfRial((await net.textContent()) ?? '')).toBe(netCents);
  await expect(breakdown.getByText('فرق الجرد النقدي')).toBeVisible();
  await expect(distribution.getByText('المالك', { exact: true })).toBeVisible();
  await expect(distribution.getByText('الشريك', { exact: true })).toBeVisible();
  await expect(distribution.getByText('المحل', { exact: true })).toBeVisible();
  await expect(distribution.getByText('مجموع ما قُسم')).toBeVisible();
  await expect(distribution.getByText('كسور القسمة تذهب إلى المحل.')).toBeVisible();

  // Online: the server's figures in a confirmation, then the approval.
  await page.getByRole('button', { name: 'مراجعة واعتماد' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('صافي الربح')).toBeVisible();
  await expect(dialog.getByText('مجموع التعديلات')).toBeVisible();
  await expect(dialog.getByText(/تُقفل الفترة حتى/)).toBeVisible();
  await expect(dialog.getByText('الاعتماد لا يدفع لأحد')).toBeVisible();
  await dialog.getByRole('button', { name: 'اعتمد وأقفل' }).click();
  await expect(dialog).toBeHidden();

  // Settled: the status, the lock, the history row.
  await expect(summary.getByText('مسوّاة ومقفلة', { exact: true })).toBeVisible();
  await expect(page.getByText(/مقفلة حتى/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'مراجعة واعتماد' })).toHaveCount(0);
  const history = page.getByRole('region', { name: 'سجل التسويات' });
  await expect(history.getByRole('link').first()).toBeVisible();
  const settled = await serverGet<
    {
      periodEnd: string;
      expensesCents: number;
      netProfitCents: number;
      ownerShareCents: number;
      partnerShareCents: number;
      shopShareCents: number;
      voidedAt: string | null;
    }[]
  >(request, '/settlements');
  expect(settled).toEqual([
    expect.objectContaining({
      periodEnd: month.last,
      expensesCents: RENT_CENTS,
      netProfitCents: netCents,
      ownerShareCents: ownerCents,
      partnerShareCents: ownerCents,
      shopShareCents: shopCents,
      voidedAt: null,
    }),
  ]);

  // The settled month shows its approved figures, and the same page fits a tablet and a phone.
  await expect(distribution.getByText('مجموع ما قُسم')).toBeVisible();
  for (const size of [
    { width: 1280, height: 800 },
    { width: 800, height: 1280 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(size);
    await expect(summary).toBeVisible();
    await expect(history).toBeVisible();
    await expectNoHorizontalOverflow(page);
  }
  await page.setViewportSize({ width: 1280, height: 720 });

  // The history row opens the settlement's details, with the same figures.
  await history.getByRole('link').first().click();
  await expect(page).toHaveURL(/\/settlements\/view\?id=/);
  await expect(page.getByText('مسوّاة ومقفلة', { exact: true })).toBeVisible();
  await expect(page.getByText('مجموع ما قُسم')).toBeVisible();
  await page.getByRole('link', { name: 'العودة إلى التسوية' }).click();

  // Last month is closed: a bill paid in it is refused, and the dialog says why (under the date).
  await rentPaidOn(page, month.last, '100');
  await expect(page.getByRole('dialog').getByRole('note')).toContainText('مسوّاة ومقفلة');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'إلغاء' }).click();
  // Its rent can no longer be edited or voided, and the row says why.
  await page.getByRole('button', { name: 'الشهر السابق' }).click();
  const rent = page.getByRole('row').filter({ hasText: 'كراء' });
  await expect(rent.getByText('مقفل')).toBeVisible();
  await expect(rent.getByRole('button', { name: 'تعديل' })).toHaveCount(0);

  // Unlocked with a reason: the settlement is voided and the month takes changes again.
  await page.goto('/settlements');
  await page.getByRole('button', { name: 'فتح الفترة' }).click();
  await page.getByRole('dialog').getByLabel('السبب').fill('نسيت فاتورة');
  await page.getByRole('dialog').getByRole('button', { name: 'افتح الفترة' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect
    .poll(async () =>
      (await serverGet<{ voidedAt: string | null }[]>(request, '/settlements')).map(
        (settlement) => settlement.voidedAt !== null,
      ),
    )
    .toEqual([true]);
  // The voided settlement stays in the history as unlocked, with its original figures.
  await expect(history.getByText('فُتحت', { exact: true })).toBeVisible();
  await rentPaidOn(page, month.last, '100');
  await expect(page.getByRole('dialog')).toBeHidden();

  // The cash count is voided so the later specs find the shop as it was.
  await page.goto('/integrity');
  const counts = page.getByRole('region', { name: 'الجرد النقدي' });
  await counts.getByRole('button', { name: 'إلغاء' }).click();
  await page.getByRole('dialog').getByLabel('السبب').fill('انتهى اختبار التسوية');
  await page.getByRole('dialog').getByRole('button', { name: 'تأكيد الإلغاء' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(connectivity(page)).not.toContainText(/معلّق/);
});

test('the profit-split rules live in Partners, and Settlement links to them', async ({ page }) => {
  await signIn(page);
  await waitForAppShell(page);
  await ensurePartners(page);

  // Partners holds the rules: the default one, and the way to add a future one.
  const rules = page.getByRole('region', { name: 'قواعد قسمة الأرباح' });
  await expect(rules).toBeVisible();
  await expect(rules.getByRole('button', { name: 'قاعدة جديدة' })).toBeVisible();

  // Settlement shows the rule in effect and sends the owner there to change it.
  await page.goto('/settlements');
  const distribution = page.getByRole('region', { name: 'توزيع الربح' });
  await expect(distribution.getByText('قاعدة القسمة')).toBeVisible();
  await distribution.getByRole('link', { name: 'إدارة قواعد القسمة في الشركاء' }).click();
  await expect(page).toHaveURL(/\/settings\/partners$/);
  await expect(page.getByRole('region', { name: 'قواعد قسمة الأرباح' })).toBeVisible();
});
