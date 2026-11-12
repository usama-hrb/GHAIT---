import { expect, type Locator, type Page, test } from '@playwright/test';
import { ar } from '../src/i18n/ar';
import { en } from '../src/i18n/en';
import { addProduct, connectivity, restock, signIn, waitForAppShell } from './helpers';
import { type Language, login, measure, settle } from './responsive-kit';

/**
 * The selling dialog of the till (the quantity and the price of one product), on every kind of
 * screen: a desktop and a tablet type on the keypad beside the fields, a phone has no keypad and
 * types with its own numeric keyboard. It measures the dialog in the browser (no screenshot): that
 * it is as tall as its content, fits the window, keeps its footer in reach, and that the owner's
 * two confirmations (under the minimum, under the cost) still work and are asked once.
 */

test.describe.configure({ mode: 'serial' });

const stamp = Date.now().toString(36);
const LONG = `ميلان ${stamp}`;
const SHORT = `قصير ${stamp}`;

interface Setup {
  name: string;
  width: number;
  height: number;
  language: Language;
  scheme: 'light' | 'dark';
  /** A phone: no keypad, the system keyboard. */
  phone: boolean;
}

const SETUPS: readonly Setup[] = [
  { name: 'desktop', width: 1440, height: 900, language: 'ar', scheme: 'light', phone: false },
  {
    name: 'tablet-landscape',
    width: 1280,
    height: 800,
    language: 'en',
    scheme: 'dark',
    phone: false,
  },
  {
    name: 'tablet-portrait',
    width: 800,
    height: 1280,
    language: 'ar',
    scheme: 'dark',
    phone: false,
  },
  { name: 'phone-320', width: 320, height: 720, language: 'ar', scheme: 'dark', phone: true },
  { name: 'phone-375', width: 375, height: 812, language: 'en', scheme: 'light', phone: true },
  { name: 'phone-390', width: 390, height: 844, language: 'ar', scheme: 'light', phone: true },
  { name: 'phone-430', width: 430, height: 932, language: 'en', scheme: 'dark', phone: true },
];

/** Keys of the keypad, tapped one by one like a finger would. */
async function tap(dialog: Locator, m: typeof en, keys: string): Promise<void> {
  const pad = dialog.getByRole('group', { name: m.keypad.label });
  for (const key of keys) {
    await pad
      .getByRole('button', { name: key === '.' ? m.keypad.decimal : key, exact: true })
      .click();
  }
}

/** What the dialog looks like, measured in the page. */
interface Fit {
  dialog: { top: number; bottom: number; left: number; right: number };
  inside: boolean;
  /** The body's height beyond what its fields need (a fixed-height dialog leaves a gap here). */
  emptyBelowFields: number;
  bodyScrolls: boolean;
  footerInView: boolean;
}

async function fitOf(page: Page): Promise<Fit> {
  return page.evaluate(() => {
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    if (!dialog) throw new Error('no dialog');
    const box = dialog.getBoundingClientRect();
    const body = dialog.querySelector<HTMLElement>('.overflow-y-auto');
    const fields = body?.firstElementChild?.getBoundingClientRect();
    const footer = dialog.querySelector<HTMLElement>('[data-slot="dialog-footer"]');
    const footerBox = footer?.getBoundingClientRect();
    return {
      dialog: { top: box.top, bottom: box.bottom, left: box.left, right: box.right },
      inside:
        box.left >= -1 &&
        box.right <= window.innerWidth + 1 &&
        box.top >= -1 &&
        box.bottom <= window.innerHeight + 1,
      emptyBelowFields: body && fields ? body.clientHeight - fields.height : 0,
      bodyScrolls: body ? body.scrollHeight > body.clientHeight + 1 : false,
      footerInView:
        footerBox !== undefined &&
        footerBox.top >= -1 &&
        footerBox.bottom <= window.innerHeight + 1,
    };
  });
}

test('seed: a product with two batches and one with 2.8 m left', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);
  await waitForAppShell(page);
  const long = await addProduct(page, { name: LONG, price: '400', min: '360' });
  await restock(page, long, { quantity: '30', cost: '330' });
  await addProduct(page, { name: SHORT, stock: { quantity: '2.8', cost: '320' } });
  // The other devices read what the server has: wait until nothing is waiting to be sent.
  await expect(connectivity(page)).not.toContainText(/معلّق/);
});

