import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type Db } from '@sns/database';
import { loadConfig } from '@sns/config';
import { buildApp } from './app.js';
import type { FastifyInstance } from 'fastify';

const opened: { sqlite: Db; dir: string }[] = [];
const ADMIN = { email: 'admin@example.invalid', password: 'ChangeMe_admin_1' };

type Session = { cookie: string; csrf: string };

let app: FastifyInstance;
let sqlite: Db;
let hr: Session;
let employee: Session;

function sessionFrom(res: { headers: Record<string, unknown> }): Session {
  const raw = res.headers['set-cookie'];
  const cookie = Array.isArray(raw)
    ? raw.map((c) => c.split(';')[0]).join('; ')
    : String(raw ?? '');
  return { cookie, csrf: /leaveos\.csrf=([^;]*)/.exec(cookie)?.[1] ?? '' };
}

async function signIn(email: string, password: string): Promise<Session> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email, password },
  });
  expect(res.statusCode).toBe(200);
  return sessionFrom(res);
}

function auth(s: Session) {
  return { cookie: s.cookie, 'x-csrf-token': s.csrf };
}

beforeEach(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leaveos-cal-'));
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
      adminEmail: ADMIN.email,
      adminPassword: ADMIN.password,
      loadSampleData: true,
    },
  });
  hr = await signIn('helen@example.invalid', 'ChangeMe_demo_1');
  employee = await signIn('amina@example.invalid', 'ChangeMe_demo_1');
});

afterEach(async () => {
  await app.close();
  for (const item of opened.splice(0)) {
    try {
      await item.sqlite.close();
    } catch {
      /* already closed */
    }
    fs.rmSync(item.dir, { recursive: true, force: true });
  }
});

async function holidays(): Promise<{ date: string; name: string; kind: string }[]> {
  const res = await app.inject({
    method: 'GET',
    url: '/api/v1/calendar?year=2026&month=9',
    headers: { cookie: hr.cookie },
  });
  return (res.json() as { data: { holidays: { date: string; name: string; kind: string }[] } }).data
    .holidays;
}

async function mark(date: string, name: string, kind: string) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/holidays',
    headers: auth(hr),
    payload: { date, name, kind },
  });
}

