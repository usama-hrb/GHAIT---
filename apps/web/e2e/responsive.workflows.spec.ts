import { expect, type Locator, type Page, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { ar } from '../src/i18n/ar';
import { en } from '../src/i18n/en';
import {
  type Finding,
  type Language,
  LANGUAGES,
  login,
  measure,
  type Size,
  settle,
  SIZES,
} from './responsive-kit';

/**
 * The responsive audit of what each page opens: dialogs, drawers, menus and pickers. The route
 * audit (`responsive.spec.ts`) measures pages; this one opens each overlay of a critical workflow
 * (the till, stock, expenses, people, accounts, a sale's void and return) and checks that it fits
 * the screen, that its footer buttons can be reached, that it does not scroll sideways and that,
 * with the keyboard of a phone taking half the screen, the field being typed in and the buttons stay
 * in view. It runs after the route audit's seed and, like it, only with `RESPONSIVE_AUDIT=1`.
 * `RESPONSIVE_REPORT=<file>` writes the findings, `RESPONSIVE_SIZES` and `RESPONSIVE_LANGS` narrow it.
 */

test.skip(
  process.env.RESPONSIVE_AUDIT !== '1',
  'The responsive audit seeds shared data: run it alone with RESPONSIVE_AUDIT=1',
);
test.describe.configure({ mode: 'serial' });

type Catalog = typeof en;
const catalogs: Record<Language, Catalog> = { en, ar };

interface Context {
  page: Page;
  m: Catalog;
  size: Size;
  language: Language;
}

interface Result {
  findings: Finding[];
  scrollRegions: string[];
}
const report: Record<string, Result> = {};

/** Runs in the page: how an overlay sits in the window. */
function fitOf(element: Element): string[] {
  const problems: string[] = [];
  const box = element.getBoundingClientRect();
  const width = window.innerWidth;
  const height = window.innerHeight;
  if (box.left < -1 || box.right > width + 1) {
    problems.push(
      `sticks out sideways: ${String(Math.round(box.left))}..${String(Math.round(box.right))} of ${String(width)}`,
    );
  }
  if (box.top < -1 || box.bottom > height + 1) {
    problems.push(
      `sticks out vertically: ${String(Math.round(box.top))}..${String(Math.round(box.bottom))} of ${String(height)}`,
    );
  }
  const html = element as HTMLElement;
  if (html.scrollWidth > html.clientWidth + 1) {
    problems.push(`scrolls sideways: ${String(html.scrollWidth)} in ${String(html.clientWidth)}`);
  }
  // The buttons that finish the task (the footer's, or any button at the bottom of the overlay).
  const buttons = [...element.querySelectorAll<HTMLElement>('button, a[href]')].filter((b) => {
    const rect = b.getBoundingClientRect();
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      b.closest('[data-slot="dialog-footer"], footer, [data-slot="drawer-footer"]') !== null
    );
  });
  for (const button of buttons) {
    const rect = button.getBoundingClientRect();
    if (rect.top < -1 || rect.bottom > height + 1 || rect.left < -1 || rect.right > width + 1) {
      problems.push(`a footer button is out of view: "${button.textContent.trim().slice(0, 30)}"`);
    }
  }
  return problems;
}

/** Runs in the page: the field with the focus is inside the window. */
function focusFit(): string[] {
  const field = document.activeElement;
  if (!field || !(field instanceof HTMLElement) || field === document.body) return [];
  const box = field.getBoundingClientRect();
  const height = window.innerHeight;
  return box.bottom > height + 1 || box.top < -1
    ? [
        `the focused field is out of view: ${String(Math.round(box.top))}..${String(Math.round(box.bottom))} of ${String(height)}`,
      ]
    : [];
}

function record(c: Context, name: string, findings: Finding[], notes: string[] = []): void {
  report[`${c.size.name}/${c.language} ${name}`] = { findings, scrollRegions: notes };
}

function problem(where: string, detail: string): Finding {
  return { kind: 'offscreen', where, detail };
}

/**
 * Measures the overlay that is open now: its fit, the page measurement with it open (targets,
 * clipped text) and, on a touch screen with a text field, the same with the keyboard up.
 * Returns false when no overlay is open.
 */
