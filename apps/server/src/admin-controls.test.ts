/**
 * Administrator controls over who approves whom, and who can do what. Driven through the
 * real API against the seeded sample organisation:
 *
 *   Production (head: David, reports to Rajesh the MD) → Printing (lead: John, member: Vijay)
 *   Everyone has a reporting manager; Anitha is HR. The administrator is set up by the test.
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
    const vijay = people.find((p) => p.name === 'Vijay Anand');
    expect(vijay?.route?.approverName).toBe('John Mathew');
    const john = people.find((p) => p.name === 'John Mathew');
    expect(john?.route?.approverName).toBe('David Fernandes');
  });

  it('is refused to HR — deciding the hierarchy is the administrator’s', async () => {
    const helen = await signIn('anitha@sns.test');
    expect((await call(helen, 'GET', '/api/v1/admin/approval-map')).statusCode).toBe(403);
  });

  it('warns about a team with no lead only when someone relies on it', async () => {
    await sqlite.exec(`UPDATE team SET lead_employee_id = NULL WHERE name = 'Printing'`);
    const quiet = await call(admin, 'GET', '/api/v1/admin/approval-map');
    expect(
      (quiet.json() as { data: { warnings: { text: string }[] } }).data.warnings.some((w) =>
        w.text.includes('Printing'),
      ),
    ).toBe(false);
    await sqlite.exec(
      `UPDATE employee SET manager_employee_id = NULL WHERE team_id = (SELECT id FROM team WHERE name = 'Printing')`,
    );
    const res = await call(admin, 'GET', '/api/v1/admin/approval-map');
    const warnings = (res.json() as { data: { warnings: { text: string }[] } }).data.warnings;
    expect(
      warnings.some((w) => w.text.includes('Printing') && w.text.includes('no team lead')),
    ).toBe(true);
  });
});

describe('appointing leads and heads', () => {
  it('changing a team lead changes where new requests go for people with no reporting manager', async () => {
    await sqlite.exec(
      `UPDATE employee SET manager_employee_id = NULL WHERE work_email = 'vijay@sns.test'`,
    );
    const team = (await sqlite.prepare(`SELECT id FROM team WHERE name = 'Printing'`).get()) as {
      id: string;
    };
    const res = await call(admin, 'PUT', `/api/v1/admin/teams/${team.id}/lead`, {
      employeeId: await employeeId('anitha@sns.test'),
    });
    expect(res.statusCode).toBe(200);
    const id = await apply(await signIn('vijay@sns.test'), '2026-10-05', '2026-10-06');
    expect(await approverEmailFor(id)).toBe('anitha@sns.test');
  });

  it('HR can no longer appoint a team lead through the structure screens', async () => {
    const helen = await signIn('anitha@sns.test');
    const team = (await sqlite.prepare(`SELECT id FROM team WHERE name = 'Printing'`).get()) as {
      id: string;
    };
    const res = await call(helen, 'PATCH' as 'PUT', `/api/v1/teams/${team.id}`, {
      leadEmployeeId: await employeeId('ramesh@sns.test'),
    });
    expect(res.statusCode).toBe(403);
  });

  it('refuses to appoint someone with no sign-in account', async () => {
    const team = (await sqlite.prepare(`SELECT id FROM team WHERE name = 'Printing'`).get()) as {
      id: string;
    };
    await sqlite.exec(
      `DELETE FROM user_role WHERE user_account_id = (SELECT id FROM user_account WHERE email = 'ramesh@sns.test')`,
    );
    await sqlite.exec(
      `DELETE FROM session WHERE user_account_id = (SELECT id FROM user_account WHERE email = 'ramesh@sns.test')`,
    );
    await sqlite.exec(`DELETE FROM user_account WHERE email = 'ramesh@sns.test'`);
    const res = await call(admin, 'PUT', `/api/v1/admin/teams/${team.id}/lead`, {
      employeeId: await employeeId('ramesh@sns.test'),
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: { code: string } }).error.code).toBe('NO_ACCOUNT');
  });
});

describe('reporting managers', () => {
  const assign = async (employees: string[], manager: string | null, effectiveFrom?: string) =>
    call(admin, 'PUT', '/api/v1/admin/reporting-managers', {
      employeeIds: await Promise.all(employees.map(employeeId)),
      managerEmployeeId: manager ? await employeeId(manager) : null,
      ...(effectiveFrom ? { effectiveFrom } : {}),
    });

  it('sends a person’s leave to the reporting manager the administrator assigns', async () => {
    const res = await assign(['vijay@sns.test'], 'david@sns.test');
    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: { changed: number } }).data.changed).toBe(1);
    const id = await apply(await signIn('vijay@sns.test'), '2026-10-05', '2026-10-06');
    expect(await approverEmailFor(id)).toBe('david@sns.test');
  });

  it('keeps earlier requests with the manager they were sent to', async () => {
    const before = await apply(await signIn('vijay@sns.test'), '2026-10-05', '2026-10-06');
    await assign(['vijay@sns.test'], 'kumar@sns.test');
    const after = await apply(await signIn('vijay@sns.test'), '2026-10-12', '2026-10-13');
    expect(await approverEmailFor(before)).toBe('john@sns.test');
    expect(await approverEmailFor(after)).toBe('kumar@sns.test');
  });

  it('records each change with the date it took effect', async () => {
    const today = new Date().toISOString().slice(0, 10);
    await assign(['vijay@sns.test'], 'kumar@sns.test', today);
    const res = await call(
      admin,
      'GET',
      `/api/v1/employees/${await employeeId('vijay@sns.test')}/manager-history`,
    );
    const rows = (
      res.json() as {
        data: { managerName: string | null; effectiveFrom: string; effectiveTo: string | null }[];
      }
    ).data;
    expect(rows[0]).toMatchObject({
      managerName: 'Kumar Swamy',
      effectiveFrom: today,
      effectiveTo: null,
    });
    expect(rows[1]?.managerName).toBe('John Mathew');
    expect(rows[1]?.effectiveTo).not.toBeNull();
  });

  it('assigns one manager to several people at once', async () => {
    const res = await assign(['vijay@sns.test', 'priya@sns.test'], 'kumar@sns.test');
    expect((res.json() as { data: { changed: number } }).data.changed).toBe(2);
  });

  it('clearing the manager returns them to their team lead', async () => {
    await assign(['vijay@sns.test'], 'david@sns.test');
    await assign(['vijay@sns.test'], null);
    const id = await apply(await signIn('vijay@sns.test'), '2026-10-05', '2026-10-06');
    expect(await approverEmailFor(id)).toBe('john@sns.test');
  });

  it('refuses a manager who would be their own approver, or a loop', async () => {
    const self = await assign(['vijay@sns.test'], 'vijay@sns.test');
    expect((self.json() as { data: { failed: unknown[] } }).data.failed).toHaveLength(1);
    // John manages Vijay; Vijay cannot then manage John.
    const loop = await assign(['john@sns.test'], 'vijay@sns.test');
    const failed = (loop.json() as { data: { failed: { reason: string }[] } }).data.failed;
    expect(failed[0]?.reason).toMatch(/already reports/);
  });

  it('is refused to HR', async () => {
    const anitha = await signIn('anitha@sns.test');
    const res = await call(anitha, 'PUT', '/api/v1/admin/reporting-managers', {
      employeeIds: [await employeeId('vijay@sns.test')],
      managerEmployeeId: await employeeId('david@sns.test'),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('sign-in accounts', () => {
  it('creates a login for an employee, who must change the password and can use their ID', async () => {
    await sqlite.exec(
      `DELETE FROM user_role WHERE user_account_id = (SELECT id FROM user_account WHERE email = 'sneha@sns.test')`,
    );
    await sqlite.exec(`DELETE FROM user_account WHERE email = 'sneha@sns.test'`);
    const res = await call(admin, 'POST', '/api/v1/admin/users', {
      employeeId: await employeeId('sneha@sns.test'),
      roles: ['employee'],
    });
    expect(res.statusCode).toBe(200);
    const { temporaryPassword } = (res.json() as { data: { temporaryPassword: string } }).data;
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'sns-1014', password: temporaryPassword },
    });
    expect(login.statusCode).toBe(200);
    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { cookie: sessionFrom(login).cookie },
    });
    expect((me.json() as { data: { mustChangePassword: boolean } }).data.mustChangePassword).toBe(
      true,
    );
  });

  it('will not create a second login for the same person', async () => {
    const res = await call(admin, 'POST', '/api/v1/admin/users', {
      employeeId: await employeeId('vijay@sns.test'),
      roles: [],
    });
    expect(res.statusCode).toBe(409);
  });
});

describe('cover while someone is away', () => {
  it('sends a lead’s approvals to their cover during the dates', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const res = await call(admin, 'POST', '/api/v1/admin/delegations', {
      approverEmployeeId: await employeeId('john@sns.test'),
      delegateEmployeeId: await employeeId('ramesh@sns.test'),
      startsOn: today,
      endsOn: '2099-12-31',
      note: 'Ravi on annual leave',
    });
    expect(res.statusCode).toBe(200);
    const id = await apply(await signIn('vijay@sns.test'), '2026-10-05', '2026-10-06');
    expect(await approverEmailFor(id)).toBe('ramesh@sns.test');

    // The cover can actually decide it.
    const paul = await signIn('ramesh@sns.test');
    const decided = await call(paul, 'POST', `/api/v1/leave-requests/${id}/approve`, {
      expectedVersion: 1,
    });
    expect(decided.statusCode).toBe(200);
  });

  it('removing the cover restores normal routing', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const created = await call(admin, 'POST', '/api/v1/admin/delegations', {
      approverEmployeeId: await employeeId('john@sns.test'),
      delegateEmployeeId: await employeeId('ramesh@sns.test'),
      startsOn: today,
      endsOn: '2099-12-31',
    });
    const delegationId = (created.json() as { data: { id: string } }).data.id;
    expect(
      (await call(admin, 'DELETE', `/api/v1/admin/delegations/${delegationId}`)).statusCode,
    ).toBe(200);
    const id = await apply(await signIn('vijay@sns.test'), '2026-10-05', '2026-10-06');
    expect(await approverEmailFor(id)).toBe('john@sns.test');
  });

  it('rejects a date range that ends before it starts', async () => {
    const res = await call(admin, 'POST', '/api/v1/admin/delegations', {
      approverEmployeeId: await employeeId('john@sns.test'),
      delegateEmployeeId: await employeeId('ramesh@sns.test'),
      startsOn: '2099-12-31',
      endsOn: '2099-01-01',
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('reassigning a stuck request', () => {
  it('moves a pending request to a different approver who can then decide it', async () => {
    const id = await apply(await signIn('vijay@sns.test'), '2026-10-05', '2026-10-06');
    const res = await call(admin, 'POST', `/api/v1/leave-requests/${id}/reassign`, {
      approverEmployeeId: await employeeId('david@sns.test'),
      note: 'Ravi is unreachable',
    });
    expect(res.statusCode).toBe(200);
    expect(await approverEmailFor(id)).toBe('david@sns.test');

    // The old approver has lost it; the new one can decide it.
    const ravi = await signIn('john@sns.test');
    const detail = await call(ravi, 'GET', `/api/v1/leave-requests/${id}`);
    const version = (detail.json() as { data?: { version: number } }).data?.version ?? 2;
    expect(
      (
        await call(ravi, 'POST', `/api/v1/leave-requests/${id}/approve`, {
          expectedVersion: version,
        })
      ).statusCode,
    ).toBe(403);
    const sofia = await signIn('david@sns.test');
    expect(
      (await call(sofia, 'POST', `/api/v1/leave-requests/${id}/approve`, { expectedVersion: 2 }))
        .statusCode,
    ).toBe(200);
  });

  it('will not reassign a request to the person who asked for it', async () => {
    const id = await apply(await signIn('vijay@sns.test'), '2026-10-05', '2026-10-06');
    const res = await call(admin, 'POST', `/api/v1/leave-requests/${id}/reassign`, {
      approverEmployeeId: await employeeId('vijay@sns.test'),
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
    expect(users.find((u) => u.email === 'anitha@sns.test')?.roles).toEqual(['hr_officer']);
  });

  it('changes someone’s roles and the new access applies immediately', async () => {
    const paul = await signIn('ramesh@sns.test');
    expect((await call(paul, 'GET', '/api/v1/audit')).statusCode).toBe(403);
    await call(admin, 'PUT', `/api/v1/admin/users/${await userId('ramesh@sns.test')}/roles`, {
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
    await call(admin, 'PUT', `/api/v1/admin/users/${await userId('anitha@sns.test')}/roles`, {
      roles: ['hr_officer', 'admin'],
    });
    const helen = await signIn('anitha@sns.test');
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
      `/api/v1/admin/users/${await userId('anitha@sns.test')}/disabled`,
      { disabled: true },
    );
    expect(self.statusCode).toBe(409);
  });

  it('disabling an account signs it out everywhere', async () => {
    const paul = await signIn('ramesh@sns.test');
    expect((await call(paul, 'GET', '/api/v1/me')).statusCode).toBe(200);
    await call(admin, 'PUT', `/api/v1/admin/users/${await userId('ramesh@sns.test')}/disabled`, {
      disabled: true,
    });
    expect((await call(paul, 'GET', '/api/v1/me')).statusCode).toBe(401);
  });

  it('signing someone out everywhere ends their sessions', async () => {
    const paul = await signIn('ramesh@sns.test');
    await call(
      admin,
      'POST',
      `/api/v1/admin/users/${await userId('ramesh@sns.test')}/sign-out-everywhere`,
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
    const helen = await signIn('anitha@sns.test');
    expect((await call(helen, 'GET', '/api/v1/admin/users')).statusCode).toBe(403);
    expect(
      (
        await call(helen, 'PUT', `/api/v1/admin/users/${await userId('ramesh@sns.test')}/roles`, {
          roles: ['admin'],
        })
      ).statusCode,
    ).toBe(403);
  });
});

describe('the navigation knows who approves', () => {
  it('a team lead is told they approve leave, and how many are waiting', async () => {
    await apply(await signIn('vijay@sns.test'), '2026-10-05', '2026-10-06');
    const ravi = await signIn('john@sns.test');
    const me = (
      (await call(ravi, 'GET', '/api/v1/me')).json() as {
        data: { approvesLeave: boolean; pendingApprovals: number };
      }
    ).data;
    expect(me.approvesLeave).toBe(true);
    expect(me.pendingApprovals).toBe(1);
  });

  it('an ordinary member does not approve anyone', async () => {
    const amina = await signIn('vijay@sns.test');
    const me = (
      (await call(amina, 'GET', '/api/v1/me')).json() as { data: { approvesLeave: boolean } }
    ).data;
    expect(me.approvesLeave).toBe(false);
  });
});

describe('request lists by view', () => {
  it('a team lead sees requests routed to them and can decide them; the requester sees who it waits on', async () => {
    const amina = await signIn('vijay@sns.test');
    const id = await apply(amina, '2026-10-05', '2026-10-06');
    const ravi = await signIn('john@sns.test');
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
    expect(mine[0]!.waiting_on).toMatch(/John/);
  });
});

describe('leave allowances', () => {
  type A = {
    data: {
      people: { id: string; balances: Record<string, { allowance: number; available: number }> }[];
    };
  };
  it('an administrator sets how much leave people get this year', async () => {
    const amina = await employeeId('vijay@sns.test');
    const paul = await employeeId('ramesh@sns.test');
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
    await apply(await signIn('vijay@sns.test'), '2026-10-05', '2026-10-06');
    const res = await call(admin, 'PUT', '/api/v1/allowances', {
      employeeIds: [await employeeId('vijay@sns.test')],
      leaveTypeId: clTypeId,
      allowanceHalfDays: 1,
      reason: 'Trying to cut below usage',
    });
    const data = (res.json() as { data: { changed: number; blocked: unknown[] } }).data;
    expect(data.changed).toBe(0);
    expect(data.blocked).toHaveLength(1);
  });

  it('is refused to an ordinary employee', async () => {
    const amina = await signIn('vijay@sns.test');
    const res = await call(amina, 'PUT', '/api/v1/allowances', {
      employeeIds: [await employeeId('vijay@sns.test')],
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
    const id = await apply(await signIn('vijay@sns.test'), '2026-10-05', '2026-10-06');
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
    const amina = await signIn('vijay@sns.test');
    const res = await call(amina, 'POST', '/api/v1/holidays/bulk', {
      dates: ['2026-10-10'],
      kind: 'public',
      name: 'Mine',
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('moving someone to another team', () => {
  const managerOf = async (email: string) =>
    (
      (await sqlite
        .prepare(
          `SELECT m.work_email AS email FROM employee e LEFT JOIN employee m ON m.id = e.manager_employee_id WHERE e.work_email = ?`,
        )
        .get(email)) as { email: string | null }
    ).email;
  const move = async (email: string, team: string) => {
    const t = (await sqlite.prepare(`SELECT id FROM team WHERE name = ?`).get(team)) as {
      id: string;
    };
    return call(admin, 'POST', `/api/v1/teams/${t.id}/members`, {
      addEmployeeIds: [await employeeId(email)],
    });
  };

  it('makes the new team lead their reporting manager if they followed the old one', async () => {
    // Divya reports to Arun, who leads Content.
    const res = await move('divya@sns.test', 'Printing');
    expect(res.statusCode).toBe(200);
    expect(await managerOf('divya@sns.test')).toBe('john@sns.test');
  });

  it('leaves a manager who was chosen deliberately alone', async () => {
    // Suresh reports to David directly, not to a team lead.
    await move('suresh@sns.test', 'Binding & Finishing');
    expect(await managerOf('suresh@sns.test')).toBe('david@sns.test');
  });
});