describe('holiday calendar', () => {
  it('starts empty rather than seeded with invented holidays', async () => {
    expect(await holidays()).toHaveLength(0);
  });

  it('re-marking a date replaces it instead of adding a second row', async () => {
    expect((await mark('2026-09-10', 'Founders Day', 'public')).statusCode).toBe(200);
    expect((await mark('2026-09-10', 'Founders Day', 'optional')).statusCode).toBe(200);
    const rows = await holidays();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe('optional');
  });

  it('a date can hold only one kind at the database level', async () => {
    await mark('2026-09-10', 'Founders Day', 'public');
    await mark('2026-09-10', 'Founders Day', 'declared_working');
    const count = (await sqlite
      .prepare(`SELECT COUNT(*) AS n FROM holiday WHERE date = '2026-09-10'`)
      .get()) as { n: number };
    expect(count.n).toBe(1);
  });

  it('clearing a date removes it, and clearing again is harmless', async () => {
    await mark('2026-09-10', 'Founders Day', 'public');
    const first = await app.inject({
      method: 'DELETE',
      url: '/api/v1/holidays?date=2026-09-10',
      headers: auth(hr),
    });
    expect((first.json() as { data: { removed: boolean } }).data.removed).toBe(true);
    const second = await app.inject({
      method: 'DELETE',
      url: '/api/v1/holidays?date=2026-09-10',
      headers: auth(hr),
    });
    expect((second.json() as { data: { removed: boolean } }).data.removed).toBe(false);
    expect(await holidays()).toHaveLength(0);
  });

  it('records an audit event for every calendar change', async () => {
    await mark('2026-09-10', 'Founders Day', 'public');
    await mark('2026-09-10', 'Founders Day', 'optional');
    await app.inject({
      method: 'DELETE',
      url: '/api/v1/holidays?date=2026-09-10',
      headers: auth(hr),
    });
    const events = (await sqlite
      .prepare(`SELECT action FROM audit_event WHERE entity_type = 'holiday' ORDER BY occurred_at`)
      .all()) as { action: string }[];
    expect(events.map((e) => e.action)).toEqual([
      'holiday.created',
      'holiday.updated',
      'holiday.removed',
    ]);
  });

  it('an employee cannot change the calendar', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/holidays',
      headers: auth(employee),
      payload: { date: '2026-09-10', name: 'Nope', kind: 'public' },
    });
    expect(res.statusCode).toBe(403);
    expect(await holidays()).toHaveLength(0);
  });

  it('rejects a malformed date on delete', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/v1/holidays?date=not-a-date',
      headers: auth(hr),
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('the calendar drives the working-day calculation', () => {
  async function preview(start: string, end: string) {
    const types = await app.inject({
      method: 'GET',
      url: '/api/v1/leave-types',
      headers: { cookie: employee.cookie },
    });
    const typeId = (types.json() as { data: { id: string; code: string }[] }).data.find(
      (t) => t.code === 'CL',
    )!.id;
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/leave/preview?leaveTypeId=${typeId}&startDate=${start}&endDate=${end}`,
      headers: { cookie: employee.cookie },
    });
    return res.json() as { data: { workingDays: string; skipped: string } };
  }

  it('excludes a public holiday and names it in the skipped list', async () => {
    // Mon 7 Sep to Fri 11 Sep 2026 is five working days.
    expect((await preview('2026-09-07', '2026-09-11')).data.workingDays).toBe('5');
    await mark('2026-09-10', 'Founders Day', 'public');
    const after = await preview('2026-09-07', '2026-09-11');
    expect(after.data.workingDays).toBe('4');
    expect(after.data.skipped).toContain('Founders Day');
  });

  it('does not exclude an optional holiday', async () => {
    await mark('2026-09-10', 'Optional festival', 'optional');
    expect((await preview('2026-09-07', '2026-09-11')).data.workingDays).toBe('5');
  });

  it('counts a declared working day that falls on a weekend', async () => {
    // Fri 11 to Mon 14 Sep 2026 spans a weekend, so two working days.
    expect((await preview('2026-09-11', '2026-09-14')).data.workingDays).toBe('2');
    await mark('2026-09-12', 'Stock take Saturday', 'declared_working'); // a Saturday
    expect((await preview('2026-09-11', '2026-09-14')).data.workingDays).toBe('3');
  });

  it('recalculates existing leave request so day is counted as leave when holiday becomes working day', async () => {
    // Step 1: Mark Wednesday 2026-09-09 as a public holiday
    await mark('2026-09-09', 'Midweek Festival', 'public');

    const types = await app.inject({
      method: 'GET',
      url: '/api/v1/leave-types',
      headers: { cookie: employee.cookie },
    });
    const typeId = (types.json() as { data: { id: string; code: string }[] }).data.find(
      (t) => t.code === 'CL',
    )!.id;

    // Step 2: Employee submits leave from Mon 7 Sep to Fri 11 Sep (initially 4 working days because Wed was holiday)
    const submitRes = await app.inject({
      method: 'POST',
      url: '/api/v1/leave-requests',
      headers: auth(employee),
      payload: {
        leaveTypeId: typeId,
        startDate: '2026-09-07',
        endDate: '2026-09-11',
        reason: 'Family event',
      },
    });
    expect(submitRes.statusCode).toBe(201);
    const reqId = (submitRes.json() as { data: { id: string } }).data.id;

    // Verify initial state: 8 half-days (4 days) counted, Wed 2026-09-09 is skipped
    const detailBefore = (
      await app.inject({
        method: 'GET',
        url: `/api/v1/leave-requests/${reqId}`,
        headers: { cookie: hr.cookie },
      })
    ).json() as {
      data: {
        total_half_days: number;
        days: { date: string; is_counted: number; skip_reason: string | null }[];
      };
    };
    expect(detailBefore.data.total_half_days).toBe(8);
    const wedBefore = detailBefore.data.days.find((d) => d.date === '2026-09-09');
    expect(wedBefore?.is_counted).toBe(0);
    expect(wedBefore?.skip_reason).toBe('public_holiday');

    // Step 3: HR changes Wed 2026-09-09 from holiday to working day (declared_working)
    await mark('2026-09-09', 'Declared Working Day', 'declared_working');

    // Step 4: Existing leave request now counts Wed as leave (is_counted = 1, total_half_days = 10 / 5 days)
    const detailAfter = (
      await app.inject({
        method: 'GET',
        url: `/api/v1/leave-requests/${reqId}`,
        headers: { cookie: hr.cookie },
      })
    ).json() as {
      data: {
        total_half_days: number;
        days: { date: string; is_counted: number; skip_reason: string | null }[];
      };
    };
    expect(detailAfter.data.total_half_days).toBe(10);
    const wedAfter = detailAfter.data.days.find((d) => d.date === '2026-09-09');
    expect(wedAfter?.is_counted).toBe(1);
    expect(wedAfter?.skip_reason).toBeNull();

    // Step 5: Verify deleting a public holiday also causes day to be counted as normal working day
    await mark('2026-09-09', 'Midweek Festival', 'public');
    const detailReholiday = (
      await app.inject({
        method: 'GET',
        url: `/api/v1/leave-requests/${reqId}`,
        headers: { cookie: hr.cookie },
      })
    ).json() as { data: { total_half_days: number } };
    expect(detailReholiday.data.total_half_days).toBe(8);

    // Delete holiday
    await app.inject({
      method: 'DELETE',
      url: '/api/v1/holidays?date=2026-09-09',
      headers: auth(hr),
    });

    const detailAfterDelete = (
      await app.inject({
        method: 'GET',
        url: `/api/v1/leave-requests/${reqId}`,
        headers: { cookie: hr.cookie },
      })
    ).json() as {
      data: {
        total_half_days: number;
        days: { date: string; is_counted: number; skip_reason: string | null }[];
      };
    };
    expect(detailAfterDelete.data.total_half_days).toBe(10);
    const wedAfterDelete = detailAfterDelete.data.days.find((d) => d.date === '2026-09-09');
    expect(wedAfterDelete?.is_counted).toBe(1);
    expect(wedAfterDelete?.skip_reason).toBeNull();

    // Step 6: Verify employee overview (/home) and requests list reflect the updated count and balances
    const empHomeRes = await app.inject({
      method: 'GET',
      url: '/api/v1/home',
      headers: { cookie: employee.cookie },
    });
    expect(empHomeRes.statusCode).toBe(200);
    const empHome = empHomeRes.json() as {
      data: {
        balances: { id: string; left: string; total: string; taken: string }[];
        requests: { id: string; total_half_days: number }[];
      };
    };
    const reqInHome = empHome.data.requests.find((r) => r.id === reqId);
    expect(reqInHome).toBeDefined();
    expect(reqInHome?.total_half_days).toBe(10); // 5 full days (10 half-days)
    const clBalance = empHome.data.balances.find((b) => b.id === typeId);
    expect(clBalance).toBeDefined();
    // 12 granted - 5 days pending hold = 7 remaining
    expect(clBalance?.left).toBe('7');

    // Step 7: Verify employee my requests query (/leave-requests?mine=1) reflects the updated count
    const empReqsRes = await app.inject({
      method: 'GET',
      url: '/api/v1/leave-requests?mine=1',
      headers: { cookie: employee.cookie },
    });
    expect(empReqsRes.statusCode).toBe(200);
    const empReqs = empReqsRes.json() as {
      data: { id: string; total_half_days: number }[];
    };
    const reqInMine = empReqs.data.find((r) => r.id === reqId);
    expect(reqInMine?.total_half_days).toBe(10);
  });
});

describe('leave rules published from settings take effect', () => {
  async function publish(code: string, overrides: Record<string, unknown>) {
    const types = await app.inject({
      method: 'GET',
      url: '/api/v1/leave-types',
      headers: { cookie: hr.cookie },
    });
    const typeId = (types.json() as { data: { id: string; code: string }[] }).data.find(
      (t) => t.code === code,
    )!.id;
    const current = (await sqlite
      .prepare(
        `SELECT rules_json FROM leave_policy_version WHERE leave_type_id = ?
         ORDER BY version_no DESC LIMIT 1`,
      )
      .get(typeId)) as { rules_json: string };
    const rules = { ...(JSON.parse(current.rules_json) as object), ...overrides };
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/policies',
      headers: auth(hr),
      payload: { leaveTypeId: typeId, effectiveFrom: '2026-01-01', rules },
    });
    expect(res.statusCode).toBe(200);
    return typeId;
  }

  async function submit(typeId: string, start: string, end: string) {
    return app.inject({
      method: 'POST',
      url: '/api/v1/leave-requests',
      headers: auth(employee),
      payload: {
        leaveTypeId: typeId,
        startDate: start,
        endDate: end,
        reason: 'Checking that the published rule is enforced.',
      },
    });
  }

  it('enforces a new maximum consecutive days immediately', async () => {
    const typeId = await publish('CL', { maxConsecutiveDays: 2 });
    const res = await submit(typeId, '2026-10-05', '2026-10-08');
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe('LEAVE_MAX_CONSECUTIVE');
  });

  it('enforces a new minimum notice period', async () => {
    const typeId = await publish('CL', { minNoticeDays: 90 }); // schema maximum
    // A fixed weekday well inside the notice window, so the notice rule is what
    // rejects it rather than the dates happening to fall on a weekend.
    const res = await submit(typeId, '2026-10-05', '2026-10-05'); // a Monday
    expect((res.json() as { error: { code: string } }).error.code).toBe('LEAVE_MIN_NOTICE');
  });

  it('publishing bumps the version and records an audit event with before and after', async () => {
    await publish('CL', { maxConsecutiveDays: 7 });
    const versions = (await sqlite
      .prepare(
        `SELECT COUNT(*) AS n FROM leave_policy_version v
         JOIN leave_type t ON t.id = v.leave_type_id WHERE t.code = 'CL'`,
      )
      .get()) as { n: number };
    expect(versions.n).toBe(2);
    const audit = (await sqlite
      .prepare(
        `SELECT before_json, after_json FROM audit_event WHERE action = 'leave.policy.published'`,
      )
      .get()) as { before_json: string | null; after_json: string } | undefined;
    expect(audit).toBeDefined();
    expect(audit?.before_json).toBeTruthy();
    expect(JSON.parse(audit!.after_json).maxConsecutiveDays).toBe(7);
  });

  it('an employee cannot publish leave rules', async () => {
    const types = await app.inject({
      method: 'GET',
      url: '/api/v1/leave-types',
      headers: { cookie: employee.cookie },
    });
    const typeId = (types.json() as { data: { id: string; code: string }[] }).data[0]!.id;
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/policies',
      headers: auth(employee),
      payload: { leaveTypeId: typeId, effectiveFrom: '2026-01-01', rules: {} },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('dashboard scope', () => {
  it('is refused to an employee, who must not see company-wide figures', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/dashboard',
      headers: { cookie: employee.cookie },
    });
    expect(res.statusCode).toBe(403);
  });

  it('is available to HR', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/dashboard',
      headers: { cookie: hr.cookie },
    });
    expect(res.statusCode).toBe(200);
    const kpis = (res.json() as { data: { kpis: { label: string }[] } }).data.kpis;
    expect(kpis).toHaveLength(4);
    // Development scaffolding must not reappear as a headline metric.
    expect(kpis.map((k) => k.label).join(' ')).not.toMatch(/placeholder/i);
  });
});
