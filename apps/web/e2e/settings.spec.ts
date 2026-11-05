import path from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import {
  addProduct,
  addToBill,
  openLastSale,
  serverGet,
  serverPut,
  signIn,
  waitForAppShell,
} from './helpers';

// The brand folder's sample: a 2048 x 2048 JPEG of 2.2 MB (made small on the device).
const PICTURE = path.join(import.meta.dirname, '../public/brand/product_1.jpeg');
const SHOP = 'غيث';
const NEW_NAME = 'أقمشة النور';

interface ServerSetting {
  value: unknown;
  isDefault: boolean;
}

const setting = (request: Parameters<typeof serverGet>[0], key: string) =>
  serverGet<ServerSetting>(request, `/settings/${key}`);

/** The sidebar of a desktop-sized window (the shop's name and mark sit at its top). */
const sidebar = (page: Page) => page.locator('[data-slot="sidebar-inner"]');

const nav = (page: Page) => page.getByRole('navigation', { name: 'أقسام الإعدادات' });

async function save(page: Page) {
  await page.getByRole('button', { name: 'حفظ التغييرات' }).click();
}

// The server keeps its settings between specs: whatever a test changes is put back, whether the
// test passed or not (the other specs read the shop as "غيث", in rial, with the built-in mark).
test.afterEach(async ({ request }) => {
  await serverPut(request, '/settings/shop_name', { value: SHOP, effectiveFrom: null });
  await serverPut(request, '/settings/shop_logo', { value: null, effectiveFrom: null });
  await serverPut(request, '/settings/money_display_unit', {
    value: 'rial',
    effectiveFrom: null,
  });
});

test('business name: edited in Settings, then the sidebar, the shared invoice and statement and a second device carry it', async ({
  browser,
  request,
}) => {
  test.setTimeout(150_000);
  const desk = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await desk.newPage();
  await signIn(page);
  await waitForAppShell(page);

  // Settings opens on the business profile; the shop is still called what it was.
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'هوية المحل', level: 2 })).toBeVisible();
  await expect(sidebar(page)).toContainText(SHOP);
  const name = page.getByLabel('الاسم', { exact: true });
  await expect(name).toHaveValue(SHOP);
  // Nothing typed yet: nothing to save.
  await expect(page.getByRole('button', { name: 'حفظ التغييرات' })).toBeDisabled();

  // Typing changes the preview only; an empty name cannot be saved.
  await name.fill('');
  await expect(page.getByText('أدخل اسم المحل')).toBeVisible();
  await expect(page.getByRole('button', { name: 'حفظ التغييرات' })).toBeDisabled();
  await name.fill(NEW_NAME);
  await expect(page.getByTestId('profile-preview-invoice')).toContainText(NEW_NAME);
  await expect(page.getByTestId('profile-preview-sidebar')).toContainText(NEW_NAME);
  await expect(sidebar(page)).not.toContainText(NEW_NAME);
  await expect(page.getByText('لديك تغييرات غير محفوظة')).toBeVisible();
  await save(page);

  // Saved on the server (one source), shown in the sidebar at once, the draft gone.
  await expect(page.getByText('حُفظت هوية المحل').first()).toBeVisible();
  await expect(sidebar(page)).toContainText(NEW_NAME);
  await expect(page.getByRole('button', { name: 'حفظ التغييرات' })).toBeDisabled();
  expect((await setting(request, 'shop_name')).value).toBe(NEW_NAME);

  // A credit sale with a new customer: the invoice and the statement both open with the new name.
  await addProduct(page, { name: 'قطن - نور' });
  await page.goto('/pos');
  await addToBill(page, 'قطن - نور', '2');
  await page.getByRole('button', { name: 'دفعة جزئية', exact: true }).click();
  await page.getByRole('button', { name: 'زبون جديد' }).click();
  const customer = page.getByRole('dialog');
  await customer.getByLabel('الاسم').fill('نور الدين');
  await customer.getByLabel(/الهاتف/).fill('0611990011');
  await customer.getByRole('button', { name: 'حفظ' }).click();
  await page.getByLabel('المدفوع الآن').fill('0');
  await page.getByRole('button', { name: 'إتمام البيع' }).click();
  await expect(page.getByText('لا أصناف').first()).toBeVisible();
  await openLastSale(page);
  const invoice = decodeURIComponent(
    new URL(
      (await page.getByRole('link', { name: 'واتساب' }).getAttribute('href')) ?? '',
    ).searchParams.get('text') ?? '',
  );
  expect(invoice).toContain(NEW_NAME);
  expect(invoice).not.toContain(SHOP);

  await page.goto('/customers');
  await page
    .getByRole('link', { name: /نور الدين/ })
    .first()
    .click();
  await page.getByRole('button', { name: 'شارك كشف الحساب' }).click();
  const statement = page.getByRole('dialog');
  const href =
    (await statement.getByRole('link', { name: 'إرسال عبر واتساب' }).getAttribute('href')) ?? '';
  const text = new URL(href).searchParams.get('text') ?? '';
  expect(text).toContain(NEW_NAME);
  expect(text).toContain('كشف حساب · نور الدين');
  await page.keyboard.press('Escape');

  // A second device that signs in afterwards pulls the same name (no copy of its own).
  const other = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const second = await other.newPage();
  await signIn(second);
  await expect(sidebar(second)).toContainText(NEW_NAME);
  await other.close();
  await desk.close();
});

