import { expect, type Page, test } from '@playwright/test';
import { setDeviceLanguage } from './helpers';
import { E2E, setupCodeVariable, SIGNUP_SHOPS } from './stack';

/**
 * The sign-up wizard on a shop made by the operator (ADR 0029, Step 6): the first step also asks
 * for the setup code, a wrong code is refused without losing what was typed, and the right one
 * makes the owner and the shop's settings. Needs a server with many shops (`E2E_SHOPS=adopted`,
 * e2e/global-setup.ts makes the two shops and their codes); on the one-shop server there is no
 * such shop and the code is not asked for.
 */
test.skip(process.env.E2E_SHOPS !== 'adopted', 'needs a multi-shop server: E2E_SHOPS=adopted');

const TEXT = {
  en: {
    title: 'Create your shop',
    code: 'Setup code',
    badShape: 'A setup code has 12 letters and digits',
    refused: 'This code did not work. Check it, or ask for a new one',
    fullName: 'Full name',
    email: 'Email',
    password: 'Password',
    confirm: 'Confirm password',
    next: 'Continue',
    shopName: 'Shop name',
    meter: /Meter \(m\)/,
    create: 'Create my shop',
    dir: 'ltr',
  },
  ar: {
    title: 'أنشئ محلّك',
    code: 'رمز الإعداد',
    badShape: 'رمز الإعداد من 12 حرفاً ورقماً',
    refused: 'لم يعمل هذا الرمز. تحقق منه، أو اطلب رمزاً جديداً',
    fullName: 'الاسم الكامل',
    email: 'البريد الإلكتروني',
    password: 'كلمة المرور',
    confirm: 'تأكيد كلمة المرور',
    next: 'متابعة',
    shopName: 'اسم المحل',
    meter: /متر \(m\)/,
    create: 'أنشئ محلّي',
    dir: 'rtl',
  },
} as const;

/** A code of the right shape that no shop has. */
const WRONG_CODE = '0000-0000-0000';

for (const shop of SIGNUP_SHOPS) {
  const t = TEXT[shop.language];

  test.describe(`a new shop, sign-up in ${shop.language === 'en' ? 'English' : 'Arabic'}`, () => {
    test.use({ baseURL: `http://${shop.host}:${String(E2E.webPort)}` });

    const next = (page: Page) => page.getByRole('button', { name: t.next }).click();

    test('the wizard asks for the code, refuses a wrong one and makes the owner with the right one', async ({
      page,
      request,
    }) => {
      const code = process.env[setupCodeVariable(shop.slug)];
      if (code === undefined) throw new Error(`no setup code for ${shop.slug}: see global-setup`);
      const ownerEmail = `owner-${shop.language}@example.com`;
      const shopName = shop.language === 'en' ? 'Dar Al Qomash' : 'دار القماش';
      // What the shop says of itself to anyone who asks, before and after (the API reads the
      // address the browser used from the proxy's header, as it does for the browser).
      const status = async () =>
        (
          await request.get(`${E2E.apiUrl}/auth/registration`, {
            headers: { 'x-forwarded-host': shop.host },
          })
        ).json() as Promise<{ open: boolean; setupCodeRequired?: boolean }>;
      expect(await status()).toMatchObject({ open: true, setupCodeRequired: true });

      await setDeviceLanguage(page, shop.language);
      await page.goto('/signup');
      await expect(page.getByRole('heading', { level: 1, name: t.title })).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('dir', t.dir);

      // Step 1: the code field is the first of the step, and what is typed is read for its shape.
      const codeField = page.getByLabel(t.code);
      await expect(codeField).toBeVisible();
      await next(page);
      await expect(codeField).toHaveAttribute('aria-invalid', 'true');
      await codeField.fill('abc');
      await next(page);
      await expect(page.getByText(t.badShape)).toBeVisible();
      await expect(page.getByLabel(t.fullName)).toBeVisible();

      // A code of the right shape that is wrong goes to the server, which refuses it as it would
      // refuse a closed sign-up. The wizard goes back to the code and keeps the rest.
      await codeField.fill(WRONG_CODE);
      await page.getByLabel(t.fullName).fill('Amina Alaoui');
      await page.getByLabel(t.email).fill(ownerEmail);
      await page.getByLabel(t.password, { exact: true }).fill('a long password for the owner');
      await page.getByLabel(t.confirm, { exact: true }).fill('a long password for the owner');
      await next(page);
      await page.getByLabel(t.shopName).fill(shopName);
      await next(page);
      await page.getByRole('switch', { name: t.meter }).click();
      await next(page);
      await page.getByRole('button', { name: t.create }).click();
      await expect(page.getByText(t.refused)).toBeVisible();
      await expect(codeField).toHaveAttribute('aria-invalid', 'true');
      await expect(page.getByLabel(t.fullName)).toHaveValue('Amina Alaoui');
      await expect(page).toHaveURL(/\/signup$/);
      // Nothing was made, and the shop still waits for its owner.
      expect(await status()).toMatchObject({ open: true, setupCodeRequired: true });

      // The same wrong code is not sent twice; the right one is read as typed by hand.
      await next(page);
      await expect(page.getByText(t.refused)).toBeVisible();
      await codeField.fill(code.toLowerCase().replaceAll('-', ' '));
      await expect(page.getByText(t.refused)).toBeHidden();
      for (let step = 0; step < 3; step += 1) await next(page);
      await page.getByRole('button', { name: t.create }).click();
      await expect(page).toHaveURL(/\/home$/);
      await expect(page.getByText(shopName).first()).toBeVisible();

      // The code is used up: the shop has its owner and no longer asks for a code.
      const after = await status();
      expect(after.open).toBe(false);
      expect(after.setupCodeRequired).toBeUndefined();
    });
  });
}
