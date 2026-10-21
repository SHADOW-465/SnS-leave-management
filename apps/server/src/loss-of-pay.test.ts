/**
 * Leave past the balance is loss of pay, never a rejection. These drive the real API:
 * submit, approve, and every place the paid and loss-of-pay days are reported.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type Db } from '@sns/database';
import { loadConfig } from '@sns/config';
import { splitLeaveDays } from '@sns/contracts';
import { buildApp } from './app.js';
import { openCurrentPeriod } from './jobs/balance.js';
import type { FastifyInstance } from 'fastify';

type Session = { cookie: string; csrf: string };
const opened: { sqlite: Db; dir: string }[] = [];
let app: FastifyInstance;
let sqlite: Db;
let typeId: string;

async function signIn(email: string, password = 'ChangeMe_demo_1'): Promise<Session> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email, password },
  });
  expect(res.statusCode).toBe(200);
  const raw = res.headers['set-cookie'];
  const cookie = Array.isArray(raw)
    ? raw.map((c) => c.split(';')[0]).join('; ')
    : String(raw ?? '');
  return { cookie, csrf: /leaveos\.csrf=([^;]*)/.exec(cookie)?.[1] ?? '' };
}
const auth = (s: Session) => ({ cookie: s.cookie, 'x-csrf-token': s.csrf });
const json = <T>(res: { json: () => unknown }) => (res.json() as { data: T }).data;
const ADMIN = ['admin@example.invalid', 'ChangeMe_admin_1'] as const;

async function preview(as: Session, start: string, end: string) {
  const res = await app.inject({
    method: 'GET',
    url: `/api/v1/leave/preview?leaveTypeId=${typeId}&startDate=${start}&endDate=${end}`,
    headers: auth(as),
  });
  expect(res.statusCode).toBe(200);
  return json<{
    availableHalfDays: number;
    countedHalfDays: number;
    paidDays: string;
    lossOfPay: string;
  }>(res);
}

async function apply(as: Session, start: string, end: string, extra: object = {}) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/leave-requests',
    headers: auth(as),
    payload: {
      leaveTypeId: typeId,
      startDate: start,
      endDate: end,
      reason: 'LOP check.',
      confirmLossOfPay: true,
      ...extra,
    },
  });
}

const vijayId = async () =>
  (
    (await sqlite.prepare(`SELECT id FROM employee WHERE work_email = 'vijay@sns.test'`).get()) as {
      id: string;
    }
  ).id;

beforeEach(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leaveos-lop-'));
  sqlite = await openDatabase(path.join(dir, 'app.db'));
  opened.push({ sqlite, dir });
  app = await buildApp(loadConfig({ LEAVEOS_DATA_DIR: dir, LEAVEOS_ENV: 'test' }), sqlite);
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
      adminEmail: ADMIN[0],
      adminPassword: ADMIN[1],
      loadSampleData: true,
    },
  });
  typeId = (
    (await sqlite.prepare(`SELECT id FROM leave_type WHERE code = 'AL'`).get()) as { id: string }
  ).id;
  await sqlite.exec(
    `UPDATE employee SET manager_employee_id = NULL WHERE work_email = 'vijay@sns.test'`,
  );
});

afterEach(async () => {
  await app?.close();
  for (const item of opened.splice(0)) {
    try {
      await item.sqlite.close();
    } catch {
      /* already closed */
    }
    fs.rmSync(item.dir, { recursive: true, force: true });
  }
});

