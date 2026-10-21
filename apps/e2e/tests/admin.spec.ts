import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, type Page } from '@playwright/test';
import { ADMIN, DEMO_PASSWORD, signIn, signOut, test } from '../support.js';

// The last test here changes the administrator's password, so the order is fixed.
test.describe.configure({ mode: 'serial' });

async function chooseNewPassword(page: Page, current: string, next: string) {
  await page.getByLabel('Current password').fill(current);
  await page.getByLabel('New password (12+ characters)').fill(next);
  await page.getByRole('button', { name: 'Update password' }).click();
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
}

test('administrator resets a password; the person must choose a new one', async ({ page }) => {
  await signIn(page, ADMIN.email, ADMIN.password);
  await page.goto('/admin/users');
  page.once('dialog', (d) => void d.accept());
  await page
    .getByRole('row')
    .filter({ hasText: 'sneha@sns.test' })
    .getByRole('button', { name: 'Reset password' })
    .click();
  const issued = page.getByRole('status').filter({ hasText: 'Give these details to' });
  const temporary = (await issued.locator('dt:has-text("First password") + dd').innerText()).trim();
  expect(temporary).toHaveLength(16);
  await signOut(page);

  await signIn(page, 'sneha@sns.test', DEMO_PASSWORD);
  await expect(page.getByRole('alert')).toHaveText('Email or password is incorrect.');

  await signIn(page, 'sneha@sns.test', temporary);
  await expect(page.getByRole('button', { name: 'Update password' })).toBeVisible();
  await chooseNewPassword(page, temporary, 'Sneha-e2e-chosen-1');
  await signOut(page);
  await signIn(page, 'sneha@sns.test', 'Sneha-e2e-chosen-1');
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
});

test('number inputs do not keep a leading zero when typing over 0', async ({ page }) => {
  await signIn(page, ADMIN.email, ADMIN.password);
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Edit rules for Annual Leave' }).click();
  const notice = page.getByLabel('Minimum notice (days)');
  await notice.fill('0');
  await notice.click();
  await notice.press('End');
  await notice.pressSequentially('12');
  await expect(notice).toHaveValue('12');
});

test('backups panel saves the folder and count, and Back up now writes there', async ({ page }) => {
  const folder = mkdtempSync(path.join(tmpdir(), 'leaveos-e2e-usb-'));
  try {
    await page.goto('/host');
    const form = page.locator('#backup-settings');
    await form.getByLabel('Back up automatically every day').check();
    await form.getByLabel(/Backup folder/).fill(folder);
    await form.getByLabel('Backups to keep').fill('3');
    await form.getByRole('button', { name: 'Save backup settings' }).click();
    await expect(page.getByRole('status')).toHaveText('Backup settings saved.');
    await expect(form.getByLabel(/Backup folder/)).toHaveValue(folder);
    await expect(form.getByLabel('Backups to keep')).toHaveValue('3');
    await expect(form.getByLabel('Back up automatically every day')).toBeChecked();

    await page.getByRole('button', { name: 'Back up now' }).click();
    await expect(page.getByRole('status')).toContainText('Backup saved (ok)');
    await expect(page.locator('#last-backup time')).toBeVisible();
    const files = readdirSync(folder).filter((n) => /^backup-.*\.db$/.test(n));
    expect(files).toHaveLength(1);
    const backups = page.locator('section', {
      has: page.getByRole('heading', { name: 'Backups' }),
    });
    await expect(backups).toContainText(files[0]!);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test('administrator recovery on the host PC lifts a lockout and forces a new password', async ({
  page,
}) => {
  // Five wrong passwords lock the account.
  for (let i = 0; i < 5; i++) {
    await page.request.post('/api/v1/auth/login', {
      data: { email: ADMIN.email, password: `wrong-${i}` },
    });
  }
  await signIn(page, ADMIN.email, ADMIN.password);
  await expect(page.getByRole('alert')).toContainText('locked');

  // A page elsewhere cannot post to the break-glass form: it has no panel token.
  const forged = await page.request.post('/api/v1/host/recover-admin', {
    form: { userId: 'anything' },
    maxRedirects: 0,
  });
  expect(forged.status()).toBe(303);
  expect(forged.headers().location).toContain('error=');

  await page.goto('/host');
  await page
    .locator('#recovery form')
    .filter({ hasText: ADMIN.email })
    .getByRole('button', { name: 'Reset password' })
    .click();
  await expect(page.getByRole('heading', { name: 'Temporary password' })).toBeVisible();
  const temporary = (await page.locator('#temp-password').innerText()).trim();

  await signIn(page, ADMIN.email, temporary);
  await expect(page.getByRole('button', { name: 'Update password' })).toBeVisible();
  await chooseNewPassword(page, temporary, 'Admin-e2e-recovered-1');
});