for (const setup of SETUPS) {
  test(`the selling dialog on ${setup.name} (${setup.language}, ${setup.scheme})`, async ({
    browser,
  }) => {
    test.setTimeout(150_000);
    const m = setup.language === 'ar' ? ar : en;
    const context = await browser.newContext({
      viewport: { width: setup.width, height: setup.height },
      isMobile: setup.name !== 'desktop',
      hasTouch: setup.name !== 'desktop',
      colorScheme: setup.scheme,
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    await login(page, setup.language);
    await page.goto('/pos');
    await settle(page);
    await expect(page.locator('html')).toHaveAttribute(
      'dir',
      setup.language === 'ar' ? 'rtl' : 'ltr',
    );
    expect(await page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(
      setup.scheme === 'dark',
    );

    await page
      .getByRole('button', { name: new RegExp(LONG) })
      .first()
      .click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await page.waitForTimeout(400);

    const length = dialog.getByLabel(m.pos.fields.length, { exact: true });
    const price = dialog.getByLabel(m.pos.fields.pricePerMeter, { exact: true });
    const total = dialog.getByRole('status').filter({ hasText: m.pos.line.lineTotal });
    const add = dialog.getByRole('button', { name: m.pos.addLine });
    const keypad = dialog.getByRole('group', { name: m.keypad.label });

    // The dialog: inside the window, as tall as its content, the footer in reach, nothing sideways.
    const fit = await fitOf(page);
    expect(fit.inside, JSON.stringify(fit)).toBe(true);
    expect(fit.footerInView, JSON.stringify(fit)).toBe(true);
    expect(fit.emptyBelowFields, 'a gap under the fields').toBeLessThanOrEqual(2);
    if (!setup.phone) expect(fit.bodyScrolls, 'the body scrolls on a roomy screen').toBe(false);
    const measured = await page.evaluate(measure, setup.name !== 'desktop');
    const hard = measured.findings.filter(
      (finding) =>
        finding.kind === 'offscreen' ||
        finding.kind === 'doc-overflow' ||
        finding.kind === 'tiny-target',
    );
    expect(hard).toEqual([]);

    if (setup.phone) {
      // No keypad at all (not hidden: absent), the system keyboard with a decimal point.
      await expect(keypad).toHaveCount(0);
      await expect(dialog.getByRole('button', { name: '7', exact: true })).toHaveCount(0);
      await expect(length).toHaveAttribute('inputmode', 'decimal');
      await expect(price).toHaveAttribute('inputmode', 'decimal');

      // Real key presses: a decimal, backspace, retyping over a selection, a pasted comma decimal.
      await length.click();
      await page.keyboard.type('2.75');
      await expect(length).toHaveValue('2.75');
      await page.keyboard.press('Backspace');
      await expect(length).toHaveValue('2.7');
      await page.keyboard.type('5');
      await expect(length).toHaveValue('2.75');
      await page.keyboard.press('ControlOrMeta+A');
      await page.keyboard.type('3');
      await expect(length).toHaveValue('3');
      await page.keyboard.press('ControlOrMeta+A');
      await page.keyboard.insertText('2,5');
      await expect(length).toHaveValue('2,5');
      await expect(total).toContainText('1,000');
    } else {
      // The keypad beside the fields (at the end of the line: left in Arabic), the field has no system keyboard.
      await expect(keypad).toBeVisible();
      await expect(length).toHaveAttribute('inputmode', 'none');
      const pad = await keypad.boundingBox();
      const field = await length.boundingBox();
      if (!pad || !field) throw new Error('no boxes');
      if (setup.language === 'ar') expect(pad.x).toBeLessThan(field.x);
      else expect(pad.x).toBeGreaterThan(field.x);
      expect(pad.height).toBeLessThan(300);

      await tap(dialog, m, '2.75');
      await expect(length).toHaveValue('2.75');
      await dialog.getByRole('button', { name: m.keypad.backspace }).click();
      await expect(length).toHaveValue('2.7');
      // A physical keyboard types in the field too.
      await length.fill('2.5');
      await expect(length).toHaveValue('2.5');
      await expect(total).toContainText('1,000');
    }

    // The quick lengths fill the field (2.5 and 3 m: this product has 80 m).
    await dialog.getByRole('button', { name: new RegExp(`^3 ${m.units.meter}`) }).click();
    await expect(length).toHaveValue('3');
    await dialog.getByRole('button', { name: new RegExp(`^2.5 ${m.units.meter}`) }).click();
    await expect(length).toHaveValue('2.5');

    // The price: the normal one is filled; a negotiated one is typed (the keypad: the first digit
    // replaces what the field holds; a phone: the system keyboard); the reference button fills it back.
    const normal = dialog.getByRole('button', {
      name: new RegExp(`^${m.pos.line.referencePrice}`),
    });
    const setPrice = async (text: string) => {
      if (setup.phone) {
        await price.fill(text);
        return;
      }
      await normal.click();
      await tap(dialog, m, text);
    };
    await expect(price).toHaveValue('400');
    await setPrice('380');
    await expect(price).toHaveValue('380');
    await expect(total).toContainText('950');
    await expect(add).toBeEnabled();

    // Under the minimum (360): the owner confirms once; the line cannot be added before.
    await setPrice('350');
    await expect(price).toHaveValue('350');
    const minimum = dialog.getByRole('alert').filter({ hasText: m.pos.minimum.title });
    await expect(minimum).toBeVisible();
    await expect(add).toBeDisabled();
    await dialog.getByRole('switch', { name: m.pos.minimum.confirm }).click();
    await expect(add).toBeEnabled();
    // The strip is a line, not a banner: one row of text and the switch (two rows of text on a 320 px phone).
    expect((await minimum.boundingBox())?.height ?? 999).toBeLessThan(setup.phone ? 120 : 90);

    // Under the cost (320 a metre for the oldest batch): another price asks again, and apart.
    await setPrice('300');
    await expect(price).toHaveValue('300');
    await expect(minimum.getByRole('switch')).not.toBeChecked();
    await expect(add).toBeDisabled();
    await dialog.getByRole('switch', { name: m.pos.minimum.confirm }).click();
    const cost = dialog.getByRole('alert').filter({ hasText: m.pos.belowCostTitle });
    await expect(cost).toBeVisible();
    await expect(add).toBeDisabled();
    await dialog.getByRole('switch', { name: m.pos.confirmBelowCost }).click();
    await expect(add).toBeEnabled();
    // No profit or margin anywhere in the selling dialog.
    await expect(dialog.getByText(m.pos.profit, { exact: false })).toHaveCount(0);

    // Back to a price that needs no one: both strips go.
    await normal.click();
    await expect(price).toHaveValue('400');
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    await expect(add).toBeEnabled();

    // A batch: the oldest first by default; the second one chosen by hand.
    const batch = dialog.getByRole('combobox', { name: m.pos.fields.batch });
    await expect(batch).toContainText(m.pos.fields.batchAuto);
    await batch.click();
    const options = page.getByRole('option');
    await expect(options).toHaveCount(3);
    await options.last().click();
    await expect(batch).not.toContainText(m.pos.fields.batchAuto);
    await expect(
      dialog.getByRole('status').filter({ hasText: m.pos.splitAcross(1) }),
    ).toBeVisible();

    // With the keyboard of a phone up (a shorter window) the field in use and the buttons stay in view.
    if (setup.phone) {
      await price.focus();
      await page.setViewportSize({ width: setup.width, height: Math.round(setup.height * 0.55) });
      await page.waitForTimeout(300);
      await price.evaluate((el) => {
        el.scrollIntoView({ block: 'nearest' });
      });
      const up = await fitOf(page);
      expect(up.inside, `keyboard up: ${JSON.stringify(up)}`).toBe(true);
      expect(up.footerInView, `keyboard up: ${JSON.stringify(up)}`).toBe(true);
      const field = await price.boundingBox();
      expect(
        field && field.y >= 0 && field.y + field.height <= Math.round(setup.height * 0.55),
      ).toBe(true);
      await page.setViewportSize({ width: setup.width, height: setup.height });
    }

    await add.click();
    await expect(dialog).toBeHidden();
    await context.close();
  });
}

test('quick lengths are offered only when the stock covers them', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, 'ar');
  await page.goto('/pos');
  await settle(page);
  await page
    .getByRole('button', { name: new RegExp(SHORT) })
    .first()
    .click();
  const dialog = page.getByRole('dialog');
  // 2.8 m left: 2.5 m can be asked for, 3 m cannot.
  await expect(dialog.getByRole('button', { name: /^2.5 م/ })).toBeVisible();
  await expect(dialog.getByRole('button', { name: /^3 م/ })).toHaveCount(0);
  await dialog.getByLabel('الطول', { exact: true }).fill('3');
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'أضف إلى الفاتورة' })).toBeDisabled();
});
