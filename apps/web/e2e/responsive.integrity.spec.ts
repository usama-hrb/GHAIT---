import { randomUUID } from 'node:crypto';
import { type APIRequestContext, expect, test } from '@playwright/test';
import {
  addProduct,
  addToBill,
  payInFull,
  restock,
  serverPut,
  serverRecords,
  setDeviceLanguage,
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

/**
 * The browser audit of the Financial Integrity page and of the navigation that leads to it
 * (ADR 0027). It opens `/integrity` signed in as the owner, in every size the shop uses and in both
 * languages, and measures what a person would see: the page must not scroll sideways, nothing may
 * stick out of the screen, a control must be big enough to hit, the two sides of the check must sit
 * side by side only where the column is wide enough, and the menu (the sidebar, its folded rail,
 * or the phone's "more" drawer) must show the five groups with Financial Integrity under Reports.
 * It also reads the contrast of every piece of text in light and in dark. There are no screenshots.
 *
 * Three answers are opened: Balanced (the data this spec seeds), Difference detected (the device
 * is handed one batch whose cost is 10 dirham too high, which makes the stock it holds disagree
 * with the purchases that explain it) and Unable to verify (the device is never allowed to receive
 * the shop's records). Only the first two need the shop's records on the device; the third needs
 * none. Neither alteration reaches the server.
 *
 * It is not part of the regular suite: it adds stock, a purchase on credit and a sale, which would
 * change the figures other specs expect from the shared database. Run it alone, on its own stack:
 * `RESPONSIVE_AUDIT=1 pnpm exec playwright test e2e/responsive.integrity.spec.ts --workers=1`.
 * `RESPONSIVE_REPORT=<prefix>` writes every finding and measurement as JSON, `RESPONSIVE_SOFT=1`
 * reports instead of failing, `RESPONSIVE_SIZES=a,b` and `RESPONSIVE_LANGS=en,ar` narrow a run.
 */

test.skip(
  process.env.RESPONSIVE_AUDIT !== '1',
  'The responsive audit seeds shared data: run it alone with RESPONSIVE_AUDIT=1',
);

const stamp = Date.now().toString(36);

/** The pages the owner's sidebar draws, in order; the phone's drawer leaves out the four tabs. */
const SIDEBAR_HREFS = [
  '/home',
  '/pos',
  '/inventory',
  '/customers',
  '/payables',
  '/expenses',
  '/settlements',
  '/zakat',
  '/reports',
  '/integrity',
  '/audit',
  '/settings',
];
const DRAWER_HREFS = SIDEBAR_HREFS.slice(4);

/** What a menu is measured for. Everything here runs in the browser and must be self-contained. */
interface NavFacts {
  /** The sidebar's state (`expanded` or `collapsed`); null for the phone's drawer. */
  state: string | null;
  headings: string[];
  hrefs: string[];
  /** Financial Integrity sits in a list inside the Reports item. */
  nested: boolean;
  /** How far the nested link starts inside its parent's, in px (positive: indented). */
  indent: number;
  integrityCurrent: boolean;
  reportsCurrent: boolean;
  reportsWithin: boolean;
  /** The distance between the two icons' centres across the menu; null when one is missing. */
  iconShift: number | null;
  /** The menu's own vertical scroll: the height of its content and the height it shows. */
  scrollHeight: number;
  clientHeight: number;
  /** How far the last link (Settings) lies below what the menu shows, before any scrolling. */
  hiddenBelow: number;
  /** Links whose name a person can read (none on the folded rail). */
  labels: number;
  /** How much wider the menu's content is than its box. */
  sideways: number;
}

/** Runs in the page: the figures of the menu inside `scope` (the sidebar's nav or a dialog). */
function navFacts(scope: string): NavFacts | null {
  const root = document.querySelector<HTMLElement>(scope);
  if (!root) return null;
  const rtl = getComputedStyle(document.documentElement).direction === 'rtl';
  const shown = (el: Element): boolean => {
    const box = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return (
      box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
    );
  };
  const links = [...root.querySelectorAll<HTMLAnchorElement>('a[href]')].filter(shown);
  const link = (href: string) => links.find((a) => a.getAttribute('href') === href) ?? null;
  const reports = link('/reports');
  const integrity = link('/integrity');
  const settings = link('/settings');
  const item = reports?.closest('li') ?? null;
  const nested =
    item !== null &&
    integrity !== null &&
    item.contains(integrity) &&
    integrity.closest('li') !== item;
  let indent = 0;
  if (reports && integrity) {
    const parent = reports.getBoundingClientRect();
    const child = integrity.getBoundingClientRect();
    indent = rtl ? parent.right - child.right : child.left - parent.left;
  }
  const centre = (a: HTMLAnchorElement | null): number | null => {
    const icon = a?.querySelector('svg');
    if (!icon) return null;
    const box = icon.getBoundingClientRect();
    return box.left + box.width / 2;
  };
  const one = centre(reports);
  const two = centre(integrity);
  const scrollers = [root, ...root.querySelectorAll<HTMLElement>('*')].filter((el) =>
    /(auto|scroll)/.test(getComputedStyle(el).overflowY),
  );
  const scroller = scrollers[0] ?? root;
  const room = scroller.getBoundingClientRect();
  const last = settings?.getBoundingClientRect().bottom ?? 0;
  return {
    state: root.closest('[data-slot="sidebar"]')?.getAttribute('data-state') ?? null,
    headings: [...root.querySelectorAll<HTMLElement>('p[aria-hidden="true"]')]
      .filter(shown)
      .map((p) => p.textContent.trim()),
    hrefs: links.map((a) => a.getAttribute('href') ?? ''),
    nested,
    indent: Math.round(indent),
    integrityCurrent: integrity?.getAttribute('aria-current') === 'page',
    reportsCurrent: reports?.getAttribute('aria-current') === 'page',
    reportsWithin: reports?.getAttribute('data-within') === 'true',
    iconShift: one === null || two === null ? null : Math.round(Math.abs(one - two) * 10) / 10,
    scrollHeight: scroller.scrollHeight,
    clientHeight: scroller.clientHeight,
    hiddenBelow: settings ? Math.round(Math.max(last - room.bottom, last - window.innerHeight)) : 0,
    labels: links.filter((a) => a.innerText.trim() !== '').length,
    sideways: scroller.scrollWidth - scroller.clientWidth,
  };
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** The menu's facts, checked against what an owner is shown (ADR 0027), and kept in the report. */
async function checkMenu(
  run: Run,
  name: string,
  scope: string,
  onIntegrity: boolean,
): Promise<NavFacts | null> {
  const drawer = scope.includes('dialog');
  const groups = run.m.nav.groups;
  const facts = await run.page.evaluate(navFacts, scope);
  if (facts === null) {
    run.problems.push(`${run.key} ${name}: the menu is not on the page`);
    return null;
  }
  note(run, `${name}: ${JSON.stringify(facts)}`);
  const folded = facts.state === 'collapsed';
  expectThat(
    run,
    same(facts.hrefs, drawer ? DRAWER_HREFS : SIDEBAR_HREFS),
    `${name}: the pages are ${facts.hrefs.join(' ')}`,
  );
  // The headings are folded away on the rail; the Reports group has none by design.
  const headings = folded
    ? []
    : drawer
      ? [groups.operations, groups.finance, groups.admin]
      : [groups.main, groups.operations, groups.finance, groups.admin];
  expectThat(
    run,
    same(facts.headings, headings),
    `${name}: the headings are ${facts.headings.join(' | ')}`,
  );
  expectThat(run, facts.nested, `${name}: Financial Integrity is not under Reports`);
  if (!folded) {
    expectThat(
      run,
      facts.indent >= 8,
      `${name}: the nested page is indented by ${String(facts.indent)}px`,
    );
  }
  expectThat(
    run,
    facts.integrityCurrent === onIntegrity,
    `${name}: Financial Integrity ${facts.integrityCurrent ? 'is' : 'is not'} the current page`,
  );
  expectThat(run, !facts.reportsCurrent, `${name}: Reports is drawn as the current page`);
  if (!drawer) {
    expectThat(
      run,
      facts.reportsWithin === onIntegrity,
      `${name}: Reports ${facts.reportsWithin ? 'is' : 'is not'} marked as containing the open page`,
    );
  }
  if (folded) {
    expectThat(
      run,
      facts.labels === 0,
      `${name}: ${String(facts.labels)} names still shown on the rail`,
    );
    expectThat(
      run,
      facts.iconShift !== null && facts.iconShift <= 2,
      `${name}: the two icons are ${String(facts.iconShift)}px out of line on the rail`,
    );
  } else {
    expectThat(
      run,
      facts.labels === (drawer ? DRAWER_HREFS : SIDEBAR_HREFS).length,
      `${name}: ${String(facts.labels)} names shown`,
    );
  }
  expectThat(
    run,
    facts.sideways <= 1,
    `${name}: the menu is ${String(facts.sideways)}px wider than its box`,
  );
  return facts;
}

/** The sidebar of a tablet or desktop: open, folded to the rail and open again. */
async function checkSidebar(run: Run, onIntegrity: boolean): Promise<void> {
  const { page, size } = run;
  const scope = '[data-slot="sidebar"][data-state] nav';
  const open = await checkMenu(run, 'sidebar', scope, onIntegrity);
  if (open !== null) {
    expectThat(run, open.state === 'expanded', `the sidebar starts ${String(open.state)}`);
    const over = open.scrollHeight - open.clientHeight;
    note(
      run,
      `sidebar scroll: ${String(over)}px of the menu lie beyond the ${String(open.clientHeight)}px it shows; Settings is ${String(open.hiddenBelow)}px below the fold`,
    );
    // A screen 900px tall or more shows the whole menu; a tablet in landscape scrolls it (ADR 0027).
    if (size.height >= 900) {
      expectThat(
        run,
        open.hiddenBelow <= 0,
        `sidebar: Settings is ${String(open.hiddenBelow)}px below the fold on a ${String(size.height)}px screen`,
      );
    }
  }
  if (!onIntegrity) return;

  await page.locator('[data-sidebar="trigger"]').click();
  await expect(page.locator('[data-slot="sidebar"][data-state="collapsed"]')).toBeVisible();
  await page.waitForTimeout(450);
  await checkMenu(run, 'rail', scope, onIntegrity);
  take(run, 'rail', await page.evaluate(measure, size.touch));
  await page.locator('[data-sidebar="trigger"]').click();
  await expect(page.locator('[data-slot="sidebar"][data-state="expanded"]')).toBeVisible();
  await page.waitForTimeout(450);
}

/** The phone's drawer: open it, check its menu and its fit, and follow Financial Integrity. */
async function checkDrawer(run: Run, follow: boolean): Promise<void> {
  const { page, m, size } = run;
  const bar = page.getByRole('navigation', { name: m.nav.label });
  const more = bar.getByRole('button', { name: m.nav.more, exact: true });
  await expect(more).toBeVisible();
  await more.click();
  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();
  await page.waitForTimeout(600);
  const facts = await checkMenu(run, 'drawer', '[role="dialog"]', !follow);
  if (facts !== null) {
    note(
      run,
      `drawer scroll: ${String(facts.scrollHeight - facts.clientHeight)}px beyond the ${String(facts.clientHeight)}px shown; Settings is ${String(facts.hiddenBelow)}px below the fold`,
    );
    // A phone 800px tall or more shows every page of the drawer without a scroll.
    if (size.height >= 800) {
      expectThat(
        run,
        facts.hiddenBelow <= 0,
        `drawer: Settings is ${String(facts.hiddenBelow)}px below the fold on a ${String(size.height)}px phone`,
      );
    }
  }
  const box = await drawer.boundingBox();
  if (box !== null) {
    expectThat(
      run,
      box.x >= -1 &&
        box.x + box.width <= size.width + 1 &&
        box.y >= -1 &&
        box.y + box.height <= size.height + 1,
      `the drawer sticks out of the screen: ${JSON.stringify(box)} of ${String(size.width)}×${String(size.height)}`,
    );
  }
  take(run, 'drawer', await page.evaluate(measure, size.touch));
  if (follow) {
    await drawer.getByRole('link', { name: m.nav.integrity, exact: true }).click();
    await expect(page).toHaveURL(/\/integrity$/);
    await expect(page.getByRole('dialog')).toBeHidden();
  } else {
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
  }
}

/** From the home page, through the menu, to the Financial Integrity page. */
async function openThroughMenu(run: Run): Promise<void> {
  const { page, m, size } = run;
  await page.goto('/home');
  await settle(page);
  if (size.width >= 768) {
    await checkSidebar(run, false);
    await page
      .locator('[data-slot="sidebar"] nav')
      .getByRole('link', { name: m.nav.integrity, exact: true })
      .click();
    await expect(page).toHaveURL(/\/integrity$/);
  } else {
    const more = page
      .getByRole('navigation', { name: m.nav.label })
      .getByRole('button', { name: m.nav.more, exact: true });
    await expect(more).toHaveAttribute('data-active', 'false');
    await checkDrawer(run, true);
  }
  await settle(page);
}

/** How many records of `entity` the server has. */
async function serverCount(request: APIRequestContext, entity: string): Promise<number> {
  return (await serverRecords<{ id: string }>(request, entity)).length;
}

test('seed: stock bought on credit and a sale, so the check has figures', async ({
  page,
  request,
}) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);
  await waitForAppShell(page);
  const name = `قماش التطابق ${stamp}`;
  const product = await addProduct(page, { name, code: `I${stamp}` });

  // A supplier owed money: a part-paid restock, so the check has a debt to show.
  await serverPut(request, `/suppliers/${randomUUID()}`, { name: `مورد التطابق ${stamp}` });
  await page.reload();
  await waitForAppShell(page);
  await restock(page, product, {
    quantity: '40',
    cost: '500',
    supplier: `مورد التطابق ${stamp}`,
    paid: '4000',
  });

  const sold = await serverCount(request, 'sale');
  const paid = await serverCount(request, 'payment');
  await page.goto('/pos');
  await addToBill(page, name, '2.5');
  await payInFull(page);
  // A sale is saved on the device first and sent in the background. The devices opened below read
  // the server's copy, so wait until it has arrived; without it their lists had no sale in them.
  await expect
    .poll(
      async () =>
        (await serverCount(request, 'sale')) > sold &&
        (await serverCount(request, 'payment')) > paid,
      { timeout: 60_000 },
    )
    .toBe(true);
});

