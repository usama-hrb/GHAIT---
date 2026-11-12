import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { ar } from '../src/i18n/ar';
import {
  connectivity,
  daysAgo,
  serverGet,
  shopWithMoney,
  signIn,
  waitForAppShell,
} from './helpers';
import { E2E } from './stack';
import { confirmReading, reportIdOf, walkToConfirm } from './zakat-kit';

/**
 * The Zakat Management Center on the real stack (SPEC §10, ADR 0028): the overview and its state,
 * the methodology settings, the guided review that records nothing, one saved report that can be
 * voided and saved again, and payments in parts that are shared between the partners, offline
 * first and synced later. The words are read from the Arabic catalog so a rewording of the screen
 * cannot make the spec lie about it.
 */

const t = ar.zakat;

interface ReportDetail {
  report?: { zakatDueCents: number };
  paidCents?: number;
  payments?: unknown[];
}

test('zakat: the center, a review that records nothing, a report voided and saved again, paid in parts', async ({
  page,
  request,
}) => {
  test.setTimeout(240_000);
  await signIn(page);
  await waitForAppShell(page);
  await shopWithMoney(page);
  const center = page.getByRole('main');

  await test.step('not configured: it says so, is not a fatwa, and offers the review as the one main action', async () => {
    await page.goto('/zakat');
    await expect(center.getByText(t.notFatwa)).toBeVisible();
    await expect(
      center.getByRole('heading', { name: t.status.not_configured.title }),
    ).toBeVisible();
    await expect(center.getByText(t.cards.hawl.notSet)).toBeVisible();
    await expect(center.getByText(t.history.emptyTitle)).toBeVisible();
    await expect(center.locator('[data-variant="accent"]')).toHaveCount(1);
    await expect(center.getByRole('link', { name: t.actions.review })).toHaveAttribute(
      'data-variant',
      'accent',
    );
  });

  await test.step('the review cannot be finished while the hawl and the price are missing, and it saves nothing', async () => {
    await center.getByRole('link', { name: t.actions.review }).click();
    await expect(page).toHaveURL(/\/zakat\/review\/?$/);
    await expect(page.getByRole('heading', { name: t.review.title, level: 2 })).toBeVisible();
    await walkToConfirm(page, ['base', 'inventory', 'nisab', 'result']);
    await expect(page.getByText(t.confirm.blocks.blocking_items)).toBeVisible();
    await expect(page.getByRole('button', { name: t.confirm.save })).toHaveCount(0);
  });

  await test.step('the methodology: three groups that open and close, checked before anything is saved', async () => {
    await page.goto('/zakat/review');
    await page.getByRole('link', { name: t.settingsStep.change }).click();
    await expect(page).toHaveURL(/\/zakat\/settings\/?$/);
    await expect(page.getByRole('heading', { name: t.settings.title, level: 2 })).toBeVisible();
    await expect(page.getByText(t.settings.futureOnly)).toBeVisible();

    const gold = page.getByLabel(t.fields.goldPrice, { exact: true });
    const goldDate = page.getByLabel(`${t.fields.goldPrice}: ${t.fields.priceDate}`);
    for (const group of ['hawl', 'methodology', 'prices'] as const) {
      const trigger = page.getByRole('button', {
        name: new RegExp(`^${t.settings.groups[group].title}`),
      });
      await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    }
    const prices = page.getByRole('button', {
      name: new RegExp(`^${t.settings.groups.prices.title}`),
    });
    await prices.click();
    await expect(gold).toBeHidden();
    await prices.click();
    await expect(gold).toBeVisible();

    // A price needs its day, and the reminder a whole number of days: nothing is saved otherwise.
    const save = page.getByRole('button', { name: t.settings.save });
    await gold.fill('1');
    await save.click();
    await expect(page.getByText(t.settings.errors.price)).toBeVisible();
    const reminder = page.getByLabel(t.fields.reminderDays);
    const kept = await reminder.inputValue();
    await reminder.fill('abc');
    await save.click();
    await expect(page.getByText(t.settings.errors.reminder)).toBeVisible();
    await reminder.fill(kept);

    // The first hawl began 400 days ago: a Hijri year has passed. The nisab in gold at 1 rial a gram.
    await page.getByLabel(t.fields.hawlStart).fill(daysAgo(400));
    await goldDate.fill(daysAgo(1));
    await save.click();
    await expect(page.getByText(t.settings.saved)).toBeVisible();
    await save.click();
    await expect(page.getByText(t.settings.unchanged)).toBeVisible();
    await page.reload();
    await expect(page.getByLabel(t.fields.hawlStart)).toHaveValue(daysAgo(400));
  });

  await test.step('the center now has a state from the hawl and the nisab, and the home screen reminds', async () => {
    await page.getByRole('link', { name: t.actions.back }).click();
    await expect(page).toHaveURL(/\/zakat\/?$/);
    // Due, or to be reviewed first when a record of this shared shop needs a look: never "not set".
    await expect(
      center
        .getByRole('heading', { name: t.status.zakat_due.title })
        .or(center.getByRole('heading', { name: t.status.review_required.title })),
    ).toBeVisible();
    await expect(center.getByRole('heading', { name: t.status.not_configured.title })).toHaveCount(
      0,
    );
    await expect(center.getByText(t.cards.base.estimate, { exact: true })).toBeVisible();
    await expect(center.getByText(t.cards.base.estimateNote)).toBeVisible();

    await page.goto('/home');
    await expect(page.getByRole('link', { name: /حال الحول/ })).toBeVisible();
  });

  await test.step('a review read to the end saves nothing until it is confirmed', async () => {
    await page.goto('/zakat/review');
    await walkToConfirm(page);
    await expect(page.getByText(t.confirm.nothingRecorded)).toBeVisible();
    const save = page.getByRole('button', { name: t.confirm.save });
    await expect(save).toBeDisabled();
    await confirmReading(page);
    await expect(save).toBeEnabled();

    // Leaving without saving: still no report.
    await page.getByRole('link', { name: t.actions.back }).click();
    await expect(center.getByText(t.history.emptyTitle)).toBeVisible();
    expect(await serverGet<unknown[]>(request, '/zakat/reports')).toEqual([]);
  });

  // From here the device is offline: the review, the report and the payments work from its own
  // records and reach the server when the connection comes back.
  await page.context().setOffline(true);

  let firstReportId = '';
  await test.step('confirmed, the report is saved on the device and opens as it was saved', async () => {
    await page.goto('/zakat/review');
    await walkToConfirm(page);
    await confirmReading(page);
    await page.getByRole('button', { name: t.confirm.save }).click();
    await expect(page).toHaveURL(/\/zakat\/view\/?\?id=/);
    await expect(
      page.getByRole('heading', { name: new RegExp(t.reportOf), level: 2 }),
    ).toBeVisible();
    firstReportId = reportIdOf(page);
    expect(firstReportId).not.toBe('');

    await expect(center.getByText(t.report.asSaved)).toBeVisible();
    await expect(center.getByText(t.paymentState.unpaid, { exact: true })).toBeVisible();
    await expect(center.getByText(t.report.methodologyTitle)).toBeVisible();
    await expect(
      center.getByText(t.baseStep.categories.money.title, { exact: true }),
    ).toBeVisible();
    await expect(center.locator('[data-variant="accent"]')).toHaveCount(1);
    await expect(page.getByRole('link', { name: t.shareAction })).toHaveAttribute(
      'href',
      /^https:\/\/wa\.me\//,
    );
  });

  await test.step('a report with nothing paid is voided with a reason and replaced by a new one', async () => {
    await page.getByRole('button', { name: t.voidAction }).click();
    const voiding = page.getByRole('dialog');
    await voiding.getByLabel(ar.voidDialog.reason).fill('سعر الذهب كان خاطئاً');
    await voiding.getByRole('button', { name: ar.voidDialog.confirm }).click();
    await expect(voiding).toBeHidden();
    await expect(center.getByText(t.report.voidedBanner)).toBeVisible();
    await expect(page.getByRole('button', { name: t.actions.pay })).toHaveCount(0);
    await expect(page.getByRole('button', { name: t.voidAction })).toHaveCount(0);

    // The overview keeps it in the history, marked voided, and asks for a calculation again.
    await page.getByRole('link', { name: t.actions.back }).click();
    await expect(center.getByText(t.paymentState.voided, { exact: true })).toBeVisible();
    await expect(
      center
        .getByRole('heading', { name: t.status.zakat_due.title })
        .or(center.getByRole('heading', { name: t.status.review_required.title })),
    ).toBeVisible();

    await center.getByRole('link', { name: t.actions.review }).click();
    await walkToConfirm(page);
    await confirmReading(page);
    await page.getByRole('button', { name: t.confirm.save }).click();
    await expect(page).toHaveURL(/\/zakat\/view\/?\?id=/);
    expect(reportIdOf(page)).not.toBe(firstReportId);
  });

  const reportId = reportIdOf(page);
  const payment = page.getByRole('region', { name: t.report.paymentTitle });
  // 100 rial, which is 500 cents: amounts are typed in the unit the shop displays (rial).
  const PARTIAL_CENTS = 500;

  await test.step('a payment cannot pass what is left; a part is shared between the partners with its note', async () => {
    await payment.getByRole('button', { name: t.actions.pay }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: t.pay.title })).toBeVisible();
    const amount = dialog.getByLabel(t.fields.amount);
    // The amount offered is everything that is left.
    expect(await amount.inputValue()).not.toBe('');

    await amount.fill('99999999');
    await expect(dialog.getByText(t.pay.aboveRemaining)).toBeVisible();
    await expect(dialog.getByRole('button', { name: t.actions.pay })).toBeDisabled();

    await amount.fill('100');
    await dialog.getByLabel(t.fields.note).fill('إيصال 41');
    await dialog.getByRole('button', { name: t.actions.pay }).click();
    await expect(dialog).toBeHidden();

    await expect(center.getByText(t.paymentState.partial, { exact: true })).toBeVisible();
    // One draw per partner, and each carries the note the payment was recorded with.
    await expect(payment.getByText('إيصال 41')).toHaveCount(2);
    await expect(payment.getByRole('listitem').filter({ hasText: 'أنا' })).toBeVisible();
    await expect(payment.getByRole('listitem').filter({ hasText: 'شريكي' })).toBeVisible();
    // Something is paid: the report can no longer be voided, and something is still left to pay.
    await expect(page.getByRole('button', { name: t.voidAction })).toHaveCount(0);
    await expect(payment.getByRole('button', { name: t.actions.pay })).toBeVisible();
  });

  await page.context().setOffline(false);
  await expect(connectivity(page)).not.toContainText(/معلّق/);

  await test.step('back online, the server holds the one live report and the part that was paid', async () => {
    await expect
      .poll(async () => {
        const reports = await serverGet<{ id: string; voidedAt: string | null }[]>(
          request,
          '/zakat/reports',
        );
        return [
          reports.find((report) => report.id === firstReportId)?.voidedAt !== null,
          reports.find((report) => report.id === reportId)?.voidedAt === null,
        ];
      })
      .toEqual([true, true]);
    await expect
      .poll(async () => {
        const detail = await serverGet<ReportDetail>(request, `/zakat/reports/${reportId}`);
        return [detail.paidCents, detail.payments?.length];
      })
      .toEqual([PARTIAL_CENTS, 2]);
  });

  await test.step('the rest is paid in one go; the report is then paid in full and nothing is left', async () => {
    await payment.getByRole('button', { name: t.actions.pay }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: t.actions.pay }).click();
    await expect(dialog).toBeHidden();
    await expect(center.getByText(t.paymentState.paid, { exact: true })).toBeVisible();
    await expect(payment.getByRole('button', { name: t.actions.pay })).toHaveCount(0);

    await expect
      .poll(async () => {
        const detail = await serverGet<ReportDetail>(request, `/zakat/reports/${reportId}`);
        return [detail.paidCents === detail.report?.zakatDueCents, detail.payments?.length];
      })
      .toEqual([true, 4]);
  });

  await test.step('the overview shows the payment, the history opens the report, and the reminder is gone', async () => {
    await page.goto('/zakat');
    await expect(
      center.getByRole('heading', { name: t.status.payment_recorded.title }),
    ).toBeVisible();
    await expect(center.locator(`a[href^="/zakat/view"][href$="id=${reportId}"]`)).toBeVisible();
    await page.goto('/home');
    await expect(page.getByRole('link', { name: /حال الحول/ })).toBeHidden();
  });
});

