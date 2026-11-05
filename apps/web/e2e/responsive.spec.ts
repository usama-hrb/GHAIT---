import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import {
  addProduct,
  addToBill,
  payInFull,
  restock,
  serverPut,
  setDeviceLanguage,
  signIn,
  waitForAppShell,
} from './helpers';
import { type Finding, LANGUAGES, login, measure, settle, SIZES } from './responsive-kit';

/**
 * The responsive audit. It is not part of the regular suite: it seeds sales, a supplier debt,
 * partners, an employee, a rent bill, an approved settlement and a zakat report, which would change
 * the figures other specs expect from the shared database. Run it alone, on its own stack:
 * `RESPONSIVE_AUDIT=1 pnpm exec playwright test e2e/responsive.spec.ts --workers=1`.
 *
 * Every route of the app, opened at the sizes the shop uses it on, in both languages, and
 * measured in the browser (no screenshots): the page must not scroll sideways, nothing may stick
 * out of the screen outside a deliberate scroll region, and a touch screen must not get a control
 * too small to hit. `RESPONSIVE_REPORT=<file>` also writes every finding as JSON (the audit);
 * `RESPONSIVE_SIZES=a,b` and `RESPONSIVE_LANGS=en,ar` narrow a run.
 */

interface Route {
  /** The page; a detail page names the pages it is reached through, each followed by its link. */
  path: string;
  via?: readonly string[];
  /** Needs no sign-in. */
  open?: boolean;
}

const ROUTES: readonly Route[] = [
  { path: '/home' },
  { path: '/pos' },
  { path: '/pos/history' },
  { path: '/pos/view', via: ['/pos/history'] },
  { path: '/inventory' },
  { path: '/inventory/catalog' },
  { path: '/inventory/suppliers' },
  { path: '/inventory/product', via: ['/inventory'] },
  { path: '/purchases' },
  { path: '/purchases/new' },
  { path: '/purchases/view', via: ['/payables', '/payables/view'] },
  { path: '/payables' },
  { path: '/payables/view', via: ['/payables'] },
  { path: '/customers' },
  { path: '/customers/debts' },
  { path: '/customers/view', via: ['/customers'] },
  { path: '/expenses' },
  { path: '/settlements' },
  { path: '/settlements/view', via: ['/settlements'] },
  { path: '/integrity' },
  { path: '/audit' },
  { path: '/zakat' },
  { path: '/zakat/view', via: ['/zakat'] },
  { path: '/reports' },
  { path: '/settings' },
  { path: '/settings/selling' },
  { path: '/settings/regional' },
  { path: '/settings/partners' },
  { path: '/settings/partners/view', via: ['/settings/partners'] },
  { path: '/settings/partners/employee', via: ['/settings/partners'] },
  { path: '/settings/accounts' },
  { path: '/settings/sync' },
  { path: '/settings/data' },
  { path: '/login', open: true },
  { path: '/signup', open: true },
  { path: '/~offline', open: true },
];

const stamp = Date.now().toString(36);

