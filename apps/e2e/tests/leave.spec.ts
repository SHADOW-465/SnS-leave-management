import { expect } from '@playwright/test';
import { requestRow, signIn, signOut, test, weekday } from '../support.js';

// Both report to Arun Prakash. Karthik has 2.5 days of Annual Leave, Divya 19.5.
test.describe.configure({ mode: 'serial' });

test('sign in rejects a wrong password, then signs in and out', async ({ page }) => {
  await signIn(page, 'karthik@sns.test', 'not-the-password');
  await expect(page.getByRole('alert')).toHaveText('Email or password is incorrect.');
  await expect(page.getByRole('heading', { name: 'Sign in to Leave OS' })).toBeVisible();
  // Email was removed (DW-34); the sign-in page must not promise it.
  await expect(page.getByText(/mail is down|safety net/i)).toHaveCount(0);

  await signIn(page, 'SNS-1012');
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  await signOut(page);
});

test('employee applies within quota: no loss-of-pay tick box, request is pending', async ({
  page,
}) => {
  await signIn(page, 'divya@sns.test');
  await page.goto('/apply');
  const day = weekday(3);
  await page.getByLabel('From').fill(day);
  await page.getByLabel('To').fill(day);
  await expect(page.getByTestId('lop-days')).toHaveText(/^0/);
  await expect(page.getByRole('checkbox', { name: /loss of pay/ })).toHaveCount(0);
  await page.getByLabel('Reason').fill('Family function');
  await page.getByRole('button', { name: 'Submit request' }).click();
  await expect(page).toHaveURL(/\/requests$/);
  await expect(requestRow(page, 'Divya Nair', day)).toContainText(/pending/i);
});

test('beyond quota the loss-of-pay tick box is required before Submit', async ({ page }) => {
  await signIn(page, 'karthik@sns.test');
  await page.goto('/apply');
  const submit = page.getByRole('button', { name: 'Submit request' });
  const tick = page.getByRole('checkbox', { name: /loss of pay/ });

  // Monday to Friday is 5 working days against 2.5 available.
  await page.getByLabel('From').fill(weekday(4));
  await page.getByLabel('To').fill(weekday(4, 4));
  await expect(page.getByTestId('lop-days')).toHaveText('2.5 days');
  await expect(tick).toBeVisible();
  await expect(submit).toBeDisabled();

  await tick.check();
  await expect(submit).toBeEnabled();

  // A tick given for 2.5 unpaid days is not consent to 7.5: changing the dates clears it.
  await page.getByLabel('To').fill(weekday(5, 4));
  await expect(page.getByTestId('lop-days')).toHaveText('7.5 days');
  await expect(tick).not.toBeChecked();
  await expect(submit).toBeDisabled();
  await page.getByLabel('To').fill(weekday(4, 4));

  // The server enforces it too: the same request without the confirmation is refused.
  const csrf = (await page.context().cookies()).find((c) => c.name === 'leaveos.csrf')?.value;
  const types = await (await page.request.get('/api/v1/leave-types')).json();
  const refused = await page.request.post('/api/v1/leave-requests', {
    headers: { 'x-csrf-token': csrf ?? '', 'Idempotency-Key': crypto.randomUUID() },
    data: {
      leaveTypeId: types.data[0].id,
      startDate: weekday(4),
      endDate: weekday(4, 4),
      halfDayStart: null,
      reason: 'No confirmation',
    },
  });
  expect(refused.status()).toBe(400);
  expect((await refused.json()).error.code).toBe('LOP_CONFIRMATION_REQUIRED');

  await tick.check();
  await page.getByLabel('Reason').fill('Travel');
  await submit.click();
  await expect(page).toHaveURL(/\/requests$/);
  await expect(requestRow(page, 'Karthik Raja', weekday(4))).toContainText('2.5 LOP');
});

test('approver sees Paid Days and Loss of Pay, approves one and rejects the other', async ({
  page,
}) => {
  await signIn(page, 'arun@sns.test');
  await page.goto('/approvals');

  await requestRow(page, 'Karthik Raja', weekday(4)).click();
  const drawer = page.getByRole('dialog');
  await expect(drawer.locator('dt', { hasText: 'Paid Days' }).locator('+ dd')).toHaveText(
    '2.5 days',
  );
  await expect(drawer.locator('dt', { hasText: 'Loss of Pay' }).locator('+ dd')).toHaveText(
    '2.5 days (unpaid)',
  );
  await drawer.getByRole('button', { name: 'Close preview' }).click();

  const karthik = requestRow(page, 'Karthik Raja', weekday(4));
  await karthik.getByRole('button', { name: 'Approve Karthik Raja' }).click();
  await expect(karthik.getByRole('button', { name: 'Approve Karthik Raja' })).toHaveCount(0);

  const divya = requestRow(page, 'Divya Nair', weekday(3));
  await divya.getByRole('button', { name: 'Reject Divya Nair' }).click();
  const reject = page.getByRole('dialog', { name: /Reject Divya Nair/ });
  await expect(reject.getByRole('button', { name: 'Reject request' })).toBeDisabled();
  await reject.getByLabel('Reason').fill('Team is short that week');
  await reject.getByRole('button', { name: 'Reject request' }).click();
  await expect(divya.getByRole('button', { name: 'Reject Divya Nair' })).toHaveCount(0);
});

test('in-app notifications tell each employee the decision', async ({ page }) => {
  await signIn(page, 'karthik@sns.test');
  await page.getByRole('button', { name: /unread notifications/ }).click();
  const panel = page.getByRole('region', { name: 'Notifications' });
  await expect(
    panel.getByRole('button', { name: /Leave approved/ }).filter({ hasText: 'loss of pay' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Mark all read' }).click();
  await expect(page.getByRole('button', { name: 'Notifications', exact: true })).toBeVisible();
  await signOut(page);

  await signIn(page, 'divya@sns.test');
  await page.getByRole('button', { name: /unread notifications/ }).click();
  await expect(
    page
      .getByRole('region', { name: 'Notifications' })
      .getByRole('button', { name: /Leave rejected/ })
      .filter({ hasText: 'Team is short that week' }),
  ).toBeVisible();
});
