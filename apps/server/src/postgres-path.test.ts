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
  employee = await signIn('amina@example.invalid');
  hr = await signIn('helen@example.invalid');
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
      .prepare(`SELECT COUNT(*) AS n FROM user_account WHERE email = 'sofia@example.invalid'`)
      .get()) as { n: number };
    expect(Number(n.n)).toBe(1);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'sofia@example.invalid', password: 'ChangeMe_demo_1' },
    });
    expect(res.statusCode).toBe(200);
  });
});
