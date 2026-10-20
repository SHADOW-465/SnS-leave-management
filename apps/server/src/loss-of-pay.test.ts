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

async function apply(as: Session, start: string, end: string) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/leave-requests',
    headers: auth(as),
    payload: { leaveTypeId: typeId, startDate: start, endDate: end, reason: 'LOP check.' },
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
