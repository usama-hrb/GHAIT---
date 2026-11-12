import { randomUUID } from 'node:crypto';
import { type Browser, expect, type Page, test } from '@playwright/test';
import { ar } from '../src/i18n/ar';
import { serverPut, setDeviceLanguage, signIn } from './helpers';
import { E2E } from './stack';

/**
 * The owner's account management on the real stack (ADR 0024): cashier and partner accounts are
 * made, filtered, switched off and on and reset from Settings > Accounts; a new account must choose
 * its own password before anything else; a switched-off account is signed out at once; and a
 * partner or cashier never reaches the owner's pages. Accounts made here have unique names and are
 * left switched off at the end, so the other specs (one shared database) are not affected.
 */

const suffix = Date.now().toString(36);
const TEMPORARY = /^[A-Za-z0-9]{4}(-[A-Za-z0-9]{4}){3}$/;
const NEW_PASSWORD = 'a new password of the cashier';

async function openAccounts(page: Page): Promise<void> {
  await page.goto('/settings/accounts');
  await expect(page.getByRole('heading', { name: 'الحسابات', level: 2 })).toBeVisible();
  await expect(page.getByTestId('account-count')).toBeVisible();
}

const row = (page: Page, username: string) =>
  page.locator(`[data-testid="account-row"][data-username="${username}"]`);

/** Fills the dialog's name and username, submits, and returns the temporary password it shows once. */
async function createAccount(
  page: Page,
  opening: string,
  fields: { name: string; username: string },
): Promise<string> {
  await page.getByRole('button', { name: opening }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('الاسم الظاهر').fill(fields.name);
  await dialog.getByLabel('اسم المستخدم').fill(fields.username);
  await dialog.getByRole('button', { name: 'إنشاء الحساب' }).click();
  return acknowledgeCredential(page, fields.username);
}

/** Reads the one-time password out of the credential dialog and closes it. */
async function acknowledgeCredential(page: Page, username: string): Promise<string> {
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('credential-username')).toHaveText(username);
  const password = (await dialog.getByTestId('credential-password').textContent()) ?? '';
  expect(password).toMatch(TEMPORARY);
  // It cannot be dismissed by accident: Escape leaves it open.
  await page.keyboard.press('Escape');
  await expect(dialog.getByTestId('credential-password')).toBeVisible();
  await dialog.getByRole('button', { name: 'سلّمتها له' }).click();
  await expect(dialog).toHaveCount(0);
  return password;
}

async function signInOnly(page: Page, username: string, password: string): Promise<void> {
  await setDeviceLanguage(page, 'ar');
  await page.goto('/login');
  await page.getByLabel('اسم المستخدم').fill(username);
  await page.getByLabel('كلمة المرور', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'دخول' }).click();
}

/** A new browser profile signed in with a temporary password, ready on the change-password page. */
async function firstSignIn(browser: Browser, username: string, temporary: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await signInOnly(page, username, temporary);
  await expect(page).toHaveURL(/\/change-password$/);
  await expect(page.getByRole('heading', { name: 'اختر كلمة مرورك' })).toBeVisible();
  return page;
}

async function chooseOwnPassword(page: Page, temporary: string, own: string): Promise<void> {
  await page.getByLabel('كلمة المرور المؤقتة', { exact: true }).fill(temporary);
  await page.getByLabel('كلمة المرور الجديدة', { exact: true }).fill(own);
  await page.getByLabel('أعد كتابة كلمة المرور الجديدة', { exact: true }).fill(own);
  await page.getByRole('button', { name: 'حفظ ومتابعة' }).click();
  await expect(page).toHaveURL(/\/home$/);
}