for (const language of LANGUAGES) {
  for (const size of SIZES) {
    if (!isWanted(size, language)) continue;

    test(`Balanced: the page and the navigation fit ${size.name} (${language})`, async ({
      browser,
    }) => {
      test.setTimeout(300_000);
      const context = await browser.newContext(contextOf(size));
      const page = await context.newPage();
      const run = startRun('integrity', page, size, language, 'balanced');
      const { m } = run;
      const t = m.integrity;
      try {
        await login(page, language);
        await openThroughMenu(run);

        await expect(page.locator('html')).toHaveAttribute(
          'dir',
          language === 'ar' ? 'rtl' : 'ltr',
        );
        const verdict = page.getByRole('status').filter({
          has: page.getByRole('heading', { level: 2, name: t.status.balanced, exact: true }),
        });
        await expect(verdict).toBeVisible();
        const holdings = page.getByRole('region', { name: t.holdings, exact: true });
        const claims = page.getByRole('region', { name: t.claims, exact: true });
        await expect(holdings).toBeVisible();
        await expect(claims).toBeVisible();
        take(run, 'page', await page.evaluate(measure, size.touch));

        // The totals are on screen whatever the arrangement: in the verdict and on each side.
        for (const [scope, label] of [
          [verdict, t.holdingsTotal],
          [verdict, t.claimsTotal],
          [verdict, t.status.gap],
          [holdings, t.holdingsTotal],
          [claims, t.claimsTotal],
        ] as const) {
          await expect(scope.getByText(label, { exact: true })).toBeVisible();
        }

        // Side by side only where the column is wide enough for two (a container query at 48rem).
        const first = await holdings.boundingBox();
        const second = await claims.boundingBox();
        const column = await page
          .locator('[class~="@container"]')
          .first()
          .evaluate((el) => el.clientWidth);
        if (first !== null && second !== null) {
          const beside =
            Math.abs(first.y - second.y) < 4 &&
            (first.x + first.width <= second.x + 1 || second.x + second.width <= first.x + 1);
          const below = Math.abs(first.x - second.x) < 4 && second.y >= first.y + first.height - 1;
          const wantBeside = column >= 768;
          expectThat(
            run,
            wantBeside ? beside : below,
            `the two sides should be ${wantBeside ? 'side by side' : 'one above the other'} in a ${String(column)}px column: ${JSON.stringify([first, second])}`,
          );
          note(
            run,
            `the two sides are ${beside ? 'side by side' : 'stacked'} in a ${String(column)}px column`,
          );
        }

        // "Money per the records" explained, and how it is worked out.
        await expect(holdings.getByText(t.helps.cash, { exact: true })).toBeVisible();
        const negative = await holdings.getByText(t.negatives.cash, { exact: true }).isVisible();
        note(run, `the note on a negative money line is ${negative ? 'shown' : 'not needed here'}`);
        const how = holdings.getByRole('button', { name: t.cashHow.title });
        await how.scrollIntoViewIfNeeded();
        await how.click();
        await expect(holdings.getByText(t.cashHow.counted, { exact: true })).toBeVisible();
        take(run, 'cash explanation open', await page.evaluate(measure, size.touch));

        // The cash counts and the latest changes.
        const counts = page.getByRole('region', { name: t.countsTitle, exact: true });
        const latest = page.getByRole('region', { name: t.recentTitle, exact: true });
        await counts.scrollIntoViewIfNeeded();
        await expect(counts).toBeVisible();
        await expect(page.getByRole('button', { name: t.count })).toBeEnabled();
        await latest.scrollIntoViewIfNeeded();
        await expect(latest).toBeVisible();
        await expect(latest.locator('tbody tr').first()).toBeVisible();
        // Measured with the changes listed: the name of a short change ("Sale") is a link only a few
        // characters wide, which the measurement taken before the list loaded could not see.
        take(run, 'latest changes', await page.evaluate(measure, size.touch));
        const names = await latest.locator('tbody a[href]').evaluateAll((all) =>
          all.map((a) => {
            const box = a.getBoundingClientRect();
            return `${a.textContent.trim()} ${String(Math.round(box.width))}×${String(Math.round(box.height))}`;
          }),
        );
        note(
          run,
          `latest changes, the names that open a record (width×height): ${names.join('; ')}`,
        );
        await expect(latest.getByRole('link', { name: t.viewAudit })).toHaveAttribute(
          'href',
          '/audit',
        );
        // A real table from 640px up, one card for each change below it.
        const headed = await latest.getByRole('columnheader', { name: t.recordedAt }).isVisible();
        expectThat(
          run,
          headed === size.width >= 640,
          `the latest changes ${headed ? 'is a table' : 'is stacked'} at ${String(size.width)}px`,
        );
        const tables = await page
          .locator('[data-slot="table-container"]')
          .evaluateAll((all) =>
            all.map((el) => `${String(el.scrollWidth)} in ${String(el.clientWidth)}`),
          );
        note(run, `table boxes (content in box): ${tables.join('; ')}`);

        // The navigation on the page itself.
        if (size.width >= 768) {
          await checkSidebar(run, true);
        } else {
          const more = page
            .getByRole('navigation', { name: m.nav.label })
            .getByRole('button', { name: m.nav.more, exact: true });
          await expect(more).toHaveAttribute('data-active', 'true');
          await checkDrawer(run, false);
        }

        // Light, then dark: the same layout, and every piece of text against what is behind it.
        await page.evaluate(() => {
          window.scrollTo(0, 0);
        });
        const light = await page.evaluate(contrastOf, ['#content', 'nav']);
        for (const weak of light) {
          note(
            run,
            `contrast light ${weak.ratio}<${String(weak.need)} ${weak.where} "${weak.text}" ${weak.fg} on ${weak.bg}`,
          );
        }
        await page.emulateMedia({ colorScheme: 'dark' });
        await expect(page.locator('html')).toHaveClass(/(^|\s)dark(\s|$)/);
        await page.waitForTimeout(400);
        take(run, 'dark', await page.evaluate(measure, size.touch));
        const dark = await page.evaluate(contrastOf, ['#content', 'nav']);
        for (const weak of dark) {
          note(
            run,
            `contrast dark ${weak.ratio}<${String(weak.need)} ${weak.where} "${weak.text}" ${weak.fg} on ${weak.bg}`,
          );
        }
        if (size.width < 768) {
          const more = page
            .getByRole('navigation', { name: m.nav.label })
            .getByRole('button', { name: m.nav.more, exact: true });
          await more.click();
          await expect(page.getByRole('dialog')).toBeVisible();
          await page.waitForTimeout(600);
          for (const weak of await page.evaluate(contrastOf, ['[role="dialog"]'])) {
            note(
              run,
              `contrast dark drawer ${weak.ratio}<${String(weak.need)} ${weak.where} "${weak.text}" ${weak.fg} on ${weak.bg}`,
            );
          }
        }
      } finally {
        await context.close();
        finish(run);
      }
    });

    test(`Difference detected: the page fits ${size.name} (${language})`, async ({ browser }) => {
      test.setTimeout(240_000);
      const context = await browser.newContext(contextOf(size, true));
      const page = await context.newPage();
      const run = startRun('integrity', page, size, language, 'difference');
      const t = run.m.integrity;
      // The batch that is altered, and what it cost before.
      const altered: { batch?: { id: unknown; cost: number } } = {};
      try {
        // One batch of stock arrives costing 10 dirham more than the purchase it came with. Every
        // pull that carries it again alters it the same way, so a second pull cannot undo it.
        await page.route(/\/api\/sync\/pull/, async (route) => {
          const response = await route.fetch();
          const body = (await response.json()) as {
            changes?: { entity: string; record: Record<string, unknown> }[];
          };
          for (const change of body.changes ?? []) {
            const cost = change.record.costTotalCents;
            if (change.entity !== 'product_batch' || typeof cost !== 'number') continue;
            altered.batch ??= { id: change.record.id, cost };
            if (change.record.id === altered.batch.id) {
              change.record.costTotalCents = altered.batch.cost + 1000;
            }
          }
          await route.fulfill({
            status: response.status(),
            contentType: 'application/json',
            body: JSON.stringify(body),
          });
        });
        await login(page, language);
        expectThat(
          run,
          altered.batch !== undefined,
          'no batch of stock came with the records to alter',
        );

        await page.goto('/integrity');
        await settle(page);
        const verdict = page.getByRole('status').filter({
          has: page.getByRole('heading', { level: 2, name: t.status.difference, exact: true }),
        });
        await expect(verdict).toBeVisible();
        await expect(verdict.getByText(t.status.heldMore, { exact: true })).toBeVisible();
        const review = verdict.getByRole('link', { name: t.status.reviewChanges });
        await expect(review).toBeVisible();
        const gap = await verdict
          .locator('dl > div')
          .filter({ hasText: t.status.gap })
          .locator('dd')
          .innerText();
        note(run, `the difference shown: ${gap}`);
        expectThat(
          run,
          /\b(200|10)\b/.test(gap),
          `the difference shown is "${gap}", not 10 dirham`,
        );
        await expect(page.getByRole('region', { name: t.holdings, exact: true })).toBeVisible();
        take(run, 'page', await page.evaluate(measure, size.touch));

        // The way to the latest changes lands on them, with the heading in view.
        await review.click();
        await page.waitForTimeout(600);
        const top = await page
          .locator('#integrity-latest-changes')
          .evaluate((el) => el.getBoundingClientRect().top);
        expectThat(
          run,
          top >= -1 && top < size.height,
          `the review link leaves the latest changes at ${String(Math.round(top))}px of ${String(size.height)}`,
        );
      } finally {
        await context.close();
        finish(run);
      }
    });

    test(`Unable to verify: the page fits ${size.name} (${language})`, async ({ browser }) => {
      test.setTimeout(180_000);
      const context = await browser.newContext(contextOf(size, true));
      const page = await context.newPage();
      const run = startRun('integrity', page, size, language, 'unable');
      const t = run.m.integrity;
      try {
        // The shop's records never reach this device.
        await page.route(/\/api\/sync\/pull/, (route) => route.abort());
        await setDeviceLanguage(page, language);
        await page.goto('/login');
        await page.locator('input[autocomplete="username"]').fill(E2E.owner.username);
        await page.locator('input[autocomplete="current-password"]').fill(E2E.owner.password);
        await page.locator('button[type="submit"]').click();
        await expect(page).toHaveURL(/\/home$/);

        await page.goto('/integrity');
        await settle(page);
        const verdict = page.getByRole('status').filter({
          has: page.getByRole('heading', { level: 2, name: t.status.unable, exact: true }),
        });
        await expect(verdict).toBeVisible();
        await expect(verdict.getByText(t.status.unableNotReceived, { exact: true })).toBeVisible();
        await expect(verdict.getByRole('button', { name: t.status.checkAgain })).toBeVisible();
        // Nothing is said about the figures, and no count can be made without them.
        await expect(page.getByRole('region', { name: t.holdings, exact: true })).toHaveCount(0);
        await expect(page.getByRole('button', { name: t.count })).toBeDisabled();
        take(run, 'page', await page.evaluate(measure, size.touch));
      } finally {
        await context.close();
        finish(run);
      }
    });
  }
}
