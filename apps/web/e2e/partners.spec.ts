import { expect, test } from '@playwright/test';
import { connectivity, serverGet, signIn, waitForAppShell } from './helpers';

test('partners: set up, a contribution, a draw offline beyond the share (confirmed), synced', async ({
  page,
  request,
}) => {
  await signIn(page);
  await waitForAppShell(page);

  // Set up once: the owner and the partner, 50/50 (another spec may have done it already).
  await page.goto('/settings/partners');
  const setup = page.getByLabel('اسم المالك');
  const ready = page.getByRole('region', { name: 'مال المحل حسب السجلات' });
  await expect(setup.or(ready)).toBeVisible();
  if (await setup.isVisible()) {
    await setup.fill('أنا');
    await page.getByLabel('اسم الشريك').fill('شريكي');
    await expect(page.getByText('حصة الشريك: 50%')).toBeVisible();
    await page.getByRole('button', { name: 'حفظ' }).click();
  }
  const partner = page.getByRole('region', { name: 'شريكي' });
  await expect(partner).toBeVisible();
  const accountHref =
    (await partner.getByRole('link', { name: 'حساب الشريك' }).getAttribute('href')) ?? '';
  const partnerId = new URL(accountHref, 'http://shop').searchParams.get('id') ?? '';

  // The partner puts in 50,000 rial.
  await partner.getByRole('button', { name: 'مساهمة في رأس المال' }).click();
  await page.getByRole('dialog').getByLabel('المبلغ').fill('50000');
  await page.getByRole('dialog').getByRole('button', { name: 'حفظ' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();

  // Offline, a draw of 1,000 rial: no settlement yet, so it is ahead of the share and needs a confirmation.
  await page.context().setOffline(true);
  await partner.getByRole('button', { name: 'سحب من الأرباح' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('المبلغ').fill('1000');
  await dialog.getByLabel('السبب').fill('مصروف شخصي');
  await expect(dialog.getByText('هذا أكثر من أرباحه غير المسحوبة')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'حفظ' })).toBeDisabled();
  await dialog.getByLabel('أؤكد رغم التنبيه').click();
  await dialog.getByRole('button', { name: 'حفظ' }).click();
  await expect(dialog).toBeHidden();
  await expect(connectivity(page)).toContainText(/معلّق/);

  // The partner's account, from the records only.
  await page.goto(`/settings/partners/view?id=${partnerId}`);
  await expect(page.getByRole('heading', { name: 'شريكي' })).toBeVisible();
  await expect(page.getByRole('definition').first()).toContainText('50,000');
  await expect(page.getByRole('region', { name: 'السحوبات من الأرباح' })).toContainText(
    'مصروف شخصي',
  );

  await page.context().setOffline(false);
  await expect(connectivity(page)).not.toContainText(/معلّق/);
  await expect
    .poll(
      async () =>
        (
          await serverGet<{ account?: Record<string, number> }>(
            request,
            `/partners/${partnerId}/account`,
          )
        ).account,
    )
    .toMatchObject({ capitalCents: 250_000, drawsCents: 5000, undrawnCents: -5000 });
});

// Unique to this test: the shared database keeps what the specs leave behind.
const LEAVER = 'خالد المغادر';

test('partners: a partner with money records exits instead, one without is removed with a reason, synced', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  await signIn(page);
  await waitForAppShell(page);
  await page.goto('/settings/partners');

  // The owner and the partner exist already (the test above); set them up if it did not run.
  const setup = page.getByLabel('اسم المالك');
  const ready = page.getByRole('region', { name: 'مال المحل حسب السجلات' });
  await expect(setup.or(ready)).toBeVisible();
  if (await setup.isVisible()) {
    await setup.fill('أنا');
    await page.getByLabel('اسم الشريك').fill('شريكي');
    await page.getByRole('button', { name: 'حفظ' }).click();
    await expect(ready).toBeVisible();
  }

  // A newcomer joins at 0% with a first contribution of 1,000 rial.
  await page.getByRole('button', { name: 'إضافة شريك' }).click();
  const add = page.getByRole('dialog');
  await add.getByLabel('الاسم الكامل').fill(LEAVER);
  await add.getByLabel('المبلغ').fill('1000');
  await add.getByRole('button', { name: 'حفظ' }).click();
  await expect(add).toBeHidden();
  const card = page.getByRole('region', { name: LEAVER, exact: true });
  await expect(card).toBeVisible();
  const accountLink = card.getByRole('link', { name: 'حساب الشريك' });
  const leaverId =
    new URL((await accountLink.getAttribute('href')) ?? '', 'http://shop').searchParams.get('id') ??
    '';
  expect(leaverId).not.toBe('');

  // Their details are edited from the card's own menu, without leaving the list.
  const menu = card.getByRole('button', { name: `إجراءات الشريك: ${LEAVER}` });
  await menu.click();
  await page.getByRole('menuitem', { name: 'تعديل البيانات' }).click();
  const edit = page.getByRole('dialog');
  await edit.getByLabel('الصفة').fill('شريك مؤقت');
  await edit.getByRole('button', { name: 'حفظ' }).click();
  await expect(edit).toBeHidden();
  await expect(card.getByText('شريك مؤقت')).toBeVisible();

  // The contribution keeps them: the menu offers the exit, and no removal. The exit opens
  // without removing anything.
  await menu.click();
  await expect(page.getByRole('menuitem', { name: 'إزالة (أُضيف بالخطأ)' })).toHaveCount(0);
  await page.getByRole('menuitem', { name: 'بدء خروج الشريك' }).click();
  const exit = page.getByRole('dialog');
  await expect(exit.getByRole('heading', { name: `خروج الشريك: ${LEAVER}` })).toBeVisible();
  await exit.getByRole('button', { name: 'إلغاء' }).click();
  await expect(exit).toBeHidden();
  await expect(card).toBeVisible();

  // Voiding the contribution (with a reason) leaves them with no history.
  await accountLink.click();
  await expect(page).toHaveURL(/\/settings\/partners\/view\?id=/);
  await expect(page.getByRole('heading', { name: LEAVER })).toBeVisible();
  await page
    .getByRole('row')
    .filter({ hasText: 'مساهمة' })
    .getByRole('button', { name: 'إلغاء' })
    .click();
  const voidContribution = page.getByRole('dialog');
  await voidContribution.getByLabel('السبب').fill('أُدخلت بالخطأ');
  await voidContribution.getByRole('button', { name: 'تأكيد الإلغاء' }).click();
  await expect(voidContribution).toBeHidden();

  // The account page offers the same removal for a partner who took part in nothing; here it
  // is only checked, the list removes them.
  await page.getByRole('button', { name: 'إزالة (أُضيف بالخطأ)' }).click();
  const fromAccount = page.getByRole('dialog');
  await expect(fromAccount.getByText('لا يمكن إزالة هذا الشريك بعد:')).toBeHidden();
  await fromAccount.getByRole('button', { name: 'إلغاء' }).click();
  await expect(fromAccount).toBeHidden();
  await page.goto('/settings/partners');

  // Now the menu removes them, with a reason.
  await menu.click();
  await page.getByRole('menuitem', { name: 'إزالة (أُضيف بالخطأ)' }).click();
  const confirm = page.getByRole('dialog');
  await expect(confirm.getByText('لا يمكن إزالة هذا الشريك بعد:')).toBeHidden();
  await confirm.getByLabel('السبب').fill('خرج من الشراكة');
  await confirm.getByRole('button', { name: 'إزالة الشريك' }).click();

  // They are gone from the list, and the server has them voided.
  await expect(page.getByRole('region', { name: LEAVER, exact: true })).toHaveCount(0);
  await expect
    .poll(
      async () =>
        (await serverGet<{ id: string; voidedAt: string | null }[]>(request, '/partners')).find(
          (p) => p.id === leaverId,
        )?.voidedAt ?? null,
    )
    .not.toBeNull();

  // The owner is never offered an exit or a removal; the partner who put money in is offered
  // the exit, not the removal.
  const ownerMenu = page
    .getByRole('region', { name: 'أنا', exact: true })
    .getByRole('button', { name: /إجراءات الشريك/ });
  await ownerMenu.click();
  await expect(page.getByRole('menuitem', { name: 'تعديل البيانات' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'بدء خروج الشريك' })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'إزالة (أُضيف بالخطأ)' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page
    .getByRole('region', { name: 'شريكي', exact: true })
    .getByRole('button', { name: /إجراءات الشريك/ })
    .click();
  await expect(page.getByRole('menuitem', { name: 'بدء خروج الشريك' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'إزالة (أُضيف بالخطأ)' })).toHaveCount(0);
});
