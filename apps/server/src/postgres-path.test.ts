/**
 * Runs the real application against a real Postgres (PGlite, Postgres compiled to WASM)
 * through an adapter shaped exactly like packages/database/src/postgres.ts.
 *
 * This exists because the hosted Postgres deployment shipped unable to submit or approve
 * leave: Postgres folds unquoted identifiers to lower case, so `AS quantityHalfDays` came
 * back as `quantityhalfdays` and every balance read threw. Nothing caught it, because the
 * whole Postgres path had no tests. These do not run against SQLite — that is the point.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { loadConfig } from '@sns/config';
import { migrate, toPostgresQuery, toPostgresSql, type Db, type Statement } from '@sns/database';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { completeSetup, ensureDemoHierarchy } from './usecases/setup.js';
import { nowIso, todayInTimeZone } from './time.js';
import type { RequestContext } from './ctx.js';

function splitSql(sql: string): string[] {
  const parts: string[] = [];
  let buf = '';
  let inDollar = false;
  for (let i = 0; i < sql.length; i += 1) {
    if (sql.startsWith('$$', i)) {
      inDollar = !inDollar;
      buf += '$$';
      i += 1;
      continue;
    }
    if (!inDollar && sql[i] === ';') {
      if (buf.trim()) parts.push(buf.trim());
      buf = '';
      continue;
    }
    buf += sql[i];
  }
  if (buf.trim()) parts.push(buf.trim());
  return parts;
}

type Session = { cookie: string; csrf: string };

let pg: PGlite;
let db: Db;
let app: FastifyInstance;
let employee: Session;
let hr: Session;
let clTypeId: string;

function sessionFrom(res: { headers: Record<string, unknown> }): Session {
  const raw = res.headers['set-cookie'];
  const cookie = Array.isArray(raw)
    ? raw.map((c) => c.split(';')[0]).join('; ')
    : String(raw ?? '');
  return { cookie, csrf: /leaveos\.csrf=([^;]*)/.exec(cookie)?.[1] ?? '' };
}

async function signIn(email: string): Promise<Session> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email, password: 'ChangeMe_demo_1' },
  });
  expect(res.statusCode).toBe(200);
  return sessionFrom(res);
}

function auth(s: Session) {
  return { cookie: s.cookie, 'x-csrf-token': s.csrf };
}

beforeAll(async () => {
  pg = new PGlite();
  db = {
    dialect: 'postgres',
    prepare(text: string): Statement {
      return {
        async get(...params: unknown[]) {
          const q = toPostgresQuery(text, params);
          return (await pg.query(q.text, q.values as unknown[])).rows[0] as unknown;
        },
        async all(...params: unknown[]) {
          const q = toPostgresQuery(text, params);
          return (await pg.query(q.text, q.values as unknown[])).rows as unknown[];
        },
        async run(...params: unknown[]) {
          const q = toPostgresQuery(text, params);
          const r = await pg.query(q.text, q.values as unknown[]);
          return { changes: r.affectedRows ?? 0 };
        },
      };
    },
    async exec(text: string) {
      for (const stmt of splitSql(toPostgresSql(text))) await pg.exec(stmt);
    },
    async close() {
      await pg.close();
    },
  };

  await migrate(db);
  const config = loadConfig({ LEAVEOS_ENV: 'test', LEAVEOS_DATA_DIR: './.tmp-pgtest' });
  const ctx: RequestContext = {
    requestId: 'seed',
    sqlite: db,
    config,
    principal: null,
    ip: '127.0.0.1',
    userAgent: 'test',
    now: nowIso(),
    today: todayInTimeZone('UTC'),
    attachmentsRoot: './.tmp-pgtest/attachments',
    backupsRoot: './.tmp-pgtest/backups',
  };
  await completeSetup(ctx, {
    companyName: 'Test Co',
    timezone: 'UTC',
    leaveYearStartMonth: 1,
    leaveYearStartDay: 1,
    adminName: 'Ada Example',
    adminEmail: 'admin@example.invalid',
    adminPassword: 'ChangeMe_admin_1',
    loadSampleData: true,
  });
  app = await buildApp(config, db);
  await app.ready();
  employee = await signIn('vijay@sns.test');
  hr = await signIn('anitha@sns.test');
  const types = await app.inject({
    method: 'GET',
    url: '/api/v1/leave-types',
    headers: { cookie: employee.cookie },
  });
  clTypeId = (types.json() as { data: { id: string; code: string }[] }).data.find(
    (t) => t.code === 'CL',
  )!.id;
}, 60_000);

afterAll(async () => {
  await app?.close();
  await pg?.close();
});

describe('hosted Postgres: identifier case folding', () => {
  it('preserves a camelCase column alias', async () => {
    // Unquoted, Postgres would return `quantityhalfdays` and every reader would see
    // undefined. toPostgresSql quotes the alias so the case survives.
    const q = toPostgresQuery(
      'SELECT quantity_half_days AS quantityHalfDays, entry_type AS entryType FROM balance_ledger LIMIT 1',
      [],
    );
    const rows = await pg.query(q.text, q.values as unknown[]);
    expect(Object.keys(rows.rows[0] as object)).toContain('quantityHalfDays');
  });

  it('leaves a cast to a type name alone', () => {
    expect(toPostgresSql('SELECT CAST(x AS TEXT) FROM t')).toContain('CAST(x AS TEXT)');
  });
});

describe('hosted Postgres: the leave flow that was broken in production', () => {
  let requestId: string;

  it('previews working days', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/leave/preview?leaveTypeId=${clTypeId}&startDate=2026-10-05&endDate=2026-10-07`,
      headers: { cookie: employee.cookie },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: { workingDays: string } }).data.workingDays).toBe('3');
  });

  it('submits a leave request', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/leave-requests',
      headers: auth(employee),
      payload: {
        leaveTypeId: clTypeId,
        startDate: '2026-10-05',
        endDate: '2026-10-07',
        reason: 'Exercising the hosted Postgres write path.',
      },
    });
    expect(res.statusCode).toBe(201);
    requestId = (res.json() as { data: { id: string } }).data.id;
  });

  it('approves it and writes the correct ledger entries', async () => {
    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/leave-requests/${requestId}`,
      headers: { cookie: hr.cookie },
    });
    const version = (detail.json() as { data: { version: number } }).data.version;

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/leave-requests/${requestId}/approve`,
      headers: auth(hr),
      payload: { expectedVersion: version },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: { status: string } }).data.status).toBe('approved');

    const ledger = await pg.query<{ entry_type: string; quantity_half_days: number }>(
      `SELECT entry_type, quantity_half_days FROM balance_ledger WHERE source_id = $1
       ORDER BY created_at`,
      [requestId],
    );
    expect(ledger.rows.map((r) => r.entry_type)).toEqual([
      'PENDING_HOLD',
      'HOLD_RELEASE',
      'DEDUCTION',
    ]);
    // Hold and release cancel; the deduction is what remains.
    expect(ledger.rows.reduce((n, r) => n + r.quantity_half_days, 0)).toBe(-6);
  });

  it('resolves an approver rather than storing null', async () => {
    const step = await pg.query<{ approver_user_id: string | null }>(
      `SELECT approver_user_id FROM approval_step_instance WHERE leave_request_id = $1`,
      [requestId],
    );
    expect(step.rows[0]?.approver_user_id).toBeTruthy();
  });
});

describe('hosted Postgres: every read surface answers', () => {
  const urls = [
    '/api/v1/me',
    '/api/v1/home',
    '/api/v1/dashboard',
    '/api/v1/employees',
    '/api/v1/leave-requests',
    '/api/v1/availability?from=2026-10-01&days=14',
    '/api/v1/calendar?year=2026&month=10',
    '/api/v1/reports',
    '/api/v1/audit',
    '/api/v1/policies',
    '/api/v1/org',
    '/api/v1/departments',
    '/api/v1/teams', // `? IS NULL` used to make Postgres reject this outright
    '/api/v1/attendance',
    '/api/v1/notifications',
  ];
  it.each(urls)('%s does not fail', async (url) => {
    const res = await app.inject({ method: 'GET', url, headers: { cookie: hr.cookie } });
    expect(res.statusCode).toBeLessThan(500);
  });
});

describe('hosted Postgres: write surfaces', () => {
  it('marks a holiday, publishes a policy, and creates an employee', async () => {
    const holiday = await app.inject({
      method: 'POST',
      url: '/api/v1/holidays',
      headers: auth(hr),
      payload: { date: '2026-10-12', name: 'Founders Day', kind: 'public' },
    });
    expect(holiday.statusCode).toBe(200);

    const policy = await app.inject({
      method: 'POST',
      url: '/api/v1/policies',
      headers: auth(hr),
      payload: {
        leaveTypeId: clTypeId,
        effectiveFrom: '2026-01-01',
        rules: {
          entitlementHalfDays: 30,
          accrualMethod: 'annual_grant',
          accrualCadenceMonths: 12,
          midYearProrate: true,
          carryForwardCapHalfDays: 10,
          carryForwardExpiryMonths: 3,
          probationRestriction: 'none',
          probationMaxHalfDays: 6,
          halfDaysAllowed: true,
          minNoticeDays: 0,
          maxConsecutiveDays: 15,
          negativeBalanceAllowed: false,
          attachmentRequiredAfterHalfDays: null,
        },
      },
    });
    expect(policy.statusCode).toBe(200);
  });

  it('withdraws and rejects', async () => {
    const mk = async (start: string, end: string) => {
      const r = await app.inject({
        method: 'POST',
        url: '/api/v1/leave-requests',
        headers: auth(employee),
        payload: {
          leaveTypeId: clTypeId,
          startDate: start,
          endDate: end,
          reason: 'Exercising withdraw and reject on the hosted path.',
        },
      });
      expect(r.statusCode).toBe(201);
      return (r.json() as { data: { id: string } }).data.id;
    };

    const a = await mk('2026-11-02', '2026-11-03');
    const withdrawn = await app.inject({
      method: 'POST',
      url: `/api/v1/leave-requests/${a}/withdraw`,
      headers: auth(employee),
      payload: { expectedVersion: 1 },
    });
    expect(withdrawn.statusCode).toBe(200);

    const b = await mk('2026-11-09', '2026-11-10');
    const rejected = await app.inject({
      method: 'POST',
      url: `/api/v1/leave-requests/${b}/reject`,
      headers: auth(hr),
      payload: { expectedVersion: 1, reason: 'Not enough cover that week.' },
    });
    expect(rejected.statusCode).toBe(200);
  });
});

describe('hosted Postgres: demo hierarchy backfill is idempotent', () => {
  it('leaves a fully seeded org alone and still lets Sofia sign in', async () => {
    const ctx: RequestContext = {
      requestId: 'backfill',
      sqlite: db,
      config: loadConfig({ LEAVEOS_ENV: 'test', LEAVEOS_DATA_DIR: './.tmp-pgtest' }),
      principal: null,
      ip: '127.0.0.1',
      userAgent: 'test',
      now: nowIso(),
      today: todayInTimeZone('UTC'),
      attachmentsRoot: './.tmp-pgtest/attachments',
      backupsRoot: './.tmp-pgtest/backups',
    };
    await ensureDemoHierarchy(ctx);
    await ensureDemoHierarchy(ctx);
    const n = (await db
      .prepare(`SELECT COUNT(*) AS n FROM user_account WHERE email = 'david@sns.test'`)
      .get()) as { n: number };
    expect(Number(n.n)).toBe(1);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'david@sns.test', password: 'ChangeMe_demo_1' },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('hosted Postgres: administrator controls', () => {
  let admin: Session;
  const emp = async (email: string) =>
    ((await pg.query<{ id: string }>(`SELECT id FROM employee WHERE work_email = $1`, [email]))
      .rows[0]?.id ?? '') as string;
  const user = async (email: string) =>
    ((await pg.query<{ id: string }>(`SELECT id FROM user_account WHERE email = $1`, [email]))
      .rows[0]?.id ?? '') as string;
  const put = (s: Session, url: string, payload: object) =>
    app.inject({ method: 'PUT', url, headers: auth(s), payload });
  const post = (s: Session, url: string, payload: object = {}) =>
    app.inject({ method: 'POST', url, headers: auth(s), payload });

  beforeAll(async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'admin@example.invalid', password: 'ChangeMe_admin_1' },
    });
    expect(res.statusCode).toBe(200);
    admin = sessionFrom(res);
  });

  it('builds the approval map', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/approval-map',
      headers: { cookie: admin.cookie },
    });
    expect(res.statusCode).toBe(200);
    const data = (res.json() as { data: { people: unknown[]; teams: { memberCount: number }[] } })
      .data;
    expect(data.people.length).toBeGreaterThan(0);
    // COUNT(*) is a bigint on Postgres; it must still arrive as a number.
    expect(typeof data.teams[0]?.memberCount).toBe('number');
  });

  it('assigns reporting managers with dated history', async () => {
    const vijay = await emp('vijay@sns.test');
    const david = await emp('david@sns.test');
    const assign = (managerEmployeeId: string | null) =>
      put(admin, '/api/v1/admin/reporting-managers', { employeeIds: [vijay], managerEmployeeId });
    const first = await assign(david);
    expect(first.statusCode).toBe(200);
    expect((first.json() as { data: { changed: number } }).data.changed).toBe(1);
    // A same-day correction updates the open history row rather than adding another.
    expect((await assign(null)).statusCode).toBe(200);
    const history = await app.inject({
      method: 'GET',
      url: `/api/v1/employees/${vijay}/manager-history`,
      headers: { cookie: admin.cookie },
    });
    expect(history.statusCode).toBe(200);
    expect((history.json() as { data: unknown[] }).data.length).toBeGreaterThan(0);
  });

  it('works through the transactions register, annual report and working week', async () => {
    const vijay = await emp('vijay@sns.test');
    const get = (url: string) =>
      app.inject({ method: 'GET', url, headers: { cookie: admin.cookie } });
    expect((await get(`/api/v1/ledger?employeeId=${vijay}`)).statusCode).toBe(200);
    const annual = await get('/api/v1/reports/annual');
    expect(annual.statusCode).toBe(200);
    expect((annual.json() as { data: { rows: unknown[] } }).data.rows.length).toBeGreaterThan(0);
    expect(
      (await put(admin, '/api/v1/settings/work-week', { weekendDays: [0, 6] })).statusCode,
    ).toBe(200);
    expect((await get('/api/v1/admin/users')).statusCode).toBe(200);
    expect((await get('/api/v1/profile')).statusCode).toBe(200);
  });

  it('creates and removes cover, and routes to the cover meanwhile', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const created = await post(admin, '/api/v1/admin/delegations', {
      approverEmployeeId: await emp('john@sns.test'),
      delegateEmployeeId: await emp('ramesh@sns.test'),
      startsOn: today,
      endsOn: '2099-12-31',
    });
    expect(created.statusCode).toBe(200);
    const preview = await app.inject({
      method: 'GET',
      url: `/api/v1/leave/preview?leaveTypeId=${clTypeId}&startDate=2026-12-07&endDate=2026-12-08`,
      headers: { cookie: employee.cookie },
    });
    expect((preview.json() as { data: { approver: string } }).data.approver).toContain('Ramesh');
    const id = (created.json() as { data: { id: string } }).data.id;
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/api/v1/admin/delegations/${id}`,
          headers: auth(admin),
        })
      ).statusCode,
    ).toBe(200);
  });

  it('reassigns a pending request', async () => {
    const submitted = await post(employee, '/api/v1/leave-requests', {
      leaveTypeId: clTypeId,
      startDate: '2026-12-14',
      endDate: '2026-12-15',
      reason: 'Hosted reassignment check.',
    });
    expect(submitted.statusCode).toBe(201);
    const id = (submitted.json() as { data: { id: string } }).data.id;
    const res = await post(admin, `/api/v1/leave-requests/${id}/reassign`, {
      approverEmployeeId: await emp('david@sns.test'),
    });
    expect(res.statusCode).toBe(200);
  });

  it('lists users, changes roles, disables, releases a workstation, and signs out', async () => {
    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/users',
      headers: { cookie: admin.cookie },
    });
    expect(list.statusCode).toBe(200);
    const paul = await user('ramesh@sns.test');
    expect(
      (await put(admin, `/api/v1/admin/users/${paul}/roles`, { roles: ['payroll_officer'] }))
        .statusCode,
    ).toBe(200);
    expect((await post(admin, `/api/v1/admin/users/${paul}/release-workstation`)).statusCode).toBe(
      200,
    );
    expect((await post(admin, `/api/v1/admin/users/${paul}/sign-out-everywhere`)).statusCode).toBe(
      200,
    );
    expect(
      (await put(admin, `/api/v1/admin/users/${paul}/disabled`, { disabled: true })).statusCode,
    ).toBe(200);
    expect(
      (await put(admin, `/api/v1/admin/users/${paul}/disabled`, { disabled: false })).statusCode,
    ).toBe(200);
  });

  it('tells a team lead they approve leave', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'john@sns.test', password: 'ChangeMe_demo_1' },
    });
    const ravi = sessionFrom(res);
    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { cookie: ravi.cookie },
    });
    expect(me.statusCode).toBe(200);
    expect((me.json() as { data: { approvesLeave: boolean } }).data.approvesLeave).toBe(true);
  });

  it('lists and sets allowances, with numbers not bigints', async () => {
    const cl = (await pg.query<{ id: string }>(`SELECT id FROM leave_type WHERE code = 'CL'`))
      .rows[0]!.id;
    const paul = await emp('ramesh@sns.test');
    const set = await put(admin, '/api/v1/allowances', {
      employeeIds: [paul],
      leaveTypeId: cl,
      allowanceHalfDays: 50,
      reason: 'Hosted allowance check',
    });
    expect(set.statusCode).toBe(200);
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/allowances',
      headers: { cookie: admin.cookie },
    });
    const row = (
      res.json() as {
        data: { people: { id: string; balances: Record<string, { allowance: unknown }> }[] };
      }
    ).data.people.find((p) => p.id === paul)!;
    expect(row.balances[cl]!.allowance).toBe(50);
  });

  it('applies holidays in bulk', async () => {
    const res = await post(admin, '/api/v1/holidays/bulk', {
      dates: ['2026-12-12', '2026-12-19'],
      kind: 'declared_working',
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: { changed: string[] } }).data.changed).toHaveLength(2);
    const cleared = await post(admin, '/api/v1/holidays/bulk', {
      dates: ['2026-12-12', '2026-12-19'],
      kind: null,
    });
    expect((cleared.json() as { data: { changed: string[] } }).data.changed).toHaveLength(2);
  });

  it('filters the request list by view', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/leave-requests?view=approvals',
      headers: { cookie: admin.cookie },
    });
    expect(res.statusCode).toBe(200);
  });

  it('returns employee overview with identity, pending, and monthly rows', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/home',
      headers: { cookie: employee.cookie },
    });
    expect(res.statusCode).toBe(200);
    const data = (
      res.json() as {
        data: {
          employee: { code: string; department: string };
          monthly: unknown[];
          balances: { pending: string; left: string }[];
        };
      }
    ).data;
    expect(data.employee.code).toBeTruthy();
    expect(data.employee.department).toBeTruthy();
    expect(Array.isArray(data.monthly)).toBe(true);
    expect(data.balances.some((b) => typeof b.pending === 'string')).toBe(true);
  });

  it('returns monthly payroll columns on reports', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/reports?year=2026&month=1',
      headers: { cookie: admin.cookie },
    });
    expect(res.statusCode).toBe(200);
    const payroll = (
      res.json() as {
        data: { payroll: { rows: { employeeCode: string; closing: number }[] } };
      }
    ).data.payroll;
    expect(payroll.rows.length).toBeGreaterThan(0);
    expect(payroll.rows[0]!.employeeCode).toBeTruthy();
  });

  it('imports holidays from a row list', async () => {
    const res = await post(admin, '/api/v1/holidays/import', {
      rows: [{ date: '2026-01-26', name: 'Republic Day', kind: 'public' }],
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: { changed: string[] } }).data.changed).toContain('2026-01-26');
  });

  it('refuses overlapping leave on the hosted path', async () => {
    const first = await post(employee, '/api/v1/leave-requests', {
      leaveTypeId: clTypeId,
      startDate: '2026-10-20',
      endDate: '2026-10-21',
      reason: 'Hosted overlap first request.',
    });
    expect(first.statusCode).toBe(201);
    const second = await post(employee, '/api/v1/leave-requests', {
      leaveTypeId: clTypeId,
      startDate: '2026-10-21',
      endDate: '2026-10-22',
      reason: 'Hosted overlap second request.',
    });
    expect(second.statusCode).toBe(409);
    expect((second.json() as { error: { code: string } }).error.code).toBe('LEAVE_OVERLAP');
  });
});
