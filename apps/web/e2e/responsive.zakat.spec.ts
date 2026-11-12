import { type APIRequestContext, expect, type Locator, type Page, test } from '@playwright/test';
import { ar } from '../src/i18n/ar';
import {
  addProduct,
  serverGet,
  serverRecords,
  setDeviceLanguage,
  shopWithMoney,
  signIn,
  waitForAppShell,
} from './helpers';
import { contrastOf, LANGUAGES, login, measure, settle, SIZES } from './responsive-kit';
import {
  contextOf,
  expectThat,
  finish,
  isWanted,
  note,
  type Run,
  startRun,
  take,
} from './responsive-run';
import { E2E } from './stack';
import { configureZakat, reportIdOf, saveReport, STEPS, type Step } from './zakat-kit';

/**
 * The browser audit of the Zakat Management Center (ADR 0028). It opens the overview, the guided
 * review (every step, up to the confirmation that can save), the methodology settings, the history,
 * a saved report with its payments and the payment dialog, signed in as the owner, in every size
 * the shop uses and in both languages, and measures what a person would see: the page must not
 * scroll sideways, nothing may stick out of the screen, a control must be big enough to hit, a
 * table must be a table only where it fits and cards below, there is one gold action on each
 * screen, the page follows the language's direction, and the owner's page is the one the menu
 * marks. It also reads the contrast of the text in light and in dark. There are no screenshots.
 *
 * A saved report blocks the confirmation (one live report for each hawl), so the audit works in
 * phases and the tests depend on each other in file order: the first seed gives the shop money,
 * two products (one weighed and not yet measured, which the review marks for a look) and a
 * methodology; the first group of tests opens everything that exists before a report; the second
 * group opens the same pages on a device that has received nothing (its sync pull is cut, so it has
 * no methodology and no records, and every step that needs figures says so); the second seed saves
 * a report, voids it with a reason, saves another and pays a part of it; the third group opens
 * everything that exists after. Each test is a fresh device that pulls the shop's records, so each
 * seed waits until the server holds what it made. Run the file whole, not by `--grep`.
 *
 * It is not part of the regular suite: it adds records to the shared database, which would change
 * the figures other specs expect. Run it alone, on its own stack:
 * `RESPONSIVE_AUDIT=1 pnpm exec playwright test e2e/responsive.zakat.spec.ts --workers=1`.
 * `RESPONSIVE_REPORT=<prefix>` writes every finding and measurement as JSON, `RESPONSIVE_SOFT=1`
 * reports instead of failing, `RESPONSIVE_SIZES=a,b` and `RESPONSIVE_LANGS=en,ar` narrow a run.
 *
 * The states the shop's records cannot reach from the seed (waiting for the hawl, hawl in progress,
 * below the nisab, calculation completed) are the same card with other words: they are read in the
 * component tests with the real catalogs, not opened here. "Not set up" and "review required" are.
 */

test.skip(
  process.env.RESPONSIVE_AUDIT !== '1',
  'The responsive audit seeds shared data: run it alone with RESPONSIVE_AUDIT=1',
);

const stamp = Date.now().toString(36);

/** The seed is typed on an Arabic device, with the Arabic catalog's words. */
const seed = ar.zakat;

interface ReportRow {
  id: string;
  voidedAt: string | null;
}

interface ReportDetail {
  paidCents?: number;
  payments?: unknown[];
}

/** A pattern for a name that starts with `text`, whatever characters `text` holds. */
function startsWith(text: string): RegExp {
  return new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
}

/** How many records of `entity` the server has. */
async function serverCount(request: APIRequestContext, entity: string): Promise<number> {
  return (await serverRecords<{ id: string }>(request, entity)).length;
}

/** The zakat page's own words, in the language of this run. */
function wording(run: Run) {
  return run.m.zakat;
}