describe('loss of pay beyond the quota', () => {
  it('accepts a request past the balance and stores the paid and LOP split', async () => {
    const vijay = await signIn('vijay@sns.test');
    const p = await preview(vijay, '2026-10-01', '2026-11-11');
    const expected = splitLeaveDays({
      availableHalfDays: p.availableHalfDays,
      requestedHalfDays: p.countedHalfDays,
    });
    expect(expected.lopHalfDays).toBeGreaterThan(0);
    expect(Number(p.lossOfPay) * 2).toBe(expected.lopHalfDays);
    expect(Number(p.paidDays) * 2).toBe(expected.paidHalfDays);

    const res = await apply(vijay, '2026-10-01', '2026-11-11');
    expect(res.statusCode).toBe(201);
    const id = json<{ id: string }>(res).id;
    const row = (await sqlite
      .prepare(
        `SELECT total_half_days AS total, lop_half_days AS lop FROM leave_request WHERE id = ?`,
      )
      .get(id)) as { total: number; lop: number };
    expect(Number(row.total)).toBe(p.countedHalfDays);
    expect(Number(row.lop)).toBe(expected.lopHalfDays);
    // Only the paid part is held against the balance.
    const hold = (await sqlite
      .prepare(
        `SELECT quantity_half_days AS q FROM balance_ledger WHERE source_id = ? AND entry_type = 'PENDING_HOLD'`,
      )
      .get(id)) as { q: number } | undefined;
    expect(Math.abs(Number(hold?.q ?? 0))).toBe(expected.paidHalfDays);
  });

  it('at a zero balance the whole request is loss of pay and is still accepted', async () => {
    const admin = await signIn(...ADMIN);
    const vijay = await signIn('vijay@sns.test');
    const before = await preview(vijay, '2026-10-05', '2026-10-06');
    const zero = await app.inject({
      method: 'POST',
      url: '/api/v1/balances/adjust',
      headers: auth(admin),
      payload: {
        employeeId: await vijayId(),
        leaveTypeId: typeId,
        quantityHalfDays: -Math.max(0, before.availableHalfDays),
        reason: 'Zero the balance for the test',
      },
    });
    expect(zero.statusCode).toBe(200);
    const p = await preview(vijay, '2026-10-05', '2026-10-06');
    expect(p.availableHalfDays).toBe(0);
    expect(p.paidDays).toBe('0');
    expect(p.lossOfPay).toBe('2');
    const res = await apply(vijay, '2026-10-05', '2026-10-06');
    expect(res.statusCode).toBe(201);
    const row = (await sqlite
      .prepare(
        `SELECT lop_half_days AS lop, total_half_days AS total FROM leave_request WHERE id = ?`,
      )
      .get(json<{ id: string }>(res).id)) as { lop: number; total: number };
    expect(Number(row.lop)).toBe(Number(row.total));
  });

  it('approval deducts only paid days; the approver, reports and exports show the LOP days', async () => {
    const vijay = await signIn('vijay@sns.test');
    const lead = await signIn('john@sns.test');
    const admin = await signIn(...ADMIN);
    const p = await preview(vijay, '2026-10-01', '2026-11-11');
    const split = splitLeaveDays({
      availableHalfDays: p.availableHalfDays,
      requestedHalfDays: p.countedHalfDays,
    });
    const paid = split.paidHalfDays / 2;
    const lop = split.lopHalfDays / 2;
    const id = json<{ id: string }>(await apply(vijay, '2026-10-01', '2026-11-11')).id;

    // The approver sees the LOP days in the queue.
    const queue = await app.inject({
      method: 'GET',
      url: '/api/v1/leave-requests?view=approvals',
      headers: auth(lead),
    });
    const queued = json<{ id: string; lop_half_days: number }[]>(queue).find((r) => r.id === id);
    expect(Number(queued?.lop_half_days)).toBe(split.lopHalfDays);

    const approve = await app.inject({
      method: 'POST',
      url: `/api/v1/leave-requests/${id}/approve`,
      headers: auth(lead),
      payload: { expectedVersion: 1 },
    });
    expect(approve.statusCode).toBe(200);
    const deduction = (await sqlite
      .prepare(
        `SELECT quantity_half_days AS q FROM balance_ledger WHERE source_id = ? AND entry_type = 'DEDUCTION'`,
      )
      .get(id)) as { q: number } | undefined;
    expect(-Number(deduction?.q ?? 0)).toBe(split.paidHalfDays);

    // Transactions: the deduction carries the loss of pay of the same request.
    const employeeId = await vijayId();
    const ledger = json<{ entries: { kind: string; lossOfPayDays: number }[] }>(
      await app.inject({
        method: 'GET',
        url: `/api/v1/ledger?employeeId=${employeeId}`,
        headers: auth(admin),
      }),
    );
    expect(ledger.entries.find((e) => e.kind === 'DEDUCTION')?.lossOfPayDays).toBe(lop);

    // Reports: October payroll, summary and per-employee figures.
    const rep = json<{
      summary: { totalLossOfPayDays: number };
      payroll: { rows: { employeeId: string; lossOfPay: number; leaveTaken: number }[] };
      employeeSummaries: { id: string; lossOfPayDays: number }[];
    }>(
      await app.inject({
        method: 'GET',
        url: '/api/v1/reports?year=2026&month=10',
        headers: auth(admin),
      }),
    );
    const pay = rep.payroll.rows.find((r) => r.employeeId === employeeId);
    expect(pay?.lossOfPay).toBe(lop);
    expect(pay?.leaveTaken).toBe(paid);
    expect(rep.summary.totalLossOfPayDays).toBe(lop);
    expect(rep.employeeSummaries.find((e) => e.id === employeeId)?.lossOfPayDays).toBe(lop);

    // Exports.
    const csv = await app.inject({
      method: 'GET',
      url: '/api/v1/reports/export.csv?year=2026&month=10',
      headers: auth(admin),
    });
    expect(csv.body).toContain('Loss of pay');
    expect(csv.body).toContain(`,${paid},${lop},`);
    const xlsx = await app.inject({
      method: 'GET',
      url: '/api/v1/reports/export.xlsx?year=2026&month=10',
      headers: auth(admin),
    });
    const wb = XLSX.read(xlsx.rawPayload, { type: 'buffer' });
    const payrollRows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets['Monthly Payroll']!, {
      header: 1,
    });
    const mine = payrollRows.find((r) => r[1] === 'Vijay Anand');
    expect(mine?.[5]).toBe(paid);
    expect(mine?.[6]).toBe(lop);
    const summary = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets['Executive Summary']!, {
      header: 1,
    });
    expect(summary.find((r) => r[0] === 'Loss of Pay Days')?.[1]).toBe(lop);
    const pdf = await app.inject({
      method: 'GET',
      url: '/api/v1/reports/export.pdf?year=2026&month=10',
      headers: auth(admin),
    });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
    const annual = await app.inject({
      method: 'GET',
      url: '/api/v1/reports/annual.csv',
      headers: auth(admin),
    });
    expect(annual.body).toContain('Loss of pay');
  });
});

