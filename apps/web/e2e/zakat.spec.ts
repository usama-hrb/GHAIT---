import { expect, type Page, test } from '@playwright/test';
import { connectivity, serverGet, signIn, waitForAppShell } from './helpers';

/** A day `days` before today in the shop's time zone (YYYY-MM-DD). */
function daysAgo(days: number): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Casablanca' }).format(
    new Date(),
  );
  return new Date(Date.parse(`${today}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);
}

/** The two partners (set up once), and money in the shop: a contribution of 50 000 rial. */
async function shopWithMoney(page: Page) {
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
  await page
    .getByRole('region')
    .filter({ has: page.getByRole('button', { name: 'مساهمة في رأس المال' }) })
    .first()
    .getByRole('button', { name: 'مساهمة في رأس المال' })
    .click();
  await page.getByRole('dialog').getByLabel('المبلغ').fill('50000');
  await page.getByRole('dialog').getByRole('button', { name: 'حفظ' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
}

test('zakat: settings, the hawl’s report saved and paid by the partners, reminded until saved', async ({
  page,
  request,
}) => {
  await signIn(page);
  await waitForAppShell(page);
  await shopWithMoney(page);

  // The first hawl started 400 days ago: a Hijri year has passed. The nisab in gold at 1 rial a gram.
  await page.goto('/zakat');
  await expect(page.getByText('هذه أداة حساب وليست فتوى')).toBeVisible();
  await page.getByLabel('بداية الحول الأول').fill(daysAgo(400));
  await page.getByLabel('سعر غرام الذهب').fill('1');
  await page.getByLabel('تاريخ السعر').first().fill(daysAgo(1));
  await page.getByRole('button', { name: 'حفظ الإعدادات' }).click();
  await expect(page.getByText('حُفظت إعدادات الزكاة')).toBeVisible();
  const base = page.getByRole('region', { name: 'وعاء الزكاة' });
  await expect(base.getByText('بلغ الوعاء النصاب وحال الحول.')).toBeVisible();

  // Reminded on the home screen until the hawl's report is saved.
  await page.goto('/home');
  await expect(page.getByRole('region', { name: 'الزكاة' })).toContainText('حال الحول');

  // Offline: the base from this device's records; the report saves and syncs later.
  await page.context().setOffline(true);
  await page.goto('/zakat');
  await page.getByRole('button', { name: 'حفظ تقرير الحول' }).click();
  await expect(page.getByText('حُفظ تقرير الزكاة')).toBeVisible();
  await page
    .getByRole('region', { name: 'أرشيف التقارير' })
    .getByRole('link', { name: 'التفاصيل' })
    .click();
  await expect(page.getByRole('heading', { name: /زكاة حول/ })).toBeVisible();

  // Paid in full: a draw per partner by ownership.
  await page.getByRole('button', { name: 'تسجيل إخراج الزكاة' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'تسجيل إخراج الزكاة' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByRole('region', { name: 'الإخراج' }).getByText('أنا')).toBeVisible();
  await page.context().setOffline(false);
  await expect(connectivity(page)).not.toContainText(/معلّق/);

  const reportId = new URL(page.url()).searchParams.get('id') ?? '';
  await expect
    .poll(async () => {
      const detail = await serverGet<{
        report?: { zakatDueCents: number };
        paidCents?: number;
        payments?: unknown[];
      }>(request, `/zakat/reports/${reportId}`);
      return [detail.paidCents === detail.report?.zakatDueCents, detail.payments?.length];
    })
    .toEqual([true, 2]);
  await page.goto('/home');
  await expect(page.getByRole('region', { name: 'الزكاة' })).toBeHidden();
});