/** The pages the sidebar marks: on a phone the "more" tab, where the Zakat page lives. */
async function expectMenuMarks(run: Run): Promise<void> {
  const { page, m, size } = run;
  if (size.width >= 768) {
    await expect(
      page
        .locator('[data-slot="sidebar"] nav')
        .getByRole('link', { name: m.nav.zakat, exact: true }),
    ).toHaveAttribute('aria-current', 'page');
  } else {
    await expect(
      page
        .getByRole('navigation', { name: m.nav.label })
        .getByRole('button', { name: m.nav.more, exact: true }),
    ).toHaveAttribute('data-active', 'true');
  }
}

/** Opens a zakat page, waits until it has drawn, and checks what every one of them must have. */
async function open(run: Run, path: string): Promise<void> {
  const { page, m, language } = run;
  await page.goto(path);
  await settle(page);
  await expect(page.locator('html')).toHaveAttribute('dir', language === 'ar' ? 'rtl' : 'ltr');
  await expect(
    page.getByRole('heading', { level: 1, name: m.nav.zakat, exact: true }),
  ).toBeVisible();
  await expectMenuMarks(run);
}

/** Unfolds every folded section: the measurement should see what a person who opens them sees. */
async function unfold(page: Page): Promise<number> {
  const folded = page
    .getByRole('main')
    .locator('[data-slot="collapsible-trigger"][aria-expanded="false"]');
  let opened = 0;
  while ((await folded.count()) > 0 && opened < 40) {
    await folded.first().click();
    opened += 1;
  }
  return opened;
}

/** One gold action on a screen, and only one (none on a step that offers nothing to do yet). */
async function expectOneAccent(run: Run, name: string, expected = 1): Promise<void> {
  const count = await run.page.getByRole('main').locator('[data-variant="accent"]').count();
  expectThat(
    run,
    count === expected,
    `${name}: ${String(count)} gold actions, not ${String(expected)}`,
  );
}

/** A dialog, a menu or a list that opened lies wholly inside the screen. */
async function expectInside(run: Run, name: string, what: Locator): Promise<void> {
  const box = await what.boundingBox();
  expectThat(
    run,
    box !== null &&
      box.x >= -1 &&
      box.y >= -1 &&
      box.x + box.width <= run.size.width + 1 &&
      box.y + box.height <= run.size.height + 1,
    `${name} sticks out of the screen: ${JSON.stringify(box)} of ${String(run.size.width)}×${String(run.size.height)}`,
  );
}

/** The page measured, and its text read against what is behind it (notes, not failures). */
async function measured(run: Run, name: string, theme: 'light' | 'dark'): Promise<void> {
  const { page, size } = run;
  // A button that has just been enabled and a section that has just opened are still changing
  // their colours and their height: read them once they have settled, not halfway.
  await page.waitForTimeout(350);
  take(run, `${name} ${theme}`, await page.evaluate(measure, size.touch));
  expectThat(
    run,
    (await page.locator('#content').count()) === 1,
    `${name}: the content area is not on the page`,
  );
  for (const weak of await page.evaluate(contrastOf, ['#content'])) {
    note(
      run,
      `contrast ${theme} ${name} ${weak.ratio}<${String(weak.need)} ${weak.where} "${weak.text}" ${weak.fg} on ${weak.bg}`,
    );
  }
}

/** The overview of a shop whose methodology is set and that has no report yet. */
async function checkCenterBefore(run: Run): Promise<void> {
  const { page } = run;
  const t = wording(run);
  const main = page.getByRole('main');
  await open(run, '/zakat');
  // The methodology the seed saved has reached this device, so the center is not "not set up".
  const state = main
    .getByRole('heading', { name: t.status.zakat_due.title })
    .or(main.getByRole('heading', { name: t.status.review_required.title }));
  await expect(state).toBeVisible({ timeout: 30_000 });
  await expect(main.getByRole('heading', { name: t.status.not_configured.title })).toHaveCount(0);
  await expect(main.getByText(t.notFatwa)).toBeVisible();
  await expect(main.getByText(t.history.emptyTitle)).toBeVisible();
  await expect(main.getByRole('link', { name: t.actions.review })).toHaveAttribute(
    'data-variant',
    'accent',
  );
  await expectOneAccent(run, 'center');
  note(run, `center state: ${(await state.innerText()).trim()}`);
  await measured(run, 'center', 'light');
}