test('zakat: a cashier opens none of it, on the screen or on the server', async ({
  browser,
  request,
}) => {
  const till = await (await browser.newContext()).newPage();
  await signIn(till, E2E.cashier);
  await waitForAppShell(till);

  const menu = till.getByRole('navigation').first();
  await expect(menu.getByRole('link', { name: ar.nav.zakat, exact: true })).toHaveCount(0);
  for (const path of ['/zakat', '/zakat/review', '/zakat/settings', '/zakat/view?id=anything']) {
    await till.goto(path);
    await expect(till.getByText('هذه الشاشة ليست لحساب العامل')).toBeVisible();
  }

  // And whatever the screen does, the server refuses the cashier's token on every zakat route.
  const login = await request.post(`${E2E.apiUrl}/auth/login`, { data: E2E.cashier });
  const { accessToken } = (await login.json()) as { accessToken: string };
  const headers = { authorization: `Bearer ${accessToken}` };
  const id = randomUUID();
  expect((await request.get(`${E2E.apiUrl}/zakat/reports`, { headers })).status()).toBe(403);
  expect((await request.get(`${E2E.apiUrl}/zakat/reports/${id}`, { headers })).status()).toBe(403);
  expect(
    (
      await request.post(`${E2E.apiUrl}/zakat/reports/${id}/payments`, { headers, data: {} })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.post(`${E2E.apiUrl}/zakat/reports/${id}/void`, {
        headers,
        data: { reason: 'not mine to void' },
      })
    ).status(),
  ).toBe(403);
});
