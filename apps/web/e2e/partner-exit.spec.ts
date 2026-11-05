import { expect, type Locator, type Page, test } from '@playwright/test';
import { serverGet, serverRecords, signIn, waitForAppShell } from './helpers';

/**
 * The Partner Exit Center (S20), driven the way the owner drives it, in Arabic. Every partner
 * here has a name of its own: the specs share one database. Figures that depend on the cash the
 * other specs left are never compared; only the partner's own account is.
 *
 * Profit that settlements allocated cannot be made here without locking a month for the other
 * specs; that part of the exit (partial and full profit payments, settled history untouched) is
 * covered by the local-db tests (src/local-db/partners.test.ts) and the API
 * (apps/api/test/partner-exit.e2e-spec.ts).
 */

interface AccountBody {
  account?: { capitalCents: number; undrawnCents: number; drawsCents: number };
}

async function ensureShop(page: Page) {
  await page.goto('/settings/partners');
  const setup = page.getByLabel('اسم المالك');
  const ready = page.getByRole('region', { name: 'مال المحل حسب السجلات' });
  await expect(setup.or(ready)).toBeVisible();
  if (await setup.isVisible()) {
    await setup.fill('أنا');
    await page.getByLabel('اسم الشريك').fill('شريكي');
    await page.getByRole('button', { name: 'حفظ' }).click();
    await expect(ready).toBeVisible();
  }
}

