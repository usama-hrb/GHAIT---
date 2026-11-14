import { expect, test } from '@playwright/test';
import {
  addProduct,
  connectivity,
  restock,
  serverGet,
  serverPut,
  serverRecords,
  signIn,
  waitForAppShell,
} from './helpers';

const owedOf = async (
  request: Parameters<typeof serverGet>[0],
  supplierId: string,
): Promise<number> => {
  const rows = await serverGet<{ supplier: { id: string }; account: { owedCents: number } }[]>(
    request,
    '/supplier-payables',
  );
  return rows.find((row) => row.supplier.id === supplierId)?.account.owedCents ?? 0;
};

test('a purchase entered as paid in full is corrected to what was really paid, from its page and from the product page, offline', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  await signIn(page);
  await waitForAppShell(page);
  const tag = crypto.randomUUID().slice(0, 6);
  const supplierName = `مورد التصحيح ${tag}`;
  const supplierId = crypto.randomUUID();
  await serverPut(request, `/suppliers/${supplierId}`, { name: supplierName });
  const productId = await addProduct(page, { name: `قطن - تصحيح ${tag}`, stock: null });
  await page.reload();
  await waitForAppShell(page);

  // 100 m at 1,000 rial a metre = 100,000 rial (5,000 dh), entered as paid in full.
  await restock(page, productId, { quantity: '100', cost: '1000', supplier: supplierName });
  await expect.poll(() => owedOf(request, supplierId)).toBe(0);

  // Only 1,000 dh (20,000 rial) was really paid. The purchase is opened from its batch.
  await page
    .getByRole('region', { name: 'دفعات المخزون' })
    .getByRole('link', { name: 'الشراء' })
    .click();
  await expect(page).toHaveURL(/\/purchases\/view\?id=/);
  await expect(page.getByText('الباقي للمورد')).toBeHidden();

  await expect(connectivity(page)).not.toContainText(/معلّق/);
  await page.context().setOffline(true);
  await page.getByRole('button', { name: 'تعديل الدفع' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('radio', { name: 'دُفع كاملاً' })).toBeChecked();
  await dialog.getByRole('radio', { name: 'دُفع جزء، والباقي دَين' }).click();

  // More than the purchase cost is refused inside the dialog, before anything is saved.
  await dialog.getByLabel('المبلغ المدفوع للمورد', { exact: true }).fill('100001');
  await expect(dialog.getByText('المدفوع أكثر من إجمالي الشراء.')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'حفظ' })).toBeDisabled();

  await dialog.getByLabel('المبلغ المدفوع للمورد', { exact: true }).fill('20000');
  await expect(dialog.getByText('ما زال مستحقاً على هذا الشراء')).toBeVisible();
  await expect(dialog.getByText('80,000')).toBeVisible();
  await dialog.getByRole('button', { name: 'حفظ' }).click();
  await expect(dialog).toBeHidden();

  // The purchase says what is owed at once, offline; the stock and the cost did not move.
  const facts = page.locator('dl').first();
  await expect(facts).toContainText(/مدفوع\s*20,000/);
  await expect(facts).toContainText(/الباقي للمورد\s*80,000/);
  await expect(facts).toContainText(/المجموع\s*100,000/);
  await expect(connectivity(page)).toContainText(/معلّق/);

  // Back online it reaches the server: 4,000 dh (400,000 cents) is owed to the supplier.
  await page.context().setOffline(false);
  await expect(connectivity(page)).not.toContainText(/معلّق/);
  await expect.poll(() => owedOf(request, supplierId)).toBe(400_000);
  const purchases = await serverRecords<{ supplierId: string | null; paidCents: number }>(
    request,
    'purchase',
  );
  expect(purchases.find((purchase) => purchase.supplierId === supplierId)?.paidCents).toBe(100_000);
  expect((await serverGet<{ ok: boolean }>(request, '/integrity')).ok).toBe(true);

  // On the product page the batch shows the debt, and its menu corrects the payment again.
  await page.goBack();
  await waitForAppShell(page);
  const batches = page.getByRole('region', { name: 'دفعات المخزون' });
  await expect(batches).toContainText(/دَين للمورد\s*·\s*80,000/);
  await batches.getByRole('button', { name: /إجراءات الدفعة/ }).click();
  await page.getByRole('menuitem', { name: 'تعديل دفع الشراء' }).click();
  const again = page.getByRole('dialog');
  // It opens on what is true now: part paid, 20,000 rial.
  await expect(again.getByRole('radio', { name: 'دُفع جزء، والباقي دَين' })).toBeChecked();
  await expect(again.getByLabel('المبلغ المدفوع للمورد', { exact: true })).toHaveValue('20000');
  await again.getByRole('radio', { name: 'دُفع كاملاً' }).click();
  await again.getByRole('button', { name: 'حفظ' }).click();
  await expect(again).toBeHidden();
  await expect(batches).not.toContainText('دَين للمورد');
  await expect(connectivity(page)).not.toContainText(/معلّق/);
  await expect.poll(() => owedOf(request, supplierId)).toBe(0);
});

test('a purchase made part paid starts from "paid part" and says what stays owed before it is saved', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  await signIn(page);
  await waitForAppShell(page);
  const tag = crypto.randomUUID().slice(0, 6);
  const supplierName = `مورد الدفع ${tag}`;
  const supplierId = crypto.randomUUID();
  await serverPut(request, `/suppliers/${supplierId}`, { name: supplierName });
  const productId = await addProduct(page, { name: `كتان - دفع ${tag}`, stock: null });
  await page.reload();
  await waitForAppShell(page);

  // The panel starts on "paid in full": nothing is read from an empty field.
  const panel = page.getByRole('region', { name: 'إضافة مخزون', exact: true });
  await expect(panel.getByRole('radio', { name: 'دُفع كاملاً' })).toBeChecked();
  await expect(panel.getByLabel('المبلغ المدفوع للمورد', { exact: true })).toBeHidden();

  await restock(page, productId, {
    quantity: '10',
    cost: '1000',
    supplier: supplierName,
    paid: '4000',
  });
  // 10 m at 1,000 rial = 10,000 rial; 4,000 rial paid, 6,000 rial owed (30,000 cents).
  await expect.poll(() => owedOf(request, supplierId)).toBe(30_000);
});