/** The review, step by step, to the confirmation that can save; nothing is saved. */
async function checkReview(run: Run, theme: 'light' | 'dark'): Promise<void> {
  const { page } = run;
  const t = wording(run);
  const main = page.getByRole('main');
  await open(run, '/zakat/review');
  for (const [index, step] of STEPS.entries()) {
    await expect(page.getByText(t.review.stepOf(index + 1, STEPS.length))).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 3, name: t.review.steps[step], exact: true }),
    ).toBeVisible();
    // The seed holds everything the calculation needs: no step falls back to "cannot be worked out".
    await expect(page.getByText(t.review.blockedTitle)).toHaveCount(0);
    const opened = await unfold(page);
    const name = `review ${String(index + 1)} ${step}`;
    await expectOneAccent(run, name);
    note(run, `${name} ${theme}: ${String(opened)} folded sections opened`);
    await measured(run, name, theme);

    if (step === 'base') {
      await expect(
        main.getByText(t.baseStep.categories.money.title, { exact: true }),
      ).toBeVisible();
    }
    if (step === 'inventory') {
      // The product bought by weight and not yet measured is a line of its own, counted at cost.
      await expect(main.getByText(t.inventoryStep.awaiting).first()).toBeVisible();
    }
    if (index < STEPS.length - 1) await main.getByRole('button', { name: t.review.next }).click();
  }

  // The confirmation: what will be saved, the ticks that are asked for, and the one gold action.
  await expect(main.getByText(t.confirm.nothingRecorded)).toBeVisible();
  const boxes = main.getByRole('checkbox');
  const ticks = await boxes.count();
  note(run, `confirmation asks for ${String(ticks)} ticks`);
  expectThat(
    run,
    ticks >= 2,
    `the confirmation asks for ${String(ticks)} tick(s), though a weight awaits measurement`,
  );
  const save = main.getByRole('button', { name: t.confirm.save });
  await expect(save).toBeDisabled();
  await measured(run, 'confirmation unticked', theme);
  for (let index = 0; index < ticks; index += 1) await boxes.nth(index).check();
  await expect(save).toBeEnabled();
  await expectOneAccent(run, 'confirmation');
  await measured(run, 'confirmation ticked', theme);
}

/** The methodology page: three groups that fold, a list that opens, and nothing saved. */
async function checkSettings(run: Run, theme: 'light' | 'dark'): Promise<void> {
  const { page } = run;
  const t = wording(run);
  const main = page.getByRole('main');
  await open(run, '/zakat/settings');
  await expect(main.getByRole('heading', { name: t.settings.title, level: 2 })).toBeVisible();
  await expect(main.getByText(t.settings.futureOnly)).toBeVisible();
  const groups = (['hawl', 'methodology', 'prices'] as const).map((group) =>
    main.getByRole('button', { name: startsWith(t.settings.groups[group].title) }),
  );
  for (const trigger of groups) await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expectOneAccent(run, 'settings');
  await measured(run, 'settings open', theme);

  // The list of metals opens inside the screen.
  const metal = main.getByLabel(t.fields.nisabMetal, { exact: true });
  await metal.click();
  await expectInside(run, 'the metal list', page.getByRole('listbox'));
  await page.keyboard.press('Escape');
  await expect(page.getByRole('listbox')).toBeHidden();

  for (const trigger of groups) {
    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  }
  await measured(run, 'settings folded', theme);
  for (const trigger of groups) await trigger.click();
}

