import { expect, type Page, test } from '@playwright/test';
import { connectivity, serverGet, signIn, waitForAppShell } from './helpers';

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
  await page.goto('/partners');
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
  await page.getByRole('button', { name: 'مصروف جديد' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('الفئة', { exact: true }).click();
  await page.getByRole('option', { name: 'كراء', exact: true }).click();
  await dialog.getByLabel('المبلغ').fill(rial);
  await dialog.getByLabel('التاريخ', { exact: true }).fill(date);
  await dialog.getByLabel('تاريخ الدفع').fill(date);
  await dialog.getByRole('button', { name: 'حفظ' }).click();
}

test('a month is previewed offline, approved online and locked, then unlocked with a reason', async ({
  page,
  request,
}) => {
  const month = lastMonth();
  await signIn(page);
  await waitForAppShell(page);
  await ensurePartners(page);

  // Last month's rent, 2000 rial (100 dh): a losing month.
  await rentPaidOn(page, month.first, '2000');
  await expect(page.getByRole('dialog')).toBeHidden();

  // Offline: the breakdown from this device's records; approving waits for the connection.
  await page.context().setOffline(true);
  await page.goto('/settlements');
  await expect(page.getByLabel('نهاية الفترة')).toHaveValue(month.last);
  const preview = page.getByRole('region', { name: 'تسوية فترة' });
  await expect(preview.getByText('المصروفات المدفوعة')).toBeVisible();
  await expect(preview.getByText('عجز يُرحَّل إلى الفترة التالية')).toBeVisible();
  await expect(page.getByRole('button', { name: 'اعتماد وإقفال الفترة' })).toBeDisabled();
  await expect(page.getByText('الاعتماد يحتاج اتصالاً')).toBeVisible();

  // Online: the server's figures, then the approval.
  await page.context().setOffline(false);
  await expect(connectivity(page)).not.toContainText(/معلّق/);
  await page.getByRole('button', { name: 'اعتماد وإقفال الفترة' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('صافي الربح')).toBeVisible();
  await dialog.getByRole('button', { name: 'اعتمد وأقفل' }).click();
  await expect(dialog).toBeHidden();
  const history = page.getByRole('region', { name: 'التسويات' });
  await expect(history.getByText('مقفلة', { exact: true })).toBeVisible();
  await expect(page.getByText(/مقفلة حتى/)).toBeVisible();
  const settled = await serverGet<
    { periodEnd: string; expensesCents: number; voidedAt: string | null }[]
  >(request, '/settlements');
  expect(settled).toEqual([
    expect.objectContaining({ periodEnd: month.last, expensesCents: 10_000, voidedAt: null }),
  ]);

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
  await history.getByRole('button', { name: 'فتح الفترة' }).click();
  await page.getByRole('dialog').getByLabel('السبب').fill('نسيت فاتورة');
  await page.getByRole('dialog').getByRole('button', { name: 'افتح الفترة' }).click();
  await expect(history.getByText('فُتحت', { exact: true })).toBeVisible();
  await expect
    .poll(async () =>
      (await serverGet<{ voidedAt: string | null }[]>(request, '/settlements')).map(
        (settlement) => settlement.voidedAt !== null,
      ),
    )
    .toEqual([true]);
  await rentPaidOn(page, month.last, '100');
  await expect(page.getByRole('dialog')).toBeHidden();
});