/** A partner who joins with some ownership (taken from the owner), capital and a profit weight. */
async function addPartner(
  page: Page,
  o: { name: string; ownership?: number; capitalRial?: string; weight?: string },
): Promise<string> {
  await ensureShop(page);
  await page.getByRole('button', { name: 'إضافة شريك' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('الاسم الكامل').fill(o.name);
  if (o.ownership) {
    const owner = dialog.getByLabel('أنا', { exact: true });
    const before = Number(await owner.inputValue());
    expect(before).toBeGreaterThan(o.ownership);
    await dialog.getByLabel(o.name, { exact: true }).fill(String(o.ownership));
    await owner.fill(String(before - o.ownership));
  }
  if (o.capitalRial) await dialog.getByLabel('المبلغ').fill(o.capitalRial);
  if (o.weight) await dialog.getByLabel('الوزن').fill(o.weight);
  await dialog.getByRole('button', { name: 'حفظ' }).click();
  await expect(dialog).toBeHidden();
  const card = page.getByRole('region', { name: o.name, exact: true });
  await expect(card).toBeVisible();
  const href = (await card.getByRole('link', { name: 'حساب الشريك' }).getAttribute('href')) ?? '';
  return new URL(href, 'http://shop').searchParams.get('id') ?? '';
}

/** The exit dialog of a partner, opened from the card's menu. */
async function startExit(page: Page, name: string): Promise<Locator> {
  await page.goto('/settings/partners');
  const card = page.getByRole('region', { name, exact: true });
  await card.getByRole('button', { name: `إجراءات الشريك: ${name}` }).click();
  await page.getByRole('menuitem', { name: 'بدء خروج الشريك' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: `خروج الشريك: ${name}` })).toBeVisible();
  return dialog;
}

const section = (dialog: Locator, title: string) =>
  dialog
    .locator('section[data-state]')
    .filter({ has: dialog.page().getByText(title, { exact: true }) });

async function openSection(dialog: Locator, title: string) {
  const row = section(dialog, title);
  const head = row.getByRole('button').first();
  if ((await head.getAttribute('aria-expanded')) !== 'true') await head.click();
  return row;
}

async function accountOf(request: Parameters<typeof serverGet>[0], id: string) {
  return (await serverGet<AccountBody>(request, `/partners/${id}/account`)).account;
}

test('exit: a partner with no history leaves in two taps, and stays as a former partner', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signIn(page);
  await waitForAppShell(page);
  const name = 'سامي بلا سجل';
  const id = await addPartner(page, { name });

  const dialog = await startExit(page, name);
  // Nothing needs a decision: every part reads as not applicable and the review is open.
  await expect(section(dialog, 'الأرباح المستحقة')).toHaveAttribute('data-state', 'na');
  await expect(section(dialog, 'رأس المال')).toHaveAttribute('data-state', 'na');
  await expect(section(dialog, 'الملكية وحصة الأرباح')).toHaveAttribute('data-state', 'done');
  await expect(section(dialog, 'التزامات أخرى')).toHaveAttribute('data-state', 'na');
  await expect(dialog.getByText('كل شيء محسوم. راجعه قبل التأكيد.')).toBeVisible();

  // Opening the center removed nothing.
  await dialog.getByRole('button', { name: 'إلغاء' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('region', { name, exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name, exact: true }).getByText('شريك سابق')).toHaveCount(
    0,
  );

  const again = await startExit(page, name);
  await again.getByRole('button', { name: 'مراجعة الخروج' }).click();
  await expect(again.getByText('راجع كل سطر. لا يحدث شيء حتى تؤكد.')).toBeVisible();
  await again.getByRole('button', { name: 'إتمام خروج الشريك' }).click();
  await expect(again).toBeHidden();

  // Under former partners, with the account still there.
  const former = page.getByRole('region', { name, exact: true });
  await expect(page.getByRole('heading', { name: 'الشركاء السابقون' })).toBeVisible();
  await expect(former.getByText('شريك سابق')).toBeVisible();
  await former.getByRole('link', { name: 'حساب الشريك' }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
  await expect(page.getByText('شريك سابق')).toBeVisible();
  await expect(page.getByRole('button', { name: 'إعادته شريكاً' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'بدء خروج الشريك' })).toHaveCount(0);

  // Not a delete: the server has the partner, with the day they left.
  await expect
    .poll(async () => {
      const rows = await serverGet<{ id: string; voidedAt: string | null; exitedOn?: string }[]>(
        page.request,
        '/partners',
      );
      const row = rows.find((p) => p.id === id);
      return row ? { voided: row.voidedAt !== null, left: Boolean(row.exitedOn) } : null;
    })
    .toEqual({ voided: false, left: true });
});

test('exit: capital paid in part, ownership and profit share handed over, the rest kept on the account', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  await signIn(page);
  await waitForAppShell(page);
  const name = 'هاني الخارج';
  const id = await addPartner(page, { name, ownership: 10, capitalRial: '1000', weight: '1' });
  const settlementsBefore = JSON.stringify(
    (await serverRecords<{ id: string; voidedAt: string | null }>(request, 'settlement'))
      .map((s) => [s.id, s.voidedAt])
      .sort(),
  );

  const dialog = await startExit(page, name);
  // The overview: ownership, profit-sharing, capital (1,000 rial) and what is undrawn.
  await expect(dialog.getByText('الملكية', { exact: true }).first()).toBeVisible();
  await expect(dialog.getByText('رصيد رأس المال')).toBeVisible();

  // The capital and the transfer need a decision; a first tap on review opens the first of them.
  await expect(section(dialog, 'رأس المال')).toHaveAttribute('data-state', 'needs');
  await expect(section(dialog, 'الملكية وحصة الأرباح')).toHaveAttribute('data-state', 'needs');
  await dialog.getByRole('button', { name: 'مراجعة الخروج' }).click();
  await expect(dialog.getByText('راجع كل سطر. لا يحدث شيء حتى تؤكد.')).toBeHidden();

  // Capital: pay 400 of the 1,000 rial now; 600 stays on the account, and the figure updates.
  const capital = await openSection(dialog, 'رأس المال');
  await capital.getByText('رُدّ الآن').click();
  await capital.getByLabel('المبلغ').fill('400');
  await expect(capital.getByText('يبقى في حسابه').first()).toBeVisible();
  await expect(section(dialog, 'رأس المال')).toHaveAttribute('data-state', 'ready');

  // Ownership and the profit share go to the owner / nobody in particular.
  const transfer = await openSection(dialog, 'الملكية وحصة الأرباح');
  await expect(transfer.getByText(/الملكية هي الجزء الذي يملكه من المحل/)).toBeVisible();
  const ownership = transfer.getByRole('radiogroup', { name: /ملكيته/ });
  await ownership.getByText('شخص واحد').click();
  await transfer.getByLabel('تنتقل إلى', { exact: true }).first().click();
  await page.getByRole('option', { name: 'المالك', exact: true }).click();
  const profit = transfer.getByRole('radiogroup', { name: /حصته/ });
  if (await profit.count()) {
    await profit.getByText('لا أحد بعينه').click();
    // The split is shown before and after, at once.
    await expect(transfer.getByText(/قسمة الأرباح ابتداءً من/)).toBeVisible();
  }
  await expect(section(dialog, 'الملكية وحصة الأرباح')).toHaveAttribute('data-state', 'ready');

  // Review in plain words, then confirm; a second tap while it is written does nothing.
  await dialog.getByRole('button', { name: 'مراجعة الخروج' }).click();
  await expect(dialog.getByText('راجع كل سطر. لا يحدث شيء حتى تؤكد.')).toBeVisible();
  await expect(dialog.getByText('ما لا يتغيّر')).toBeVisible();
  await expect(dialog.getByText('ما يبقى مستحقاً له بعد ذلك')).toBeVisible();
  const confirm = dialog.getByRole('button', { name: 'إتمام خروج الشريك' });
  await confirm.dblclick();
  await expect(dialog).toBeHidden();

  // Exactly one withdrawal of 400 rial (2,000 cents); 600 rial (3,000 cents) stays.
  await expect
    .poll(async () => accountOf(request, id))
    .toMatchObject({ capitalCents: 3000, undrawnCents: 0 });
  const moves = (
    await serverRecords<{
      partnerId: string;
      type: string;
      amountCents: number;
      voidedAt: string | null;
    }>(request, 'capital_move')
  ).filter((move) => move.partnerId === id && move.type === 'withdrawal' && move.voidedAt === null);
  expect(moves).toHaveLength(1);
  expect(moves[0]?.amountCents).toBe(-2000);

  // The former partner's card shows what is still owed; no delete anywhere.
  const former = page.getByRole('region', { name, exact: true });
  await expect(page.getByRole('heading', { name: 'الشركاء السابقون' })).toBeVisible();
  await expect(former.getByText('رأس مال مستحق')).toBeVisible();
  await expect(former.getByRole('button', { name: 'مساهمة في رأس المال' })).toHaveCount(0);

  // They are out of every picker for the shop's ownership.
  await page.getByRole('button', { name: 'حصص الملكية' }).click();
  const shares = page.getByRole('dialog');
  await expect(shares.getByLabel(name, { exact: true })).toHaveCount(0);
  await shares.getByRole('button', { name: 'إلغاء' }).click();

  // Later, the rest is paid from the same account: it is a normal capital withdrawal.
  await former.getByRole('button', { name: 'سحب من رأس المال' }).click();
  const pay = page.getByRole('dialog');
  await pay.getByLabel('المبلغ').fill('600');
  await pay.getByLabel('السبب').fill('باقي رأس المال');
  await pay.getByRole('button', { name: 'حفظ' }).click();
  await expect(pay).toBeHidden();
  await expect.poll(async () => accountOf(request, id)).toMatchObject({ capitalCents: 0 });

  // The account page keeps every record, and no settlement changed.
  await former.getByRole('link', { name: 'حساب الشريك' }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
  await expect(page.getByText('باقي رأس المال')).toBeVisible();
  await expect(page.getByText('رأس مال رُدّ عند الخروج من الشراكة')).toBeVisible();
  const settlementsAfter = JSON.stringify(
    (await serverRecords<{ id: string; voidedAt: string | null }>(request, 'settlement'))
      .map((s) => [s.id, s.voidedAt])
      .sort(),
  );
  expect(settlementsAfter).toBe(settlementsBefore);
});

test('exit: capital left on the account, a later departure date, and bringing a partner back', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  await signIn(page);
  await waitForAppShell(page);
  const name = 'ليلى المؤجّلة';
  const id = await addPartner(page, { name, capitalRial: '500' });

  const dialog = await startExit(page, name);
  const capital = await openSection(dialog, 'رأس المال');
  await capital.getByText('اتركه في حسابه').click();
  await expect(section(dialog, 'رأس المال')).toHaveAttribute('data-state', 'ready');

  // A date a month ahead: she is leaving, not gone; the hint says when the profit stops.
  const future = new Date();
  future.setDate(future.getDate() + 30);
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Casablanca' }).format(future);
  await dialog.getByLabel('تاريخ المغادرة').fill(day);
  await expect(dialog.getByText(/تتوقف حصتها|تتوقف حصته من الأرباح ابتداءً من/)).toBeVisible();
  await dialog.getByRole('button', { name: 'مراجعة الخروج' }).click();
  await dialog.getByLabel('ملاحظة عمّا بقي مستحقاً').fill('يُرَدّ بعد 30 يوماً');
  await dialog.getByRole('button', { name: 'إتمام خروج الشريك' }).click();
  await expect(dialog).toBeHidden();

  // Nothing was paid: the capital is intact, the partner is leaving.
  await expect.poll(async () => accountOf(request, id)).toMatchObject({ capitalCents: 2500 });
  const card = page.getByRole('region', { name, exact: true });
  await expect(card.getByText(/يغادر في/)).toBeVisible();
  await expect(card.getByText('رأس مال مستحق')).toBeVisible();

  // Brought back: active again, with no ownership or profit share until the owner gives one.
  await card.getByRole('button', { name: `إجراءات الشريك: ${name}` }).click();
  await page.getByRole('menuitem', { name: 'إعادته شريكاً' }).click();
  await expect(page.getByRole('region', { name, exact: true }).getByText(/يغادر في/)).toHaveCount(
    0,
  );
});

test('exit: closing the center changes nothing, and figures that move during the review hold the confirmation', async ({
  page,
  context,
  request,
}) => {
  test.setTimeout(180_000);
  await signIn(page);
  await waitForAppShell(page);
  const name = 'نادر المراجع';
  const id = await addPartner(page, { name, capitalRial: '200' });

  // An exit that is started and abandoned writes nothing, even after a reload.
  let dialog = await startExit(page, name);
  const capital = await openSection(dialog, 'رأس المال');
  await capital.getByText('رُدّ الآن').click();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await page.reload();
  await expect(page.getByRole('region', { name, exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name, exact: true }).getByText('شريك سابق')).toHaveCount(
    0,
  );
  await expect.poll(async () => accountOf(request, id)).toMatchObject({ capitalCents: 1000 });

  // A second tab of the same device takes part of the capital while the review is open.
  dialog = await startExit(page, name);
  const again = await openSection(dialog, 'رأس المال');
  await again.getByText('رُدّ الآن').click();
  await dialog.getByRole('button', { name: 'مراجعة الخروج' }).click();
  await expect(dialog.getByText('راجع كل سطر. لا يحدث شيء حتى تؤكد.')).toBeVisible();

  const other = await context.newPage();
  await other.goto('/settings/partners');
  const card = other.getByRole('region', { name, exact: true });
  await card.getByRole('button', { name: 'سحب من رأس المال' }).click();
  const move = other.getByRole('dialog');
  await move.getByLabel('المبلغ').fill('50');
  await move.getByLabel('السبب').fill('جزء قبل الخروج');
  await move.getByRole('button', { name: 'حفظ' }).click();
  await expect(move).toBeHidden();
  await other.close();

  // The review says the figures moved and refuses to confirm on the old ones.
  await expect(
    dialog.getByText('تغيّرت أرقامه أثناء المراجعة. ارجع لترى الأرقام الجديدة.'),
  ).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'إتمام خروج الشريك' })).toBeDisabled();

  // Back, the amount asked is more than what is left now; the owner corrects it and goes on.
  await dialog.getByRole('button', { name: 'رجوع' }).click();
  const fresh = await openSection(dialog, 'رأس المال');
  await expect(fresh.getByText('أكثر من المستحق.')).toBeVisible();
  await fresh.getByLabel('المبلغ').fill('150');
  await expect(fresh.getByText('أكثر من المستحق.')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'مراجعة الخروج' }).click();
  await dialog.getByRole('button', { name: 'إتمام خروج الشريك' }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(async () => accountOf(request, id)).toMatchObject({ capitalCents: 0 });
});
