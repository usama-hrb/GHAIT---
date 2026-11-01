import { type APIRequestContext, expect, type Locator, type Page } from '@playwright/test';
import { E2E } from './stack';

/**
 * The language a page opens in. The app's default is English; most specs read Arabic, so signIn()
 * opens the page in Arabic. A choice already made on the page (the language icon) is kept.
 */
export async function setDeviceLanguage(page: Page, language: 'ar' | 'en'): Promise<void> {
  await page.addInitScript((value) => {
    try {
      if (localStorage.getItem('fabric.language') === null) {
        localStorage.setItem('fabric.language', value);
      }
    } catch {
      // Storage blocked: the app keeps its default language.
    }
  }, language);
}

export async function signIn(
  page: Page,
  account: { username: string; password: string } = E2E.owner,
): Promise<void> {
  await setDeviceLanguage(page, 'ar');
  await page.goto('/login');
  await page.getByLabel('اسم المستخدم').fill(account.username);
  await page.getByLabel('كلمة المرور').fill(account.password);
  await page.getByRole('button', { name: 'دخول' }).click();
  await expect(page).toHaveURL(/\/home$/);
}

/** The service worker controls the page once the app shell is precached. */
export async function waitForAppShell(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true);
}

/** What the server has, straight from the API (what every other device will pull). */
export async function serverGet<T>(request: APIRequestContext, path: string): Promise<T> {
  const login = await request.post(`${E2E.apiUrl}/auth/login`, { data: E2E.owner });
  const { accessToken } = (await login.json()) as { accessToken: string };
  const response = await request.get(`${E2E.apiUrl}${path}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  return (await response.json()) as T;
}

/** A change made straight on the API as the owner (what another device would have synced). */
export async function serverPut<T>(
  request: APIRequestContext,
  path: string,
  data: unknown,
): Promise<T> {
  const login = await request.post(`${E2E.apiUrl}/auth/login`, { data: E2E.owner });
  const { accessToken } = (await login.json()) as { accessToken: string };
  const response = await request.put(`${E2E.apiUrl}${path}`, {
    headers: { authorization: `Bearer ${accessToken}` },
    data,
  });
  expect(response.ok()).toBe(true);
  return (await response.json()) as T;
}

/**
 * Picks an option of one of our comboboxes (Command + Popover). A popover that has just closed
 * hands focus back to its trigger, which can close the next one a moment after it opened (seen
 * when the machine is busy): open it again until the option can be clicked.
 */
export async function choose(page: Page, label: string, option: string): Promise<void> {
  const trigger = page.getByLabel(label, { exact: true });
  const choice = page.getByRole('option', { name: option, exact: true });
  await expect(async () => {
    if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
    await choice.click({ timeout: 2000 });
  }).toPass({ timeout: 20_000 });
}

/** The header's connectivity badge (other live regions, like toasts, are also role=status). */
export function connectivity(page: Page) {
  return page.getByRole('status').filter({ hasText: /متصل|دون اتصال/ });
}

/** A fabric with two colours, through the UI (prices in rial: 400 rial = 20 dh). */
export async function addFabric(page: Page, name: string): Promise<void> {
  await page.goto('/inventory/fabric');
  await page.getByLabel('اسم القماش').fill(name);
  await page.getByLabel('السعر المرجعي للمتر').fill('400');
  await page.getByLabel('أقل سعر للمتر').fill('360');
  await page.getByRole('button', { name: 'حفظ' }).click();
  await expect(page).toHaveURL(/\/inventory\/fabric\?id=/);
  for (const color of ['أحمر', 'أزرق']) {
    await page.getByRole('button', { name: 'إضافة لون' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('اسم اللون').fill(color);
    await dialog.getByRole('button', { name: 'حفظ' }).click();
    await expect(page.getByText(color, { exact: true })).toBeVisible();
  }
}

export async function startPurchase(page: Page, method: string, fabric: string): Promise<void> {
  await page.goto('/purchases/new');
  await page.getByRole('tab', { name: method }).click();
  await choose(page, 'القماش', fabric);
}

export async function reviewAndSave(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'مراجعة الشراء' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText(/^R-[A-Z]+\d{4}$/).first()).toBeVisible();
  await dialog.getByRole('button', { name: 'حفظ الشراء' }).click();
  await expect(page).toHaveURL(/\/purchases\/view\?id=/);
}

/** A colour's tile on the POS: its length and price dialog opens. */
export async function pickColor(page: Page, fabric: string, color: string): Promise<Locator> {
  await page.getByRole('button', { name: new RegExp(`${color}\\s+${fabric}`) }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

/**
 * One line on the POS invoice, through the tile and its dialog (the length and the price are
 * typed into the fields; `price` in rial, the reference price when left out).
 */
export async function addToBill(
  page: Page,
  fabric: string,
  color: string,
  meters: string,
  price?: string,
): Promise<void> {
  const dialog = await pickColor(page, fabric, color);
  await dialog.getByLabel('الطول', { exact: true }).fill(meters);
  if (price) await dialog.getByLabel('سعر المتر', { exact: true }).fill(price);
  await dialog.getByRole('button', { name: 'أضف إلى الفاتورة' }).click();
  await expect(dialog).toBeHidden();
}

/** Pay the invoice in full and save the sale. */
export async function payInFull(page: Page): Promise<void> {
  // On a phone the invoice is a drawer behind a bar at the bottom of the screen.
  const bar = page.getByRole('button', { name: /^الفاتورة ·/ });
  if (await bar.isVisible()) await bar.click();
  await page.getByRole('button', { name: /^ادفع/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'إتمام البيع' }).click();
}

/** Every record of `entity` the server has, pulled page by page (voided ones included). */
export async function serverRecords<T>(request: APIRequestContext, entity: string): Promise<T[]> {
  const login = await request.post(`${E2E.apiUrl}/auth/login`, { data: E2E.owner });
  const { accessToken } = (await login.json()) as { accessToken: string };
  const found: T[] = [];
  let since = 0;
  for (;;) {
    const response = await request.get(`${E2E.apiUrl}/sync/pull?since=${String(since)}&limit=500`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    const page = (await response.json()) as {
      changes: { entity: string; record: T }[];
      nextSince: number;
      hasMore: boolean;
    };
    found.push(...page.changes.filter((change) => change.entity === entity).map((c) => c.record));
    since = page.nextSince;
    if (!page.hasMore) return found;
  }
}
