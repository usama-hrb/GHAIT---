import { expect, type Page, test } from '@playwright/test';
import { connectivity, serverGet, serverPut, signIn, waitForAppShell } from './helpers';

/** Today in the shop's time zone (YYYY-MM-DD). */
const today = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Casablanca' }).format(new Date());

async function pickOption(page: Page, label: string, option: string) {
  await page.getByRole('dialog').getByLabel(label, { exact: true }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

test('a recurring bill due is flagged on the home screen, created offline with its amount, and synced', async ({
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

  // Offline from here: the home screen lists the bill under "needs attention" and opens the
  // template, where the bill is created with this month's amount.
  await page.context().setOffline(true);
  await page.goto('/home');
  const due = page.getByRole('link', { name: /حان موعده/ });
  await expect(due).toBeVisible();
  await due.click();
  await expect(page).toHaveURL(/\/expenses#recurring$/);
  const template = page.getByRole('region', { name: 'المصروفات الشهرية' });
  await expect(template).toContainText('كهرباء المحل');
  await expect(template).toContainText('مستحق اليوم');
  await template.getByRole('button', { name: 'أنشئ المصروف' }).click();
  await page.getByRole('dialog').getByLabel('المبلغ').fill('455');
  await page.getByRole('dialog').getByRole('button', { name: 'حفظ' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.goto('/home');
  await expect(page.getByRole('link', { name: /حان موعده/ })).toBeHidden();

  // An unpaid water bill, and the month's totals (by paid date).
  await page.goto('/expenses');
  await page.getByRole('button', { name: 'مصروف جديد' }).first().click();
  await pickOption(page, 'الفئة', 'ماء');
  await page.getByRole('dialog').getByLabel('المبلغ').fill('40');
  await page.getByRole('radio', { name: /لم يُدفع بعد/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'حفظ' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  // The month's summary: total = paid (by payment date) + unpaid, and the entries counted.
  const summary = page.getByLabel('ملخص الشهر');
  await expect(summary).toContainText('495');
  await expect(summary).toContainText('455');
  await expect(summary).toContainText('40');
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

const rowOf = (page: Page, text: string) => page.getByRole('row').filter({ hasText: text });

async function openRowMenu(page: Page, text: string) {
  await rowOf(page, text)
    .getByRole('button', { name: /إجراءات المصروف/ })
    .click();
}

async function voidWithReason(page: Page, reason: string) {
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('السبب').fill(reason);
  await dialog.getByRole('button', { name: 'تأكيد الإلغاء' }).click();
  await expect(dialog).toBeHidden();
}

async function addExpense(
  page: Page,
  input: { category: string; amount: string; note: string; unpaid?: boolean },
) {
  await page.getByRole('button', { name: 'مصروف جديد' }).first().click();
  const dialog = page.getByRole('dialog');
  await pickOption(page, 'الفئة', input.category);
  await dialog.getByLabel('المبلغ').fill(input.amount);
  await dialog.getByLabel('ملاحظة').fill(input.note);
  if (input.unpaid) await dialog.getByRole('radio', { name: /لم يُدفع بعد/ }).click();
  await dialog.getByRole('button', { name: 'حفظ' }).click();
  await expect(dialog).toBeHidden();
}

test('a paid expense is added, edited and voided with a reason', async ({ page }) => {
  await signIn(page);
  await page.goto('/expenses');
  await expect(page.locator('#content').getByLabel('ملخص الشهر')).toBeVisible();

  await addExpense(page, { category: 'نقل', amount: '12', note: 'e2e مدفوع' });
  const row = rowOf(page, 'e2e مدفوع');
  await expect(row).toContainText('12');
  await expect(row.getByText('مدفوع', { exact: true })).toBeVisible();
  await expect(row).toContainText('دُفع في');

  await openRowMenu(page, 'e2e مدفوع');
  await page.getByRole('menuitem', { name: 'تعديل' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('تاريخ المصروف')).not.toHaveValue('');
  await dialog.getByLabel('المبلغ').fill('15');
  await dialog.getByRole('button', { name: 'حفظ' }).click();
  await expect(dialog).toBeHidden();
  await expect(rowOf(page, 'e2e مدفوع')).toContainText('15');

  await openRowMenu(page, 'e2e مدفوع');
  await page.getByRole('menuitem', { name: 'إلغاء المصروف' }).click();
  await voidWithReason(page, 'أُدخل مرتين');
  await expect(rowOf(page, 'e2e مدفوع')).toHaveCount(0);
});

test('an unpaid expense counts in no period until it is paid today', async ({ page, request }) => {
  await signIn(page);
  await page.goto('/expenses');
  const month = today().slice(0, 7);
  const summary = () =>
    serverGet<{ paidCents: number; unpaidCents: number }>(
      request,
      `/expenses/summary?month=${month}`,
    );
  await expect(page.locator('#content').getByLabel('ملخص الشهر')).toBeVisible();
  const before = await summary();

  await addExpense(page, { category: 'تغليف', amount: '30', note: 'e2e غير مدفوع', unpaid: true });
  const row = rowOf(page, 'e2e غير مدفوع');
  await expect(row.getByText('غير مدفوع', { exact: true })).toBeVisible();
  await expect(row).not.toContainText('دُفع في');

  // The status filter splits paid from unpaid.
  const filters = page.getByRole('tablist', { name: 'عرض' });
  await filters.getByRole('tab', { name: /^مدفوعة/ }).click();
  await expect(rowOf(page, 'e2e غير مدفوع')).toHaveCount(0);
  await filters.getByRole('tab', { name: /^غير مدفوعة/ }).click();
  await expect(rowOf(page, 'e2e غير مدفوع')).toHaveCount(1);
  await filters.getByRole('tab', { name: /^الكل/ }).click();

  // Not paid: no cash went out, so the month's paid total on the server has not moved.
  await expect.poll(async () => (await summary()).unpaidCents).toBe(before.unpaidCents + 30 * 5);
  expect((await summary()).paidCents).toBe(before.paidCents);

  await openRowMenu(page, 'e2e غير مدفوع');
  await page.getByRole('menuitem', { name: 'سُدّد اليوم' }).click();
  await expect(rowOf(page, 'e2e غير مدفوع')).toContainText('دُفع في');
  await expect.poll(async () => (await summary()).paidCents).toBe(before.paidCents + 30 * 5);
  expect((await summary()).unpaidCents).toBe(before.unpaidCents);

  await openRowMenu(page, 'e2e غير مدفوع');
  await page.getByRole('menuitem', { name: 'إلغاء المصروف' }).click();
  await voidWithReason(page, 'اختبار');
  await expect(rowOf(page, 'e2e غير مدفوع')).toHaveCount(0);
  // Leave only when the void has reached the server: a paid bill left there would show in the
  // home screen's activity, in the next spec.
  await expect(connectivity(page)).not.toContainText(/معلّق/);
});

test('an unpaid bill of an earlier month stays listed, marked, and the months are navigable', async ({
  page,
  request,
}) => {
  await signIn(page);
  const day = today();
  const earlier = new Date(`${day.slice(0, 7)}-01T00:00:00Z`);
  earlier.setUTCMonth(earlier.getUTCMonth() - 1);
  await serverPut(request, `/expenses/${crypto.randomUUID()}`, {
    date: `${earlier.toISOString().slice(0, 7)}-20`,
    category: 'water',
    amountCents: 8000,
    paidDate: null,
    note: 'e2e من الشهر الماضي',
  });
  await page.goto('/expenses');
  await expect(page.locator('#content').getByLabel('ملخص الشهر')).toBeVisible();
  await page.reload();
  const row = rowOf(page, 'e2e من الشهر الماضي');
  await expect(row).toContainText('من شهر سابق');

  // Next month is the furthest the page goes; "this month" brings it back.
  const next = page.getByRole('button', { name: 'الشهر التالي' });
  await expect(page.getByRole('button', { name: 'هذا الشهر' })).toHaveCount(0);
  await next.click();
  await expect(next).toBeDisabled();
  await page.getByRole('button', { name: 'هذا الشهر' }).click();
  await expect(next).toBeEnabled();
  await page.getByRole('button', { name: 'الشهر السابق' }).click();
  await expect(rowOf(page, 'e2e من الشهر الماضي')).toContainText('غير مدفوع');
  await page.getByRole('button', { name: 'هذا الشهر' }).click();

  await openRowMenu(page, 'e2e من الشهر الماضي');
  await page.getByRole('menuitem', { name: 'إلغاء المصروف' }).click();
  await voidWithReason(page, 'اختبار');
  await expect(rowOf(page, 'e2e من الشهر الماضي')).toHaveCount(0);
});

test('a monthly template shows when it is due, creates its expense once, pauses and is deleted', async ({
  page,
}) => {
  await signIn(page);
  await page.goto('/expenses');
  const day = today();
  const panel = page.getByRole('region', { name: 'المصروفات الشهرية' });
  await expect(panel).toBeVisible();

  await panel.getByRole('button', { name: 'قالب جديد' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('الاسم').fill('e2e قالب');
  await pickOption(page, 'الفئة', 'أخرى');
  await dialog.getByLabel('يوم الاستحقاق من الشهر').fill(String(Number(day.slice(8))));
  await dialog.getByLabel('المبلغ', { exact: true }).fill('25');
  await dialog.getByRole('button', { name: 'حفظ' }).click();
  await expect(dialog).toBeHidden();

  const item = panel.getByRole('listitem').filter({ hasText: 'e2e قالب' });
  await expect(item).toContainText('مستحق اليوم');
  await expect(item).toContainText('الاستحقاق القادم');

  // Create this month's bill, left unpaid: no payment happens by itself.
  await item.getByRole('button', { name: 'أنشئ المصروف' }).click();
  const create = page.getByRole('dialog');
  await expect(create.getByLabel('المبلغ')).toHaveValue(/25/);
  await create.getByRole('radio', { name: /لم يُدفع بعد/ }).click();
  await create.getByRole('button', { name: 'حفظ' }).click();
  await expect(create).toBeHidden();
  const bill = rowOf(page, 'e2e قالب');
  await expect(bill).toHaveCount(1);
  await expect(bill.getByText('غير مدفوع', { exact: true })).toBeVisible();

  // One bill a month: the template now points at next month, not at the one just created.
  await expect(item).not.toContainText('مستحق اليوم');
  await expect(item.getByRole('button', { name: 'أنشئ المصروف' })).toBeVisible();

  // Paused: no next due, nothing to create.
  await item.getByRole('button', { name: /إجراءات القالب/ }).click();
  await page.getByRole('menuitem', { name: 'إيقاف' }).click();
  await expect(item).toContainText('موقوف');
  await expect(item.getByRole('button', { name: 'أنشئ المصروف' })).toHaveCount(0);
  await item.getByRole('button', { name: /إجراءات القالب/ }).click();
  await page.getByRole('menuitem', { name: 'تفعيل' }).click();
  await expect(item.getByRole('button', { name: 'أنشئ المصروف' })).toBeVisible();

  // Clean up: void the bill, delete the template (each with a reason).
  await openRowMenu(page, 'e2e قالب');
  await page.getByRole('menuitem', { name: 'إلغاء المصروف' }).click();
  await voidWithReason(page, 'اختبار');
  await item.getByRole('button', { name: /إجراءات القالب/ }).click();
  await page.getByRole('menuitem', { name: 'حذف القالب' }).click();
  await voidWithReason(page, 'اختبار');
  await expect(item).toHaveCount(0);
});