async function check(c: Context, name: string, selector = '[role="dialog"]'): Promise<boolean> {
  const { page, size } = c;
  await page.waitForTimeout(450);
  const overlay: Locator = page.locator(selector).filter({ visible: true }).last();
  if ((await overlay.count()) === 0) {
    record(c, name, [], ['(did not open)']);
    return false;
  }
  const findings: Finding[] = [];
  for (const detail of await overlay.evaluate(fitOf)) findings.push(problem(name, detail));
  const measured = await page.evaluate(measure, size.touch);
  findings.push(...measured.findings.filter((f) => f.kind !== 'tiny-text'));

  // A phone's keyboard takes about 45% of a portrait screen and shrinks the page behind it
  // (`interactiveWidget: resizes-content`), so the same window with less height is the keyboard.
  const field = overlay
    .locator(
      'input:not([type="checkbox"]):not([type="radio"]):not([inputmode="none"]):not([readonly]), textarea',
    )
    .first();
  if (size.touch && size.width < 800 && (await field.count()) > 0 && (await field.isVisible())) {
    await field.focus();
    await page.setViewportSize({ width: size.width, height: Math.round(size.height * 0.55) });
    await page.waitForTimeout(300);
    await field.focus();
    for (const detail of await overlay.evaluate(fitOf))
      findings.push(problem(`${name} with the keyboard up`, detail));
    for (const detail of await page.evaluate(focusFit))
      findings.push(problem(`${name} with the keyboard up`, detail));
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.waitForTimeout(200);
  }
  record(c, name, findings, measured.scrollRegions);
  return true;
}

/** Closes what is open (Escape twice covers a menu over a dialog). */
async function dismiss(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  if ((await page.locator('[role="dialog"]').filter({ visible: true }).count()) > 0) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
  }
}

/** A flow that cannot continue is a note in the report, never a failed test: it names what it needed. */
async function attempt(c: Context, name: string, flow: () => Promise<void>): Promise<void> {
  try {
    await flow();
  } catch (error) {
    record(
      c,
      `${name} (flow stopped)`,
      [],
      [String(error instanceof Error ? error.message : error).split('\n')[0] ?? ''],
    );
    await dismiss(c.page).catch(() => undefined);
  }
}

async function tillFlow(c: Context): Promise<void> {
  const { page, m, size } = c;
  await page.goto('/pos');
  await settle(page);
  const tile = page
    .getByRole('region', { name: m.pos.title, exact: true })
    .getByRole('button', { name: /كتان - أحمر|حرير - أزرق/ })
    .first();
  await tile.click();
  await check(c, 'pos: line dialog');
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(m.pos.fields.length, { exact: true }).fill('2');
  await dialog.getByRole('button', { name: m.pos.addLine }).click();
  await expect(dialog).toBeHidden();

  // On a phone or portrait tablet the bill is a drawer behind a bar at the bottom of the screen.
  const bar = page.getByRole('button', { name: new RegExp(`^${m.pos.bill.open} ·`) });
  if (await bar.isVisible()) {
    await bar.click();
    await check(c, 'pos: bill drawer');
  }
  await page.getByRole('button', { name: m.pos.bill.addDiscount }).click();
  await check(c, 'pos: discount dialog');
  await dismiss(page);
  await page.getByRole('button', { name: m.pos.bill.partialPay }).click();
  await check(c, 'pos: payment dialog');
  await dismiss(page);

  await page.getByLabel(m.pos.fields.customer, { exact: true }).click();
  await check(c, 'pos: customer picker', '[role="listbox"], [cmdk-list]');
  await dismiss(page);
  await page.getByRole('button', { name: m.customers.add }).click();
  await check(c, 'pos: new customer dialog');
  await dismiss(page);
  if (size.width < 1024) await dismiss(page);
}

async function opens(
  c: Context,
  name: string,
  route: string,
  opener: () => Locator,
): Promise<void> {
  await attempt(c, name, async () => {
    await c.page.goto(route);
    await settle(c.page);
    await opener().first().click();
    await check(c, name);
    await dismiss(c.page);
  });
}

async function stockFlows(c: Context): Promise<void> {
  const { page, m } = c;
  await opens(c, 'inventory: new product dialog', '/inventory', () =>
    page.getByRole('button', { name: m.productStock.newProduct }),
  );

  await attempt(c, 'inventory: product page overlays', async () => {
    await page.goto('/inventory');
    await settle(page);
    const href = await page
      .locator('a[href^="/inventory/product?id="]')
      .first()
      .getAttribute('href');
    if (href === null) throw new Error('no product to open');
    await page.goto(href);
    await settle(page);
    const restock = page.getByRole('button', { name: m.productStock.restock.title });
    if (await restock.first().isVisible()) {
      // A phone or portrait tablet opens the restock form as a drawer; wider, it is a side panel.
      if (c.size.width < 1024) {
        await restock.first().click();
        await check(c, 'inventory: restock drawer');
        await dismiss(page);
      } else {
        await check(c, 'inventory: restock side panel', 'aside');
      }
    }
    const batchActions = page.getByRole('button', {
      name: new RegExp(m.productStock.actions.batchActions),
    });
    if ((await batchActions.count()) > 0) {
      await batchActions.first().click();
      await check(c, 'inventory: batch actions menu', '[role="menu"]');
      await page.getByRole('menuitem', { name: m.productStock.actions.loss }).click();
      await check(c, 'inventory: stock loss dialog');
      await dismiss(page);
    }
  });
}

