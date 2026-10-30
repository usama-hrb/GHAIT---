import { expect, type Page, test } from '@playwright/test';
import {
  addFabric,
  choose,
  connectivity,
  reviewAndSave,
  serverGet,
  signIn,
  startPurchase,
  waitForAppShell,
} from './helpers';

/** A credit sale at the POS of `meters` of red linen at the 400 rial reference, nothing paid. */
async function creditSale(
  page: Page,
  meters: string,
  newCustomer?: { name: string; phone: string },
) {
  await page.goto('/pos');
  await choose(page, 'القماش', 'كتان');
  await choose(page, 'اللون', 'أحمر');
  await page.getByLabel('الطول', { exact: true }).fill(meters);
  await page.getByRole('button', { name: 'أضف إلى الفاتورة' }).click();
  if (newCustomer) {
    await page.getByRole('button', { name: 'زبون جديد' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('الاسم').fill(newCustomer.name);
    await dialog.getByLabel(/الهاتف/).fill(newCustomer.phone);
    await dialog.getByRole('button', { name: 'حفظ' }).click();
    await expect(page.getByLabel('الزبون', { exact: true })).toContainText(newCustomer.name);
  } else {
    await choose(page, 'الزبون', 'خديجة · 0611223344');
  }
  await page.getByLabel('دين أو دفعة جزئية').check();
  await page.getByLabel('المدفوع الآن').fill('0');
  await page.getByRole('button', { name: 'حفظ البيع' }).click();
  await expect(page).toHaveURL(/\/pos\/view\?id=/);
  return new URL(page.url()).searchParams.get('id') ?? '';
}

async function recordPayment(page: Page, amount: string) {
  await page.getByRole('button', { name: 'تسجيل دفعة' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('المبلغ').fill(amount);
  await dialog.getByRole('button', { name: 'حفظ' }).click();
  await expect(dialog).toBeHidden();
}

test('credit, payments (T8), credit refunded and applied, a bad debt written off', async ({
  page,
  request,
}) => {
  await signIn(page);
  await waitForAppShell(page);
  await addFabric(page, 'كتان');
  // 50 m of each colour at 320 rial/m (16 dh).
  await startPurchase(page, 'بالمتر', 'كتان');
  await page.getByLabel('سعر المتر').fill('320');
  await page.getByRole('button', { name: 'كل الألوان' }).click();
  await reviewAndSave(page);

  // T8: 10 m at 400 rial = 4,000 rial (200 dh), costing 3,200 rial (160 dh), on credit.
  const saleId = await creditSale(page, '10', { name: 'خديجة', phone: '0611223344' });
  await recordPayment(page, '2000');
  const payments = page.getByRole('region', { name: 'الدفعات' });
  await expect(payments.getByRole('row').nth(1)).toContainText('2,000');
  await expect(payments.getByRole('row').nth(1)).toContainText('0 ريال');

  // The second half offline, from the customer's page.
  await page.getByRole('link', { name: 'خديجة' }).click();
  await expect(page).toHaveURL(/\/customers\/view\?id=/);
  const customerId = new URL(page.url()).searchParams.get('id') ?? '';
  await page.context().setOffline(true);
  await page.goto(`/customers/view?id=${customerId}`);
  await recordPayment(page, '2000');
  await expect(connectivity(page)).toContainText(/معلّق/);
  await page.goto(`/pos/view?id=${saleId}`);
  const second = page
    .getByRole('region', { name: 'الدفعات' })
    .getByRole('row')
    .nth(2)
    .getByRole('cell');
  await expect(second.nth(2)).toContainText('1,200');
  await expect(second.nth(3)).toContainText('800');
  await page.context().setOffline(false);
  await expect(connectivity(page)).not.toContainText(/معلّق/);

  // Overpaying with nothing due: credit; part of it refunded, the rest applied to the next sale.
  await page.goto(`/customers/view?id=${customerId}`);
  await recordPayment(page, '500');
  await expect(page.getByText('رصيد دائن له').first()).toBeVisible();
  await page.getByRole('button', { name: 'ردّ الرصيد نقداً' }).click();
  await page.getByRole('dialog').getByLabel('المبلغ').fill('200');
  await page.getByRole('dialog').getByRole('button', { name: 'ردّ الرصيد نقداً' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();

  const nextSale = await creditSale(page, '2');
  await page.goto(`/customers/view?id=${customerId}`);
  await page.getByRole('button', { name: 'طبّق الرصيد على الفواتير' }).click();
  await expect(page.getByRole('button', { name: 'طبّق الرصيد على الفواتير' })).toBeHidden();

  // The statement as WhatsApp text, to her number.
  const statement = page.getByRole('link', { name: 'شارك كشف الحساب' });
  const href = (await statement.getAttribute('href')) ?? '';
  expect(href).toContain('wa.me/212611223344');
  const text = new URL(href).searchParams.get('text') ?? '';
  expect(text).toContain('كشف حساب · خديجة');
  expect(text).toContain('المجموع المستحق: 500 ريال');

  // She will not pay the rest: written off, she leaves the list of who owes me.
  await page.getByRole('button', { name: 'شطب كدين معدوم' }).click();
  await page.getByRole('dialog').getByLabel('السبب').fill('سافرت');
  await page.getByRole('dialog').getByRole('button', { name: 'تأكيد الشطب' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByText('دين معدوم', { exact: true })).toBeVisible();
  await page.goto('/customers/debts');
  await expect(page.getByRole('link', { name: 'خديجة' })).toHaveCount(0);

  await expect
    .poll(async () => {
      const detail = await serverGet<{ account?: Record<string, unknown> }>(
        request,
        `/customers/${customerId}/account`,
      );
      return detail.account;
    })
    .toEqual(
      expect.objectContaining({
        // 4,000 + 800 rial of sales, 4,500 paid, 200 refunded (in cents).
        balanceCents: 24_000 - 22_500 + 1000,
        collectibleCents: 0,
        writtenOffCents: 2500,
        creditCents: 0,
      }),
    );
  const sale = await serverGet<{ writeOff?: { reason: string } | null }>(
    request,
    `/sales/${nextSale}`,
  );
  expect(sale.writeOff?.reason).toBe('سافرت');
});