test('logo: picked and made small, previewed, saved, shown in the sidebar and header, replaced and removed; a bad file keeps the current one', async ({
  browser,
  request,
}) => {
  test.setTimeout(150_000);
  const desk = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await desk.newPage();
  await signIn(page);
  await waitForAppShell(page);
  await page.goto('/settings');

  const upload = page.getByLabel('رفع شعار', { exact: true });
  const field = page.getByRole('img', { name: 'شعار المحل' });
  const sidebarLogo = sidebar(page).locator('img[src^="data:image/jpeg"]');
  await expect(page.getByText('لا يوجد شعار بعد')).toBeVisible();
  await expect(sidebarLogo).toHaveCount(0);

  // The 2.2 MB file is made small, previewed at once and kept as a draft: not saved yet.
  await upload.setInputFiles(PICTURE);
  await expect(page.getByText('الشعار الجديد جاهز. احفظ لتطبيقه.')).toBeVisible();
  const first = (await field.getAttribute('src')) ?? '';
  expect(first.startsWith('data:image/jpeg;base64,/9j/')).toBe(true);
  expect(first.length).toBeLessThan(180_000);
  await expect(sidebarLogo).toHaveCount(0);
  expect((await setting(request, 'shop_logo')).value).toBe(null);

  // Saved: the server has it (a JPEG of 120 KB at most), the sidebar shows it.
  await save(page);
  await expect(page.getByText('حُفظت هوية المحل').first()).toBeVisible();
  await expect(sidebarLogo).toBeVisible();
  const stored = (await setting(request, 'shop_logo')).value as {
    contentType: string;
    byteLength: number;
    width: number;
    height: number;
    data: string;
  };
  expect(stored.contentType).toBe('image/jpeg');
  expect(stored.byteLength).toBeLessThanOrEqual(120 * 1024);
  expect(Math.max(stored.width, stored.height)).toBeLessThanOrEqual(480);
  expect(`data:image/jpeg;base64,${stored.data}`).toBe(first);
  await expect(page.getByText('هذا الشعار يظهر في كل التطبيق.')).toBeVisible();

  // The audit log never holds the picture's bytes.
  const audit = await serverGet<{ items: unknown[] }>(request, '/audit?entity=setting&limit=50');
  expect(JSON.stringify(audit.items)).not.toContain(stored.data.slice(0, 200));

  // A file that is not an image, then one that claims to be and is not: refused, the logo stays.
  await upload.setInputFiles({
    name: 'notes.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 not a picture'),
  });
  await expect(page.getByRole('alert').filter({ hasText: 'ليس صورة' })).toBeVisible();
  await upload.setInputFiles({
    name: 'broken.png',
    mimeType: 'image/png',
    buffer: Buffer.from('this is not a png'),
  });
  await expect(page.getByRole('alert').filter({ hasText: 'تعذّرت قراءة' })).toBeVisible();
  expect(await field.getAttribute('src')).toBe(first);
  await expect(sidebarLogo).toBeVisible();
  await expect(page.getByRole('button', { name: 'حفظ التغييرات' })).toBeDisabled();

  // A new picture replaces it; "undo" first gives the saved one back.
  await upload.setInputFiles(PICTURE);
  await expect(page.getByText('الشعار الجديد جاهز. احفظ لتطبيقه.')).toBeVisible();
  await page.getByRole('button', { name: 'تراجع' }).click();
  await expect(page.getByText('هذا الشعار يظهر في كل التطبيق.')).toBeVisible();
  await upload.setInputFiles(PICTURE);
  await expect(page.getByText('الشعار الجديد جاهز. احفظ لتطبيقه.')).toBeVisible();
  await save(page);
  await expect(page.getByText('حُفظت هوية المحل').first()).toBeVisible();
  await expect(page.getByText('هذا الشعار يظهر في كل التطبيق.')).toBeVisible();

  // The phone's header carries it too, named for assistive technology by the shop's name.
  await page.setViewportSize({ width: 390, height: 800 });
  await expect(page.getByRole('img', { name: SHOP })).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 800 });

  // Removed: the built-in mark is back, in the app and on the server.
  await page.getByRole('button', { name: 'إزالة الشعار' }).click();
  await expect(page.getByText('يُزال الشعار عند الحفظ')).toBeVisible();
  await expect(sidebarLogo).toBeVisible();
  await save(page);
  await expect(page.getByText('لا يوجد شعار بعد')).toBeVisible();
  await expect(sidebarLogo).toHaveCount(0);
  expect((await setting(request, 'shop_logo')).value).toBe(null);
  await desk.close();
});