/** Puts Vijay at exactly `halfDays` of balance, using the ledger the way an administrator would. */
async function setBalance(halfDays: number) {
  const admin = await signIn(...ADMIN);
  const vijay = await signIn('vijay@sns.test');
  const now = await preview(vijay, '2026-10-05', '2026-10-05');
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/balances/adjust',
    headers: auth(admin),
    payload: {
      employeeId: await vijayId(),
      leaveTypeId: typeId,
      quantityHalfDays: halfDays - now.availableHalfDays,
      reason: 'Set the balance for the test',
    },
  });
  expect(res.statusCode).toBe(200);
  return vijay;
}

const balance = async (as: Session) =>
  (await preview(as, '2026-12-07', '2026-12-07')).availableHalfDays;

describe('confirming loss of pay', () => {
  it('refuses a request with LOP days unless the person confirmed, and accepts it once they do', async () => {
    const vijay = await setBalance(2);
    const refused = await apply(vijay, '2026-10-05', '2026-10-07', { confirmLossOfPay: undefined });
    expect(refused.statusCode).toBe(400);
    expect((refused.json() as { error: { code: string } }).error.code).toBe(
      'LOP_CONFIRMATION_REQUIRED',
    );
    expect(
      (await sqlite.prepare(`SELECT COUNT(*) AS n FROM leave_request`).get()) as { n: number },
    ).toMatchObject({ n: 0 });
    const falseTick = await apply(vijay, '2026-10-05', '2026-10-07', { confirmLossOfPay: false });
    expect(falseTick.statusCode).toBe(400);
    const accepted = await apply(vijay, '2026-10-05', '2026-10-07');
    expect(accepted.statusCode).toBe(201);
  });

  it('needs no confirmation when the balance covers the request', async () => {
    const vijay = await setBalance(6);
    const res = await apply(vijay, '2026-10-05', '2026-10-05', { confirmLossOfPay: undefined });
    expect(res.statusCode).toBe(201);
  });
});

describe('half days around the quota', () => {
  it('a full day with one half day left is half paid and half loss of pay', async () => {
    const vijay = await setBalance(1);
    const p = await preview(vijay, '2026-10-05', '2026-10-05');
    expect(p.countedHalfDays).toBe(2);
    expect(p.paidDays).toBe('0.5');
    expect(p.lossOfPay).toBe('0.5');
    const id = json<{ id: string }>(await apply(vijay, '2026-10-05', '2026-10-05')).id;
    const row = (await sqlite
      .prepare(`SELECT lop_half_days AS lop FROM leave_request WHERE id = ?`)
      .get(id)) as { lop: number };
    expect(Number(row.lop)).toBe(1);
  });

  it('a half day with one half day left is fully paid', async () => {
    const vijay = await setBalance(1);
    const res = await apply(vijay, '2026-10-05', '2026-10-05', {
      halfDayStart: 'am',
      confirmLossOfPay: undefined,
    });
    expect(res.statusCode).toBe(201);
    const row = (await sqlite
      .prepare(`SELECT lop_half_days AS lop, total_half_days AS total FROM leave_request`)
      .get()) as { lop: number; total: number };
    expect(Number(row.total)).toBe(1);
    expect(Number(row.lop)).toBe(0);
  });
});

