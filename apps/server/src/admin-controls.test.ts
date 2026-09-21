/**
 * Administrator controls over who approves whom, and who can do what. Driven through the
 * real API against the seeded sample organisation:
 *
 *   Engineering (head: Sofia) → Platform (lead: Ravi, member: Amina), Customer Support (Paul)
 *   Helen is HR. Ada is the administrator.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type Db } from '@sns/database';
import { loadConfig } from '@sns/config';
import { buildApp } from './app.js';
import type { FastifyInstance } from 'fastify';

type Session = { cookie: string; csrf: string };
const opened: { sqlite: Db; dir: string }[] = [];
let app: FastifyInstance;
let sqlite: Db;
let admin: Session;
let clTypeId: string;

function sessionFrom(res: { headers: Record<string, unknown> }): Session {
  const raw = res.headers['set-cookie'];
  const cookie = Array.isArray(raw)
    ? raw.map((c) => c.split(';')[0]).join('; ')
    : String(raw ?? '');
  return { cookie, csrf: /leaveos\.csrf=([^;]*)/.exec(cookie)?.[1] ?? '' };
}

async function signIn(email: string, password = 'ChangeMe_demo_1'): Promise<Session> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email, password },
  });
  expect(res.statusCode, `sign in ${email}`).toBe(200);
  return sessionFrom(res);
}

const auth = (s: Session) => ({ cookie: s.cookie, 'x-csrf-token': s.csrf });

async function call(
  s: Session,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  url: string,
  payload?: unknown,
) {
  return app.inject({
    method,
    url,
    headers: method === 'GET' ? { cookie: s.cookie } : auth(s),
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
}

async function employeeId(email: string): Promise<string> {
  const row = (await sqlite.prepare(`SELECT id FROM employee WHERE work_email = ?`).get(email)) as {
    id: string;
  };
  return row.id;
}

async function userId(email: string): Promise<string> {
  const row = (await sqlite.prepare(`SELECT id FROM user_account WHERE email = ?`).get(email)) as {
    id: string;
  };
  return row.id;
}

async function apply(as: Session, start: string, end: string): Promise<string> {
  const res = await call(as, 'POST', '/api/v1/leave-requests', {
    leaveTypeId: clTypeId,
    startDate: start,
    endDate: end,
    reason: 'Exercising administrator routing controls.',
  });
  expect(res.statusCode).toBe(201);
  return (res.json() as { data: { id: string } }).data.id;
}

async function approverEmailFor(requestId: string): Promise<string | null> {
  const row = (await sqlite
    .prepare(
      `SELECT ua.email AS email FROM approval_step_instance s
         JOIN user_account ua ON ua.id = s.approver_user_id WHERE s.leave_request_id = ?`,
    )
    .get(requestId)) as { email: string } | undefined;
  return row?.email ?? null;
}

beforeEach(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leaveos-admin-'));
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
      adminEmail: 'admin@example.invalid',
      adminPassword: 'ChangeMe_admin_1',
      loadSampleData: true,
    },
  });
  admin = await signIn('admin@example.invalid', 'ChangeMe_admin_1');
  const row = (await sqlite.prepare(`SELECT id FROM leave_type WHERE code = 'CL'`).get()) as {
    id: string;
  };
  clTypeId = row.id;
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

describe('the approval map', () => {
  it('shows who each person’s leave goes to, matching real routing', async () => {
    const res = await call(admin, 'GET', '/api/v1/admin/approval-map');
    expect(res.statusCode).toBe(200);
    const people = (
      res.json() as {
        data: { people: { name: string; route: { approverName: string } | null }[] };
      }
    ).data.people;
    const amina = people.find((p) => p.name === 'Amina Example');
    expect(amina?.route?.approverName).toBe('Ravi Example');
    const ravi = people.find((p) => p.name === 'Ravi Example');
    expect(ravi?.route?.approverName).toBe('Sofia Example');
  });

  it('is refused to HR — deciding the hierarchy is the administrator’s', async () => {
    const helen = await signIn('helen@example.invalid');
    expect((await call(helen, 'GET', '/api/v1/admin/approval-map')).statusCode).toBe(403);
  });

  it('warns about a team with no lead', async () => {
    await sqlite.exec(`UPDATE team SET lead_employee_id = NULL WHERE name = 'Platform'`);
    const res = await call(admin, 'GET', '/api/v1/admin/approval-map');
    const warnings = (res.json() as { data: { warnings: { text: string }[] } }).data.warnings;
    expect(
      warnings.some((w) => w.text.includes('Platform') && w.text.includes('no team lead')),
    ).toBe(true);
  });
});

describe('appointing leads and heads', () => {
  it('changing a team lead changes where new requests go', async () => {
    const team = (await sqlite.prepare(`SELECT id FROM team WHERE name = 'Platform'`).get()) as {
      id: string;
    };
    const res = await call(admin, 'PUT', `/api/v1/admin/teams/${team.id}/lead`, {
      employeeId: await employeeId('helen@example.invalid'),
    });
    expect(res.statusCode).toBe(200);
    const id = await apply(await signIn('amina@example.invalid'), '2026-10-05', '2026-10-06');
    expect(await approverEmailFor(id)).toBe('helen@example.invalid');
  });

  it('HR can no longer appoint a team lead through the structure screens', async () => {
    const helen = await signIn('helen@example.invalid');
    const team = (await sqlite.prepare(`SELECT id FROM team WHERE name = 'Platform'`).get()) as {
      id: string;
    };
    const res = await call(helen, 'PATCH' as 'PUT', `/api/v1/teams/${team.id}`, {
      leadEmployeeId: await employeeId('paul@example.invalid'),
    });
    expect(res.statusCode).toBe(403);
  });

  it('refuses to appoint someone with no sign-in account', async () => {
    const team = (await sqlite.prepare(`SELECT id FROM team WHERE name = 'Platform'`).get()) as {
      id: string;
    };
    await sqlite.exec(
      `DELETE FROM user_role WHERE user_account_id = (SELECT id FROM user_account WHERE email = 'paul@example.invalid')`,
    );
    await sqlite.exec(
      `DELETE FROM session WHERE user_account_id = (SELECT id FROM user_account WHERE email = 'paul@example.invalid')`,
    );
    await sqlite.exec(`DELETE FROM user_account WHERE email = 'paul@example.invalid'`);
    const res = await call(admin, 'PUT', `/api/v1/admin/teams/${team.id}/lead`, {
      employeeId: await employeeId('paul@example.invalid'),
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: { code: string } }).error.code).toBe('NO_ACCOUNT');
  });
});

describe('overrides', () => {
  it('sends one person’s leave to a named approver, whatever their team says', async () => {
    const res = await call(
      admin,
      'PUT',
      `/api/v1/admin/overrides/${await employeeId('amina@example.invalid')}`,
      { approverEmployeeId: await employeeId('sofia@example.invalid'), note: 'Project secondment' },
    );
    expect(res.statusCode).toBe(200);
    const id = await apply(await signIn('amina@example.invalid'), '2026-10-05', '2026-10-06');
    expect(await approverEmailFor(id)).toBe('sofia@example.invalid');
  });

  it('clearing the override returns them to their team lead', async () => {
    const amina = await employeeId('amina@example.invalid');
    await call(admin, 'PUT', `/api/v1/admin/overrides/${amina}`, {
      approverEmployeeId: await employeeId('sofia@example.invalid'),
    });
    await call(admin, 'PUT', `/api/v1/admin/overrides/${amina}`, { approverEmployeeId: null });
    const id = await apply(await signIn('amina@example.invalid'), '2026-10-05', '2026-10-06');
    expect(await approverEmailFor(id)).toBe('ravi@example.invalid');
  });

  it('refuses an override that makes someone their own approver', async () => {
    const amina = await employeeId('amina@example.invalid');
    const res = await call(admin, 'PUT', `/api/v1/admin/overrides/${amina}`, {
      approverEmployeeId: amina,
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('cover while someone is away', () => {
  it('sends a lead’s approvals to their cover during the dates', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const res = await call(admin, 'POST', '/api/v1/admin/delegations', {
      approverEmployeeId: await employeeId('ravi@example.invalid'),
      delegateEmployeeId: await employeeId('paul@example.invalid'),
      startsOn: today,
      endsOn: '2099-12-31',
      note: 'Ravi on annual leave',
    });
    expect(res.statusCode).toBe(200);
    const id = await apply(await signIn('amina@example.invalid'), '2026-10-05', '2026-10-06');
    expect(await approverEmailFor(id)).toBe('paul@example.invalid');

    // The cover can actually decide it.
    const paul = await signIn('paul@example.invalid');
    const decided = await call(paul, 'POST', `/api/v1/leave-requests/${id}/approve`, {
      expectedVersion: 1,
    });
    expect(decided.statusCode).toBe(200);
  });

  it('removing the cover restores normal routing', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const created = await call(admin, 'POST', '/api/v1/admin/delegations', {
      approverEmployeeId: await employeeId('ravi@example.invalid'),
      delegateEmployeeId: await employeeId('paul@example.invalid'),
      startsOn: today,
      endsOn: '2099-12-31',
    });
    const delegationId = (created.json() as { data: { id: string } }).data.id;
    expect(
      (await call(admin, 'DELETE', `/api/v1/admin/delegations/${delegationId}`)).statusCode,
    ).toBe(200);
    const id = await apply(await signIn('amina@example.invalid'), '2026-10-05', '2026-10-06');
    expect(await approverEmailFor(id)).toBe('ravi@example.invalid');
  });

  it('rejects a date range that ends before it starts', async () => {
    const res = await call(admin, 'POST', '/api/v1/admin/delegations', {
      approverEmployeeId: await employeeId('ravi@example.invalid'),
      delegateEmployeeId: await employeeId('paul@example.invalid'),
      startsOn: '2099-12-31',
      endsOn: '2099-01-01',
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('reassigning a stuck request', () => {
  it('moves a pending request to a different approver who can then decide it', async () => {
    const id = await apply(await signIn('amina@example.invalid'), '2026-10-05', '2026-10-06');
    const res = await call(admin, 'POST', `/api/v1/leave-requests/${id}/reassign`, {
      approverEmployeeId: await employeeId('sofia@example.invalid'),
      note: 'Ravi is unreachable',
    });
    expect(res.statusCode).toBe(200);
    expect(await approverEmailFor(id)).toBe('sofia@example.invalid');

    // The old approver has lost it; the new one can decide it.
    const ravi = await signIn('ravi@example.invalid');
    const detail = await call(ravi, 'GET', `/api/v1/leave-requests/${id}`);
    const version = (detail.json() as { data?: { version: number } }).data?.version ?? 2;
    expect(
      (
        await call(ravi, 'POST', `/api/v1/leave-requests/${id}/approve`, {
          expectedVersion: version,
        })
      ).statusCode,
    ).toBe(403);
    const sofia = await signIn('sofia@example.invalid');
    expect(
      (await call(sofia, 'POST', `/api/v1/leave-requests/${id}/approve`, { expectedVersion: 2 }))
        .statusCode,
    ).toBe(200);
  });

  it('will not reassign a request to the person who asked for it', async () => {
    const id = await apply(await signIn('amina@example.invalid'), '2026-10-05', '2026-10-06');
    const res = await call(admin, 'POST', `/api/v1/leave-requests/${id}/reassign`, {
      approverEmployeeId: await employeeId('amina@example.invalid'),
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('users and access', () => {
  it('lists every account with its roles', async () => {
    const res = await call(admin, 'GET', '/api/v1/admin/users');
    expect(res.statusCode).toBe(200);
    const users = (res.json() as { data: { users: { email: string; roles: string[] }[] } }).data
      .users;
    expect(users.find((u) => u.email === 'helen@example.invalid')?.roles).toEqual(['hr_officer']);
  });

  it('changes someone’s roles and the new access applies immediately', async () => {
    const paul = await signIn('paul@example.invalid');
    expect((await call(paul, 'GET', '/api/v1/audit')).statusCode).toBe(403);
    await call(admin, 'PUT', `/api/v1/admin/users/${await userId('paul@example.invalid')}/roles`, {
      roles: ['payroll_officer', 'auditor'],
    });
    expect((await call(paul, 'GET', '/api/v1/audit')).statusCode).toBe(200);
  });

  it('will not let an administrator remove their own admin role', async () => {
    const res = await call(
      admin,
      'PUT',
      `/api/v1/admin/users/${await userId('admin@example.invalid')}/roles`,
      { roles: ['employee'] },
    );
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: { code: string } }).error.code).toBe('SELF_LOCKOUT');
  });

  it('will not disable the last active administrator', async () => {
    // Make Helen an admin, then have her try to disable Ada, who would be the other one.
    await call(admin, 'PUT', `/api/v1/admin/users/${await userId('helen@example.invalid')}/roles`, {
      roles: ['hr_officer', 'admin'],
    });
    const helen = await signIn('helen@example.invalid');
    // Disabling Ada is fine while Helen is also an admin...
    expect(
      (
        await call(
          helen,
          'PUT',
          `/api/v1/admin/users/${await userId('admin@example.invalid')}/disabled`,
          { disabled: true },
        )
      ).statusCode,
    ).toBe(200);
    // ...but Helen cannot then disable herself, the last one.
    const self = await call(
      helen,
      'PUT',
      `/api/v1/admin/users/${await userId('helen@example.invalid')}/disabled`,
      { disabled: true },
    );
    expect(self.statusCode).toBe(409);
  });

  it('disabling an account signs it out everywhere', async () => {
    const paul = await signIn('paul@example.invalid');
    expect((await call(paul, 'GET', '/api/v1/me')).statusCode).toBe(200);
    await call(
      admin,
      'PUT',
      `/api/v1/admin/users/${await userId('paul@example.invalid')}/disabled`,
      {
        disabled: true,
      },
    );
    expect((await call(paul, 'GET', '/api/v1/me')).statusCode).toBe(401);
  });

  it('signing someone out everywhere ends their sessions', async () => {
    const paul = await signIn('paul@example.invalid');
    await call(
      admin,
      'POST',
      `/api/v1/admin/users/${await userId('paul@example.invalid')}/sign-out-everywhere`,
    );
    expect((await call(paul, 'GET', '/api/v1/me')).statusCode).toBe(401);
  });

  it('signing yourself out everywhere keeps the session you used', async () => {
    const second = await signIn('admin@example.invalid', 'ChangeMe_admin_1');
    await call(
      admin,
      'POST',
      `/api/v1/admin/users/${await userId('admin@example.invalid')}/sign-out-everywhere`,
    );
    expect((await call(admin, 'GET', '/api/v1/me')).statusCode).toBe(200);
    expect((await call(second, 'GET', '/api/v1/me')).statusCode).toBe(401);
  });

  it('is all refused to HR', async () => {
    const helen = await signIn('helen@example.invalid');
    expect((await call(helen, 'GET', '/api/v1/admin/users')).statusCode).toBe(403);
    expect(
      (
        await call(
          helen,
          'PUT',
          `/api/v1/admin/users/${await userId('paul@example.invalid')}/roles`,
          {
            roles: ['admin'],
          },
        )
      ).statusCode,
    ).toBe(403);
  });
});

describe('the navigation knows who approves', () => {
  it('a team lead is told they approve leave, and how many are waiting', async () => {
    await apply(await signIn('amina@example.invalid'), '2026-10-05', '2026-10-06');
    const ravi = await signIn('ravi@example.invalid');
    const me = (
      (await call(ravi, 'GET', '/api/v1/me')).json() as {
        data: { approvesLeave: boolean; pendingApprovals: number };
      }
    ).data;
    expect(me.approvesLeave).toBe(true);
    expect(me.pendingApprovals).toBe(1);
  });

  it('an ordinary member does not approve anyone', async () => {
    const amina = await signIn('amina@example.invalid');
    const me = (
      (await call(amina, 'GET', '/api/v1/me')).json() as { data: { approvesLeave: boolean } }
    ).data;
    expect(me.approvesLeave).toBe(false);
  });
});

describe('request lists by view', () => {
  it('a team lead sees requests routed to them and can decide them; the requester sees who it waits on', async () => {
    const amina = await signIn('amina@example.invalid');
    const id = await apply(amina, '2026-10-05', '2026-10-06');
    const ravi = await signIn('ravi@example.invalid');
    type R = { id: string; can_decide: boolean; waiting_on: string | null };
    const approvals = (
      (await call(ravi, 'GET', '/api/v1/leave-requests?view=approvals')).json() as { data: R[] }
    ).data;
    expect(approvals.find((r) => r.id === id)?.can_decide).toBe(true);
    const mine = (
      (
        await call(amina, 'GET', '/api/v1/leave-requests?view=mine&status=pending_approval')
      ).json() as { data: R[] }
    ).data;
    expect(mine.map((r) => r.id)).toEqual([id]);
    expect(mine[0]!.can_decide).toBe(false);
    expect(mine[0]!.waiting_on).toMatch(/Ravi/);
  });
});

describe('leave allowances', () => {
  type A = {
    data: {
      people: { id: string; balances: Record<string, { allowance: number; available: number }> }[];
    };
  };
  it('an administrator sets how much leave people get this year', async () => {
    const amina = await employeeId('amina@example.invalid');
    const paul = await employeeId('paul@example.invalid');
    const res = await call(admin, 'PUT', '/api/v1/allowances', {
      employeeIds: [amina, paul],
      leaveTypeId: clTypeId,
      allowanceHalfDays: 60,
      reason: 'Long-service allowance',
    });
    expect(res.statusCode).toBe(200);
    const list = ((await call(admin, 'GET', '/api/v1/allowances')).json() as A).data;
    for (const id of [amina, paul]) {
      expect(list.people.find((p) => p.id === id)!.balances[clTypeId]!.allowance).toBe(60);
    }
  });

  it('will not drop an allowance below leave already requested', async () => {
    await apply(await signIn('amina@example.invalid'), '2026-10-05', '2026-10-06');
    const res = await call(admin, 'PUT', '/api/v1/allowances', {
      employeeIds: [await employeeId('amina@example.invalid')],
      leaveTypeId: clTypeId,
      allowanceHalfDays: 1,
      reason: 'Trying to cut below usage',
    });
    const data = (res.json() as { data: { changed: number; blocked: unknown[] } }).data;
    expect(data.changed).toBe(0);
    expect(data.blocked).toHaveLength(1);
  });

  it('is refused to an ordinary employee', async () => {
    const amina = await signIn('amina@example.invalid');
    const res = await call(amina, 'PUT', '/api/v1/allowances', {
      employeeIds: [await employeeId('amina@example.invalid')],
      leaveTypeId: clTypeId,
      allowanceHalfDays: 200,
      reason: 'Giving myself more',
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('bulk holiday calendar', () => {
  it('makes second Saturdays working days and skips weekdays that already are', async () => {
    const res = await call(admin, 'POST', '/api/v1/holidays/bulk', {
      dates: ['2026-10-10', '2026-11-14', '2026-10-12', '2026-10-10'],
      kind: 'declared_working',
    });
    const data = (res.json() as { data: { changed: string[]; skipped: { date: string }[] } }).data;
    expect(data.changed).toEqual(['2026-10-10', '2026-11-14']);
    expect(data.skipped.map((s) => s.date)).toEqual(['2026-10-12']);
  });

  it('recounts leave already requested over a new holiday, and clearing restores it', async () => {
    const id = await apply(await signIn('amina@example.invalid'), '2026-10-05', '2026-10-06');
    const total = async () =>
      (
        (await sqlite
          .prepare(`SELECT total_half_days AS n FROM leave_request WHERE id = ?`)
          .get(id)) as { n: number }
      ).n;
    expect(await total()).toBe(4);
    await call(admin, 'POST', '/api/v1/holidays/bulk', {
      dates: ['2026-10-06'],
      kind: 'public',
      name: 'Founders Day',
    });
    expect(await total()).toBe(2);
    await call(admin, 'POST', '/api/v1/holidays/bulk', { dates: ['2026-10-06'], kind: null });
    expect(await total()).toBe(4);
  });

  it('is refused to an ordinary employee', async () => {
    const amina = await signIn('amina@example.invalid');
    const res = await call(amina, 'POST', '/api/v1/holidays/bulk', {
      dates: ['2026-10-10'],
      kind: 'public',
      name: 'Mine',
    });
    expect(res.statusCode).toBe(403);
  });
});
