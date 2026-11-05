import { type APIRequestContext, expect, type Page, test } from '@playwright/test';
import { connectivity, serverGet, signIn, waitForAppShell } from './helpers';
import { E2E } from './stack';

/*
 * People & Partners (ADR 0022): a third partner, employees and their salaries.
 *
 * This file is named to run LAST. The specs share one server and one database, and what these
 * tests leave behind changes the figures the others assert: a third partner (who owns what, how a
 * profit is split) and wage expenses. Every name below is unique to this file for the same reason.
 */

const THIRD = 'سعيد الثالث';
const SELLER = 'مصطفى البائع';
const TAILOR = 'ياسين الخياط';

/** The salary used throughout: 4,000 rial (800 dh) a month, in cents. */
const SALARY_RIAL = '4000';
const SALARY_CENTS = 20_000;

/** 1 rial = 5 cents. */
function cents(rial: number): number {
  return rial * 5;
}

/** Today in the shop's time zone (YYYY-MM-DD). */
function today(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Casablanca' }).format(new Date());
}

/** Last month in the shop's time zone: its first and last day (YYYY-MM-DD) and its key (YYYY-MM). */
function lastMonth(): { first: string; last: string; key: string } {
  const [year = 2026, month = 1] = today().split('-').map(Number);
  const y = month === 1 ? year - 1 : year;
  const m = month === 1 ? 12 : month - 1;
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const key = `${String(y)}-${String(m).padStart(2, '0')}`;
  return { first: `${key}-01`, last: `${key}-${String(days).padStart(2, '0')}`, key };
}

/**
 * A displayed rial amount ("-1,234.5 ريال") as cents (1 rial = 5 cents), so the test compares
 * integers like the app does and no figure it checks is a float.
 */
