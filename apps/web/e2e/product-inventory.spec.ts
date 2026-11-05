import { expect, test } from '@playwright/test';
import {
  addProduct,
  connectivity,
  openRestock,
  restock,
  signIn,
  submitRestock,
  waitForAppShell,
} from './helpers';
import { E2E } from './stack';

test('the inventory lists products with their stock, searches and filters them, and opens one', async ({
  browser,
  page,
}) => {
  test.setTimeout(150_000);
  await signIn(page);
  await waitForAppShell(page);

  // Three products: 50 m in stock, none bought yet, and 5 kg of which nobody knows the length.
  await addProduct(page, { name: 'كريب - أحمر' });
  await addProduct(page, { name: 'كريب - أزرق', stock: null });
  await addProduct(page, {
    name: 'كريب - أخضر',
    stock: { unit: 'kg', quantity: '5', cost: '200' },
  });
  await expect(connectivity(page)).not.toContainText(/معلّق/);

  // The list: right to left, a product per row with what it can sell and where it stands.
  await page.goto('/inventory');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { level: 2, name: 'المخزون' })).toBeVisible();
  const red = page.getByRole('row', { name: /كريب - أحمر/ });
  const blue = page.getByRole('row', { name: /كريب - أزرق/ });
  const green = page.getByRole('row', { name: /كريب - أخضر/ });
  await expect(red).toContainText('متوفر');
  await expect(red).toContainText('50');
  // What the owner paid (average per metre) and what is left is worth; no selling price here.
  await expect(red).toContainText('320');
  await expect(red).toContainText(/16[,٬ ]?000/);
  await expect(red).not.toContainText('360');
  await expect(red).not.toContainText('400');
  await expect(blue).toContainText('نفد');
  // No meters are made up for a weight: it waits for a measurement.
  await expect(green).toContainText('بانتظار القياس');

  // Search by name.
  const search = page.getByRole('searchbox', { name: /ابحث باسم المنتج/ });
  await search.fill('أحمر');
  await expect(red).toBeVisible();
  await expect(blue).toHaveCount(0);
  await search.fill('');

  // Filter by stock status, on the real stock.
  const filters = page.getByRole('group', { name: 'تصفية حسب حالة المخزون' });
  await filters.getByRole('button', { name: 'نفد', exact: true }).click();
  await expect(blue).toBeVisible();
  await expect(red).toHaveCount(0);
  await filters.getByRole('button', { name: 'متوفر', exact: true }).click();
  await expect(red).toBeVisible();
  await expect(blue).toHaveCount(0);
  await filters.getByRole('button', { name: 'بانتظار القياس', exact: true }).click();
  await expect(green).toBeVisible();
  await expect(red).toHaveCount(0);
  await filters.getByRole('button', { name: 'الكل', exact: true }).click();
  await expect(red).toBeVisible();

  // One product: its details, its batch with the cost (the owner may see it) and its history.
  await red.getByRole('link', { name: /كريب - أحمر/ }).click();
  await expect(page).toHaveURL(/\/inventory\/product\?id=/);
  await expect(page.getByRole('heading', { name: 'كريب - أحمر' })).toBeVisible();
  const batches = page.getByRole('region', { name: 'دفعات المخزون' });
  await expect(batches.getByText(/^B-[A-Z]+\d{4}$/)).toBeVisible();
  await expect(batches).toContainText('التكلفة للوحدة');
  await expect(batches).toContainText('320');
  await expect(page.getByRole('region', { name: 'سجل الحركات' })).toContainText('شراء');

  // Offline, the product and the list open from the device.
  const detail = page.url();
  await page.context().setOffline(true);
  await page.goto(detail);
  await expect(page.getByRole('heading', { name: 'كريب - أحمر' })).toBeVisible();
  await page.goto('/inventory');
  await expect(red).toContainText('متوفر');
  await page.context().setOffline(false);

  // A new product without stock, then a change to it.
  await addProduct(page, { name: 'حرير خام', code: 'SK-1', stock: null });
  await expect(page.getByRole('heading', { name: 'حرير خام' })).toBeVisible();
  await expect(page.getByText('نفد', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'تعديل المنتج' }).click();
  await page.getByRole('dialog').getByLabel('اسم المنتج', { exact: true }).fill('حرير خام ممتاز');
  await page.getByRole('dialog').getByRole('button', { name: 'حفظ', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'حرير خام ممتاز' })).toBeVisible();
  await page.goto('/inventory');
  await page.getByRole('searchbox', { name: /ابحث باسم المنتج/ }).fill('SK-1');
  await expect(page.getByRole('row', { name: /حرير خام ممتاز/ })).toBeVisible();
  await expect(connectivity(page)).not.toContainText(/معلّق/);

  // A phone gets the same products as a list, not a table.
  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const phonePage = await phone.newPage();
  await signIn(phonePage);
  await phonePage.goto('/inventory');
  await expect(phonePage.getByRole('link', { name: /كريب - أحمر/ })).toBeVisible();
  await expect(phonePage.getByRole('table')).toHaveCount(0);
  await expect(phonePage.getByRole('button', { name: 'إضافة منتج' })).toBeVisible();
  await phone.close();

  // The same page in English reads left to right.
  await page.evaluate(() => {
    localStorage.setItem('fabric.language', 'en');
  });
  await page.goto('/inventory');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await expect(page.getByRole('button', { name: 'Add product' })).toBeVisible();
  await expect(page.getByRole('row', { name: /كريب - أحمر/ })).toContainText('In stock');
});

