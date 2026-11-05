import { expect, test } from '@playwright/test';
import {
  addProduct,
  connectivity,
  fillStock,
  openRestock,
  restock,
  serverGet,
  serverRecords,
  signIn,
  submitRestock,
  waitForAppShell,
} from './helpers';

test('stock bought by the metre, by weight and by the piece is kept as batches; one bought offline syncs', async ({
  page,
  request,
}) => {
  await signIn(page);
  await waitForAppShell(page);

  // T1, scaled: 50 m at 16 dh (320 rial) = 16,000 rial, bought with the product itself.
  const productId = await addProduct(page, { name: 'تول - أحمر' });
  const batches = page.getByRole('region', { name: 'دفعات المخزون' });
  // This browser's device code (every browser profile is a device: A, B… in sign-in order).
  const first = (await batches.getByText(/^B-[A-Z]+0001$/).textContent()) ?? '';
  const prefix = first.slice(0, -4);
  await expect(batches).toContainText('16,000');

  // T2: a piece of 2.3 m for 100 dh (2000 rial) → 43.48 dh/m, typed as 869.6 rial a metre; the
  // form works the 2,000 rial out, and it is dearer than the 16 dh/m before it: the renewal
  // warning (SPEC §8.5).
  const panel = await openRestock(page, productId);
  await fillStock(panel, { quantity: '2.3', cost: '869.6' });
  await expect(panel.locator('dl', { hasText: 'إجمالي الشراء' })).toContainText(/2[,٬ ]?000/);
  await expect(panel.getByText('تكلفة التجديد أعلى')).toBeVisible();
  await submitRestock(panel);

  // T4: 20 kg at 20 dh a kilo (400 rial; 8000 rial in all) at 4 m/kg → an estimated 80 m batch.
  const kilos = await openRestock(page, productId);
  await fillStock(kilos, {
    unit: 'kg',
    quantity: '20',
    cost: '400',
    conversion: { weight: '1', length: '4', estimated: true },
  });
  await expect(kilos.getByText('80 م')).toBeVisible();
  await submitRestock(kilos, 'kg');
  await expect(batches.getByText('تقديري').first()).toBeVisible();

  // Offline: a dearer batch by the metre (17 dh/m, against the 5 dh/m before it) warns about
  // renewal cost, saves, then syncs.
  await page.context().setOffline(true);
  const offline = await openRestock(page, productId);
  await fillStock(offline, { quantity: '50', cost: '340' });
  await expect(offline.getByText('تكلفة التجديد أعلى')).toBeVisible();
  await submitRestock(offline);
  // One or more waiting (Arabic plural forms: معلّقة، معلّقتان…).
  await expect(connectivity(page)).toContainText(/معلّق/);

  await page.context().setOffline(false);
  await expect(connectivity(page)).toContainText('متصل');
  await expect(connectivity(page)).not.toContainText(/معلّق/);

  // Ten ready pieces at 200 rial a piece (2000 rial in all), counted in pieces.
  const pieces = await openRestock(page, productId);
  await fillStock(pieces, { unit: 'piece', quantity: '10', cost: '200' });
  await expect(pieces.getByText('تكلفة القطعة')).toBeVisible();
  await submitRestock(pieces, 'piece');
  await expect(batches.getByText(/^B-[A-Z]+\d{4}$/)).toHaveCount(5);
  await expect(connectivity(page)).not.toContainText(/معلّق/);
  await expect
    .poll(async () =>
      (
        await serverRecords<{ productId: string; code: string; costTotalCents: number }>(
          request,
          'product_batch',
        )
      )
        .filter((batch) => batch.productId === productId)
        .map((batch) => [batch.code, batch.costTotalCents])
        .sort(([a], [b]) => String(a).localeCompare(String(b))),
    )
    .toEqual([
      [`${prefix}0001`, 80_000],
      [`${prefix}0002`, 10_000],
      [`${prefix}0003`, 40_000],
      [`${prefix}0004`, 85_000],
      [`${prefix}0005`, 10_000],
    ]);

  // The purchase behind a batch is still shown (/purchases/view), and the server has them all.
  await page.goto(`/inventory/product?id=${productId}`);
  await page
    .getByRole('region', { name: 'دفعات المخزون' })
    .getByRole('link', { name: 'الشراء' })
    .first()
    .click();
  await expect(page).toHaveURL(/\/purchases\/view\?id=/);
  const purchaseId = new URL(page.url()).searchParams.get('id') ?? '';
  await expect(page.getByRole('cell', { name: /^B-[A-Z]+\d{4}$/ })).toBeVisible();
  const detail = await serverGet<{ batches?: { code: string }[] }>(
    request,
    `/purchases/${purchaseId}`,
  );
  expect(detail.batches).toHaveLength(1);
  // The specs share one server: at least this test's five purchases are there.
  const purchases = await serverGet<unknown[]>(request, '/purchases');
  expect(purchases.length).toBeGreaterThanOrEqual(5);
});

test('a restock adds a batch to the same product: nothing is duplicated, earlier batches stay', async ({
  page,
}) => {
  await signIn(page);
  await waitForAppShell(page);
  const productId = await addProduct(page, {
    name: 'تول - أزرق',
    stock: { quantity: '10', cost: '320' },
  });
  await restock(page, productId, { quantity: '5', cost: '400' });

  await page.goto('/inventory');
  await expect(page.getByRole('row', { name: /تول - أزرق/ })).toHaveCount(1);
  await expect(page.getByRole('row', { name: /تول - أزرق/ })).toContainText('15');
});
