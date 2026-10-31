import { expect, type Page, test } from '@playwright/test';
import { connectivity, serverGet, signIn, waitForAppShell } from './helpers';

/** Today in the shop's time zone (YYYY-MM-DD). */
const today = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Casablanca' }).format(new Date());

async function pickOption(page: Page, label: string, option: string) {
  await page.getByRole('dialog').getByLabel(label, { exact: true }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

test('a recurring bill is reminded on the home screen, created offline with its amount, and synced', async ({
  page,
  request,
}) => {
  await signIn(page);
  await waitForAppShell(page);
  const day = today();
  const month = day.slice(0, 7);

  // Electricity, due today, amount typed each month.
  await page.goto('/expenses');
  await page.getByRole('button', { name: 'قالب جديد' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('الاسم').fill('كهرباء المحل');
  await pickOption(page, 'الفئة', 'كهرباء');
  await dialog.getByLabel('يوم الاستحقاق من الشهر').fill(String(Number(day.slice(8))));
  await dialog.getByLabel('المبلغ يتغيّر كل شهر (يُكتب عند الإنشاء)').click();
  await dialog.getByRole('button', { name: 'حفظ' }).click();
  await expect(dialog).toBeHidden();
  await expect(connectivity(page)).not.toContainText(/معلّق/);

  // Offline from here: the home screen reminds, the bill is created with this month's amount.
  await page.context().setOffline(true);
  await page.goto('/home');
  const reminders = page.getByRole('region', { name: 'مصروفات مستحقة' });
  await expect(reminders).toContainText('كهرباء المحل');
  await expect(reminders).toContainText('مستحق اليوم');
  await reminders.getByRole('button', { name: 'أنشئ' }).click();
  await page.getByRole('dialog').getByLabel('المبلغ').fill('455');
  await page.getByRole('dialog').getByRole('button', { name: 'حفظ' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(reminders).toBeHidden();

  // An unpaid water bill, and the month's totals (by paid date).
  await page.goto('/expenses');
  await page.getByRole('button', { name: 'مصروف جديد' }).click();
  await pickOption(page, 'الفئة', 'ماء');
  await page.getByRole('dialog').getByLabel('المبلغ').fill('40');
  await page.getByRole('dialog').getByLabel('مدفوع', { exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'حفظ' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  const totals = page.getByRole('definition');
  await expect(totals.first()).toContainText('455');
  await expect(page.getByText('غير مدفوع', { exact: true }).first()).toBeVisible();
  await expect(connectivity(page)).toContainText(/معلّق/);

  await page.context().setOffline(false);
  await expect(connectivity(page)).not.toContainText(/معلّق/);
  await expect
    .poll(() =>
      serverGet<{ paidCents?: number; unpaidCents?: number }>(
        request,
        `/expenses/summary?month=${month}`,
      ),
    )
    .toMatchObject({ paidCents: 455 * 5, unpaidCents: 40 * 5 });
});
