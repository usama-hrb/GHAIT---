import { expect, test } from '@playwright/test';
import {
  addProduct,
  connectivity,
  serverGet,
  serverRecords,
  signIn,
  waitForAppShell,
} from './helpers';

test('measuring a weight batch re-costs it and the product’s usual ratio follows; a loss offline costs its share and syncs', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  await signIn(page);
  await waitForAppShell(page);

  // T4: 20 kg at 20 dh a kilo (400 rial; 8000 rial in all) at 4 m/kg → an estimated 80 m batch at 5 dh/m (100 rial).
  const silk = await addProduct(page, {
    name: 'حرير - أزرق',
    stock: {
      unit: 'kg',
      quantity: '20',
      cost: '400',
      conversion: { weight: '1', length: '4', estimated: true },
    },
  });
  const batches = page.getByRole('region', { name: 'دفعات المخزون' });
  await expect(batches.getByText('تقديري').first()).toBeVisible();

  // Measured at 76 m: 5.26 dh/m (105.2 rial); no longer estimated, and the move is in the history.
  await batches.getByRole('button', { name: 'قياس', exact: true }).click();
  const measure = page.getByRole('dialog');
  await measure.getByLabel('الطول المقيس').fill('76');
  await measure.getByRole('button', { name: 'حفظ القياس' }).click();
  await expect(measure).toBeHidden();
  await expect(batches).toContainText('105.2');
  await expect(batches.getByText('تقديري')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'سجل الحركات' })).toContainText('قياس');

  // The product's usual weight to length follows the measurement: 7600 cm / 20 kg = 3.8 m/kg.
  await page.getByRole('button', { name: 'تعديل المنتج' }).click();
  const edit = page.getByRole('dialog');
  await expect(edit.getByLabel('الطول', { exact: true })).toHaveValue('3.8');
  await edit.getByRole('button', { name: 'إلغاء' }).click();
  await expect(edit).toBeHidden();

  // T12: a 50 m batch at 16 dh/m (320 rial); offline, 30 cm of damage costs 4.80 dh (96 rial).
  const red = await addProduct(page, { name: 'حرير - أحمر' });
  await page.context().setOffline(true);
  await page
    .getByRole('region', { name: 'دفعات المخزون' })
    .getByRole('button', { name: /^إجراءات الدفعة/ })
    .click();
  await page.getByRole('menuitem', { name: 'تسجيل تالف' }).click();
  const loss = page.getByRole('dialog');
  await loss.getByLabel('الكمية التالفة').fill('0.3');
  await loss.getByLabel('السبب').fill('بقعة');
  await loss.getByRole('button', { name: 'حفظ', exact: true }).click();
  await expect(loss).toBeHidden();
  const history = page.getByRole('region', { name: 'سجل الحركات' });
  await expect(history).toContainText('تالف');
  await expect(history).toContainText('96');
  await expect(page.getByText('49.7').first()).toBeVisible();
  await expect(connectivity(page)).toContainText(/معلّق/);

  await page.context().setOffline(false);
  await expect(connectivity(page)).toContainText('متصل');
  await expect(connectivity(page)).not.toContainText(/معلّق/);
  await expect
    .poll(async () => {
      const batchIds = new Set(
        (await serverRecords<{ id: string; productId: string }>(request, 'product_batch'))
          .filter((batch) => batch.productId === red)
          .map((batch) => batch.id),
      );
      return (
        await serverRecords<{ batchId: string; type: string; delta: number }>(
          request,
          'product_stock_move',
        )
      )
        .filter((move) => move.type === 'loss' && batchIds.has(move.batchId))
        .map((move) => move.delta);
    })
    .toEqual([-30]);
  // The silk product's measurement reached the server too.
  const silkBatches = new Set(
    (await serverRecords<{ id: string; productId: string }>(request, 'product_batch'))
      .filter((batch) => batch.productId === silk)
      .map((batch) => batch.id),
  );
  const measurements = (
    await serverRecords<{ batchId: string; type: string; delta: number }>(
      request,
      'product_stock_move',
    )
  ).filter((move) => move.type === 'measurement' && silkBatches.has(move.batchId));
  expect(measurements).toHaveLength(1);
  expect((await serverGet<{ ok: boolean }>(request, '/integrity')).ok).toBe(true);
});
