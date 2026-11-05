import { expect, type Locator, type Page, test } from '@playwright/test';
import {
  addProduct,
  addToBill,
  connectivity,
  openLastSale,
  payInFull,
  serverRecords,
  signIn,
  waitForAppShell,
} from './helpers';
import { E2E } from './stack';

interface ServerProduct {
  id: string;
  name: string;
  voidedAt: string | null;
}

/** The product's row in the Inventory table, with its actions menu opened on "Delete product". */
async function openDeleteDialog(page: Page, name: string): Promise<Locator> {
  await page.goto('/inventory');
  const row = page.getByRole('row', { name: new RegExp(name) });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: /إجراءات المنتج/ }).click();
  await page.getByRole('menuitem', { name: 'حذف المنتج' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

const confirm = (dialog: Locator) => dialog.getByRole('button', { name: 'حذف المنتج' });

test('a product with no transactions: the dialog names it, cancel keeps it, a reason is needed, confirming removes it', async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  await signIn(page);
  await waitForAppShell(page);
  await addProduct(page, { name: 'دانتيل - للحذف', code: 'DL-77', stock: null });
  await expect(connectivity(page)).not.toContainText(/معلّق/);

  // The dialog names the product and its code and says what happens.
  const dialog = await openDeleteDialog(page, 'دانتيل - للحذف');
  await expect(dialog.getByText('هل أنت متأكد أنك تريد حذف دانتيل - للحذف؟')).toBeVisible();
  await expect(dialog.getByText('DL-77')).toBeVisible();
  await expect(dialog.getByText('لم يُشترَ هذا المنتج قط')).toBeVisible();
  await expect(dialog.getByText('لا يمكن التراجع عن ذلك من التطبيق')).toBeVisible();

  // Cancel changes nothing.
  await dialog.getByRole('button', { name: 'إلغاء' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('row', { name: /دانتيل - للحذف/ })).toBeVisible();

  // Confirming without a reason is refused: nothing is deleted by accident.
  const again = await openDeleteDialog(page, 'دانتيل - للحذف');
  await confirm(again).click();
  await expect(again.getByText('اكتب سبب الإلغاء')).toBeVisible();
  await expect(again).toBeVisible();
  // An open dialog hides the page behind it from the accessibility tree: look past that.
  await expect(
    page.getByRole('row', { name: /دانتيل - للحذف/, includeHidden: true }),
  ).toBeVisible();

  // With a reason it is removed from the list, and the server keeps the record, cancelled.
  await again.getByLabel('السبب').fill('أُضيف بالخطأ');
  await confirm(again).click();
  await expect(again).toBeHidden();
  await expect(page.getByText('تم حذف دانتيل - للحذف')).toBeVisible();
  await expect(page.getByRole('row', { name: /دانتيل - للحذف/ })).toHaveCount(0);

  await expect(connectivity(page)).not.toContainText(/معلّق/);
  await expect
    .poll(async () => {
      const found = (await serverRecords<ServerProduct>(request, 'product')).find(
        (product) => product.name === 'دانتيل - للحذف',
      );
      return found?.voidedAt != null;
    })
    .toBe(true);
});

test('a product that still holds stock cannot be deleted: the dialog explains and the button stays off', async ({
  page,
  request,
}) => {
  await signIn(page);
  await waitForAppShell(page);
  await addProduct(page, { name: 'ساتان - عليه مخزون' });
  await expect(connectivity(page)).not.toContainText(/معلّق/);

  const dialog = await openDeleteDialog(page, 'ساتان - عليه مخزون');
  await expect(dialog.getByRole('alert')).toContainText('ما زال في هذا المنتج مخزون');
  await expect(confirm(dialog)).toBeDisabled();
  await dialog.getByRole('button', { name: 'إلغاء' }).click();
  await expect(page.getByRole('row', { name: /ساتان - عليه مخزون/ })).toBeVisible();

  const found = (await serverRecords<ServerProduct>(request, 'product')).find(
    (product) => product.name === 'ساتان - عليه مخزون',
  );
  expect(found?.voidedAt).toBeNull();
});

test('a product that was bought and sold out is removed; its purchase, sale and stock records stay', async ({
  page,
  request,
}) => {
  test.setTimeout(150_000);
  await signIn(page);
  await waitForAppShell(page);
  // 2 m bought at 300 rial a metre, all of it sold at the till.
  const productId = await addProduct(page, {
    name: 'أورجانزا - بيع كله',
    stock: { quantity: '2', cost: '300' },
  });
  await page.goto('/pos');
  await addToBill(page, 'أورجانزا - بيع كله', '2');
  await payInFull(page);
  await expect(connectivity(page)).not.toContainText(/معلّق/);

  const batchesOf = async () =>
    (
      await serverRecords<{ id: string; productId: string; costTotalCents: number }>(
        request,
        'product_batch',
      )
    ).filter((batch) => batch.productId === productId);
  const [batchBefore] = await batchesOf();
  expect(batchBefore?.costTotalCents).toBe(3000);
  const movesOf = async () =>
    (await serverRecords<{ batchId: string }>(request, 'product_stock_move')).filter(
      (move) => move.batchId === batchBefore?.id,
    );
  const movesBefore = (await movesOf()).length;
  const salesBefore = (await serverRecords<{ id: string }>(request, 'sale')).length;
  expect(movesBefore).toBeGreaterThanOrEqual(2);

  // Out of stock, with a history: the dialog says the history stays.
  const dialog = await openDeleteDialog(page, 'أورجانزا - بيع كله');
  await expect(dialog.getByText('تبقى مشترياته ومبيعاته ومرتجعاته وخسائره')).toBeVisible();
  await expect(dialog.getByText('ما زال في هذا المنتج مخزون')).toHaveCount(0);
  await expect(confirm(dialog)).toBeEnabled();
  await dialog.getByLabel('السبب').fill('توقف الصنف');
  await confirm(dialog).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('row', { name: /أورجانزا - بيع كله/ })).toHaveCount(0);
  await expect(connectivity(page)).not.toContainText(/معلّق/);

  await expect
    .poll(async () => {
      const found = (await serverRecords<ServerProduct>(request, 'product')).find(
        (product) => product.id === productId,
      );
      return found?.voidedAt != null;
    })
    .toBe(true);

  // Nothing of its history moved: same batch and cost, same moves, same sales.
  expect(await batchesOf()).toEqual([batchBefore]);
  expect((await movesOf()).length).toBe(movesBefore);
  expect((await serverRecords<{ id: string }>(request, 'sale')).length).toBe(salesBefore);

  // The sale still opens and still names the product.
  await openLastSale(page);
  await expect(page.getByText('أورجانزا - بيع كله').first()).toBeVisible();
  // And the till no longer offers it.
  await page.goto('/pos');
  await expect(page.getByRole('button', { name: /أورجانزا - بيع كله/ })).toHaveCount(0);
});

test('deleting offline is saved on the device and reaches the server once back online', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  await signIn(page);
  await waitForAppShell(page);
  await addProduct(page, { name: 'قطن - قديم', stock: null });
  await expect(connectivity(page)).not.toContainText(/معلّق/);

  await page.context().setOffline(true);
  // One product created and deleted while offline too: both changes wait, in order.
  await addProduct(page, { name: 'قطن - مؤقت', stock: null });

  for (const name of ['قطن - قديم', 'قطن - مؤقت']) {
    const dialog = await openDeleteDialog(page, name);
    await dialog.getByLabel('السبب').fill('بلا اتصال');
    await confirm(dialog).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('row', { name: new RegExp(name) })).toHaveCount(0);
  }
  await expect(connectivity(page)).toContainText(/معلّق/);

  await page.context().setOffline(false);
  await expect(connectivity(page)).toContainText('متصل');
  await expect(connectivity(page)).not.toContainText(/معلّق/);
  await expect
    .poll(async () => {
      const products = await serverRecords<ServerProduct>(request, 'product');
      return ['قطن - قديم', 'قطن - مؤقت'].map(
        (name) => products.find((product) => product.name === name)?.voidedAt != null,
      );
    })
    .toEqual([true, true]);
});

test('a cashier is not offered the deletion', async ({ browser, page }) => {
  test.setTimeout(90_000);
  await signIn(page);
  await waitForAppShell(page);
  await addProduct(page, { name: 'مخمل - للكاشير' });
  await expect(connectivity(page)).not.toContainText(/معلّق/);

  const till = await (await browser.newContext()).newPage();
  await signIn(till, E2E.cashier);
  await waitForAppShell(till);
  await till.goto('/inventory');
  const row = till.getByRole('row', { name: /مخمل - للكاشير/ });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: /إجراءات المنتج/ }).click();
  await expect(till.getByRole('menuitem', { name: 'فتح المنتج' })).toBeVisible();
  await expect(till.getByRole('menuitem', { name: 'حذف المنتج' })).toHaveCount(0);
});