/** The page's pieces in the dark theme, the same layout against the dark colours. */
async function checkDark(run: Run): Promise<void> {
  const { page } = run;
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.reload();
  await settle(page);
  await expect(page.locator('html')).toHaveClass(/(^|\s)dark(\s|$)/);
  await page.waitForTimeout(400);
}

test('seed 1: money, two products and the methodology, so the review has figures to show', async ({
  page,
  request,
}) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);
  await waitForAppShell(page);
  const moves = await serverCount(request, 'capital_move');
  const batches = await serverCount(request, 'product_batch');

  await shopWithMoney(page);
  await addProduct(page, { name: `قماش الزكاة ${stamp}`, code: `Z${stamp}` });
  // Weight bought and not measured yet: a line the review counts at cost and marks for a look.
  await addProduct(page, {
    name: `قماش بالوزن ${stamp}`,
    code: `W${stamp}`,
    stock: { unit: 'kg', quantity: '10', cost: '100' },
  });
  await configureZakat(page);

  // The devices opened below read the server's copy: wait until it holds what was made here.
  await expect
    .poll(
      async () => [
        (await serverCount(request, 'capital_move')) > moves,
        (await serverCount(request, 'product_batch')) >= batches + 2,
      ],
      { timeout: 60_000 },
    )
    .toEqual([true, true]);
});

for (const language of LANGUAGES) {
  for (const size of SIZES) {
    if (!isWanted(size, language)) continue;

    test(`before a report: the center, the review and the settings fit ${size.name} (${language})`, async ({
      browser,
    }) => {
      test.setTimeout(420_000);
      const context = await browser.newContext(contextOf(size));
      const page = await context.newPage();
      const run = startRun('zakat', page, size, language, 'before a report');
      try {
        await login(page, language);
        await checkCenterBefore(run);
        await checkReview(run, 'light');
        await checkSettings(run, 'light');

        // The same three pages in the dark theme.
        await checkDark(run);
        await measured(run, 'settings open', 'dark');
        await open(run, '/zakat');
        await measured(run, 'center', 'dark');
        await checkReview(run, 'dark');
        await checkSettings(run, 'dark');
      } finally {
        await context.close();
        finish(run);
      }
    });
  }
}

/**
 * The review of a device that has received nothing yet: every step that needs the figures says it
 * cannot be worked out, the confirmation says why it cannot save, and no gold action is offered.
 */
async function checkBlockedReview(run: Run): Promise<void> {
  const { page } = run;
  const t = wording(run);
  const main = page.getByRole('main');
  const blocked: readonly Step[] = ['base', 'inventory', 'nisab', 'result'];
  await open(run, '/zakat/review');
  for (const [index, step] of STEPS.entries()) {
    await expect(page.getByText(t.review.stepOf(index + 1, STEPS.length))).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 3, name: t.review.steps[step], exact: true }),
    ).toBeVisible();
    if (blocked.includes(step)) await expect(page.getByText(t.review.blockedTitle)).toBeVisible();
    await unfold(page);
    const last = index === STEPS.length - 1;
    const name = `blocked review ${String(index + 1)} ${step}`;
    await expectOneAccent(run, name, last ? 0 : 1);
    await measured(run, name, 'light');
    if (!last) await main.getByRole('button', { name: t.review.next }).click();
  }
  await expect(main.getByText(t.confirm.blocks.blocking_items)).toBeVisible();
  await expect(main.getByRole('button', { name: t.confirm.save })).toHaveCount(0);
}

