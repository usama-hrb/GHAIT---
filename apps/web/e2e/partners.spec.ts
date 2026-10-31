import { expect, test } from '@playwright/test';
import { connectivity, serverGet, signIn, waitForAppShell } from './helpers';

test('partners: set up, a contribution, a draw offline beyond the share (confirmed), synced', async ({
  page,
  request,
}) => {
  await signIn(page);
  await waitForAppShell(page);

  // Set up once: the owner and the partner, 50/50.
  await page.goto('/partners');
  await page.getByLabel('اسم المالك').fill('أنا');
  await page.getByLabel('اسم الشريك').fill('شريكي');
  await expect(page.getByText('حصة الشريك: 50%')).toBeVisible();
  await page.getByRole('button', { name: 'حفظ' }).click();
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
  await page.goto(`/partners/view?id=${partnerId}`);
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