/** A day `days` before today in the shop's time zone (YYYY-MM-DD). */
function daysAgo(days: number): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Casablanca' }).format(
    new Date(),
  );
  return new Date(Date.parse(`${today}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);
}

/** The first day of last month in the shop's time zone (YYYY-MM-DD). */
function lastMonthFirst(): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Casablanca' }).format(
    new Date(),
  );
  const [year = 2026, month = 1] = today.split('-').map(Number);
  const y = month === 1 ? year - 1 : year;
  const m = month === 1 ? 12 : month - 1;
  return `${String(y)}-${String(m).padStart(2, '0')}-01`;
}
const report: Record<string, { findings: Finding[]; scrollRegions: string[] }> = {};

async function reach(page: Page, route: Route): Promise<boolean> {
  const chain = route.via ?? [];
  const first = chain[0];
  if (first === undefined) {
    await page.goto(route.path);
    return true;
  }
  await page.goto(first);
  for (const target of [...chain.slice(1), route.path]) {
    await settle(page);
    const href = await firstLinkTo(page, target);
    if (href === null) return false;
    await page.goto(href);
  }
  return true;
}

/** The first link to a record page (`<target>?id=…`) on the page, or null. */
async function firstLinkTo(page: Page, target: string): Promise<string | null> {
  const link = page.locator(`a[href^="${target}?id="], a[href^="${target}/?id="]`).first();
  if ((await link.count()) === 0) {
    // Cards open a drawer first; the link to the full page is inside it.
    const opener = page.locator('main button[aria-haspopup="dialog"]').first();
    if ((await opener.count()) > 0) {
      await opener.click();
      await link.waitFor({ timeout: 3000 }).catch(() => undefined);
    }
  }
  if ((await link.count()) === 0) return null;
  return link.getAttribute('href');
}

test.skip(
  process.env.RESPONSIVE_AUDIT !== '1',
  'The responsive audit seeds shared data: run it alone with RESPONSIVE_AUDIT=1',
);

test.describe.configure({ mode: 'serial' });

test('seed: products, sales, a supplier debt, partners, an employee and an expense', async ({
  page,
  request,
}) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);
  await waitForAppShell(page);
  await addProduct(page, { name: `كتان - أحمر ${stamp}`, code: `R${stamp}` });
  const silk = await addProduct(page, {
    name: `حرير - أزرق ${stamp}`,
    code: `B${stamp}`,
    price: '800',
    min: '700',
  });

  // A supplier owed money: a part-paid restock.
  await serverPut(request, `/suppliers/${randomUUID()}`, { name: `مورد الحرير ${stamp}` });
  await page.reload();
  await waitForAppShell(page);
  await restock(page, silk, {
    quantity: '40',
    cost: '500',
    supplier: `مورد الحرير ${stamp}`,
    paid: '4000',
  });

  await page.goto('/pos');
  await addToBill(page, `كتان - أحمر ${stamp}`, '2.5');
  await payInFull(page);

  await addToBill(page, `حرير - أزرق ${stamp}`, '3');
  await page.getByRole('button', { name: 'دفعة جزئية', exact: true }).click();
  await page.getByRole('button', { name: 'زبون جديد' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('الاسم').fill(`خديجة ${stamp}`);
  await dialog.getByLabel(/الهاتف/).fill('0611223344');
  await dialog.getByRole('button', { name: 'حفظ' }).click();
  await expect(page.getByLabel('الزبون', { exact: true })).toContainText(`خديجة ${stamp}`);
  await page.getByLabel('المدفوع الآن').fill('0');
  await page.getByRole('button', { name: 'إتمام البيع' }).click();
  await expect(page.getByText('لا أصناف').first()).toBeVisible();

  // The owner and a partner, an employee on a salary, and last month's rent.
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
  await page.goto('/settings/partners?tab=employees');
  await page.getByRole('button', { name: 'إضافة موظف' }).click();
  const hire = page.getByRole('dialog');
  await hire.getByLabel('الاسم الكامل').fill(`ياسين ${stamp}`);
  await hire.getByLabel('المسمّى الوظيفي').fill('خياط');
  await hire.getByLabel('الهاتف').fill('0600112233');
  await hire.getByLabel('تاريخ البدء', { exact: true }).fill(lastMonthFirst());
  await hire.getByLabel('الراتب الشهري', { exact: true }).fill('4000');
  await hire.getByLabel('ابتداءً من', { exact: true }).click();
  await page.getByRole('option').first().click();
  await hire.getByRole('button', { name: 'حفظ' }).click();
  await expect(hire).toBeHidden();

  await page.goto('/expenses');
  await page.getByRole('button', { name: 'مصروف جديد' }).first().click();
  const bill = page.getByRole('dialog');
  await bill.getByLabel('الفئة', { exact: true }).click();
  await page.getByRole('option', { name: 'كراء', exact: true }).click();
  await bill.getByLabel('المبلغ').fill('2000');
  await bill.getByLabel('تاريخ المصروف', { exact: true }).fill(lastMonthFirst());
  await bill.getByLabel('تاريخ الدفع', { exact: true }).fill(lastMonthFirst());
  await bill.getByRole('button', { name: 'حفظ' }).click();
  await expect(bill).toBeHidden();

  // Money in the shop and a zakat report for a hawl that began 400 days ago, so the report
  // archive has a record to open.
  await page.goto('/settings/partners');
  await page
    .getByRole('region')
    .filter({ has: page.getByRole('button', { name: 'مساهمة في رأس المال' }) })
    .first()
    .getByRole('button', { name: 'مساهمة في رأس المال' })
    .click();
  const capital = page.getByRole('dialog');
  await capital.getByLabel('المبلغ').fill('50000');
  await capital.getByRole('button', { name: 'حفظ' }).click();
  await expect(capital).toBeHidden();
  await page.goto('/zakat');
  await page.getByLabel('بداية الحول الأول').fill(daysAgo(400));
  await page.getByLabel('سعر غرام الذهب').fill('1');
  await page.getByLabel('تاريخ السعر').first().fill(daysAgo(1));
  await page.getByRole('button', { name: 'حفظ الإعدادات' }).click();
  await expect(page.getByText('حُفظت إعدادات الزكاة')).toBeVisible();
  await page.getByRole('button', { name: 'حفظ تقرير الحول' }).click();
  await expect(page.getByText('حُفظ تقرير الزكاة')).toBeVisible();

  // Last month, settled: the rent and the salary make a loss, which the settlement carries over.
  await page.goto('/settlements');
  await page.getByRole('button', { name: 'مراجعة واعتماد' }).click();
  const approval = page.getByRole('dialog');
  await approval.getByRole('button', { name: 'اعتمد وأقفل' }).click();
  await expect(approval).toBeHidden();
});

for (const language of LANGUAGES) {
  for (const size of SIZES) {
    const wanted =
      (process.env.RESPONSIVE_SIZES ?? '').split(',').filter(Boolean).length === 0 ||
      (process.env.RESPONSIVE_SIZES ?? '').split(',').includes(size.name);
    const wantedLanguage =
      (process.env.RESPONSIVE_LANGS ?? '').split(',').filter(Boolean).length === 0 ||
      (process.env.RESPONSIVE_LANGS ?? '').split(',').includes(language);
    if (!wanted || !wantedLanguage) continue;

    test(`every page fits ${size.name} (${language})`, async ({ browser }) => {
      test.setTimeout(600_000);
      const context = await browser.newContext({
        viewport: { width: size.width, height: size.height },
        isMobile: size.touch,
        hasTouch: size.touch,
        deviceScaleFactor: size.touch ? 2 : 1,
      });
      const page = await context.newPage();
      await login(page, language);
      const key = `${size.name}/${language}`;
      const problems: string[] = [];

      for (const route of ROUTES) {
        if (route.open) {
          // The sign-in pages are reached signed out, in a fresh context.
          continue;
        }
        const reached = await reach(page, route);
        if (!reached) {
          report[`${key} ${route.path}`] = { findings: [], scrollRegions: ['(no record to open)'] };
          continue;
        }
        await settle(page);
        const measured = await page.evaluate(measure, size.touch);
        report[`${key} ${route.path}`] = measured;
        const hard = measured.findings.filter(
          (f) => f.kind === 'doc-overflow' || f.kind === 'offscreen' || f.kind === 'tiny-target',
        );
        for (const f of hard)
          problems.push(`${key} ${route.path} ${f.kind} ${f.where} ${f.detail}`);
      }

      // The signed-out pages.
      const guest = await browser.newContext({
        viewport: { width: size.width, height: size.height },
        isMobile: size.touch,
        hasTouch: size.touch,
        deviceScaleFactor: size.touch ? 2 : 1,
      });
      const guestPage = await guest.newPage();
      await setDeviceLanguage(guestPage, language);
      for (const route of ROUTES.filter((r) => r.open)) {
        await guestPage.goto(route.path);
        await settle(guestPage);
        const measured = await guestPage.evaluate(measure, size.touch);
        report[`${key} ${route.path}`] = measured;
        for (const f of measured.findings.filter(
          (x) => x.kind === 'doc-overflow' || x.kind === 'offscreen' || x.kind === 'tiny-target',
        )) {
          problems.push(`${key} ${route.path} ${f.kind} ${f.where} ${f.detail}`);
        }
      }
      await guest.close();
      await context.close();

      if (process.env.RESPONSIVE_REPORT) {
        const mine = Object.fromEntries(
          Object.entries(report).filter(([name]) => name.startsWith(`${key} `)),
        );
        writeFileSync(
          `${process.env.RESPONSIVE_REPORT}.${size.name}.${language}.json`,
          JSON.stringify(mine, null, 1),
        );
      }
      if (!process.env.RESPONSIVE_SOFT) expect(problems).toEqual([]);
    });
  }
}