test('currency: rial or dirham, a display unit only; the stored amounts do not change', async ({
  page,
  request,
}) => {
  test.setTimeout(150_000);
  await signIn(page);
  await waitForAppShell(page);

  // A paid sale of 2 m at 400 rial (20 dh) a metre: 4,000 cents on the server, whatever is shown.
  await addProduct(page, { name: 'ساتان - عملة' });
  await page.goto('/pos');
  await addToBill(page, 'ساتان - عملة', '2');
  await page.getByRole('button', { name: /^ادفع/ }).click();
  await expect(page.getByText('لا أصناف').first()).toBeVisible();
  const saleId = await openLastSale(page);
  const whatsapp = async () =>
    decodeURIComponent(
      new URL(
        (await page.getByRole('link', { name: 'واتساب' }).getAttribute('href')) ?? '',
      ).searchParams.get('text') ?? '',
    );
  expect(await whatsapp()).toContain('الإجمالي: 800 ريال');
  const before = await serverGet<{ figures?: Record<string, number> }>(request, `/sales/${saleId}`);
  expect(before.figures?.totalCents).toBe(4000);

  // Choosing dirham changes the example only until it is saved.
  await page.goto('/settings/regional');
  await expect(page.getByRole('heading', { name: 'العملة', level: 2 })).toBeVisible();
  const example = page.getByTestId('regional-example');
  await expect(example).toContainText('410');
  await page.getByRole('radio', { name: /الدرهم/ }).click();
  await expect(page.getByText('لديك تغييرات غير محفوظة')).toBeVisible();
  await expect(example).toContainText('20.5');
  expect((await setting(request, 'money_display_unit')).value).toBe('rial');
  await save(page);
  await expect(page.getByText('حُفظت العملة').first()).toBeVisible();
  expect((await setting(request, 'money_display_unit')).value).toBe('dirham');

  // Everywhere the same sale reads in dirham, and the server still holds the same cents.
  await openSale(page, saleId);
  expect(await whatsapp()).toContain('الإجمالي: 40 د');
  const after = await serverGet<{ figures?: Record<string, number> }>(request, `/sales/${saleId}`);
  expect(after.figures).toEqual(before.figures);

  // Back to rial: the very same amounts are read in rial again.
  await page.goto('/settings/regional');
  await page.getByRole('radio', { name: /الريال/ }).click();
  await save(page);
  await expect(page.getByText('حُفظت العملة').first()).toBeVisible();
  await openSale(page, saleId);
  expect(await whatsapp()).toContain('الإجمالي: 800 ريال');
  const again = await serverGet<{ figures?: Record<string, number> }>(request, `/sales/${saleId}`);
  expect(again.figures).toEqual(before.figures);
});