test('the owner makes a cashier account that must choose its own password, then switches it off and on', async ({
  page,
  browser,
}) => {
  const username = `till.${suffix}`;
  await signIn(page);
  await openAccounts(page);

  // The owner's account and the seeded cashier are listed; the owner's has no menu.
  await expect(row(page, 'owner')).toContainText('المالك');
  await expect(row(page, 'owner').getByRole('button')).toHaveCount(0);
  await expect(row(page, 'cashier')).toContainText('العامل');

  // No limit and no partner is asked for: two cashiers in a row, with nothing else to pick.
  const temporary = await createAccount(page, 'عامل جديد', { name: 'Sara Till', username });
  await createAccount(page, 'عامل جديد', { name: 'Second Till', username: `second.${suffix}` });
  await expect(row(page, username)).toContainText('لم يختر كلمة مرور بعد');
  await expect(row(page, username).getByTestId('account-partner')).toHaveCount(0);

  // A username already taken (whatever the case) is said under the field; nothing is created.
  await page.getByRole('button', { name: 'عامل جديد' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('الاسم الظاهر').fill('Another');
  await dialog.getByLabel('اسم المستخدم').fill(username.toUpperCase());
  await dialog.getByRole('button', { name: 'إنشاء الحساب' }).click();
  await expect(dialog.getByText('اسم المستخدم هذا مستعمل في حساب آخر.').first()).toBeVisible();
  await dialog.getByRole('button', { name: 'إلغاء' }).click();

  // The cashier's first sign-in: nothing else opens until it chooses a password of its own.
  const till = await firstSignIn(browser, username, temporary);
  await till.goto('/pos');
  await expect(till).toHaveURL(/\/change-password$/);
  await till.getByLabel('كلمة المرور المؤقتة', { exact: true }).fill(temporary);
  await till.getByLabel('كلمة المرور الجديدة', { exact: true }).fill(NEW_PASSWORD);
  await till.getByLabel('أعد كتابة كلمة المرور الجديدة', { exact: true }).fill('another phrase!!');
  await till.getByRole('button', { name: 'حفظ ومتابعة' }).click();
  await expect(till.getByText('كلمتا المرور غير متطابقتين')).toBeVisible();
  await chooseOwnPassword(till, temporary, NEW_PASSWORD);

  // A cashier never reaches the accounts, however the address is typed.
  await till.goto('/settings/accounts');
  await expect(till.getByText('هذه الشاشة ليست لحساب العامل')).toBeVisible();
  const sections = till.getByRole('navigation', { name: 'أقسام الإعدادات' });
  await till.goto('/settings');
  await expect(sections.getByRole('link', { name: /الحسابات/ })).toHaveCount(0);

  // The owner's list no longer says it is waiting for a password.
  await page.reload();
  await expect(row(page, username)).not.toContainText('لم يختر كلمة مرور بعد');

  // Switching off asks why, signs the cashier out at once, and removes nothing.
  await row(page, username)
    .getByRole('button', { name: /إجراءات/ })
    .click();
  await page.getByRole('menuitem', { name: 'إيقاف', exact: true }).click();
  const off = page.getByRole('dialog');
  await expect(off).toContainText('لا يتغير شيء آخر');
  await off.getByRole('button', { name: 'إيقاف الحساب' }).click();
  await expect(off.getByText('اكتب سبب الإلغاء')).toBeVisible();
  await off.getByLabel('السبب').fill('left the shop');
  await off.getByRole('button', { name: 'إيقاف الحساب' }).click();
  await expect(row(page, username)).toHaveAttribute('data-status', 'inactive');

  // The device keeps its own data (offline-first) but the server refuses it: it stops syncing and
  // asks for a sign-in, which the switched-off account can no longer complete.
  await till.reload();
  await expect(till.getByText('سجّل الدخول للمزامنة').first()).toBeVisible();
  const refused = await (await browser.newContext()).newPage();
  await signInOnly(refused, username, NEW_PASSWORD);
  await expect(refused.getByText('تم إيقاف هذا الحساب')).toBeVisible();
  await expect(refused).toHaveURL(/\/login/);

  // Switching on again issues a new temporary password; the old one is dead.
  await row(page, username)
    .getByRole('button', { name: /إجراءات/ })
    .click();
  await page.getByRole('menuitem', { name: 'إعادة التفعيل' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'إعادة التفعيل' }).click();
  const again = await acknowledgeCredential(page, username);
  expect(again).not.toBe(temporary);
  await expect(row(page, username)).toHaveAttribute('data-status', 'active');
  await signInOnly(refused, username, NEW_PASSWORD);
  await expect(refused.getByText('كلمة المرور غير صحيحة', { exact: false })).toBeVisible();

  // Resetting issues another one and signs every device out.
  await row(page, username)
    .getByRole('button', { name: /إجراءات/ })
    .click();
  await page.getByRole('menuitem', { name: 'إعادة تعيين كلمة المرور' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'إعادة التعيين' }).click();
  const reset = await acknowledgeCredential(page, username);
  expect(reset).not.toBe(again);

  // Leave it switched off.
  await row(page, username)
    .getByRole('button', { name: /إجراءات/ })
    .click();
  await page.getByRole('menuitem', { name: 'إيقاف', exact: true }).click();
  await page.getByRole('dialog').getByLabel('السبب').fill('test over');
  await page.getByRole('dialog').getByRole('button', { name: 'إيقاف الحساب' }).click();
  await expect(row(page, username)).toHaveAttribute('data-status', 'inactive');
});

test('the owner gives an existing partner a login, once, and the partner sees none of the owner’s pages', async ({
  page,
  browser,
  request,
}) => {
  const partnerName = `Partner ${suffix}`;
  const username = `partner.${suffix}`;
  const partnerId = randomUUID();
  await serverPut(request, `/partners/${partnerId}`, {
    name: partnerName,
    ownershipBp: 0,
    isOwner: false,
    phone: null,
    title: 'silent partner',
    startDate: null,
    notes: null,
  });
  await signIn(page);
  await openAccounts(page);

  // The partner is offered; the dialog says it creates a login only.
  await page.getByRole('button', { name: 'حساب لشريك' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('لا يُنشئ شريكاً');
  await dialog.getByRole('combobox', { name: 'الشريك' }).click();
  await page.getByRole('option', { name: new RegExp(partnerName) }).click();
  await expect(dialog.getByLabel('الاسم الظاهر')).toHaveValue(partnerName);
  await dialog.getByLabel('اسم المستخدم').fill(username);
  await dialog.getByRole('button', { name: 'إنشاء الحساب' }).click();
  const temporary = await acknowledgeCredential(page, username);

  // The list shows which partner the login belongs to.
  await expect(row(page, username).getByTestId('account-partner')).toContainText(partnerName);
  await expect(row(page, username)).toContainText('الشريك');

  // That partner is no longer offered (the server refuses a second login in any case).
  await page.getByRole('button', { name: 'حساب لشريك' }).click();
  const second = page.getByRole('dialog');
  const picker = second.getByRole('combobox', { name: 'الشريك' });
  // With no other partner in the shop the dialog says every partner has a login; otherwise the
  // list is shown and does not hold this one.
  await expect(picker.or(second.getByText('لكل شريك في المحل حساب مفعّل بالفعل.'))).toBeVisible();
  if ((await picker.count()) > 0) {
    await picker.click();
    await expect(page.getByRole('option', { name: new RegExp(partnerName) })).toHaveCount(0);
    await page.keyboard.press('Escape');
  }
  await page.keyboard.press('Escape');
  await expect(second).toHaveCount(0);

  // The filters: by type, by status, both, and cleared.
  const type = page.getByRole('combobox', { name: 'النوع' });
  await type.click();
  await page.getByRole('option', { name: 'الشريك', exact: true }).click();
  await expect(row(page, username)).toBeVisible();
  await expect(row(page, 'cashier')).toHaveCount(0);
  const status = page.getByRole('combobox', { name: 'الحالة' });
  await status.click();
  await page.getByRole('option', { name: 'موقوف', exact: true }).click();
  await expect(row(page, username)).toHaveCount(0);
  await page.getByRole('button', { name: 'مسح التصفية' }).click();
  await expect(row(page, 'cashier')).toBeVisible();

  // The partner chooses a password, then sees the shop but none of the owner's pages.
  const partner = await firstSignIn(browser, username, temporary);
  await chooseOwnPassword(partner, temporary, 'a partner password of their own');
  for (const path of ['/settings/accounts', '/audit', '/integrity']) {
    await partner.goto(path);
    await expect(partner.getByText('هذه الصفحة لصاحب المحل وحده.')).toBeVisible();
  }
  await partner.goto('/settings');
  const sections = partner.getByRole('navigation', { name: 'أقسام الإعدادات' });
  await expect(sections.getByRole('link', { name: /الشركاء/ })).toBeVisible();
  await expect(sections.getByRole('link', { name: /الحسابات/ })).toHaveCount(0);
  const menu = partner.getByRole('navigation').first();
  await expect(menu.getByRole('link', { name: 'سجل التعديلات', exact: true })).toHaveCount(0);

  // The pages a partner may read still open from the data on its device, not from the routes
  // that became the owner's (the settlement preview, the partner list, a zakat report).
  for (const path of ['/settlements', '/zakat', '/settings/partners']) {
    await partner.goto(path);
    await expect(partner.getByRole('main')).toBeVisible();
    await expect(partner.getByText('هذه الصفحة لصاحب المحل وحده.')).toHaveCount(0);
  }

  // On the zakat pages a partner reads and changes nothing: no methodology to save, no report to
  // save, no payment to record (the owner alone does, ADR 0028).
  await partner.goto('/zakat');
  await expect(partner.getByText(ar.zakat.readOnlyNote)).toBeVisible();
  await expect(partner.getByRole('button', { name: ar.zakat.actions.pay })).toHaveCount(0);
  await partner.goto('/zakat/settings');
  await expect(partner.getByText(ar.zakat.settings.readOnly)).toBeVisible();
  await expect(partner.getByRole('button', { name: ar.zakat.settings.save })).toHaveCount(0);
  await partner.goto('/zakat/review');
  for (let step = 1; step < 7; step += 1) {
    await partner.getByRole('button', { name: ar.zakat.review.next }).click();
  }
  await expect(partner.getByText(ar.zakat.confirm.blocks.not_owner)).toBeVisible();
  await expect(partner.getByRole('button', { name: ar.zakat.confirm.save })).toHaveCount(0);

  // A partner who still has a login cannot be removed: the login is switched off first.
  const login = await request.post(`${E2E.apiUrl}/auth/login`, { data: E2E.owner });
  const { accessToken } = (await login.json()) as { accessToken: string };
  const removal = await request.post(`${E2E.apiUrl}/partners/${partnerId}/void`, {
    headers: { authorization: `Bearer ${accessToken}` },
    data: { reason: 'added by mistake' },
  });
  expect(removal.ok()).toBe(false);
  expect(await removal.text()).toContain('partner_has_active_login');

  // Leave the login switched off.
  await row(page, username)
    .getByRole('button', { name: /إجراءات/ })
    .click();
  await page.getByRole('menuitem', { name: 'إيقاف', exact: true }).click();
  await page.getByRole('dialog').getByLabel('السبب').fill('test over');
  await page.getByRole('dialog').getByRole('button', { name: 'إيقاف الحساب' }).click();
  await expect(row(page, username)).toHaveAttribute('data-status', 'inactive');
  // The partner is still a partner: switching the login off removed nothing.
  await page.goto('/settings/partners');
  await expect(page.getByText(partnerName).first()).toBeVisible();
});

test.describe('the accounts screen fits every device and both directions', () => {
  const sizes = [
    { name: 'phone', width: 390, height: 844 },
    { name: 'tablet', width: 820, height: 1180 },
    { name: 'desktop', width: 1366, height: 900 },
  ] as const;

  for (const size of sizes) {
    for (const language of ['ar', 'en'] as const) {
      test(`${size.name}, ${language}`, async ({ browser }) => {
        const context = await browser.newContext({
          viewport: { width: size.width, height: size.height },
        });
        const page = await context.newPage();
        await setDeviceLanguage(page, language);
        await page.goto('/login');
        await page.locator('input[autocomplete="username"]').fill('owner');
        await page
          .locator('input[autocomplete="current-password"]')
          .fill('end to end test password');
        await page.locator('button[type="submit"]').click();
        await expect(page).toHaveURL(/\/home$/);
        await page.goto('/settings/accounts');
        await expect(page.getByTestId('account-count')).toBeVisible();

        await expect(page.locator('html')).toHaveAttribute(
          'dir',
          language === 'ar' ? 'rtl' : 'ltr',
        );
        // Nothing scrolls sideways.
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow).toBeLessThanOrEqual(0);

        // The create buttons and the filters are reachable, and a dialog fits the screen.
        await page
          .getByRole('button', { name: language === 'ar' ? 'عامل جديد' : 'New cashier' })
          .click();
        const box = await page.getByRole('dialog').boundingBox();
        expect(box).not.toBeNull();
        if (box) {
          expect(box.x).toBeGreaterThanOrEqual(0);
          expect(box.x + box.width).toBeLessThanOrEqual(size.width);
          expect(box.y).toBeGreaterThanOrEqual(0);
          expect(box.y + box.height).toBeLessThanOrEqual(size.height);
        }
        await page.keyboard.press('Escape');

        // Dark theme: the screen still renders (the theme is a class on the root).
        await page.emulateMedia({ colorScheme: 'dark' });
        await expect(page.getByTestId('account-count')).toBeVisible();
        await context.close();
      });
    }
  }
});

test('without a connection the accounts say so and cannot be changed', async ({
  page,
  context,
}) => {
  await signIn(page);
  await openAccounts(page);
  await context.setOffline(true);
  await expect(page.getByText('الحسابات محفوظة على الخادم')).toBeVisible();
  await expect(page.getByRole('button', { name: 'عامل جديد' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'حساب لشريك' })).toBeDisabled();
  await context.setOffline(false);
  await expect(page.getByRole('button', { name: 'عامل جديد' })).toBeEnabled();
});
