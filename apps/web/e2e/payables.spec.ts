import { expect, test } from '@playwright/test';
import {
  addProduct,
  connectivity,
  restock,
  serverGet,
  serverPut,
  signIn,
  waitForAppShell,
} from './helpers';

const owedOf = async (
  request: Parameters<typeof serverGet>[0],
  supplierId: string,
): Promise<number | undefined> => {
  const rows = await serverGet<{ supplier: { id: string }; account: { owedCents: number } }[]>(
    request,
    '/supplier-payables',
  );
  return rows.find((row) => row.supplier.id === supplierId)?.account.owedCents;
};

test('a purchase part paid is owed to the supplier; paid down offline, it syncs', async ({
  page,
  request,
}) => {
  await signIn(page);
  await waitForAppShell(page);
  const supplierId = crypto.randomUUID();
  await serverPut(request, `/suppliers/${supplierId}`, { name: 'مورد الساتان' });
  const productId = await addProduct(page, { name: 'ساتان - أزرق', stock: null });
  await page.reload();
  await waitForAppShell(page);

  // 100 m at 16 dh (320 rial/m) = 32,000 rial; 10,000 rial paid, 22,000 rial owed.
  await restock(page, productId, {
    quantity: '100',
    cost: '320',
    supplier: 'مورد الساتان',
    paid: '10000',
  });
  // The purchase behind the batch keeps what is owed for it.
  await page
    .getByRole('region', { name: 'دفعات المخزون' })
    .getByRole('link', { name: 'الشراء' })
    .click();
  await expect(page).toHaveURL(/\/purchases\/view\?id=/);
  await expect(page.getByText('الباقي للمورد').first()).toBeVisible();

  await expect(connectivity(page)).not.toContainText(/معلّق/);
  await expect.poll(() => owedOf(request, supplierId)).toBe(110_000); // 22,000 rial

  // The supplier's profile: what was bought, what was paid, what is owed.
  await page.goto('/payables');
  await page.getByRole('link', { name: 'مورد الساتان' }).click();
  await expect(page.getByRole('heading', { name: 'مورد الساتان' })).toBeVisible();
  const summary = page.locator('dl[aria-label="ملخص الحساب"]');
  await expect(summary).toContainText(/إجمالي المشتريات\s*32,000/);
  await expect(summary).toContainText(/إجمالي المدفوع\s*10,000/);
  await expect(summary).toContainText(/علينا\s*22,000/);

  // One payment of 5,000 rial, made offline: the dialog says where it goes first.
  await page.context().setOffline(true);
  await page.getByRole('button', { name: 'تسجيل دفعة' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('المبلغ').fill('5000');
  await expect(dialog.getByText('يبقى علينا بعد هذه الدفعة')).toBeVisible();
  await expect(dialog.getByText('17,000')).toBeVisible();
  await dialog.getByRole('button', { name: 'حفظ' }).click();
  await expect(dialog).toBeHidden();
  await expect(summary).toContainText(/علينا\s*17,000/);
  await expect(summary).toContainText(/إجمالي المدفوع\s*15,000/);
  await expect(connectivity(page)).toContainText(/معلّق/);

  // More than is owed is refused on the device, inside the dialog, before anything is saved.
  await page.getByRole('button', { name: 'تسجيل دفعة' }).click();
  await dialog.getByLabel('المبلغ').fill('17001');
  await expect(dialog.getByRole('alert')).toContainText('أكثر مما علينا لهذا المورد');
  await expect(dialog.getByRole('button', { name: 'حفظ' })).toBeDisabled();
  await dialog.getByRole('button', { name: 'إلغاء' }).click();
  await expect(dialog).toBeHidden();

  // The payment is on the Payments tab, applied to the purchase.
  await page.getByRole('tab', { name: 'الدفعات' }).click();
  await expect(page.getByRole('row').filter({ hasText: '5,000' })).toContainText('شراء');

  await page.context().setOffline(false);
  await expect(connectivity(page)).not.toContainText(/معلّق/);
  await expect.poll(() => owedOf(request, supplierId)).toBe(85_000); // 17,000 rial
  const integrity = await serverGet<{ ok: boolean }>(request, '/integrity');
  expect(integrity.ok).toBe(true);
});

test('the supplier directory finds, filters and adds; a partial then a full payment settles a purchase', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  await signIn(page);
  await waitForAppShell(page);
  const tag = crypto.randomUUID().slice(0, 6);
  const owing = `مورد الحرير ${tag}`;
  const quiet = `مورد القطن ${tag}`;
  const supplierId = crypto.randomUUID();
  await serverPut(request, `/suppliers/${supplierId}`, { name: owing, phone: '0661234567' });
  await serverPut(request, `/suppliers/${crypto.randomUUID()}`, { name: quiet });
  const productId = await addProduct(page, { name: `حرير - ذهبي ${tag}`, stock: null });
  await page.reload();
  await waitForAppShell(page);

  // 10 m at 300 rial/m = 3,000 rial; 1,000 rial paid at the till, 2,000 rial owed.
  await restock(page, productId, { quantity: '10', cost: '300', supplier: owing, paid: '1000' });

  // The directory lists both, and a search narrows it to one.
  await page.goto('/payables');
  const search = page.getByRole('searchbox', { name: 'ابحث بالاسم أو الهاتف' });
  await search.fill(tag);
  await expect(page.getByRole('link', { name: owing })).toBeVisible();
  await expect(page.getByRole('link', { name: quiet })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: owing })).toContainText('علينا دين');
  await expect(page.getByRole('row').filter({ hasText: quiet })).toContainText('مسدَّد');

  // "With debt" keeps the one who is owed; "Settled" the other.
  await page.getByRole('tab', { name: /عليهم دين/ }).click();
  await expect(page.getByRole('link', { name: owing })).toBeVisible();
  await expect(page.getByRole('link', { name: quiet })).toBeHidden();
  await page.getByRole('tab', { name: /مسدَّدون/ }).click();
  await expect(page.getByRole('link', { name: quiet })).toBeVisible();
  await expect(page.getByRole('link', { name: owing })).toBeHidden();
  await page.getByRole('tab', { name: /الكل/ }).click();

  // A new supplier opens on their own profile, with nothing to pay yet.
  await page.getByRole('button', { name: 'مورد جديد' }).click();
  const added = page.getByRole('dialog');
  await added.getByLabel('الاسم', { exact: true }).fill(`مورد جديد ${tag}`);
  await added.getByRole('button', { name: 'حفظ' }).click();
  await expect(page.getByRole('heading', { name: `مورد جديد ${tag}` })).toBeVisible();
  await expect(page.getByRole('button', { name: 'تسجيل دفعة' })).toBeHidden();

  // The owed supplier: a partial payment of 500 rial towards the purchase.
  await page.goto('/payables');
  await search.fill(owing);
  await page.getByRole('link', { name: owing }).click();
  await expect(page.getByRole('heading', { name: owing })).toBeVisible();
  const summary = page.locator('dl[aria-label="ملخص الحساب"]');
  await expect(summary).toContainText(/علينا\s*2,000/);
  await page.getByRole('button', { name: 'تسجيل دفعة' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('المبلغ').fill('500');
  await dialog.getByRole('button', { name: 'حفظ' }).click();
  await expect(dialog).toBeHidden();
  await expect(summary).toContainText(/علينا\s*1,500/);
  await page.getByRole('tab', { name: 'المشتريات' }).click();
  await expect(page.getByRole('row').filter({ hasText: '1,500' })).toContainText('مدفوع جزئياً');

  // The statement closes on the balance the profile shows.
  await page.getByRole('button', { name: 'شارك كشف الحساب' }).click();
  const statement = page.getByRole('dialog');
  await expect(statement.locator('pre')).toContainText(/علينا:\s*1,500/);
  await expect(statement.locator('pre')).toContainText(/الرصيد:\s*1,500/);
  await statement.getByRole('button', { name: 'إلغاء' }).click();
  await expect(statement).toBeHidden();

  // The rest, in one go: "everything owed" fills the amount, and the account is settled.
  await page.getByRole('button', { name: 'تسجيل دفعة' }).click();
  await dialog.getByRole('button', { name: /كل المستحق/ }).click();
  await expect(dialog.getByText('يصير الحساب مسدَّداً')).toBeVisible();
  await dialog.getByRole('button', { name: 'حفظ' }).click();
  await expect(dialog).toBeHidden();
  await expect(summary).toContainText(/علينا\s*0/);
  await expect(page.getByRole('button', { name: 'تسجيل دفعة' })).toBeHidden();
  await expect(page.getByRole('row').filter({ hasText: '3,000' })).toContainText('مدفوع');

  await expect(connectivity(page)).not.toContainText(/معلّق/);
  await expect.poll(() => owedOf(request, supplierId)).toBeUndefined(); // no longer owed
  const integrity = await serverGet<{ ok: boolean }>(request, '/integrity');
  expect(integrity.ok).toBe(true);
});