for (const language of LANGUAGES) {
  for (const size of SIZES) {
    if (!isWanted(size, language)) continue;

    test(`nothing received: the blocked states fit ${size.name} (${language})`, async ({
      browser,
    }) => {
      test.setTimeout(240_000);
      const context = await browser.newContext(contextOf(size, true));
      const page = await context.newPage();
      const run = startRun('zakat', page, size, language, 'nothing received');
      const t = wording(run);
      const main = page.getByRole('main');
      try {
        // The shop's records never reach this device: it has no methodology and no records.
        await page.route(/\/api\/sync\/pull/, (route) => route.abort());
        await setDeviceLanguage(page, language);
        await page.goto('/login');
        await page.locator('input[autocomplete="username"]').fill(E2E.owner.username);
        await page.locator('input[autocomplete="current-password"]').fill(E2E.owner.password);
        await page.locator('button[type="submit"]').click();
        await expect(page).toHaveURL(/\/home$/);

        await open(run, '/zakat');
        await expect(
          main.getByRole('heading', { name: t.status.not_configured.title }),
        ).toBeVisible({ timeout: 30_000 });
        await expect(main.getByText(t.cards.hawl.notSet)).toBeVisible();
        await expectOneAccent(run, 'center, not set up');
        await measured(run, 'center, not set up', 'light');

        await checkBlockedReview(run);

        await open(run, '/zakat/settings');
        await expect(main.getByRole('heading', { name: t.settings.title, level: 2 })).toBeVisible();
        await measured(run, 'settings, nothing set', 'light');
      } finally {
        await context.close();
        finish(run);
      }
    });
  }
}