describe('loss of pay requests and the balance', () => {
  it('rejecting or withdrawing one gives the balance back', async () => {
    const vijay = await setBalance(4);
    const lead = await signIn('john@sns.test');
    const before = await balance(vijay);
    const rejected = json<{ id: string }>(await apply(vijay, '2026-10-05', '2026-10-09')).id;
    expect(await balance(vijay)).toBe(0); // the 4 paid half-days are held
    const reject = await app.inject({
      method: 'POST',
      url: `/api/v1/leave-requests/${rejected}/reject`,
      headers: auth(lead),
      payload: { expectedVersion: 1, reason: 'Cover is needed that week.' },
    });
    expect(reject.statusCode).toBe(200);
    expect(await balance(vijay)).toBe(before);

    const withdrawn = json<{ id: string }>(await apply(vijay, '2026-10-12', '2026-10-16')).id;
    expect(await balance(vijay)).toBe(0);
    const withdraw = await app.inject({
      method: 'POST',
      url: `/api/v1/leave-requests/${withdrawn}/withdraw`,
      headers: auth(vijay),
      payload: { expectedVersion: 1 },
    });
    expect(withdraw.statusCode).toBe(200);
    expect(await balance(vijay)).toBe(before);
  });

  it('cancelling an approved one returns the paid days only, not the loss of pay', async () => {
    const vijay = await setBalance(4);
    const lead = await signIn('john@sns.test');
    const hr = await signIn('anitha@sns.test');
    const before = await balance(vijay);
    const id = json<{ id: string }>(await apply(vijay, '2026-10-05', '2026-10-09')).id;
    await app.inject({
      method: 'POST',
      url: `/api/v1/leave-requests/${id}/approve`,
      headers: auth(lead),
      payload: { expectedVersion: 1 },
    });
    expect(await balance(vijay)).toBe(0);
    const cancel = await app.inject({
      method: 'POST',
      url: `/api/v1/leave-requests/${id}/cancel`,
      headers: auth(hr),
      payload: { expectedVersion: 2, reason: 'Plans changed.' },
    });
    expect(cancel.statusCode).toBe(200);
    expect(await balance(vijay)).toBe(before);
  });

  it('a year rollover carries nothing negative and LOP days do not reduce next year', async () => {
    const vijay = await setBalance(4);
    const lead = await signIn('john@sns.test');
    const id = json<{ id: string }>(await apply(vijay, '2026-10-05', '2026-10-09')).id;
    await app.inject({
      method: 'POST',
      url: `/api/v1/leave-requests/${id}/approve`,
      headers: auth(lead),
      payload: { expectedVersion: 1 },
    });
    expect(await balance(vijay)).toBe(0);

    await sqlite.exec(
      `UPDATE leave_period SET starts_on = '2020-01-01', ends_on = '2020-12-31', label = '2020'`,
    );
    await openCurrentPeriod(sqlite);
    const period = (await sqlite
      .prepare(`SELECT id FROM leave_period WHERE starts_on > '2020-12-31' ORDER BY starts_on`)
      .get()) as { id: string };
    const rows = (await sqlite
      .prepare(
        `SELECT entry_type AS t, COALESCE(SUM(quantity_half_days), 0) AS n FROM balance_ledger
          WHERE employee_id = ? AND leave_type_id = ? AND period_id = ? GROUP BY entry_type`,
      )
      .all(await vijayId(), typeId, period.id)) as { t: string; n: number }[];
    const sum = (t: string) => Number(rows.find((r) => r.t === t)?.n ?? 0);
    expect(sum('CARRY_FORWARD')).toBe(0);
    expect(rows.every((r) => Number(r.n) >= 0)).toBe(true);
    // The approved request stays on record with its loss of pay.
    const kept = (await sqlite
      .prepare(`SELECT lop_half_days AS lop FROM leave_request WHERE id = ?`)
      .get(id)) as { lop: number };
    expect(Number(kept.lop)).toBeGreaterThan(0);
  });
});