function centsOfRial(text: string): number {
  const rial = Number(text.replace(/−/g, '-').replace(/[^\d.-]/g, ''));
  return Math.round(rial * 5);
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

/** No part of the page is wider than the window: nothing needs a sideways scroll. */
async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

/** The same page on a desktop, a tablet held both ways and a phone: none needs a sideways scroll. */
async function expectFitsEverySize(page: Page, ready: () => Promise<void>) {
  for (const size of [
    { width: 1280, height: 800 },
    { width: 800, height: 1280 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(size);
    await ready();
    await expectNoHorizontalOverflow(page);
  }
  await page.setViewportSize({ width: 1280, height: 720 });
}

/** A row of a table (the employees directory, the settlement's tables) that mentions `text`. */
const rowOf = (page: Page, text: string) => page.getByRole('row').filter({ hasText: text });

/** Cancelling a record (never deleting it) asks why: the reason, then the confirmation. */
async function voidWithReason(page: Page, reason: string) {
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('السبب').fill(reason);
  await dialog.getByRole('button', { name: 'تأكيد الإلغاء' }).click();
  await expect(dialog).toBeHidden();
}

interface NewEmployee {
  name: string;
  position: string;
  phone: string;
}

/**
 * An employee through the Add Employee form, working since the first day of last month on
 * 4,000 rial a month from that month (so last month and this one both have a salary to pay).
 * Returns the employee's id (the page of the employee is addressed by it).
 */
async function addEmployee(page: Page, employee: NewEmployee): Promise<string> {
  await page.goto('/settings/partners?tab=employees');
  await page.getByRole('button', { name: 'إضافة موظف' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('الاسم الكامل').fill(employee.name);
  await dialog.getByLabel('المسمّى الوظيفي').fill(employee.position);
  await dialog.getByLabel('الهاتف').fill(employee.phone);
  await dialog.getByLabel('تاريخ البدء', { exact: true }).fill(lastMonth().first);
  await dialog.getByLabel('الراتب الشهري', { exact: true }).fill(SALARY_RIAL);
  // The salary starts with the month the work started: the first month offered.
  await dialog.getByLabel('ابتداءً من', { exact: true }).click();
  await page.getByRole('option').first().click();
  await dialog.getByRole('button', { name: 'حفظ' }).click();
  await expect(dialog).toBeHidden();
  const href =
    (await rowOf(page, employee.name)
      .getByRole('link', { name: employee.name })
      .getAttribute('href')) ?? '';
  return new URL(href, 'http://shop').searchParams.get('id') ?? '';
}

interface Payroll {
  months: {
    month: string;
    dueCents: number;
    paidCents: number;
    remainingCents: number;
    status: string;
  }[];
  outstandingCents: number;
}

/** The settlement page's expenses line and net profit, from this device's records (cents). */
async function settlementFigures(page: Page): Promise<{ expensesCents: number; netCents: number }> {
  const summary = page.getByRole('region', { name: 'ملخص الفترة' });
  await expect(summary).toBeVisible();
  const breakdown = page.getByRole('region', { name: 'كيف يتكوّن صافي الربح' });
  const expenses = breakdown
    .locator('dt', { hasText: 'المصروفات المدفوعة' })
    .first()
    .locator('xpath=../dd');
  await expect(expenses).toBeVisible();
  const net = page.getByTestId('summary-net');
  return {
    expensesCents: centsOfRial(await expenses.innerText()),
    netCents: centsOfRial((await net.textContent()) ?? ''),
  };
}

test('a third partner joins: ownership 40/40/20, a first contribution, a share of the profit from next month', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  await signIn(page);
  await waitForAppShell(page);
  await ensurePartners(page);

  await page.getByRole('button', { name: 'إضافة شريك' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('الاسم الكامل').fill(THIRD);
  await dialog.getByLabel('الصفة').fill('شريك مسيّر');
  await dialog.getByLabel('الهاتف').fill('0612345678');

  // The newcomer joins at 0%. A total that is not 100% is refused in words and saves nothing.
  await dialog.getByLabel('أنا', { exact: true }).fill('40');
  await dialog.getByLabel('شريكي', { exact: true }).fill('40');
  await dialog.getByLabel(THIRD, { exact: true }).fill('10');
  await expect(dialog.getByText('يجب أن يكون المجموع 100% بالضبط')).toBeVisible();
  await dialog.getByRole('button', { name: 'حفظ' }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByLabel(THIRD, { exact: true }).fill('20');
  await expect(dialog.getByText('يجب أن يكون المجموع 100% بالضبط')).toBeHidden();

  // 10,000 rial put in as the first contribution, and a weight of 1 in the split from next month.
  await dialog.getByLabel('المبلغ').fill('10000');
  await dialog.getByLabel('الوزن', { exact: true }).fill('1');
  await expect(dialog.getByText('ستصبح القسمة:')).toBeVisible();
  await dialog.getByRole('button', { name: 'حفظ' }).click();
  await expect(dialog).toBeHidden();

  // Three people now: the others made room, and each card says what its person owns and gets.
  const card = page.getByRole('region', { name: THIRD, exact: true });
  await expect(card).toBeVisible();
  await expect(card).toContainText('شريك مسيّر');
  await expect(card).toContainText('20%');
  await expect(card).toContainText('10,000');
  await expect(card).toContainText('لا شيء');
  await expect(card).toContainText('25%');
  await expect(page.getByRole('region', { name: 'أنا', exact: true })).toContainText('40%');
  await expect(page.getByRole('region', { name: 'شريكي', exact: true })).toContainText('40%');

  // The rules: the new weight is a rule of its own for a later date, the past is left as it was.
  const rules = page.getByRole('region', { name: 'قواعد قسمة الأرباح' });
  await expect(rules.getByText('قادمة').first()).toBeVisible();
  await expect(rules).toContainText(THIRD);
  await expect(rules.getByText('منذ البداية').first()).toBeVisible();

  // On the server too, every share whole (they total 100%), nothing assumed equal.
  await expect(connectivity(page)).not.toContainText(/معلّق/);
  await expect
    .poll(async () => {
      const partners = await serverGet<
        {
          name: string;
          ownershipBp: number;
          isOwner: boolean;
          phone: string | null;
          voidedAt: string | null;
        }[]
      >(request, '/partners');
      const live = partners.filter(({ voidedAt }) => voidedAt === null);
      return {
        total: live.reduce((sum, { ownershipBp }) => sum + ownershipBp, 0),
        third: live.find(({ name }) => name === THIRD),
      };
    })
    .toMatchObject({
      total: 10_000,
      third: { ownershipBp: 2000, isOwner: false, phone: '0612345678' },
    });

  // The partner's page: the contribution, and that a profit allocated is not money paid out.
  await card.getByRole('link', { name: 'حساب الشريك' }).click();
  await expect(page).toHaveURL(/\/settings\/partners\/view\?id=/);
  await expect(page.getByRole('heading', { name: THIRD })).toBeVisible();
  await expect(page.getByRole('definition').first()).toContainText('10,000');
  await expect(page.getByRole('region', { name: 'تخصيصات الأرباح' })).toContainText(
    'لم تمنحه أي فترة مسوّاة حصة بعد.',
  );
  await expect(page.getByText('التخصيص ليس دفعاً')).toBeVisible();

  // Details change without touching ownership, capital or the split.
  await page.getByRole('button', { name: 'تعديل البيانات' }).click();
  const edit = page.getByRole('dialog');
  await edit.getByLabel('الصفة').fill('شريك مسيّر ومحاسب');
  await edit.getByRole('button', { name: 'حفظ' }).click();
  await expect(edit).toBeHidden();
  await expect(page.getByText('شريك مسيّر ومحاسب').first()).toBeVisible();
  await expect(page.getByText('20%').first()).toBeVisible();

  // The weight changes for the same later date: 2 of 5 is 40% (the rule is replaced, not stacked).
  await page.getByRole('button', { name: 'تغيير حصة الأرباح' }).click();
  const weight = page.getByRole('dialog');
  await weight.getByLabel('الوزن', { exact: true }).fill('2');
  await weight.getByRole('button', { name: 'حفظ' }).click();
  await expect(weight).toBeHidden();
  await expect(page.getByText(/40%\s+ابتداءً من/)).toBeVisible();

  // A rule that has not taken effect goes, with a reason; then the partner has no share to come.
  await page.getByRole('link', { name: 'العودة إلى الشركاء' }).first().click();
  await expect(rules.getByText('قادمة').first()).toBeVisible();
  await rules.getByRole('button', { name: 'إلغاء', exact: true }).click();
  await voidWithReason(page, 'تجربة الإلغاء');
  await expect(rules.getByText('قادمة')).toHaveCount(0);
  await expect(card).toContainText('لا شيء');

  // The pages fit a tablet held either way and a phone.
  await expectFitsEverySize(page, async () => {
    await expect(card).toBeVisible();
    await expect(rules).toBeVisible();
  });
});

test('employees: a salary is paid in parts, an overpayment needs a confirmation, a payment is voided, a raise is dated', async ({
  page,
  request,
}) => {
  test.setTimeout(150_000);
  await signIn(page);
  await waitForAppShell(page);

  // Nobody yet: the directory says so and offers the way in.
  await page.goto('/settings/partners?tab=employees');
  await expect(page.getByText('لا موظفين بعد')).toBeVisible();

  const employeeId = await addEmployee(page, {
    name: SELLER,
    position: 'بائع',
    phone: '0661000000',
  });
  const row = rowOf(page, SELLER);
  const totals = page.getByRole('region', { name: 'رواتب الشهر' });
  await expect(row).toContainText('بائع');
  await expect(row).toContainText('4,000');
  await expect(row).toContainText('غير مدفوع');
  await expect(totals).toContainText('4,000');

  // 1,500 of this month's 4,000: partly paid, 2,500 still owed.
  await row.getByRole('button', { name: 'دفع', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText(`دفع راتب ${SELLER}`)).toBeVisible();
  await dialog.getByLabel('المبلغ المدفوع').fill('1500');
  await dialog.getByRole('button', { name: 'تسجيل الدفعة' }).click();
  await expect(dialog).toBeHidden();
  await expect(row.getByText('مدفوع جزئياً')).toBeVisible();
  await expect(row).toContainText('2,500');

  // More than is owed is not refused, but it must be confirmed, and the button waits for it.
  await row.getByRole('button', { name: 'دفع', exact: true }).click();
  const submit = dialog.getByRole('button', { name: 'تسجيل الدفعة' });
  await dialog.getByLabel('المبلغ المدفوع').fill('3000');
  await expect(dialog.getByText('هذا أكثر من الراتب المستحق للشهر.')).toBeVisible();
  await expect(submit).toBeDisabled();
  await dialog.getByLabel('أؤكد أن هذه الدفعة أكثر من المستحق').click();
  await expect(submit).toBeEnabled();
  // Paying only what is left needs no confirmation, and settles the month.
  await dialog.getByLabel('المبلغ المدفوع').fill('2500');
  await expect(dialog.getByText('هذا أكثر من الراتب المستحق للشهر.')).toBeHidden();
  await submit.click();
  await expect(dialog).toBeHidden();
  await expect(row.getByText('مدفوع', { exact: true })).toBeVisible();
  await expect(row.getByText('مدفوع جزئياً')).toHaveCount(0);
  await expect(row.getByRole('button', { name: 'دفع', exact: true })).toHaveCount(0);

  // The employee's own page: both payments, the month paid in full.
  await row.getByRole('link', { name: SELLER }).click();
  await expect(page).toHaveURL(/\/settings\/partners\/employee\?id=/);
  await expect(page.getByRole('heading', { name: SELLER })).toBeVisible();
  const overview = page.getByRole('region', { name: 'نظرة عامة' });
  const payments = page.getByRole('region', { name: 'الدفعات', exact: true });
  await expect(overview.getByText('مدفوع', { exact: true })).toBeVisible();
  await expect(payments.getByRole('row')).toHaveCount(3);

  // A payment entered twice is cancelled with a reason; the 1,500 is owed again.
  await rowOf(page, '1,500').getByRole('button', { name: 'إلغاء', exact: true }).click();
  await voidWithReason(page, 'أُدخلت مرتين');
  await expect(payments.getByRole('row')).toHaveCount(2);
  await expect(overview.getByText('مدفوع جزئياً')).toBeVisible();
  await expect(overview).toContainText('1,500');

  // The rest is paid from the page (the amount offered is what is left).
  await page.getByRole('button', { name: 'تسجيل دفعة' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'تسجيل الدفعة' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(overview.getByText('مدفوع', { exact: true })).toBeVisible();

  // A raise starts next month: this month and the payments already made keep what they were.
  await page.getByRole('button', { name: 'تغيير الراتب' }).click();
  await page.getByRole('dialog').getByLabel('الراتب الشهري الجديد').fill('5000');
  await page.getByRole('dialog').getByRole('button', { name: 'حفظ' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  const rates = page.getByRole('region', { name: 'سجل الراتب' });
  await expect(rates.getByText('قادم', { exact: true })).toBeVisible();
  await expect(rates.getByText('الحالي', { exact: true })).toBeVisible();
  await expect(rates).toContainText('5,000');
  await expect(overview).not.toContainText('5,000');
  await expect(page.getByRole('region', { name: 'شهراً بشهر' })).not.toContainText('5,000');
  await expect(payments.getByRole('row')).toHaveCount(3);

  // A raise that has not begun can be cancelled; the earlier salary stays.
  await rowOf(page, 'قادم').getByRole('button', { name: 'إلغاء', exact: true }).click();
  await voidWithReason(page, 'تراجع عن الزيادة');
  await expect(rates.getByText('قادم', { exact: true })).toHaveCount(0);
  await expect(rates).not.toContainText('5,000');

  // Employment details change on their own (no salary, no payment is touched).
  await page.getByRole('button', { name: 'تعديل', exact: true }).click();
  const edit = page.getByRole('dialog');
  await edit.getByLabel('المسمّى الوظيفي').fill('بائع أول');
  await edit.getByRole('button', { name: 'حفظ' }).click();
  await expect(edit).toBeHidden();
  await expect(page.getByText('بائع أول').first()).toBeVisible();

  // An employee who was paid cannot be removed; the page says so instead of offering it.
  await expect(page.getByText('لهذا الموظف دفعات رواتب، فلا يمكن إزالته.').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'إزالة الموظف' })).toHaveCount(0);

  // Same on the server: the month paid in full, the rates dated (one cancelled), no partner touched.
  await expect(connectivity(page)).not.toContainText(/معلّق/);
  const thisMonth = today().slice(0, 7);
  await expect
    .poll(async () => {
      const payroll = await serverGet<Payroll>(
        request,
        `/employees/${employeeId}/payroll?through=${thisMonth}`,
      );
      return payroll.months.find(({ month }) => month === thisMonth);
    })
    .toMatchObject({
      dueCents: SALARY_CENTS,
      paidCents: SALARY_CENTS,
      remainingCents: 0,
      status: 'paid',
    });
  const rateRows = await serverGet<{ amountCents: number; voidedAt: string | null }[]>(
    request,
    `/employees/${employeeId}/salary`,
  );
  expect(rateRows.filter(({ voidedAt }) => voidedAt === null).map((r) => r.amountCents)).toEqual([
    SALARY_CENTS,
  ]);
  expect(rateRows).toHaveLength(2);

  // The directory and the page fit a tablet held either way and a phone.
  await expectFitsEverySize(page, async () => {
    await expect(overview).toBeVisible();
    await expect(payments).toBeVisible();
  });
  await page.getByRole('link', { name: 'العودة إلى الموظفين' }).click();
  await expectFitsEverySize(page, async () => {
    await expect(page.getByRole('region', { name: 'رواتب الشهر' })).toBeVisible();
  });
});

test('a salary paid in a month is that month’s expense, once: offline, in the settlement preview, then approved and locked', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const month = lastMonth();
  await signIn(page);
  await waitForAppShell(page);
  await ensurePartners(page);
  const employeeId = await addEmployee(page, {
    name: TAILOR,
    position: 'خياط',
    phone: '0662000000',
  });

  // The month's settlement before any pay: someone who works for us is not in its profit split.
  await page.goto('/settlements');
  const before = await settlementFigures(page);
  await expect(page.getByRole('region', { name: 'توزيع الربح' })).not.toContainText(TAILOR);

  // On the employees page, last month: 4,000 due and nothing paid. The screen is read online,
  // the payment is made offline (it waits on this device).
  await page.goto('/settings/partners?tab=employees');
  await page.getByRole('button', { name: 'الشهر السابق' }).click();
  const row = rowOf(page, TAILOR);
  await expect(row).toContainText('غير مدفوع');
  await expect(row).toContainText('4,000');
  await page.context().setOffline(true);
  await row.getByRole('button', { name: 'دفع', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('المبلغ المدفوع').fill('1500');
  await dialog.getByLabel('تاريخ الدفع', { exact: true }).fill(month.first);
  await dialog.getByRole('button', { name: 'تسجيل الدفعة' }).click();
  await expect(dialog).toBeHidden();
  await expect(row.getByText('مدفوع جزئياً')).toBeVisible();
  await expect(row).toContainText('2,500');
  await expect(connectivity(page)).toContainText(/معلّق/);

  // Still offline, the settlement preview takes the 1,500 paid as an expense of that month, once:
  // the net falls by the same amount, and the 2,500 still owed is not an expense nor any cash.
  await page.goto('/settlements');
  await expect
    .poll(async () => {
      const figures = await settlementFigures(page);
      return {
        expenses: Math.abs(figures.expensesCents) - Math.abs(before.expensesCents),
        net: figures.netCents - before.netCents,
      };
    })
    .toEqual({ expenses: cents(1500), net: -cents(1500) });
  await expect(page.getByRole('region', { name: 'توزيع الربح' })).not.toContainText(TAILOR);

  // Back online it syncs: the server's payroll and its expense say the same thing.
  await page.context().setOffline(false);
  await expect(connectivity(page)).not.toContainText(/معلّق/);
  await expect
    .poll(async () => {
      const payroll = await serverGet<Payroll>(
        request,
        `/employees/${employeeId}/payroll?through=${month.key}`,
      );
      return payroll.months.find(({ month: key }) => key === month.key);
    })
    .toMatchObject({
      dueCents: SALARY_CENTS,
      paidCents: cents(1500),
      remainingCents: SALARY_CENTS - cents(1500),
      status: 'partial',
    });
  const expenses = await serverGet<
    {
      category: string;
      amountCents: number;
      employeeId: string | null;
      salaryMonth: string | null;
      paidDate: string | null;
      voidedAt: string | null;
    }[]
  >(request, `/expenses?month=${month.key}`);
  expect(
    expenses.filter(({ employeeId: id, voidedAt }) => id === employeeId && voidedAt === null),
  ).toEqual([
    expect.objectContaining({
      category: 'wages',
      amountCents: cents(1500),
      salaryMonth: month.key,
      paidDate: month.first,
    }),
  ]);

  // The expenses screen lists it as the month's wages, with whose and which month.
  await page.goto('/expenses');
  await page.getByRole('button', { name: 'الشهر السابق' }).click();
  const wages = rowOf(page, `راتب ${TAILOR}`);
  await expect(wages).toContainText('أجرة عامل');
  await expect(wages).toContainText('1,500');

  // The server counts it too, and once, when the month is approved; the figures match the device's.
  await page.goto('/settlements');
  await expect(
    page.getByRole('region', { name: 'ملخص الفترة' }).getByText('جاهزة للاعتماد'),
  ).toBeVisible();
  const settled = await settlementFigures(page);
  expect(Math.abs(settled.expensesCents) - Math.abs(before.expensesCents)).toBe(cents(1500));
  await page.getByRole('button', { name: 'مراجعة واعتماد' }).click();
  const approval = page.getByRole('dialog');
  await expect(approval.getByText('الاعتماد لا يدفع لأحد')).toBeVisible();
  await approval.getByRole('button', { name: 'اعتمد وأقفل' }).click();
  await expect(approval).toBeHidden();
  await expect(
    page.getByRole('region', { name: 'ملخص الفترة' }).getByText('مسوّاة ومقفلة', { exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () => {
      const rows = await serverGet<
        {
          periodEnd: string;
          expensesCents: number;
          netProfitCents: number;
          voidedAt: string | null;
        }[]
      >(request, '/settlements');
      return rows.find(({ periodEnd, voidedAt }) => periodEnd === month.last && voidedAt === null);
    })
    .toMatchObject({
      expensesCents: Math.abs(settled.expensesCents),
      netProfitCents: settled.netCents,
    });

  // The month is closed: its pay can no longer be recorded, and the dialog says why.
  await page.goto('/settings/partners?tab=employees');
  await page.getByRole('button', { name: 'الشهر السابق' }).click();
  await rowOf(page, TAILOR).getByRole('button', { name: 'دفع', exact: true }).click();
  const locked = page.getByRole('dialog');
  await locked.getByLabel('تاريخ الدفع', { exact: true }).fill(month.first);
  await expect(locked.getByRole('note')).toContainText('مسوّاة ومقفلة');
  await locked.getByRole('button', { name: 'إلغاء', exact: true }).click();
  await expect(locked).toBeHidden();

  // Unlocked with a reason, the month takes changes again (and the pay figures are as they were).
  await page.goto('/settlements');
  await page.getByRole('button', { name: 'فتح الفترة' }).click();
  await page.getByRole('dialog').getByLabel('السبب').fill('تجربة فتح الفترة');
  await page.getByRole('dialog').getByRole('button', { name: 'افتح الفترة' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect
    .poll(async () => {
      const rows = await serverGet<{ periodEnd: string; voidedAt: string | null }[]>(
        request,
        '/settlements',
      );
      return rows.filter(({ periodEnd, voidedAt }) => periodEnd === month.last && voidedAt === null)
        .length;
    })
    .toBe(0);
  await page.goto('/settings/partners?tab=employees');
  await page.getByRole('button', { name: 'الشهر السابق' }).click();
  await rowOf(page, TAILOR).getByRole('button', { name: 'دفع', exact: true }).click();
  const open = page.getByRole('dialog');
  await open.getByLabel('تاريخ الدفع', { exact: true }).fill(month.first);
  await expect(open.getByRole('note')).toHaveCount(0);
  await open.getByRole('button', { name: 'إلغاء', exact: true }).click();
  await expect(open).toBeHidden();
});

test('a cashier has no part in the people: the pages refuse, the API refuses, nothing of it reaches the till', async ({
  browser,
  request,
}) => {
  const till = await (await browser.newContext()).newPage();
  await signIn(till, E2E.cashier);
  await till.goto('/settings/partners?tab=employees');
  await expect(till.getByText('هذه الشاشة ليست لحساب العامل')).toBeVisible();
  await till.goto('/settings/partners/employee?id=00000000-0000-4000-8000-000000000000');
  await expect(till.getByText('هذه الشاشة ليست لحساب العامل')).toBeVisible();
  await till.context().close();

  // The server does not rely on the screens: its answers refuse the cashier, and what the till
  // pulls to keep offline holds no employee, no salary and no partner. The owner's own pull holds
  // them (the tests above left a partner, employees and salary rates), so the cashier's pull
  // lacking them is the sync hub's doing and not an empty shop.
  const login = await request.post(`${E2E.apiUrl}/auth/login`, { data: E2E.cashier });
  const { accessToken } = (await login.json()) as { accessToken: string };
  const headers = { authorization: `Bearer ${accessToken}` };
  for (const path of ['/employees', '/partners', '/expenses?month=2000-01']) {
    expect((await request.get(`${E2E.apiUrl}${path}`, { headers })).status(), path).toBe(403);
  }
  const people = ['employee', 'employee_salary', 'partner'];
  const ownerPulls = await pulledEntities(request, E2E.owner);
  for (const entity of people) {
    expect(ownerPulls.has(entity), `the owner is sent ${entity}`).toBe(true);
  }
  const cashierPulls = await pulledEntities(request, E2E.cashier);
  for (const entity of people) {
    expect(cashierPulls.has(entity), `the cashier is sent ${entity}`).toBe(false);
  }
});

/** Every entity name the device of `who` is sent when it syncs. */
async function pulledEntities(
  request: APIRequestContext,
  who: { username: string; password: string },
): Promise<Set<string>> {
  const login = await request.post(`${E2E.apiUrl}/auth/login`, { data: who });
  const { accessToken } = (await login.json()) as { accessToken: string };
  const headers = { authorization: `Bearer ${accessToken}` };
  const entities = new Set<string>();
  let since = 0;
  for (;;) {
    const response = await request.get(`${E2E.apiUrl}/sync/pull?since=${String(since)}&limit=500`, {
      headers,
    });
    const body = (await response.json()) as {
      changes: { entity: string }[];
      nextSince: number;
      hasMore: boolean;
    };
    for (const change of body.changes) entities.add(change.entity);
    since = body.nextSince;
    if (!body.hasMore) return entities;
  }
}
