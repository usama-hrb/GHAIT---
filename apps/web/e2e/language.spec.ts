import { expect, type Page, test } from '@playwright/test';
import { E2E } from './stack';

const storedLanguage = (page: Page) => page.evaluate(() => localStorage.getItem('fabric.language'));

test('English is the default; the language icon switches to Arabic and back, and the device keeps the choice', async ({
  page,
}) => {
  // A device nobody has chosen on: English, left to right.
  await page.goto('/login');
  const html = page.locator('html');
  await expect(html).toHaveAttribute('lang', 'en');
  await expect(html).toHaveAttribute('dir', 'ltr');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  expect(await storedLanguage(page)).toBeNull();

  // The icon opens the list of languages; Arabic turns the page around.
  await page.getByRole('button', { name: 'Language', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'العربية' }).click();
  await expect(html).toHaveAttribute('lang', 'ar');
  await expect(html).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { name: 'تسجيل الدخول' })).toBeVisible();
  expect(await storedLanguage(page)).toBe('ar');

  // The choice survives a reload, and is applied before the page is shown.
  await page.reload();
  await expect(html).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { name: 'تسجيل الدخول' })).toBeVisible();
  await expect(html).not.toHaveAttribute('data-lang-pending');

  // Signed in, the shop reads Arabic and the menu sits on the right.
  await page.getByLabel('اسم المستخدم').fill(E2E.owner.username);
  await page.getByLabel('كلمة المرور').fill(E2E.owner.password);
  await page.getByRole('button', { name: 'دخول' }).click();
  await expect(page).toHaveURL(/\/home$/);
  const sidebar = page.locator('[data-slot="sidebar"]').first();
  await expect(sidebar).toHaveAttribute('data-side', 'right');
  await expect(sidebar.getByRole('link', { name: 'المخزون', exact: true })).toBeVisible();

  // Back to English from the header: the text, the direction and the side of the menu follow.
  await page.getByRole('button', { name: 'اللغة', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'English' }).click();
  await expect(html).toHaveAttribute('lang', 'en');
  await expect(html).toHaveAttribute('dir', 'ltr');
  await expect(sidebar).toHaveAttribute('data-side', 'left');
  await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
  await expect(sidebar.getByRole('link', { name: 'Stock', exact: true })).toBeVisible();
  expect(await storedLanguage(page)).toBe('en');

  // The shop screens keep the choice too, after a reload and on another page.
  await page.goto('/pos');
  await expect(page.getByRole('heading', { level: 1, name: 'Sell' })).toBeVisible();
  await page.reload();
  await expect(html).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('heading', { level: 1, name: 'Sell' })).toBeVisible();
});
