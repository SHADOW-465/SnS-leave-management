/**
 * The Leave Tracker functional framework, checked end to end against the sample
 * organisation: configurable working week and counting, per-category accrual, the joining
 * month rule, the transactions register, the annual and payroll reports, holiday import
 * from Excel, and the realistic sample activity.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type Db } from '@sns/database';
import { loadConfig } from '@sns/config';
import { buildApp } from './app.js';
import type { FastifyInstance } from 'fastify';
import { nowIso, todayInTimeZone } from './time.js';
import { creditMonth, openCurrentPeriod } from './jobs/balance.js';
import { addYearlyGrantType } from './test-support.js';
import { seedDemoActivity } from './usecases/demo.js';
import type { RequestContext } from './ctx.js';
import { parseRules } from '@sns/domain';

type Session = { cookie: string; csrf: string };
const opened: { sqlite: Db; dir: string }[] = [];
let app: FastifyInstance;
let sqlite: Db;
let dir: string;

async function boot() {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leaveos-doc-'));
  sqlite = await openDatabase(path.join(dir, 'app.db'));
  opened.push({ sqlite, dir });
  app = await buildApp(loadConfig({ LEAVEOS_DATA_DIR: dir, LEAVEOS_ENV: 'test' }), sqlite);
  await app.ready();
  await app.inject({
    method: 'POST',
    url: '/api/v1/setup',
    payload: {
      companyName: 'Simon & Sons',
      timezone: 'UTC',
      leaveYearStartMonth: 1,
      leaveYearStartDay: 1,
      adminName: 'Arjun Das',
      adminEmail: 'admin@sns.test',
      adminPassword: 'ChangeMe_admin_1',
      loadSampleData: true,
    },
  });
}

async function signIn(email: string, password = 'ChangeMe_demo_1'): Promise<Session> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email, password },
  });
  expect(res.statusCode, `sign in ${email}`).toBe(200);
  const raw = res.headers['set-cookie'];
  const cookie = Array.isArray(raw)
    ? raw.map((c) => c.split(';')[0]).join('; ')
    : String(raw ?? '');
  return { cookie, csrf: /leaveos\.csrf=([^;]*)/.exec(cookie)?.[1] ?? '' };
}

async function call(s: Session, method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown) {
  return app.inject({
    method,
    url,
    headers: method === 'GET' ? { cookie: s.cookie } : { cookie: s.cookie, 'x-csrf-token': s.csrf },
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
}

const data = <T>(res: { json: () => unknown }) => (res.json() as { data: T }).data;

async function typeId(code: string): Promise<string> {
  return (
    (await sqlite.prepare(`SELECT id FROM leave_type WHERE code = ?`).get(code)) as { id: string }
  ).id;
}
async function employeeId(email: string): Promise<string> {
  return (
    (await sqlite.prepare(`SELECT id FROM employee WHERE work_email = ?`).get(email)) as {
      id: string;
    }
  ).id;
}

function ctx(): RequestContext {
  return {
    requestId: 'test',
    sqlite,
    config: loadConfig({ LEAVEOS_DATA_DIR: dir, LEAVEOS_ENV: 'test' }),
    principal: null,
    ip: '127.0.0.1',
    userAgent: 'test',
    now: nowIso(),
    today: todayInTimeZone('UTC'),
    attachmentsRoot: path.join(dir, 'attachments'),
    backupsRoot: path.join(dir, 'backups'),
  };
}

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

describe('working week and day counting (§5, §10)', () => {
  it('the administrator changes the weekend and upcoming leave is recounted', async () => {
    await boot();
    const vijay = await signIn('vijay@sns.test');
    // Next Monday through Saturday, still ahead of today, so the recount includes it.
    // Five working days with a Saturday–Sunday weekend; Saturday counts once it is a working day.
    const [year, month, day] = todayInTimeZone('UTC').split('-').map(Number);
    const start = new Date(Date.UTC(year!, month! - 1, day));
    const untilMonday = (8 - start.getUTCDay()) % 7 || 7;
    start.setUTCDate(start.getUTCDate() + untilMonday);
    const end = new Date(start);
    end.setUTCDate(start.getUTCDate() + 5);
    const submitted = await call(vijay, 'POST', '/api/v1/leave-requests', {
      leaveTypeId: await typeId('AL'),
      startDate: start.toISOString().slice(0, 10),
      endDate: end.toISOString().slice(0, 10),
      reason: 'Checking the working week',
    });
    expect(submitted.statusCode).toBe(201);
    const id = data<{ id: string }>(submitted).id;
    const total = async () =>
      Number(
        (
          (await sqlite
            .prepare(`SELECT total_half_days AS n FROM leave_request WHERE id = ?`)
            .get(id)) as { n: number }
        ).n,
      );
    expect(await total()).toBe(10);

    const admin = await signIn('admin@sns.test', 'ChangeMe_admin_1');
    const res = await call(admin, 'PUT', '/api/v1/settings/work-week', { weekendDays: [0] });
    expect(res.statusCode).toBe(200);
    expect(await total()).toBe(12); // Saturday now counts
  });

  it('a leave type can count weekends and holidays when HR says so', async () => {
    await boot();
    const admin = await signIn('admin@sns.test', 'ChangeMe_admin_1');
    const cl = await typeId('AL');
    const current = (await sqlite
      .prepare(
        `SELECT rules_json FROM leave_policy_version WHERE leave_type_id = ? ORDER BY version_no DESC LIMIT 1`,
      )
      .get(cl)) as { rules_json: string };
    const today = new Date().toISOString().slice(0, 10);
    const published = await call(admin, 'POST', '/api/v1/policies', {
      leaveTypeId: cl,
      effectiveFrom: today,
      rules: { ...parseRules(current.rules_json), excludeWeekends: false },
    });
    expect(published.statusCode).toBe(200);
    const vijay = await signIn('vijay@sns.test');
    const preview = await call(
      vijay,
      'GET',
      `/api/v1/leave/preview?leaveTypeId=${cl}&startDate=2026-10-09&endDate=2026-10-12`,
    );
    expect(data<{ countedHalfDays: number }>(preview).countedHalfDays).toBe(8);
  });
});

describe('accrual (§4, §10, §18C)', () => {
  it('credits each staff category at its own rate and applies the joining-month rule', async () => {
    await boot();
    const el = await typeId('AL');
    const rules = parseRules({
      entitlementHalfDays: 48,
      accrualMethod: 'monthly',
      categoryMonthlyHalfDays: { MGMT: 5 },
      probationMonthlyHalfDays: 2,
      joinMonthAccrual: 'none',
    });
    const period = (await sqlite.prepare(`SELECT id FROM leave_period LIMIT 1`).get()) as {
      id: string;
    };
    const credit = (email: string, month: string) =>
      employeeId(email).then((employeeId) =>
        creditMonth(sqlite, {
          employeeId,
          leaveTypeId: el,
          periodId: period.id,
          month,
          rules,
          actor: 'system',
          now: nowIso(),
          effectiveOn: `${month}-01`,
        }),
      );
    // Accruals already run for this year during setup; test a month still to come.
    expect(await credit('rajesh@sns.test', '2026-12')).toBe(5); // management: 2.5 days
    expect(await credit('vijay@sns.test', '2026-12')).toBe(4); // production: 2 days
    expect(await credit('karthik@sns.test', '2026-12')).toBe(2); // probation: 1 day
    expect(await credit('vijay@sns.test', '2026-12')).toBeNull(); // never twice
    await sqlite.exec(
      `UPDATE employee SET joined_on = '2026-12-15' WHERE work_email = 'sneha@sns.test'`,
    );
    expect(await credit('sneha@sns.test', '2026-12')).toBe(0); // joined mid-month: 'none'
  });
});

describe('leave transactions (§13, §14)', () => {
  it('lists every movement with the balance after it, and the admin can credit manually', async () => {
    await boot();
    const admin = await signIn('admin@sns.test', 'ChangeMe_admin_1');
    const vijayId = await employeeId('vijay@sns.test');
    const el = await typeId('AL');
    const adjust = await call(admin, 'POST', '/api/v1/balances/adjust', {
      employeeId: vijayId,
      leaveTypeId: el,
      quantityHalfDays: 2,
      reason: 'Worked on a holiday',
    });
    expect(adjust.statusCode).toBe(200);
    const res = await call(admin, 'GET', `/api/v1/ledger?employeeId=${vijayId}&leaveTypeId=${el}`);
    const d = data<{
      entries: { label: string; days: number; balanceAfter: number }[];
      summary: { manualCredit: number; closing: number; earned: number }[];
    }>(res);
    expect(d.entries[0]).toMatchObject({ label: 'Manual credit', days: 1 });
    expect(d.summary[0]!.manualCredit).toBe(1);
    expect(d.summary[0]!.closing).toBe(d.entries[0]!.balanceAfter);
  });

  it('an employee sees only their own register', async () => {
    await boot();
    const vijay = await signIn('vijay@sns.test');
    expect((await call(vijay, 'GET', '/api/v1/ledger')).statusCode).toBe(200);
    const other = await employeeId('priya@sns.test');
    expect((await call(vijay, 'GET', `/api/v1/ledger?employeeId=${other}`)).statusCode).toBe(403);
  });
});

describe('reports (§12)', () => {
  it('the PDF export includes the monthly payroll sheet', async () => {
    await boot();
    const admin = await signIn('admin@sns.test', 'ChangeMe_admin_1');
    const pdf = await call(admin, 'GET', '/api/v1/reports/export.pdf?year=2026&month=9');
    expect(pdf.statusCode).toBe(200);
    expect(pdf.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
    expect(pdf.rawPayload.length).toBeGreaterThan(2000);
  });

  it('the annual report splits used days by month and exports to Excel', async () => {
    await boot();
    const admin = await signIn('admin@sns.test', 'ChangeMe_admin_1');
    const res = await call(admin, 'GET', '/api/v1/reports/annual');
    const d = data<{ months: string[]; rows: { code: string; closing: number; earned: number }[] }>(
      res,
    );
    expect(d.months).toHaveLength(12);
    expect(d.rows.find((r) => r.code === 'SNS-1005')!.earned).toBeGreaterThan(0);
    const xlsx = await call(admin, 'GET', '/api/v1/reports/annual.xlsx');
    expect(xlsx.statusCode).toBe(200);
    const wb = XLSX.read(xlsx.rawPayload, { type: 'buffer' });
    expect(wb.SheetNames).toContain('Annual report');
  });
});

describe('government holidays (§11)', () => {
  it('imports the government list from an Excel file with Date / Day / Holiday columns', async () => {
    await boot();
    const admin = await signIn('admin@sns.test', 'ChangeMe_admin_1');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ['Date', 'Day', 'Holiday'],
        ['01-Jan-2027', 'Friday', 'New Year'],
        ['15/01/2027', 'Friday', 'Pongal'],
        ['2027-01-26', 'Tuesday', 'Republic Day'],
        ['not a date', '', 'Broken row'],
      ]),
      'Holidays',
    );
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    const res = await call(admin, 'POST', '/api/v1/holidays/import-file', {
      filename: 'holidays-2027.xlsx',
      contentBase64: buf.toString('base64'),
    });
    expect(res.statusCode).toBe(200);
    const d = data<{ changed: string[]; problems: string[] }>(res);
    expect(d.changed).toEqual(['2027-01-01', '2027-01-15', '2027-01-26']);
    expect(d.problems).toHaveLength(1);
  });

  it('loads the fixed-date national holidays for a year', async () => {
    await boot();
    const admin = await signIn('admin@sns.test', 'ChangeMe_admin_1');
    const res = await call(admin, 'POST', '/api/v1/holidays/load-standard', { year: 2027 });
    expect(data<{ changed: string[] }>(res).changed).toContain('2027-08-15');
  });
});

describe('sample organisation', () => {
  it('everyone has a designation and a reporting manager, and sample leave reaches every stage', async () => {
    await boot();
    const missing = (await sqlite
      .prepare(
        `SELECT e.work_email FROM employee e
          WHERE e.work_email LIKE '%@sns.test' AND e.work_email NOT IN ('admin@sns.test', 'rajesh@sns.test')
            AND (e.manager_employee_id IS NULL OR e.job_title_id IS NULL)`,
      )
      .all()) as { work_email: string }[];
    expect(missing).toEqual([]);
    await seedDemoActivity(ctx());
    const statuses = (await sqlite.prepare(`SELECT DISTINCT status FROM leave_request`).all()) as {
      status: string;
    }[];
    expect(statuses.map((s) => s.status).sort()).toEqual(
      expect.arrayContaining(['approved', 'pending_approval', 'rejected']),
    );
    // Past leave is recorded too, once the year is far enough along for it to fit.
    if (new Date().getUTCMonth() >= 5) {
      const past = (await sqlite
        .prepare(
          `SELECT COUNT(*) AS n FROM leave_request WHERE status = 'approved' AND end_date < ?`,
        )
        .get(new Date().toISOString().slice(0, 10))) as { n: number };
      expect(Number(past.n)).toBeGreaterThanOrEqual(2);
    }
  });

  it('anyone can sign in with their employee ID', async () => {
    await boot();
    await signIn('SNS-1005');
  });
});

describe('yearly entitlement is credited once', () => {
  // A type given once a year (12 days), written straight into the database.
  const addCasual = () => addYearlyGrantType(sqlite);
  const grants = async (email: string, code: string) =>
    Number(
      (
        (await sqlite
          .prepare(
            `SELECT COALESCE(SUM(l.quantity_half_days), 0) AS n FROM balance_ledger l
               JOIN employee e ON e.id = l.employee_id JOIN leave_type t ON t.id = l.leave_type_id
              WHERE e.work_email = ? AND t.code = ? AND l.entry_type IN ('ENTITLEMENT_GRANT', 'ADJUSTMENT')`,
          )
          .get(email, code)) as { n: number }
      ).n,
    );

  it('the leave-year job does not grant again what was already granted', async () => {
    await boot();
    await addCasual();
    const before = await grants('vijay@sns.test', 'CL');
    expect(before).toBe(24); // 12 days
    await openCurrentPeriod(sqlite);
    expect(await grants('vijay@sns.test', 'CL')).toBe(before);
  });

  it('a database that was credited twice is corrected, once', async () => {
    await boot();
    const cl = await addYearlyGrantType(sqlite, { openBalances: false });
    const vijay = (await sqlite
      .prepare(`SELECT id FROM employee WHERE work_email = 'vijay@sns.test'`)
      .get()) as { id: string };
    const period = (await sqlite
      .prepare(`SELECT id, starts_on FROM leave_period ORDER BY starts_on DESC LIMIT 1`)
      .get()) as { id: string; starts_on: string };
    // What the old code did: setup credited the year, then the leave-year job credited it again.
    for (const [id, reason] of [
      ['dup0', 'Opening entitlement for the current leave year'],
      ['dup1', 'Entitlement for 2026'],
    ] as const) {
      await sqlite
        .prepare(
          `INSERT INTO balance_ledger (id, employee_id, leave_type_id, period_id, entry_type, quantity_half_days, effective_on, source_type, reason, created_by, created_at)
           VALUES (?, ?, ?, ?, 'ENTITLEMENT_GRANT', 24, ?, 'job_run', ?, 'system', ?)`,
        )
        .run(id, vijay.id, cl, period.id, period.starts_on, reason, nowIso());
    }
    expect(await grants('vijay@sns.test', 'CL')).toBe(48);
    const fix = fs.readFileSync(
      new URL(
        '../../../packages/database/src/sql/0007_fix_double_opening_grant.sql',
        import.meta.url,
      ),
      'utf8',
    );
    await sqlite.exec(fix);
    expect(await grants('vijay@sns.test', 'CL')).toBe(24);
  });
});

describe('earned leave, loss of pay and permission', () => {
  it('records the shortfall as loss of pay, tells the employee, and caps permission at 2 hours', async () => {
    await boot();
    const vijay = await signIn('vijay@sns.test');
    const submitted = await call(vijay, 'POST', '/api/v1/leave-requests', {
      leaveTypeId: await typeId('AL'),
      startDate: '2026-10-01',
      endDate: '2026-11-11',
      reason: 'A long absence past the earned balance',
      confirmLossOfPay: true,
    });
    expect(submitted.statusCode).toBe(201);
    const row = (await sqlite
      .prepare(
        `SELECT lop_half_days AS lop, total_half_days AS total FROM leave_request WHERE id = ?`,
      )
      .get(data<{ id: string }>(submitted).id)) as { lop: number; total: number };
    expect(Number(row.lop)).toBeGreaterThan(0);
    expect(Number(row.lop)).toBeLessThan(Number(row.total));
    const note = (await sqlite
      .prepare(
        `SELECT title FROM notification n
           JOIN user_account u ON u.id = n.recipient_user_id
          WHERE u.email = 'vijay@sns.test' AND n.kind = 'leave.loss_of_pay'`,
      )
      .get()) as { title: string } | undefined;
    expect(note?.title).toBe('Loss of pay on this request');
    const home = await call(vijay, 'GET', '/api/v1/home');
    expect(data<{ lossOfPay: { pending: number } }>(home).lossOfPay.pending).toBeGreaterThan(0);

    const first = await call(vijay, 'POST', '/api/v1/permissions', {
      onDate: '2026-10-06',
      hours: 1,
      reason: 'Bank appointment',
    });
    expect(first.statusCode).toBe(201);
    const second = await call(vijay, 'POST', '/api/v1/permissions', {
      onDate: '2026-10-07',
      hours: 1,
      reason: 'School appointment',
    });
    expect(second.statusCode).toBe(201);
    const third = await call(vijay, 'POST', '/api/v1/permissions', {
      onDate: '2026-10-08',
      hours: 1,
      reason: 'One hour too many',
    });
    expect(third.statusCode).toBe(409);
  });
});

describe('deciding permission', () => {
  it('HR cannot approve their own permission hours', async () => {
    await boot();
    const anitha = await signIn('anitha@sns.test');
    const asked = await call(anitha, 'POST', '/api/v1/permissions', {
      onDate: '2026-10-06',
      hours: 2,
      reason: 'Clinic appointment',
    });
    expect(asked.statusCode).toBe(201);
    const id = data<{ id: string }>(asked).id;
    const self = await call(anitha, 'POST', `/api/v1/permissions/${id}/decide`, {
      decision: 'approve',
    });
    expect(self.statusCode).toBe(403);
    const status = (await sqlite
      .prepare(`SELECT status FROM permission_request WHERE id = ?`)
      .get(id)) as { status: string };
    expect(status.status).toBe('pending_approval');
    const admin = await signIn('admin@sns.test', 'ChangeMe_admin_1');
    const decided = await call(admin, 'POST', `/api/v1/permissions/${id}/decide`, {
      decision: 'approve',
    });
    expect(decided.statusCode).toBe(200);
  });
});
