import { expect, test, type Page } from '@playwright/test';
import { ar } from '../src/i18n/ar';
import { en } from '../src/i18n/en';
import { setDeviceLanguage } from './helpers';
import { contextOf } from './responsive-run';
import { type Language, LANGUAGES, SIZES } from './responsive-kit';
import { E2E } from './stack';

/**
 * The page search of the shop's sidebar (`NavPalette`): the field at the top of the sidebar and
 * Ctrl K both open it. It only reads, so it leaves the shared database as it found it.
 */

function catalog(language: Language) {
  return language === 'ar' ? ar : en;
}

/** Signs in in `language`, finding the fields by their type rather than their label. */
async function signInIn(page: Page, language: Language): Promise<void> {
  await setDeviceLanguage(page, language);
  await page.goto('/login');
  await page.locator('input[autocomplete="username"]').fill(E2E.owner.username);
  await page.locator('input[autocomplete="current-password"]').fill(E2E.owner.password);
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/home$/);
}

for (const language of LANGUAGES) {
  test(`the sidebar search opens, says when nothing matches, and takes you to a page (${language})`, async ({
    page,
  }) => {
    const t = catalog(language);
    // The palette once threw on opening, which took the whole shop screen down with it.
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await signInIn(page, language);

    const field = page.getByRole('button', { name: t.shell.pagesSearch });
    await field.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const input = dialog.getByPlaceholder(t.shell.pagesPlaceholder);
    await expect(input).toBeFocused();

    // A word that matches no page says so.
    await input.fill('zzzzqq');
    await expect(dialog.getByText(t.shell.searchEmpty)).toBeVisible();

    // Escape closes it and gives the keyboard back to the field.
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(field).toBeFocused();

    // Ctrl K opens it from anywhere; a second press closes it.
    await page.keyboard.press('Control+k');
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Control+k');
    await expect(dialog).toBeHidden();

    // The name of a page, then Enter: the page opens and the search closes.
    await page.keyboard.press('Control+k');
    await dialog.getByPlaceholder(t.shell.pagesPlaceholder).fill(t.nav.inventory);
    await expect(dialog.getByRole('option', { name: t.nav.inventory })).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/inventory(\/|\?|$)/);
    await expect(dialog).toBeHidden();

    expect(errors).toEqual([]);
  });
}

test('on a touch tablet the search field and the pages it lists are full-size touch targets', async ({
  browser,
}) => {
  const size = SIZES.find((candidate) => candidate.name === 'tablet-landscape');
  if (!size) throw new Error('The tablet-landscape size is missing from SIZES.');
  const context = await browser.newContext(contextOf(size));
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await signInIn(page, 'ar');

  const field = page.getByRole('button', { name: ar.shell.pagesSearch });
  expect((await field.boundingBox())?.height).toBeGreaterThanOrEqual(44);

  await field.tap();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toBeInViewport({ ratio: 1 });
  // The dialog zooms in as it opens, which scales what is measured, so wait for it to settle.
  const option = dialog.getByRole('option').first();
  await expect
    .poll(async () => (await option.boundingBox())?.height ?? 0)
    .toBeGreaterThanOrEqual(44);

  expect(errors).toEqual([]);
  await context.close();
});