test('seed 2: a report voided with a reason, another saved in its place, and a part of it paid', async ({
  page,
  request,
}) => {
  test.setTimeout(300_000);
  await login(page, 'ar');

  await saveReport(page);
  const first = reportIdOf(page);
  await page.getByRole('button', { name: seed.voidAction }).click();
  const voiding = page.getByRole('dialog');
  await voiding.getByLabel(ar.voidDialog.reason).fill('سعر الذهب كان خاطئاً');
  await voiding.getByRole('button', { name: ar.voidDialog.confirm }).click();
  await expect(voiding).toBeHidden();
  await expect(page.getByText(seed.report.voidedBanner)).toBeVisible();

  await saveReport(page);
  const live = reportIdOf(page);
  expect(live).not.toBe(first);

  // 100 rial, which is 500 cents: amounts are typed in the unit the shop displays.
  const payment = page.getByRole('region', { name: seed.report.paymentTitle });
  await payment.getByRole('button', { name: seed.actions.pay }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(seed.fields.amount).fill('100');
  await dialog.getByLabel(seed.fields.note).fill('إيصال 7');
  await dialog.getByRole('button', { name: seed.actions.pay }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(seed.paymentState.partial, { exact: true })).toBeVisible();

  // The devices opened below read the server's copy: the report, the void and the part paid.
  await expect
    .poll(
      async () => {
        const reports = await serverGet<ReportRow[]>(request, '/zakat/reports');
        const detail = await serverGet<ReportDetail>(request, `/zakat/reports/${live}`);
        const voided = reports.find((report) => report.id === first);
        const alive = reports.find((report) => report.id === live);
        return [
          voided !== undefined && voided.voidedAt !== null,
          alive !== undefined && alive.voidedAt === null,
          detail.paidCents,
          detail.payments?.length,
        ];
      },
      { timeout: 60_000 },
    )
    .toEqual([true, true, 500, 2]);
});

for (const language of LANGUAGES) {
  for (const size of SIZES) {
    if (!isWanted(size, language)) continue;

    test(`with a report: the history, the report and the payment fit ${size.name} (${language})`, async ({
      browser,
      request,
    }) => {
      test.setTimeout(420_000);
      const context = await browser.newContext(contextOf(size));
      const page = await context.newPage();
      const run = startRun('zakat', page, size, language, 'with a report');
      const t = wording(run);
      const main = page.getByRole('main');
      try {
        await login(page, language);
        const reports = await serverGet<ReportRow[]>(request, '/zakat/reports');
        const live = reports.find((report) => report.voidedAt === null)?.id ?? '';
        const voided = reports.find((report) => report.voidedAt !== null)?.id ?? '';
        expectThat(
          run,
          live !== '' && voided !== '',
          'the seed did not leave a live and a voided report',
        );

        // The overview: a payment is recorded, and the history holds both reports.
        await open(run, '/zakat');
        await expect(
          main.getByRole('heading', { name: t.status.payment_recorded.title }),
        ).toBeVisible({
          timeout: 30_000,
        });
        await expectOneAccent(run, 'center with a report');
        const history = page.getByRole('region', { name: t.history.title, exact: true });
        await expect(history).toBeVisible();
        await expect(history.getByRole('link', { name: t.history.details })).toHaveCount(2);
        await expect(history.getByText(t.paymentState.voided, { exact: true })).toBeVisible();
        await expect(history.getByText(t.paymentState.partial, { exact: true })).toBeVisible();
        // A real table from 640px up, one card for each report below it.
        const headed = await history
          .getByRole('columnheader', { name: t.history.columns.hawl })
          .isVisible();
        expectThat(
          run,
          headed === size.width >= 640,
          `the history ${headed ? 'is a table' : 'is stacked'} at ${String(size.width)}px`,
        );
        await measured(run, 'center with a report', 'light');

        // The live report: as it was saved, its payment shared between the partners, the way to share it.
        await history
          .locator(`a[href^="/zakat/view"][href$="id=${live}"]`)
          .scrollIntoViewIfNeeded();
        await history.locator(`a[href^="/zakat/view"][href$="id=${live}"]`).click();
        await expect(page).toHaveURL(/\/zakat\/view\/?\?id=/);
        await settle(page);
        await expectMenuMarks(run);
        await expect(main.getByRole('heading', { name: t.reportOf, level: 2 })).toBeVisible();
        await expect(main.getByText(t.report.asSaved)).toBeVisible();
        await expect(main.getByText(t.paymentState.partial, { exact: true })).toBeVisible();
        await expect(page.getByRole('link', { name: t.shareAction })).toHaveAttribute(
          'href',
          /^https:\/\/wa\.me\//,
        );
        await expectOneAccent(run, 'report');
        const payment = page.getByRole('region', { name: t.report.paymentTitle });
        await expect(payment.getByText('إيصال 7')).toHaveCount(2);
        const draws = await payment.getByRole('listitem').count();
        expectThat(
          run,
          draws >= 2,
          `the payments list shows ${String(draws)} draw(s), not one per partner`,
        );
        const opened = await unfold(page);
        note(run, `report: ${String(opened)} folded sections opened`);
        await measured(run, 'report', 'light');

        // The payment dialog: inside the screen, with the amount that is left offered.
        await payment.scrollIntoViewIfNeeded();
        await payment.getByRole('button', { name: t.actions.pay }).click();
        const dialog = page.getByRole('dialog');
        await expect(dialog.getByRole('heading', { name: t.pay.title })).toBeVisible();
        await page.waitForTimeout(400);
        await expectInside(run, 'the payment dialog', dialog);
        take(run, 'payment dialog', await page.evaluate(measure, size.touch));
        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();

        // The voided report: kept in the record, with its banner and no way to pay or void again.
        await open(run, `/zakat/view?id=${voided}`);
        await expect(main.getByText(t.report.voidedBanner)).toBeVisible();
        await expect(page.getByRole('button', { name: t.actions.pay })).toHaveCount(0);
        await expect(page.getByRole('button', { name: t.voidAction })).toHaveCount(0);
        await unfold(page);
        await measured(run, 'voided report', 'light');

        // The same pages in the dark theme.
        await checkDark(run);
        await unfold(page);
        await measured(run, 'voided report', 'dark');
        await open(run, `/zakat/view?id=${live}`);
        await unfold(page);
        await measured(run, 'report', 'dark');
        await open(run, '/zakat');
        await measured(run, 'center with a report', 'dark');
      } finally {
        await context.close();
        finish(run);
      }
    });
  }
}