describe('a holiday changing under an approved request with loss of pay', () => {
  const holiday = (as: Session, method: 'POST' | 'DELETE', date: string) =>
    app.inject({
      method,
      url: method === 'POST' ? '/api/v1/holidays' : `/api/v1/holidays?date=${date}`,
      headers: auth(as),
      ...(method === 'POST' ? { payload: { date, name: 'Declared holiday', kind: 'public' } } : {}),
    });
  const stored = async (id: string) =>
    (await sqlite
      .prepare(
        `SELECT total_half_days AS total, lop_half_days AS lop FROM leave_request WHERE id = ?`,
      )
      .get(id)) as { total: number; lop: number };
  const approve = (as: Session, id: string) =>
    app.inject({
      method: 'POST',
      url: `/api/v1/leave-requests/${id}/approve`,
      headers: auth(as),
      payload: { expectedVersion: 1 },
    });

  it('a new holiday shrinks the loss of pay, and does not also credit the balance', async () => {
    const vijay = await setBalance(4);
    const lead = await signIn('john@sns.test');
    const admin = await signIn(...ADMIN);
    const id = json<{ id: string }>(await apply(vijay, '2026-10-05', '2026-10-09')).id;
    expect((await approve(lead, id)).statusCode).toBe(200);
    expect(await balance(vijay)).toBe(0);
    expect(await stored(id)).toMatchObject({ total: 10, lop: 6 });

    expect((await holiday(admin, 'POST', '2026-10-07')).statusCode).toBe(200);
    // One day fewer is leave. The 2 paid days stay paid; the unpaid part drops by one day.
    expect(await stored(id)).toMatchObject({ total: 8, lop: 4 });
    expect(await balance(vijay)).toBe(0);

    expect((await holiday(admin, 'DELETE', '2026-10-07')).statusCode).toBe(200);
    expect(await stored(id)).toMatchObject({ total: 10, lop: 6 });
    expect(await balance(vijay)).toBe(0);
  });

  it('a removed holiday is paid from the balance when there is one, not charged twice', async () => {
    const vijay = await setBalance(10);
    const lead = await signIn('john@sns.test');
    const admin = await signIn(...ADMIN);
    expect((await holiday(admin, 'POST', '2026-10-07')).statusCode).toBe(200);
    const id = json<{ id: string }>(await apply(vijay, '2026-10-05', '2026-10-09')).id;
    expect((await approve(lead, id)).statusCode).toBe(200);
    expect(await stored(id)).toMatchObject({ total: 8, lop: 0 });
    expect(await balance(vijay)).toBe(2);

    expect((await holiday(admin, 'DELETE', '2026-10-07')).statusCode).toBe(200);
    // The extra day is covered by the 1 day left, so nothing is loss of pay.
    expect(await stored(id)).toMatchObject({ total: 10, lop: 0 });
    expect(await balance(vijay)).toBe(0);
  });
});

describe('asking to cancel approved leave', () => {
  it('HR can complete the cancellation, and the paid days come back', async () => {
    const vijay = await setBalance(4);
    const lead = await signIn('john@sns.test');
    const hr = await signIn('anitha@sns.test');
    const before = await balance(vijay);
    const id = json<{ id: string }>(await apply(vijay, '2026-12-14', '2026-12-15')).id;
    const approved = await app.inject({
      method: 'POST',
      url: `/api/v1/leave-requests/${id}/approve`,
      headers: auth(lead),
      payload: { expectedVersion: 1 },
    });
    expect(approved.statusCode).toBe(200);
    const asked = await app.inject({
      method: 'POST',
      url: `/api/v1/leave-requests/${id}/cancel-request`,
      headers: auth(vijay),
      payload: { expectedVersion: 2 },
    });
    expect(asked.statusCode).toBe(200);
    const cancel = await app.inject({
      method: 'POST',
      url: `/api/v1/leave-requests/${id}/cancel`,
      headers: auth(hr),
      payload: { expectedVersion: 3, reason: 'Employee asked to cancel.' },
    });
    expect(cancel.statusCode).toBe(200);
    expect(await balance(vijay)).toBe(before);
  });
});

describe('dates the wrong way round', () => {
  it('preview and submit answer 400 with a field message, not a server error', async () => {
    const vijay = await signIn('vijay@sns.test');
    const previewRes = await app.inject({
      method: 'GET',
      url: `/api/v1/leave/preview?leaveTypeId=${typeId}&startDate=2026-12-10&endDate=2026-12-08`,
      headers: auth(vijay),
    });
    expect(previewRes.statusCode).toBe(400);
    const submitRes = await apply(vijay, '2026-12-10', '2026-12-08');
    expect(submitRes.statusCode).toBe(400);
    expect((submitRes.json() as { error: { code: string } }).error.code).toBe(
      'LEAVE_DATES_REVERSED',
    );
  });
});
