import { expect, test } from '@playwright/test';
import { connectivity, serverGet, signIn, waitForAppShell } from './helpers';

test('the shop balances; a cash count, voided with a reason, both in the audit log', async ({
  page,
  request,
}) => {
  await signIn(page);
  await waitForAppShell(page);

  // Whatever the earlier specs left, the records agree with each other.
  await page.goto('/integrity');
  const balanced = page.getByText('متطابق', { exact: true });
  await expect(balanced).toBeVisible();

  // A count of 1 rial: a shortage, which needs a reason.
  await page.getByRole('button', { name: 'جرد نقدي' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('المال المعدود').fill('1');
  await dialog.getByRole('button', { name: 'حفظ' }).click();
  await expect(dialog.getByText('الفرق يحتاج سبباً')).toBeVisible();
  await dialog.getByLabel('السبب').fill('تجربة الجرد');
  await dialog.getByRole('button', { name: 'حفظ' }).click();
  await expect(dialog).toBeHidden();
  const counts = page.getByRole('region', { name: 'الجرد النقدي' });
  await expect(counts.getByText('تجربة الجرد')).toBeVisible();
  // The books moved to the money counted: still balanced.
  await expect(balanced).toBeVisible();
  await expect(connectivity(page)).not.toContainText(/معلّق/);
  await expect
    .poll(async () =>
      (await serverGet<{ countedCents: number; note: string }[]>(request, '/cash-counts')).map(
        (count) => [count.countedCents, count.note],
      ),
    )
    .toEqual([[5, 'تجربة الجرد']]);
  expect((await serverGet<{ ok: boolean }>(request, '/integrity')).ok).toBe(true);

  // Voided with a reason.
  await counts.getByRole('button', { name: 'إلغاء' }).click();
  await page.getByRole('dialog').getByLabel('السبب').fill('عددت خطأ');
  await page.getByRole('dialog').getByRole('button', { name: 'تأكيد الإلغاء' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(connectivity(page)).not.toContainText(/معلّق/);

  // The audit log: both, who did them, and why the count was voided.
  await page.goto('/audit');
  await expect(page.getByRole('list', { name: 'سجل التعديلات' })).toBeVisible();
  await page.getByLabel('النوع').click();
  await page.getByRole('option', { name: 'الجرد النقدي', exact: true }).click();
  const entries = page.getByRole('list', { name: 'سجل التعديلات' }).getByRole('listitem');
  await expect(entries).toHaveCount(2);
  await expect(entries.first()).toContainText('إلغاء');
  await expect(entries.first()).toContainText('عددت خطأ');
  await expect(entries.first()).toContainText('صاحب المحل');
  await expect(entries.last()).toContainText('إنشاء');

  // Offline, the log shows this device's copy of the last search.
  await page.context().setOffline(true);
  await page.reload();
  await expect(page.getByText('دون اتصال: هذه نسخة هذا الجهاز')).toBeVisible();
  await page.context().setOffline(false);
});