async function openSale(page: Page, saleId: string) {
  await page.goto(`/pos/view?id=${saleId}`);
  await expect(page.getByRole('link', { name: 'واتساب' })).toBeVisible();
}

test('partners live inside Settings; the old addresses lead there; the sidebar no longer lists them', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page);
  await waitForAppShell(page);

  await page.goto('/settings');
  // Not in the main sidebar, but one tap away in Settings.
  await expect(nav(page).getByRole('link', { name: /الشركاء/ })).toHaveCount(1);
  await expect(sidebar(page).getByRole('link', { name: 'الشركاء' })).toHaveCount(0);
  await nav(page)
    .getByRole('link', { name: /الشركاء/ })
    .click();
  await expect(page).toHaveURL(/\/settings\/partners$/);
  await expect(nav(page).getByRole('link', { name: /الشركاء/ })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.getByRole('navigation', { name: 'أنت هنا' })).toContainText('الإعدادات');
  await expect(page.getByRole('navigation', { name: 'أنت هنا' })).toContainText('الشركاء');

  // The old addresses (bookmarks, an older install) keep working; the partner's id is kept.
  await page.goto('/partners');
  await expect(page).toHaveURL(/\/settings\/partners$/);
  await page.goto('/partners/view?id=some-partner');
  await expect(page).toHaveURL(/\/settings\/partners\/view\?id=some-partner$/);
  await expect(nav(page)).toBeVisible();
});

test('offline: the settings are readable, the changes wait for a connection and nothing is lost', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page);
  await waitForAppShell(page);
  await page.goto('/settings');
  const name = page.getByLabel('الاسم', { exact: true });
  await expect(name).toHaveValue(SHOP);
  await expect(name).toBeEnabled();

  await page.context().setOffline(true);
  await expect(page.getByText('تُحفظ الإعدادات على الخادم')).toBeVisible();
  await expect(name).toBeDisabled();
  await expect(name).toHaveValue(SHOP);
  await expect(page.getByRole('button', { name: 'حفظ التغييرات' })).toBeDisabled();
  // The other sections open from the device too.
  await nav(page)
    .getByRole('link', { name: /العملة/ })
    .click();
  await expect(page.getByTestId('regional-example')).toBeVisible();
  await expect(page.getByRole('radio', { name: /الريال/ })).toBeDisabled();

  await page.context().setOffline(false);
  await expect(page.getByText('تُحفظ الإعدادات على الخادم')).toHaveCount(0);
  await expect(page.getByRole('radio', { name: /الريال/ })).toBeEnabled();
});

test('sync and data sections: status, the issues screen and the downloads', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page);
  await waitForAppShell(page);
  await page.goto('/settings');

  await nav(page)
    .getByRole('link', { name: /المزامنة/ })
    .click();
  await expect(page).toHaveURL(/\/settings\/sync$/);
  await expect(page.getByRole('heading', { name: 'المزامنة', level: 2 })).toBeVisible();
  // The header's icon button has the same name; the page's own button has the words on it.
  await expect(page.getByText('زامن الآن', { exact: true })).toBeVisible();

  await nav(page)
    .getByRole('link', { name: /البيانات/ })
    .click();
  await expect(page).toHaveURL(/\/settings\/data$/);
  await expect(page.getByText('نسخة احتياطية كاملة (JSON)')).toBeVisible();
  await expect(page.getByText('جدول واحد (CSV)')).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'تنزيل نسخة كاملة' }).click();
  expect((await download).suggestedFilename()).toMatch(/\.json$/);
});
