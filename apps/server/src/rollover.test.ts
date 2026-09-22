/**
 * The leave year used to end with everyone's balance silently reading zero: entitlement
 * is scoped to a leave period, a new period appears on the first day of the new year, and
 * nothing granted anything into it. These tests pin the behaviour that fixes it.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type Db } from '@sns/database';
import { loadConfig } from '@sns/config';
import { buildApp } from './app.js';
import { openCurrentPeriod, runMonthlyAccrual, expireCarriedDays } from './jobs/balance.js';
import type { FastifyInstance } from 'fastify';

const opened: { sqlite: Db; dir: string }[] = [];
const ADMIN = { email: 'admin@example.invalid', password: 'ChangeMe_admin_1' };

async function boot(): Promise<{ app: FastifyInstance; sqlite: Db }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leaveos-roll-'));
  const sqlite = await openDatabase(path.join(dir, 'app.db'));
  opened.push({ sqlite, dir });
  const app = await buildApp(loadConfig({ LEAVEOS_DATA_DIR: dir, LEAVEOS_ENV: 'test' }), sqlite);
  await app.ready();
  await app.inject({
    method: 'POST',
    url: '/api/v1/setup',
    payload: {
      companyName: 'Test Co',
      timezone: 'UTC',
      leaveYearStartMonth: 1,
      leaveYearStartDay: 1,
      adminName: 'Ada Example',
      adminEmail: ADMIN.email,
      adminPassword: ADMIN.password,
      loadSampleData: true,
    },
  });
  // These tests are about yearly-grant leave, so add Casual Leave from its template the way
  // an administrator would on Leave types.
  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email: ADMIN.email, password: ADMIN.password },
  });
  const raw = login.headers['set-cookie'];
  const cookie = Array.isArray(raw)
    ? raw.map((c) => c.split(';')[0]).join('; ')
    : String(raw ?? '');
  const csrf = /leaveos\.csrf=([^;]*)/.exec(cookie)?.[1] ?? '';
  const added = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/leave-types',
    headers: { cookie, 'x-csrf-token': csrf },
    payload: { name: 'Casual Leave', code: 'CL', isPaid: true, template: 'CL' },
  });
  if (added.statusCode !== 200) throw new Error(`could not add Casual Leave: ${added.body}`);
  return { app, sqlite };
}

afterEach(async () => {
  for (const item of opened.splice(0)) {
    try {
      await item.sqlite.close();
    } catch {
      /* already closed */
    }
    fs.rmSync(item.dir, { recursive: true, force: true });
  }
});

async function amina(sqlite: Db): Promise<string> {
  const row = (await sqlite
    .prepare(`SELECT id FROM employee WHERE work_email = 'vijay@sns.test'`)
    .get()) as { id: string };
  return row.id;
}

async function clType(sqlite: Db): Promise<string> {
  const row = (await sqlite.prepare(`SELECT id FROM leave_type WHERE code = 'CL'`).get()) as {
    id: string;
  };
  return row.id;
}

/** Balance in whatever period the ledger rows sit in, for one employee and type. */
async function balanceInPeriod(
  sqlite: Db,
  employeeId: string,
  leaveTypeId: string,
  periodId: string,
): Promise<number> {
  const row = (await sqlite
    .prepare(
      `SELECT COALESCE(SUM(quantity_half_days), 0) AS n FROM balance_ledger
        WHERE employee_id = ? AND leave_type_id = ? AND period_id = ?`,
    )
    .get(employeeId, leaveTypeId, periodId)) as { n: number };
  return Number(row.n);
}

/** Moves the company into the next leave year by rewinding the existing period. */
async function advanceToNextLeaveYear(sqlite: Db): Promise<void> {
  await sqlite.exec(
    `UPDATE leave_period SET starts_on = '2020-01-01', ends_on = '2020-12-31', label = '2020'`,
  );
}

