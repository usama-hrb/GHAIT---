import { expect, type Locator, test } from '@playwright/test';
import { addFabric, pickColor, reviewAndSave, signIn, startPurchase } from './helpers';

/** The keypad's keys, tapped one by one like a finger would. */
async function tap(dialog: Locator, keys: string): Promise<void> {
  const pad = dialog.getByRole('group', { name: 'لوحة الأرقام' });
  for (const key of keys) {
    const name = key === '.' ? 'الفاصلة العشرية' : key;
    await pad.getByRole('button', { name, exact: true }).click();
  }
}

test('a tablet sale is typed on the keypad: length, negotiated price, discount, part payment', async ({
  browser,
}) => {
  const tablet = await browser.newContext({
    viewport: { width: 1024, height: 768 },
    hasTouch: true,
  });
  const page = await tablet.newPage();
  await signIn(page);
  await addFabric(page, 'قطيفة');
  await startPurchase(page, 'بالمتر', 'قطيفة');
  await page.getByLabel('سعر المتر').fill('320');
  await page.getByRole('button', { name: 'كل الألوان' }).click();
  await reviewAndSave(page);

  await page.goto('/pos');
  const dialog = await pickColor(page, 'قطيفة', 'أحمر');

  // The length is typed on the keypad; the field has no system keyboard.
  const length = dialog.getByLabel('الطول', { exact: true });
  await expect(length).toHaveAttribute('inputmode', 'none');
  await tap(dialog, '2.5');
  await expect(length).toHaveValue('2.5');

  // Tap the price: the first digit replaces the reference price; delete takes one back.
  const price = dialog.getByLabel('سعر المتر', { exact: true });
  await expect(price).toHaveValue('400');
  await price.click();
  await tap(dialog, '380');
  await expect(price).toHaveValue('380');
  await dialog.getByRole('button', { name: 'حذف آخر رقم' }).click();
  await expect(price).toHaveValue('38');

  // A quick button fills the reference price; the line is worth 2.5 m × 400 rial.
  await dialog.getByRole('button', { name: /المرجعي/ }).click();
  await expect(price).toHaveValue('400');
  await expect(dialog.getByText('1,000 ريال', { exact: false }).first()).toBeVisible();
  await dialog.getByRole('button', { name: 'أضف إلى الفاتورة' }).click();

  // The bill at the side: a discount of 100 rial on the keypad.
  const bill = page.getByRole('region', { name: 'الفاتورة' });
  await expect(bill.getByText('قطيفة · أحمر')).toBeVisible();
  await bill.getByRole('button', { name: 'أضف خصماً' }).click();
  const discount = page.getByRole('dialog');
  await tap(discount, '100');
  await discount.getByRole('button', { name: 'تطبيق' }).click();
  await expect(bill.getByRole('button', { name: /^ادفع/ })).toContainText('900');

  // Part payment: a credit sale needs a customer, then 300 rial on the keypad.
  await bill.getByRole('button', { name: /^ادفع/ }).click();
  const checkout = page.getByRole('dialog');
  await checkout.getByRole('tab', { name: 'دين أو دفعة جزئية' }).click();
  await expect(checkout.getByRole('button', { name: 'إتمام البيع' })).toBeDisabled();
  await checkout.getByRole('button', { name: 'زبون جديد' }).click();
  const customer = page.getByRole('dialog');
  await customer.getByLabel('الاسم').fill('سعاد');
  await customer.getByRole('button', { name: 'حفظ' }).click();
  await expect(page.getByLabel('الزبون', { exact: true })).toContainText('سعاد');
  await checkout.getByLabel('المدفوع الآن').click();
  await tap(checkout, '300');
  await expect(checkout.getByLabel('المدفوع الآن')).toHaveValue('300');
  await checkout.getByRole('button', { name: 'إتمام البيع' }).click();

  // Saved: 900 rial, 300 paid, 600 owed.
  await expect(page).toHaveURL(/\/pos\/view\?id=/);
  await expect(page.getByText('600 ريال').first()).toBeVisible();
  await tablet.close();
});