test('a cashier sees the stock of a product, never its cost, and cannot add or edit one', async ({
  browser,
  page,
}) => {
  test.setTimeout(120_000);
  await signIn(page);
  await waitForAppShell(page);
  await addProduct(page, { name: 'جاكار - أحمر' });
  await expect(connectivity(page)).not.toContainText(/معلّق/);

  const till = await (await browser.newContext()).newPage();
  await signIn(till, E2E.cashier);
  await waitForAppShell(till);
  await till.goto('/inventory');
  const red = till.getByRole('row', { name: /جاكار - أحمر/ });
  await expect(red).toContainText('متوفر');
  // The stock, never what it cost or is worth, and no selling price.
  await expect(red).not.toContainText('320');
  await expect(red).not.toContainText('400');
  await expect(till.getByRole('columnheader', { name: 'تكلفة الشراء' })).toHaveCount(0);
  await expect(till.getByRole('columnheader', { name: /متوسط تكلفة الشراء/ })).toHaveCount(0);
  await expect(till.getByRole('columnheader', { name: 'قيمة المخزون' })).toHaveCount(0);
  await expect(till.getByText('قيمة المخزون')).toHaveCount(0);
  await expect(till.getByRole('button', { name: 'إضافة منتج' })).toHaveCount(0);

  await red.getByRole('link', { name: /جاكار - أحمر/ }).click();
  await expect(till.getByRole('heading', { name: 'جاكار - أحمر' })).toBeVisible();
  const batches = till.getByRole('region', { name: 'دفعات المخزون' });
  await expect(batches.getByText(/^B-[A-Z]+\d{4}$/)).toBeVisible();
  await expect(batches).toContainText('المتبقي');
  // No batch cost, remaining value, stock value or purchase link on the page.
  await expect(batches).not.toContainText('320');
  await expect(till.getByText('التكلفة للوحدة')).toHaveCount(0);
  await expect(till.getByText('قيمة المتبقي')).toHaveCount(0);
  await expect(till.getByText('قيمة المخزون')).toHaveCount(0);
  await expect(till.getByText('التكلفة', { exact: true })).toHaveCount(0);
  await expect(batches.getByRole('link', { name: 'الشراء' })).toHaveCount(0);
  await expect(till.getByRole('button', { name: 'تعديل المنتج' })).toHaveCount(0);
  await expect(till.getByRole('button', { name: 'إضافة مخزون', exact: true })).toHaveCount(0);

  // Nothing of buying or suppliers is offered to a cashier.
  await till.goto('/inventory');
  await expect(till.getByRole('button', { name: 'المزيد' })).toHaveCount(0);
});

test('the old purchase and catalogue addresses open the Inventory', async ({ page }) => {
  await signIn(page);
  await waitForAppShell(page);
  for (const old of [
    '/purchases',
    '/purchases/new',
    '/inventory/catalog',
    '/inventory/fabric',
    '/inventory/color',
    '/inventory/roll',
  ]) {
    await page.goto(old);
    await expect(page).toHaveURL(/\/inventory$/);
    await expect(page.getByRole('heading', { level: 2, name: 'المخزون' })).toBeVisible();
  }

  // Offline too: a bookmark of the old address still lands on the Inventory.
  await page.context().setOffline(true);
  await page.goto('/purchases/new');
  await expect(page).toHaveURL(/\/inventory$/);
  await expect(page.getByRole('heading', { level: 2, name: 'المخزون' })).toBeVisible();
  await page.context().setOffline(false);
});

test('the inventory shows a table or cards, and keeps the choice on the device', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await signIn(page);
  await waitForAppShell(page);
  await addProduct(page, { name: 'تويد - رمادي' });
  await page.goto('/inventory');

  const views = page.getByRole('group', { name: 'طريقة العرض' });
  const row = page.getByRole('row', { name: /تويد - رمادي/ });
  await expect(row).toBeVisible();

  await views.getByRole('button', { name: 'بطاقات' }).click();
  await expect(row).toHaveCount(0);
  await expect(page.getByRole('link', { name: /تويد - رمادي/ })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('link', { name: /تويد - رمادي/ })).toBeVisible();
  await expect(row).toHaveCount(0);

  await views.getByRole('button', { name: 'جدول' }).click();
  await expect(row).toBeVisible();
});

