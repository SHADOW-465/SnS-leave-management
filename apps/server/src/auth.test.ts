import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type Db } from '@sns/database';
import { loadConfig } from '@sns/config';
import { buildApp } from './app.js';
import type { FastifyInstance } from 'fastify';

const opened: { sqlite: Db; dir: string }[] = [];

const ADMIN = { email: 'admin@example.invalid', password: 'ChangeMe_admin_1' };

async function boot(): Promise<{ app: FastifyInstance; sqlite: Db }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leaveos-auth-'));
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
  return { app, sqlite };
}

function cookiesOf(res: { headers: Record<string, unknown> }): {
  header: string;
  csrf: string;
  sid: string;
} {
  const raw = res.headers['set-cookie'];
  const header = Array.isArray(raw)
    ? raw.map((c) => c.split(';')[0]).join('; ')
    : String(raw ?? '');
  return {
    header,
    csrf: /leaveos\.csrf=([^;]*)/.exec(header)?.[1] ?? '',
    sid: /leaveos\.sid=([^;]*)/.exec(header)?.[1] ?? '',
  };
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

describe('login rejection (regression: un-awaited failure accepted every password)', () => {
  it('rejects a wrong password with 401 and issues no session', async () => {
    const { app } = await boot();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: ADMIN.email, password: 'not-the-right-password' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.headers['set-cookie']).toBeUndefined();
    await app.close();
  });

  it('a session issued by a failed login does not exist', async () => {
    const { app, sqlite } = await boot();
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: ADMIN.email, password: 'wrong' },
    });
    const sessions = (await sqlite.prepare(`SELECT COUNT(*) AS n FROM session`).get()) as {
      n: number;
    };
    expect(sessions.n).toBe(0);
    await app.close();
  });

  it('rejects an unknown email with 401 without crashing the process', async () => {
    const { app } = await boot();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'nobody@nowhere.invalid', password: 'anything' },
    });
    expect(res.statusCode).toBe(401);
    // Same message as a wrong password: the response must not reveal whether the
    // address exists (SECURITY T-09).
    expect((res.json() as { error: { message: string } }).error.message).toBe(
      'Email or password is incorrect.',
    );
    // The server is still answering — an unhandled rejection used to kill it outright.
    const health = await app.inject({ method: 'GET', url: '/healthz' });
    expect(health.statusCode).toBe(200);
    await app.close();
  });

  it('records every failed attempt without storing the password', async () => {
    const { app, sqlite } = await boot();
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: ADMIN.email, password: 'hunter2-should-never-be-stored' },
    });
    const rows = (await sqlite
      .prepare(`SELECT email_attempted, succeeded, failure_reason FROM login_attempt`)
      .all()) as { email_attempted: string; succeeded: number; failure_reason: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.succeeded).toBe(0);
    expect(rows[0]?.failure_reason).toBe('bad_password');
    expect(JSON.stringify(rows)).not.toContain('hunter2');
    await app.close();
  });

  it('locks the account after repeated failures', async () => {
    const { app } = await boot();
    for (let i = 0; i < 5; i += 1) {
      await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: ADMIN.email, password: `wrong-${i}` },
      });
    }
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: ADMIN.email, password: ADMIN.password },
    });
    expect(res.statusCode).toBe(401);
    expect((res.json() as { error: { code: string } }).error.code).toBe('ACCOUNT_LOCKED');
    await app.close();
  });
});

describe('logout', () => {
  it('revokes the session so the same cookie stops working', async () => {
    const { app } = await boot();
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: ADMIN,
    });
    const { header, csrf } = cookiesOf(login);

    const before = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { cookie: header },
    });
    expect(before.statusCode).toBe(200);

    const out = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie: header, 'x-csrf-token': csrf },
    });
    expect(out.statusCode).toBe(200);

    // Replaying the original cookie must fail: the session is revoked server-side, not
    // merely cleared in the browser.
    const after = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { cookie: header },
    });
    expect(after.statusCode).toBe(401);
    await app.close();
  });

  it('clears both cookies', async () => {
    const { app } = await boot();
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: ADMIN });
    const { header, csrf } = cookiesOf(login);
    const out = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie: header, 'x-csrf-token': csrf },
    });
    const set = String(out.headers['set-cookie'] ?? '');
    expect(set).toContain('leaveos.sid=');
    expect(set).toContain('leaveos.csrf=');
    await app.close();
  });
});

describe('setup seeding (regression: un-awaited seeds raced the balance grant)', () => {
  it('opens the administrator a balance for every leave type, exactly once', async () => {
    const { app, sqlite } = await boot();
    const admin = (await sqlite
      .prepare(`SELECT employee_id AS id FROM user_account WHERE email = ?`)
      .get(ADMIN.email)) as { id: string };
    const types = (await sqlite.prepare(`SELECT COUNT(*) AS n FROM leave_type`).get()) as {
      n: number;
    };
    // Every type is marked as opened for the year, so the leave-year job never grants again.
    const opened = (await sqlite
      .prepare(`SELECT COUNT(*) AS n FROM period_rollover_run WHERE employee_id = ?`)
      .get(admin.id)) as { n: number };
    expect(Number(opened.n)).toBe(Number(types.n));
    // Annual Leave accrues monthly; months already elapsed are recorded as run.
    const accrualMonths = (await sqlite
      .prepare(`SELECT COUNT(*) AS n FROM accrual_run WHERE employee_id = ?`)
      .get(admin.id)) as { n: number };
    expect(Number(accrualMonths.n)).toBeGreaterThan(0);
    await app.close();
  });

  it('seeds leave types and workflows exactly once, and no invented holidays', async () => {
    const { app, sqlite } = await boot();
    const count = async (table: string) =>
      ((await sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()) as { n: number }).n;
    // The framework describes one leave type: Annual Leave. Others are added from Leave types.
    expect(await count('leave_type')).toBe(1);
    // One workflow per rung of the hierarchy: member, team lead, department head, HR/admin.
    expect(await count('approval_workflow')).toBe(4);
    // The calendar starts empty on purpose: HR enters the company's real holidays.
    expect(await count('holiday')).toBe(0);
    await app.close();
  });
});

describe('hosted preview cron', () => {
  it('is absent when CRON_SECRET is unset', async () => {
    delete process.env.CRON_SECRET;
    const { app } = await boot();
    const res = await app.inject({ method: 'GET', url: '/api/v1/internal/cron' });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('rejects a wrong bearer token', async () => {
    process.env.CRON_SECRET = 'preview-cron-secret';
    const { app } = await boot();
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/internal/cron',
      headers: { authorization: 'Bearer no' },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
    delete process.env.CRON_SECRET;
  });

  it('runs when the bearer token matches', async () => {
    process.env.CRON_SECRET = 'preview-cron-secret';
    const { app } = await boot();
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/internal/cron',
      headers: { authorization: 'Bearer preview-cron-secret' },
    });
    expect(res.statusCode).toBe(200);
    await app.close();
    delete process.env.CRON_SECRET;
  });
});