async function moneyFlows(c: Context): Promise<void> {
  const { page, m } = c;
  await opens(c, 'expenses: new expense dialog', '/expenses', () =>
    page.getByRole('button', { name: m.expenses.add }),
  );
  await opens(c, 'integrity: cash count dialog', '/integrity', () =>
    page.getByRole('button', { name: m.integrity.count }),
  );
  await opens(c, 'customers: new customer dialog', '/customers', () =>
    page.getByRole('button', { name: m.customers.add }),
  );
  await opens(c, 'payables: new supplier dialog', '/payables', () =>
    page.getByRole('button', { name: m.payables.add }),
  );
}

async function peopleFlows(c: Context): Promise<void> {
  const { page, m } = c;
  await opens(c, 'partners: new employee dialog', '/settings/partners?tab=employees', () =>
    page.getByRole('button', { name: m.partners.employees.add }),
  );
  await attempt(c, 'partners: exit center', async () => {
    await page.goto('/settings/partners');
    await settle(page);
    await page.getByRole('button', { name: m.partners.cardMenu }).last().click();
    await page.getByRole('menuitem', { name: m.partners.exit.start }).click();
    await check(c, 'partners: exit center');
    await dismiss(page);
  });
  await attempt(c, 'accounts: new cashier and its credentials', async () => {
    await page.goto('/settings/accounts');
    await settle(page);
    await page.getByRole('button', { name: m.userAccounts.create.cashier }).first().click();
    const dialog = page.getByRole('dialog');
    await check(c, 'accounts: new cashier dialog');
    await dialog
      .locator('input')
      .first()
      .fill(`caissier-${c.size.name}-${c.language}-${Date.now().toString(36)}`);
    await dialog.locator('[data-slot="dialog-footer"] button').last().click();
    await check(c, 'accounts: temporary password dialog');
  });
}

async function saleFlows(c: Context): Promise<void> {
  const { page, m } = c;
  await attempt(c, 'sale page: void and return dialogs', async () => {
    await page.goto('/pos/history');
    await settle(page);
    const direct = page.locator('a[href^="/pos/view?id="]').first();
    if ((await direct.count()) === 0) {
      await page.locator('main button[aria-haspopup="dialog"]').first().click();
      await page.locator('a[href^="/pos/view?id="]').first().waitFor();
    }
    const href = await page.locator('a[href^="/pos/view?id="]').first().getAttribute('href');
    if (href === null) throw new Error('no sale to open');
    await page.goto(href);
    await settle(page);
    await page.getByRole('button', { name: m.sales.returnAction }).first().click();
    await check(c, 'sale: return dialog');
    await dismiss(page);
    await page.getByRole('button', { name: m.sales.voidAction }).first().click();
    await check(c, 'sale: void dialog');
    await dismiss(page);
  });
  await attempt(c, 'header: command palette', async () => {
    await page.goto('/home');
    await settle(page);
    await page.keyboard.press('Control+k');
    await check(c, 'header: command palette');
    await dismiss(page);
  });
}

for (const language of LANGUAGES) {
  for (const size of SIZES) {
    const sizes = (process.env.RESPONSIVE_SIZES ?? '').split(',').filter(Boolean);
    const languages = (process.env.RESPONSIVE_LANGS ?? '').split(',').filter(Boolean);
    if (sizes.length > 0 && !sizes.includes(size.name)) continue;
    if (languages.length > 0 && !languages.includes(language)) continue;

    test(`every overlay fits ${size.name} (${language})`, async ({ browser }) => {
      test.setTimeout(420_000);
      const context = await browser.newContext({
        viewport: { width: size.width, height: size.height },
        isMobile: size.touch,
        hasTouch: size.touch,
        deviceScaleFactor: size.touch ? 2 : 1,
      });
      const page = await context.newPage();
      await login(page, language);
      const c: Context = { page, m: catalogs[language], size, language };

      await attempt(c, 'pos', () => tillFlow(c));
      await attempt(c, 'stock', () => stockFlows(c));
      await attempt(c, 'money', () => moneyFlows(c));
      await attempt(c, 'people', () => peopleFlows(c));
      await attempt(c, 'sales', () => saleFlows(c));
      await context.close();

      const mine = Object.fromEntries(
        Object.entries(report).filter(([name]) => name.startsWith(`${size.name}/${language} `)),
      );
      if (process.env.RESPONSIVE_REPORT) {
        writeFileSync(
          `${process.env.RESPONSIVE_REPORT}.workflows.${size.name}.${language}.json`,
          JSON.stringify(mine, null, 1),
        );
      }
      const hard = Object.entries(mine).flatMap(([name, entry]) =>
        entry.findings
          .filter(
            (f) => f.kind === 'offscreen' || f.kind === 'tiny-target' || f.kind === 'doc-overflow',
          )
          .map((f) => `${name}: ${f.kind} ${f.where} ${f.detail}`),
      );
      if (!process.env.RESPONSIVE_SOFT) expect(hard).toEqual([]);
    });
  }
}