test('stock bought at two costs shows its weighted average and the cost of each batch', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signIn(page);
  await waitForAppShell(page);
  // 50 m for 16,000 rial (320 a metre), then 10 m for 8,000 rial (800 a metre).
  const id = await addProduct(page, { name: 'مخمل - بنفسجي' });
  await restock(page, id, { quantity: '10', cost: '800' });
  await expect(connectivity(page)).not.toContainText(/معلّق/);

  await page.goto('/inventory');
  const row = page.getByRole('row', { name: /مخمل - بنفسجي/ });
  // 24,000 rial over 60 m: 400 a metre, not the 560 that averaging the two batches would say.
  await expect(row).toContainText('400');
  await expect(row).toContainText(/24[,٬ ]?000/);
  await expect(row).not.toContainText('560');

  // Each batch keeps the cost it was bought at.
  await row.getByRole('button', { name: /الدفعات: 2/ }).click();
  const batches = page.getByRole('dialog');
  await expect(batches).toContainText(/16[,٬ ]?000/);
  await expect(batches).toContainText(/8[,٬ ]?000/);
  await expect(batches).toContainText('320');
  await expect(batches).toContainText('800');

  // Add stock from the row, without leaving the list.
  await page.keyboard.press('Escape');
  await row.getByRole('button', { name: /إجراءات المنتج/ }).click();
  await page.getByRole('menuitem', { name: 'إضافة مخزون' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page).toHaveURL(/\/inventory$/);
});

test('adding stock takes the cost of one unit and works the total out, whatever the unit', async ({
  page,
}) => {
  await signIn(page);
  await waitForAppShell(page);
  const id = await addProduct(page, { name: 'دانتيل - أبيض', stock: null });

  const panel = await openRestock(page, id);
  const perMeter = panel.getByLabel('تكلفة شراء المتر', { exact: true });
  const perKg = panel.getByLabel('تكلفة شراء الكيلوغرام', { exact: true });
  const perPiece = panel.getByLabel('تكلفة شراء القطعة', { exact: true });
  const total = panel.getByLabel('إجمالي تكلفة الشراء', { exact: true });
  const length = panel.getByLabel('الطول المستلم', { exact: true });
  // The panel names the purchase total under its fields, as the till's bill does.
  const summary = panel.locator('dl', { hasText: 'إجمالي الشراء' });

  // Whatever the unit, the price of one is typed: there is never a total to type.
  await expect(perMeter).toBeVisible();
  await expect(total).toHaveCount(0);

  // 2.5 m at 320 rial a metre is 800 rial; the total follows the length as it changes.
  await length.fill('2.5');
  await perMeter.fill('320');
  await expect(summary).toContainText(/800/);
  await length.fill('4');
  await expect(summary).toContainText(/1[,٬ ]?280/);

  // A weight is bought at so much a kilo: the label follows the unit, the old price (it was a
  // metre's) is cleared, and the total is worked out again: 2.345 kg at 38.5 dh (770 rial) is
  // 90.2825 dh, rounded half up to the cent: 90.28 dh, 1,805.6 rial.
  await panel.getByRole('radio', { name: 'كيلوغرام', exact: true }).click();
  await expect(perKg).toBeVisible();
  await expect(perKg).toHaveValue('');
  await expect(perMeter).toHaveCount(0);
  await expect(total).toHaveCount(0);
  await panel.getByLabel('الوزن المستلم', { exact: true }).fill('2.345');
  await perKg.fill('770');
  await expect(summary).toContainText(/1[,٬ ]?805[.,٫]6(?!\d)/);

  // Pieces are bought at so much a piece: 10 pieces at 200 rial are 2,000 rial.
  await panel.getByRole('radio', { name: 'قطعة', exact: true }).click();
  await expect(perPiece).toBeVisible();
  await expect(perKg).toHaveCount(0);
  await panel.getByLabel('القطع المستلمة', { exact: true }).fill('10');
  await perPiece.fill('200');
  await expect(summary).toContainText(/2[,٬ ]?000/);

  // Back to a length: its price is asked for again, not carried over from a kilo or a piece.
  await panel.getByRole('radio', { name: 'متر', exact: true }).click();
  await expect(perMeter).toHaveValue('');
  await length.fill('4');
  await perMeter.fill('320');

  // Saving without the cost of a metre says so, next to the field.
  await perMeter.fill('');
  await panel.getByRole('button', { name: 'إضافة المخزون', exact: true }).click();
  await expect(panel.getByText('هذا الحقل مطلوب')).toBeVisible();
  await perMeter.fill('320');
  await submitRestock(panel);

  // The batch costs what the total said: 4 m × 320 rial = 1,280 rial.
  await page.goto('/inventory');
  await expect(page.getByRole('row', { name: /دانتيل - أبيض/ })).toContainText(/1[,٬ ]?280/);
});
