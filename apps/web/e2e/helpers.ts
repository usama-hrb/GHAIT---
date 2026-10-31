import { type APIRequestContext, expect, type Page } from '@playwright/test';
import { E2E } from './stack';

export async function signIn(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('اسم المستخدم').fill(E2E.owner.username);
  await page.getByLabel('كلمة المرور').fill(E2E.owner.password);
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

/** Picks an option of one of our comboboxes (Command + Popover). */
export async function choose(page: Page, label: string, option: string): Promise<void> {
  await page.getByLabel(label, { exact: true }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
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
