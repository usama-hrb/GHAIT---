import { expect, test } from '@playwright/test';
import { ar } from '../src/i18n/ar';
import { en } from '../src/i18n/en';
import { setDeviceLanguage, signIn } from './helpers';
import { contextOf } from './responsive-run';
import { contrastOf, LANGUAGES, measure, SIZES, settle } from './responsive-kit';

/**
 * The page for an address that matches no screen (`app/not-found.tsx`). It reads nothing from
 * the database and writes nothing, so it can run anywhere in the suite and leaves the shared
 * database as it found it.
 */

const MISSING = '/this-page-does-not-exist';

test('an unknown address answers 404 with the page, and its language can be changed there', async ({
  page,
}) => {
  await setDeviceLanguage(page, 'ar');
  const response = await page.goto(MISSING);
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { level: 1, name: ar.notFound.title })).toBeVisible();
  await expect(page.getByText(ar.notFound.description)).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

  await page.getByRole('button', { name: 'Switch to English' }).click();
  await expect(page.getByRole('heading', { level: 1, name: en.notFound.title })).toBeVisible();
  await expect(page.getByText(en.notFound.description)).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
});

test('a page missing inside a known section shows it too, and the way out leads home', async ({
  page,
}) => {
  await signIn(page);
  const response = await page.goto('/inventory/no-such-page');
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { level: 1, name: ar.notFound.title })).toBeVisible();
  // One way out, and it is the page's one gold action.
  await expect(page.locator('[data-variant="accent"]')).toHaveCount(1);
  await page.getByRole('link', { name: ar.notFound.backToHome }).click();
  await expect(page).toHaveURL(/\/home$/);
});

for (const language of LANGUAGES) {
  for (const size of SIZES) {
    test(`the page fits ${size.name} (${language}), light and dark, with readable text`, async ({
      browser,
    }) => {
      const context = await browser.newContext({ ...contextOf(size), colorScheme: 'light' });
      const page = await context.newPage();
      await setDeviceLanguage(page, language);
      await page.goto(MISSING);
      await settle(page);

      for (const scheme of ['light', 'dark'] as const) {
        if (scheme === 'dark') {
          await page.emulateMedia({ colorScheme: 'dark' });
          await page.reload();
          await settle(page);
          await expect(page.locator('html')).toHaveClass(/(^|\s)dark(\s|$)/);
        }
        const measured = await page.evaluate(measure, size.touch);
        const hard = measured.findings.filter((finding) =>
          ['doc-overflow', 'offscreen', 'clipped', 'tiny-target', 'small-target'].includes(
            finding.kind,
          ),
        );
        expect(hard, `${scheme}: layout`).toEqual([]);
        expect(await page.evaluate(contrastOf, ['body']), `${scheme}: contrast`).toEqual([]);
        // The page never scrolls: its heading, the text and the button are all in view.
        await expect(
          page.getByRole('heading', { level: 1, name: catalog(language).notFound.title }),
        ).toBeInViewport();
        await expect(
          page.getByRole('link', { name: catalog(language).notFound.backToHome }),
        ).toBeInViewport();
      }
      await context.close();
    });
  }
}

function catalog(language: (typeof LANGUAGES)[number]) {
  return language === 'ar' ? ar : en;
}