describe('opening a new leave period', () => {
  it('grants the new year entitlement instead of leaving the balance at zero', async () => {
    const { app, sqlite } = await boot();
    const employeeId = await amina(sqlite);
    const leaveTypeId = await clType(sqlite);

    await advanceToNextLeaveYear(sqlite);
    const result = await openCurrentPeriod(sqlite);
    expect(result.opened).toBeGreaterThan(0);

    const current = (await sqlite
      .prepare(`SELECT id FROM leave_period WHERE starts_on > '2020-12-31' ORDER BY starts_on`)
      .get()) as { id: string };
    const balance = await balanceInPeriod(sqlite, employeeId, leaveTypeId, current.id);
    expect(balance).toBeGreaterThan(0);
    await app.close();
  });

  it('does not grant twice when it runs again', async () => {
    const { app, sqlite } = await boot();
    const employeeId = await amina(sqlite);
    const leaveTypeId = await clType(sqlite);
    await advanceToNextLeaveYear(sqlite);

    await openCurrentPeriod(sqlite);
    const current = (await sqlite
      .prepare(`SELECT id FROM leave_period WHERE starts_on > '2020-12-31' ORDER BY starts_on`)
      .get()) as { id: string };
    const first = await balanceInPeriod(sqlite, employeeId, leaveTypeId, current.id);

    // Several restarts on the first of the year must not multiply anyone's entitlement.
    await openCurrentPeriod(sqlite);
    await openCurrentPeriod(sqlite);
    expect(await balanceInPeriod(sqlite, employeeId, leaveTypeId, current.id)).toBe(first);
    await app.close();
  });

  it('carries unused days forward up to the policy cap and records the rest as expired', async () => {
    const { app, sqlite } = await boot();
    const employeeId = await amina(sqlite);
    const leaveTypeId = await clType(sqlite);

    const oldPeriod = (await sqlite.prepare(`SELECT id FROM leave_period`).get()) as { id: string };
    const closing = await balanceInPeriod(sqlite, employeeId, leaveTypeId, oldPeriod.id);
    expect(closing).toBeGreaterThan(0);

    await advanceToNextLeaveYear(sqlite);
    await openCurrentPeriod(sqlite);

    const carried = (await sqlite
      .prepare(
        `SELECT COALESCE(SUM(quantity_half_days), 0) AS n FROM balance_ledger
          WHERE employee_id = ? AND leave_type_id = ? AND entry_type = 'CARRY_FORWARD'`,
      )
      .get(employeeId, leaveTypeId)) as { n: number };
    // The seeded casual-leave policy caps carry-forward at 10 half-days.
    expect(Number(carried.n)).toBe(10);

    const expired = (await sqlite
      .prepare(
        `SELECT COALESCE(SUM(quantity_half_days), 0) AS n FROM balance_ledger
          WHERE employee_id = ? AND leave_type_id = ? AND entry_type = 'EXPIRY'`,
      )
      .get(employeeId, leaveTypeId)) as { n: number };
    // Everything above the cap is written off explicitly, not silently dropped.
    expect(Number(expired.n)).toBe(-(closing - 10));
    await app.close();
  });

  it('writes an audit event for every opening', async () => {
    const { app, sqlite } = await boot();
    await advanceToNextLeaveYear(sqlite);
    await openCurrentPeriod(sqlite);
    const events = (await sqlite
      .prepare(`SELECT COUNT(*) AS n FROM audit_event WHERE action = 'leave.period.opened'`)
      .get()) as { n: number };
    expect(Number(events.n)).toBeGreaterThan(0);
    await app.close();
  });

  it('grants nothing to someone who has left', async () => {
    const { app, sqlite } = await boot();
    const employeeId = await amina(sqlite);
    const leaveTypeId = await clType(sqlite);
    await sqlite.prepare(`UPDATE employee SET status = 'exited' WHERE id = ?`).run(employeeId);
    await advanceToNextLeaveYear(sqlite);
    await openCurrentPeriod(sqlite);

    const current = (await sqlite
      .prepare(`SELECT id FROM leave_period WHERE starts_on > '2020-12-31' ORDER BY starts_on`)
      .get()) as { id: string } | undefined;
    if (current) {
      expect(await balanceInPeriod(sqlite, employeeId, leaveTypeId, current.id)).toBe(0);
    }
    await app.close();
  });
});

