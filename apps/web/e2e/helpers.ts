import { type APIRequestContext, expect, type Page } from '@playwright/test';
import { E2E } from './stack';

export async function signIn(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('اسم المستخدم').fill(E2E.owner.username);
  await page.getByLabel('كلمة المرور').fill(E2E.owner.password);
  await page.getByRole('button', { name: 'دخول' }).click();
  await expect(page).toHaveURL(/\/inventory$/);
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
