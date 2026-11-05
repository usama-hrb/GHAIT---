import { expect, test } from '@playwright/test';
import { addProduct, serverGet, serverPut, setDeviceLanguage, signIn } from './helpers';
import { E2E } from './stack';

interface ServerSetting {
  value: unknown;
}

const ALL_UNITS = { piece: true, kg: true, meter: true };

// The server keeps its settings between specs: the selling units go back to "all on" whether the
// test passed or not (the other specs sell by the meter and by the piece).
test.afterEach(async ({ request }) => {
  await serverPut(request, '/settings/selling_units', { value: ALL_UNITS, effectiveFrom: null });
});

test('the sign-in page: brand panel, show or hide the password, required fields, one request', async ({
  page,
}) => {
  await setDeviceLanguage(page, 'en');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/login');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();

  // Wide window: the brand panel sits beside the form. The page never scrolls sideways.
  const aside = page.locator('aside').first();
  await expect(aside).toBeVisible();
  const panel = await aside.boundingBox();
  const form = await page.getByRole('main').boundingBox();
  expect(panel && form && panel.x < form.x).toBe(true);
  const width = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    inner: window.innerWidth,
  }));
  expect(width.scroll).toBeLessThanOrEqual(width.inner);

  // A phone-sized window: the form alone.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(aside).toBeHidden();
  await page.setViewportSize({ width: 1440, height: 900 });

  // The shop already has an owner, so there is no way to the sign-up page from here.
  await expect(page.getByRole('link', { name: 'Create your shop' })).toHaveCount(0);

  // Show and hide the password.
  const password = page.getByLabel('Password', { exact: true });
  await password.fill('some password value');
  await expect(password).toHaveAttribute('type', 'password');
  await page.getByRole('button', { name: 'Show password' }).click();
  await expect(password).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: 'Hide password' }).click();
  await expect(password).toHaveAttribute('type', 'password');

  // Both fields are required, and the first empty one gets the focus.
  await password.fill('');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByText('Enter your email or username')).toBeVisible();
  await expect(page.getByText('Enter your password')).toBeVisible();
  await expect(page.getByLabel('Email or username')).toBeFocused();

  // A wrong password: one request however many times the form is sent while it waits.
  let requests = 0;
  await page.route('**/api/auth/login', async (route) => {
    requests += 1;
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.continue();
  });
  await page.getByLabel('Email or username').fill(E2E.owner.username);
  await password.fill('not the password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Signing in…' })).toBeDisabled();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Wrong email, username or password')).toBeVisible();
  expect(requests).toBe(1);
});

test('sign-up is closed once the shop has an owner', async ({ page, request }) => {
  await setDeviceLanguage(page, 'en');
  await page.goto('/signup');
  await expect(page.getByText('Sign-up is closed')).toBeVisible();

  const status = await request.get(`${E2E.apiUrl}/auth/registration`);
  expect(await status.json()).toEqual({ open: false });

  const attempt = await request.post(`${E2E.apiUrl}/auth/register`, {
    data: {
      fullName: 'Someone Else',
      email: 'someone.else@example.com',
      password: 'a long password for this try',
      confirmPassword: 'a long password for this try',
      shopName: 'Another shop',
      shopLogo: null,
      sellingUnits: ALL_UNITS,
      currency: 'rial',
    },
  });
  expect(attempt.status()).toBe(403);
  const body = (await attempt.json()) as { error: { issues: { code: string }[] } };
  expect(body.error.issues.map((issue) => issue.code)).toContain('registration_closed');
});

test('selling units: three independent switches, none-on refused, unsafe turn-off blocked, a safe change saved', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  await signIn(page);
  // A product that is sold by the meter only: the unit nobody may switch off from under it.
  await addProduct(page, { name: 'وحدات - بالمتر' });

  await page.goto('/settings/selling');
  const piece = page.getByRole('switch', { name: /^وحدة \/ قطعة/ });
  const kg = page.getByRole('switch', { name: /^كيلوغرام/ });
  const meter = page.getByRole('switch', { name: /^متر \(m\)/ });
  for (const unit of [piece, kg, meter]) await expect(unit).toHaveAttribute('aria-checked', 'true');
  const save = page.getByRole('button', { name: 'حفظ التغييرات' });
  await expect(save).toBeDisabled();

  // Turning every unit off is refused on the spot.
  for (const unit of [piece, kg, meter]) await unit.click();
  await expect(page.getByText('فعّل وحدة واحدة على الأقل.')).toBeVisible();
  await expect(save).toBeDisabled();

  // Only Kilogram left on while a product sells only by the meter: blocked, with the count.
  await kg.click();
  await expect(kg).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByText('هذا التغيير يحتاج مراجعة أولاً')).toBeVisible();
  await expect(save).toBeDisabled();
  await page.getByRole('button', { name: 'تجاهل التغييرات' }).click();
  for (const unit of [piece, kg, meter]) await expect(unit).toHaveAttribute('aria-checked', 'true');

  // Kilogram off takes nothing from what is sold: it saves, and the server has it.
  await kg.click();
  await expect(page.getByText('هذا التغيير يحتاج مراجعة أولاً')).toHaveCount(0);
  await save.click();
  await expect(page.getByText('حُفظت وحدات البيع').first()).toBeVisible();
  const saved = await serverGet<ServerSetting>(request, '/settings/selling_units');
  expect(saved.value).toEqual({ piece: true, kg: false, meter: true });

  // New stock can no longer be bought in kilograms.
  await page.goto('/inventory');
  await page.getByRole('button', { name: 'إضافة منتج' }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('اسم المنتج', { exact: true })).toBeVisible();
  const bought = dialog.getByRole('radiogroup', { name: 'وحدة الشراء' });
  await expect(bought).toContainText('متر');
  await expect(bought).not.toContainText('كيلوغرام');
});