describe('monthly accrual', () => {
  it('uses the published policy rather than built-in defaults', async () => {
    const { app, sqlite } = await boot();
    const employeeId = await amina(sqlite);
    const leaveTypeId = await clType(sqlite);

    // HR switches casual leave to monthly accrual with a distinctive entitlement.
    await sqlite
      .prepare(
        `INSERT INTO leave_policy_version (id, leave_type_id, version_no, effective_from, rules_json, published_at, published_by, created_at, created_by)
         VALUES ('pv-monthly', ?, 99, '2000-01-01', ?, '2000-01-01', 'test', '2000-01-01', 'test')`,
      )
      .run(
        leaveTypeId,
        JSON.stringify({
          entitlementHalfDays: 24,
          accrualMethod: 'monthly',
          accrualCadenceMonths: 1,
          midYearProrate: false,
          carryForwardCapHalfDays: 10,
          carryForwardExpiryMonths: 0,
          probationRestriction: 'none',
          probationMaxHalfDays: 0,
          halfDaysAllowed: true,
          minNoticeDays: 0,
          maxConsecutiveDays: 15,
          negativeBalanceAllowed: false,
          attachmentRequiredAfterHalfDays: null,
        }),
      );

    const before = (await sqlite
      .prepare(
        `SELECT COUNT(*) AS n FROM balance_ledger
          WHERE entry_type = 'ACCRUAL' AND employee_id = ? AND leave_type_id = ?`,
      )
      .get(employeeId, leaveTypeId)) as { n: number };
    expect(Number(before.n)).toBe(0);

    await runMonthlyAccrual(sqlite);

    const after = (await sqlite
      .prepare(
        `SELECT COALESCE(SUM(quantity_half_days), 0) AS n FROM balance_ledger
          WHERE entry_type = 'ACCRUAL' AND employee_id = ? AND leave_type_id = ?`,
      )
      .get(employeeId, leaveTypeId)) as { n: number };
    // 24 half-days a year, credited monthly, is 2 half-days a month.
    expect(Number(after.n)).toBe(2);
    await app.close();
  });

  it('credits once a month however often it runs', async () => {
    const { app, sqlite } = await boot();
    const leaveTypeId = await clType(sqlite);
    await sqlite
      .prepare(`UPDATE leave_policy_version SET rules_json = ? WHERE leave_type_id = ?`)
      .run(
        JSON.stringify({
          entitlementHalfDays: 24,
          accrualMethod: 'monthly',
          accrualCadenceMonths: 1,
          midYearProrate: false,
          carryForwardCapHalfDays: 10,
          carryForwardExpiryMonths: 0,
          probationRestriction: 'none',
          probationMaxHalfDays: 0,
          halfDaysAllowed: true,
          minNoticeDays: 0,
          maxConsecutiveDays: 15,
          negativeBalanceAllowed: false,
          attachmentRequiredAfterHalfDays: null,
        }),
        leaveTypeId,
      );

    // The job used to sit on a twelve-hour timer, so it fired twice on the first of the
    // month and credited everyone twice.
    await runMonthlyAccrual(sqlite);
    await runMonthlyAccrual(sqlite);
    await runMonthlyAccrual(sqlite);

    const rows = (await sqlite
      .prepare(
        `SELECT COUNT(*) AS n FROM balance_ledger WHERE entry_type = 'ACCRUAL' AND leave_type_id = ?`,
      )
      .get(leaveTypeId)) as { n: number };
    const people = (await sqlite
      .prepare(`SELECT COUNT(*) AS n FROM employee WHERE status != 'exited'`)
      .get()) as { n: number };
    expect(Number(rows.n)).toBe(Number(people.n));
    await app.close();
  });

  it('does not accrue a type the policy grants annually', async () => {
    const { app, sqlite } = await boot();
    const leaveTypeId = await clType(sqlite);
    await runMonthlyAccrual(sqlite);
    const rows = (await sqlite
      .prepare(
        `SELECT COUNT(*) AS n FROM balance_ledger WHERE entry_type = 'ACCRUAL' AND leave_type_id = ?`,
      )
      .get(leaveTypeId)) as { n: number };
    expect(Number(rows.n)).toBe(0);
    await app.close();
  });
});

describe('carry-forward expiry', () => {
  it('lapses carried days once their expiry date has passed', async () => {
    const { app, sqlite } = await boot();
    const employeeId = await amina(sqlite);
    const leaveTypeId = await clType(sqlite);
    const period = (await sqlite.prepare(`SELECT id FROM leave_period`).get()) as { id: string };

    await sqlite
      .prepare(
        `INSERT INTO balance_ledger (id, employee_id, leave_type_id, period_id, entry_type, quantity_half_days, effective_on, source_type, expires_on, created_by, created_at)
         VALUES ('cf-1', ?, ?, ?, 'CARRY_FORWARD', 6, '2020-01-01', 'job_run', '2020-04-01', 'system', '2020-01-01')`,
      )
      .run(employeeId, leaveTypeId, period.id);

    const result = await expireCarriedDays(sqlite);
    expect(result.expired).toBe(1);

    const lapsed = (await sqlite
      .prepare(
        `SELECT COALESCE(SUM(quantity_half_days), 0) AS n FROM balance_ledger
          WHERE entry_type = 'EXPIRY' AND reverses_entry_id = 'cf-1'`,
      )
      .get()) as { n: number };
    expect(Number(lapsed.n)).toBe(-6);

    // Running again must not lapse the same entry twice.
    await expireCarriedDays(sqlite);
    const again = (await sqlite
      .prepare(`SELECT COUNT(*) AS n FROM balance_ledger WHERE reverses_entry_id = 'cf-1'`)
      .get()) as { n: number };
    expect(Number(again.n)).toBe(1);
    await app.close();
  });
});
