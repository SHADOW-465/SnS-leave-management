import { expect, test } from '@playwright/test';
import { BARE_ADMIN, signIn, startBareServer, type TestServer } from '../support.js';

// Each block runs its own server: the rate limit would lock out every later sign-in from
// this machine, and expiry needs sessions measured in seconds.

test.describe('login rate limit', () => {
  let server: TestServer;
  test.beforeAll(async () => {
    server = await startBareServer();
  });
  test.afterAll(async () => {
    await server.stop();
  });

  test('limits by name tried, then by address, even for the right password', async ({ page }) => {
    test.setTimeout(120_000);
    const fail = (email: string) =>
      page.request.post(`${server.url}/api/v1/auth/login`, {
        data: { email, password: 'wrong-password' },
      });
    // Ten failures for a name that does not exist: the eleventh try is refused outright.
    for (let i = 0; i < 10; i++) expect((await fail('nobody@example.invalid')).status()).toBe(401);
    await signIn(page, 'nobody@example.invalid', 'wrong-password', server.url);
    await expect(page.getByRole('alert')).toHaveText(
      'Too many failed sign-in attempts. Wait 15 minutes and try again.',
    );

    // Other names from the same address still work until the address reaches twenty.
    await signIn(page, BARE_ADMIN.email, BARE_ADMIN.password, server.url);
    await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();

    for (let i = 0; i < 10; i++) await fail(`guess-${i}@example.invalid`);
    await signIn(page, BARE_ADMIN.email, BARE_ADMIN.password, server.url);
    await expect(page.getByRole('alert')).toHaveText(
      'Too many failed sign-in attempts. Wait 15 minutes and try again.',
    );
    await expect(page.getByRole('heading', { name: 'Sign in to Leave OS' })).toBeVisible();
  });
});

test.describe('session expiry', () => {
  let server: TestServer;
  // 0.002 h is 7.2 s idle; 0.005 h is 18 s from sign-in, however active.
  test.beforeAll(async () => {
    server = await startBareServer({
      LEAVEOS_SESSION_IDLE_HOURS: '0.002',
      LEAVEOS_SESSION_ABSOLUTE_HOURS: '0.005',
    });
  });
  test.afterAll(async () => {
    await server.stop();
  });

  test('an idle session ends and the next click returns to sign-in', async ({ page }) => {
    await signIn(page, BARE_ADMIN.email, BARE_ADMIN.password, server.url);
    await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
    await page.waitForTimeout(9_000);
    await page.getByRole('link', { name: 'My requests' }).click();
    await expect(page.getByRole('heading', { name: 'Sign in to Leave OS' })).toBeVisible();
    expect((await page.request.get(`${server.url}/api/v1/me`)).status()).toBe(401);
  });

  test('an active session still ends at the absolute limit', async ({ page }) => {
    test.setTimeout(90_000);
    await signIn(page, BARE_ADMIN.email, BARE_ADMIN.password, server.url);
    const started = Date.now();
    // Activity every 3 s keeps it inside the idle limit.
    while (Date.now() - started < 12_000) {
      expect((await page.request.get(`${server.url}/api/v1/me`)).status()).toBe(200);
      await page.waitForTimeout(3_000);
    }
    while (Date.now() - started < 20_000) {
      await page.request.get(`${server.url}/api/v1/me`);
      await page.waitForTimeout(3_000);
    }
    expect((await page.request.get(`${server.url}/api/v1/me`)).status()).toBe(401);
    await page.getByRole('link', { name: 'My requests' }).click();
    await expect(page.getByRole('heading', { name: 'Sign in to Leave OS' })).toBeVisible();
  });
});
