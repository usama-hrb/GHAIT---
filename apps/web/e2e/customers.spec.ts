import { expect, type Page, test } from '@playwright/test';
import {
  addProduct,
  addToBill,
  choose,
  connectivity,
  openLastSale,
  serverGet,
  signIn,
  waitForAppShell,
} from './helpers';

/** A credit sale at the POS of `meters` of red linen at the 400 rial reference, nothing paid. */
async function creditSale(
  page: Page,
  meters: string,
  newCustomer?: { name: string; phone: string },
  product = 'كتان - أحمر',
) {
  await page.goto('/pos');
  await addToBill(page, product, meters);
  await page.getByRole('button', { name: 'دفعة جزئية', exact: true }).click();
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
  await page.getByLabel('المدفوع الآن').fill('0');
  await page.getByRole('button', { name: 'إتمام البيع' }).click();
  // Saved on the device at once: the bill is empty for the next sale.
  await expect(page.getByText('لا أصناف').first()).toBeVisible();
  return openLastSale(page);
}

/** Opens the owner's "more actions" menu of the customer's page and picks one. */
async function moreActions(page: Page, action: string) {
  await page.getByRole('button', { name: 'المزيد من الإجراءات' }).click();
  await page.getByRole('menuitem', { name: action }).click();
}

async function recordPayment(page: Page, amount: string) {
  // The page's own button; an invoice's "record a payment for it" has a longer name.
  await page.getByRole('button', { name: 'تسجيل دفعة', exact: true }).click();
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
  // 50 m at 320 rial/m (16 dh).
  await addProduct(page, { name: 'كتان - أحمر' });

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
  await moreActions(page, 'ردّ الرصيد نقداً');
  await page.getByRole('dialog').getByLabel('المبلغ').fill('200');
  await page.getByRole('dialog').getByRole('button', { name: 'ردّ الرصيد نقداً' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();

  const nextSale = await creditSale(page, '2');
  await page.goto(`/customers/view?id=${customerId}`);
  await moreActions(page, 'طبّق الرصيد على الفواتير');
  // The credit went onto the invoice: none is held for her any more.
  await expect(page.getByText('رصيد دائن له')).toHaveCount(0);

  // The statement as WhatsApp text, to her number: previewed first, then sent.
  await page.getByRole('button', { name: 'شارك كشف الحساب' }).click();
  const statementDialog = page.getByRole('dialog');
  await expect(statementDialog).toContainText('كشف حساب · خديجة');
  const href =
    (await statementDialog.getByRole('link', { name: 'إرسال عبر واتساب' }).getAttribute('href')) ??
    '';
  expect(href).toContain('wa.me/212611223344');
  const text = new URL(href).searchParams.get('text') ?? '';
  expect(text).toContain('كشف حساب · خديجة');
  expect(text).toContain('المجموع المستحق: 500 ريال');
  // What she paid is in it too.
  expect(text).toContain('مدفوعاتكم:');
  await page.keyboard.press('Escape');
  await expect(statementDialog).toBeHidden();

  // She will not pay the rest: written off from the invoice's menu, she leaves the list of who
  // owes me. A cashier is never offered it (roles.spec).
  await page.getByRole('tab', { name: 'الفواتير' }).click();
  await page
    .getByRole('row')
    .filter({ hasText: 'مدفوعة جزئياً' })
    .getByRole('button', { name: /إجراءات الفاتورة/ })
    .click();
  await page.getByRole('menuitem', { name: 'شطب كدين معدوم' }).click();
  await page.getByRole('dialog').getByLabel('السبب').fill('سافرت');
  await page.getByRole('dialog').getByRole('button', { name: 'تأكيد الشطب' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByRole('row').getByText('دين معدوم', { exact: true })).toBeVisible();
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

test('the directory filters and counts, the profile has its sections, a settled customer is edited and archived', async ({
  page,
}) => {
  await signIn(page);
  await waitForAppShell(page);
  await addProduct(page, { name: 'قطن - أزرق' });

  await page.goto('/customers');
  const stats = page.getByLabel('الزبائن في لمحة');
  const figure = async (index: number) =>
    Number(((await stats.locator('dd').nth(index).textContent()) ?? '').replaceAll(/\D/g, ''));
  await expect(stats).toBeVisible();
  const before = { customers: await figure(0), owing: await figure(1) };

  // A customer with nothing sold: settled. Saving opens their profile.
  await page.getByRole('button', { name: 'زبون جديد' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('الاسم').fill('منى السعدي');
  await dialog.getByLabel(/الهاتف/).fill('0677889900');
  await dialog.getByRole('button', { name: 'حفظ' }).click();
  await expect(page).toHaveURL(/\/customers\/view\?id=/);
  await expect(page.getByRole('heading', { name: 'منى السعدي', level: 2 })).toBeVisible();
  await expect(page.getByLabel('ملخص الحساب')).toContainText('إجمالي المشتريات');
  await expect(page.getByLabel('ملخص الحساب')).toContainText('لا شيء للتحصيل');

  // The sections: each has its own list and says when it is empty.
  await expect(page.getByText('لا شيء للتحصيل من هذا الزبون.', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'الفواتير' }).click();
  await expect(page.getByText('لا فواتير بعد')).toBeVisible();
  await page.getByRole('tab', { name: 'الدفعات' }).click();
  await expect(page.getByText('لا دفعات بعد').first()).toBeVisible();
  await page.getByRole('tab', { name: 'النشاط' }).click();
  await expect(page.getByText('لم يحدث شيء على هذا الحساب بعد.').first()).toBeVisible();
  await page.getByRole('tab', { name: 'التفاصيل' }).click();
  await expect(
    page.getByRole('region', { name: 'بيانات الزبون' }).getByText('0677889900'),
  ).toBeVisible();

  // Edit: the notes are kept and shown.
  await page.getByRole('button', { name: 'تعديل الزبون' }).first().click();
  await page
    .getByRole('dialog')
    .getByLabel(/ملاحظات/)
    .fill('تدفع في آخر الشهر');
  await page.getByRole('dialog').getByRole('button', { name: 'حفظ' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByText('تدفع في آخر الشهر')).toBeVisible();

  // Archive: settled, so allowed; she leaves the directory, her history stays.
  await moreActions(page, 'أرشفة الزبون');
  await page.getByRole('dialog').getByLabel('السبب').fill('لا تشتري بعد اليوم');
  await page.getByRole('dialog').getByRole('button', { name: 'أرشفة', exact: true }).click();
  await expect(page).toHaveURL(/\/customers$/);
  await expect(page.getByRole('link', { name: 'منى السعدي' })).toHaveCount(0);

  // A customer who owes: in the "owe money" list, counted, and out of the "settled" one.
  await creditSale(page, '2', { name: 'رشيد العلمي', phone: '0699001122' }, 'قطن - أزرق');
  await page.goto('/customers');
  await expect.poll(() => figure(0)).toBe(before.customers + 1);
  await expect.poll(() => figure(1)).toBe(before.owing + 1);
  await page.getByRole('tab', { name: /^عليهم دين/ }).click();
  const row = page.getByRole('row', { name: /رشيد العلمي/ });
  await expect(row).toContainText('عليه دين');
  await expect(row).toContainText('800 ريال');
  await page.getByRole('tab', { name: /^مسدِّدون/ }).click();
  await expect(page.getByRole('link', { name: 'رشيد العلمي' })).toHaveCount(0);

  // Searching with nothing found says so and offers to show everyone again.
  await page.getByRole('tab', { name: /^الكل/ }).click();
  await page.getByRole('searchbox', { name: 'ابحث بالاسم أو الهاتف' }).fill('zzzz');
  await expect(page.getByText('لا زبون مطابق')).toBeVisible();
  await page.getByRole('button', { name: 'عرض كل الزبائن' }).click();
  await expect(page.getByRole('link', { name: 'رشيد العلمي' })).toBeVisible();

  // The whole row opens the profile; the payment dialog shows what is owed and what will be left.
  await page.getByRole('searchbox', { name: 'ابحث بالاسم أو الهاتف' }).fill('0699001122');
  await page.getByRole('row', { name: /رشيد العلمي/ }).click();
  await expect(page).toHaveURL(/\/customers\/view\?id=/);
  await page.getByRole('button', { name: 'تسجيل دفعة', exact: true }).click();
  const paying = page.getByRole('dialog');
  await expect(paying).toContainText('المستحق الآن');
  await paying.getByLabel('المبلغ').fill('300');
  await expect(paying).toContainText('يبقى مستحقاً بعد هذه الدفعة');
  await expect(paying).toContainText('500 ريال');
  await paying.getByRole('button', { name: /كل المستحق/ }).click();
  await expect(paying.getByLabel('المبلغ')).toHaveValue('800');
  await expect(paying).toContainText('يصير الحساب مسدَّداً');
  await paying.getByRole('button', { name: 'حفظ' }).click();
  await expect(paying).toBeHidden();

  // Settled: nothing left to pay or write off on the invoice, only to look at.
  await expect(page.getByLabel('ملخص الحساب')).toContainText('لا شيء للتحصيل');
  await page.getByRole('tab', { name: 'الفواتير' }).click();
  await page.getByRole('button', { name: /إجراءات الفاتورة/ }).click();
  await expect(page.getByRole('menuitem', { name: 'عرض الفاتورة' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'تسجيل دفعة لها' })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'شطب كدين معدوم' })).toHaveCount(0);
  await page.keyboard.press('Escape');

  // The same page in English: left to right, in the words of the language.
  await page.evaluate(() => {
    localStorage.setItem('fabric.language', 'en');
  });
  await page.goto('/customers');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await expect(page.getByRole('heading', { name: 'Customers', level: 2 })).toBeVisible();
  await expect(page.getByLabel('Customers at a glance')).toContainText('Total owed to you');
});
