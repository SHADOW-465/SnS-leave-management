/**
 * Administrator / HR temporary passwords: the typed password replaces whatever the person
 * had, signs them out, forces a change at next sign-in, and works for people who never had
 * a password or have no sign-in at all. HR cannot use it on an administrator; nobody on
 * themselves.
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
let app: FastifyInstance;
let sqlite: Db;
let dir: string;
let admin: Session;
const TEMP = 'Temp_pass_2026!x';

function sessionFrom(res: { headers: Record<string, unknown> }): Session {
  const raw = res.headers['set-cookie'];
  const cookie = Array.isArray(raw)
    ? raw.map((c) => c.split(';')[0]).join('; ')
    : String(raw ?? '');
  return { cookie, csrf: /leaveos\.csrf=([^;]*)/.exec(cookie)?.[1] ?? '' };
}
async function login(email: string, password: string) {
  return app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
}
async function signIn(email: string, password = 'ChangeMe_demo_1'): Promise<Session> {
  const res = await login(email, password);
  expect(res.statusCode, `sign in ${email}`).toBe(200);
  return sessionFrom(res);
}
function call(s: Session, url: string, payload?: unknown) {
  return app.inject({
    method: 'POST',
    url,
    headers: { cookie: s.cookie, 'x-csrf-token': s.csrf },
    payload: (payload ?? {}) as object,
  });
}
async function one<T>(sql: string, ...args: string[]): Promise<T> {
  return (await sqlite.prepare(sql).get(...args)) as T;
}
const uid = async (email: string) =>
  (await one<{ id: string }>(`SELECT id FROM user_account WHERE email = ?`, email)).id;
const eid = async (email: string) =>
  (await one<{ id: string }>(`SELECT id FROM employee WHERE work_email = ?`, email)).id;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leaveos-temppw-'));
  sqlite = await openDatabase(path.join(dir, 'app.db'));
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
});
afterEach(async () => {
  await app?.close();
  try {
    await sqlite.close();
  } catch {
    /* closed */
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('temporary passwords set by an administrator or HR', () => {
  it('admin: replaces the existing password, revokes sessions, forces a change, audits without the password', async () => {
    const vijay = await signIn('vijay@sns.test');
    const res = await call(
      admin,
      `/api/v1/accounts/${await uid('vijay@sns.test')}/reset-password`,
      {
        temporaryPassword: TEMP,
      },
    );
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain(TEMP);
    // Old password no longer works; the old session is revoked.
    expect((await login('vijay@sns.test', 'ChangeMe_demo_1')).statusCode).not.toBe(200);
    const old = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { cookie: vijay.cookie },
    });
    expect(old.statusCode).toBe(401);
    // New one works and must be changed.
    const next = await login('vijay@sns.test', TEMP);
    expect(next.statusCode).toBe(200);
    expect(
      (next.json() as { data: { mustChangePassword?: boolean } }).data.mustChangePassword,
    ).toBe(true);
    const s = sessionFrom(next);
    const changed = await call(s, '/api/v1/auth/password', {
      currentPassword: TEMP,
      newPassword: 'Brand_new_pass_99',
    });
    expect(changed.statusCode).toBe(200);
    const row = await one<{ m: number }>(
      `SELECT must_change_password AS m FROM user_account WHERE email = 'vijay@sns.test'`,
    );
    expect(Number(row.m)).toBe(0);
    const audits = (await sqlite
      .prepare(
        `SELECT action, actor_user_id, entity_id, before_json, after_json FROM audit_event WHERE action = 'user.password.temporary_set'`,
      )
      .all()) as { entity_id: string; before_json: string | null; after_json: string | null }[];
    expect(audits.length).toBe(1);
    expect(audits[0]!.entity_id).toBe(await uid('vijay@sns.test'));
    expect(JSON.stringify(audits)).not.toContain(TEMP);
  });

  it('enforces the password policy with a clear message', async () => {
    const res = await call(
      admin,
      `/api/v1/accounts/${await uid('vijay@sns.test')}/reset-password`,
      {
        temporaryPassword: 'short',
      },
    );
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatch(/at least 12 characters/);
    expect((await login('vijay@sns.test', 'ChangeMe_demo_1')).statusCode).toBe(200);
  });

  it('lifts a lockout', async () => {
    await sqlite.exec(
      `UPDATE user_account SET failed_attempts = 5, locked_until = '2999-01-01T00:00:00.000Z' WHERE email = 'vijay@sns.test'`,
    );
    const res = await call(
      admin,
      `/api/v1/accounts/${await uid('vijay@sns.test')}/reset-password`,
      {
        temporaryPassword: TEMP,
      },
    );
    expect(res.statusCode).toBe(200);
    expect((await login('vijay@sns.test', TEMP)).statusCode).toBe(200);
  });

  it('HR can set a temporary password for an employee', async () => {
    const hr = await signIn('anitha@sns.test');
    const res = await call(hr, `/api/v1/accounts/${await uid('ramesh@sns.test')}/reset-password`, {
      temporaryPassword: TEMP,
    });
    expect(res.statusCode).toBe(200);
    expect((await login('ramesh@sns.test', TEMP)).statusCode).toBe(200);
  });

  it('HR cannot set the password of an administrator, by account or by employee', async () => {
    const hr = await signIn('anitha@sns.test');
    const byAccount = await call(
      hr,
      `/api/v1/accounts/${await uid('admin@example.invalid')}/reset-password`,
      {
        temporaryPassword: TEMP,
      },
    );
    expect(byAccount.statusCode).toBe(403);
    // Make Vijay (who has an employee record) an administrator, then try through his employee id.
    await sqlite.exec(
      `INSERT INTO user_role (user_account_id, role_id, granted_by, granted_at)
         SELECT ua.id, r.id, 'test', '2026-01-01' FROM user_account ua, role r
          WHERE ua.email = 'vijay@sns.test' AND r.code = 'admin'`,
    );
    const byEmployee = await call(
      hr,
      `/api/v1/employees/${await eid('vijay@sns.test')}/temporary-password`,
      {
        temporaryPassword: TEMP,
      },
    );
    expect(byEmployee.statusCode).toBe(403);
    expect((await login('vijay@sns.test', TEMP)).statusCode).not.toBe(200);
    expect((await login('admin@example.invalid', TEMP)).statusCode).not.toBe(200);
  });

  it('nobody can use it on their own account', async () => {
    const hr = await signIn('anitha@sns.test');
    const self = await call(hr, `/api/v1/accounts/${await uid('anitha@sns.test')}/reset-password`, {
      temporaryPassword: TEMP,
    });
    expect(self.statusCode).toBe(400);
    const selfEmp = await call(
      hr,
      `/api/v1/employees/${await eid('anitha@sns.test')}/temporary-password`,
      {
        temporaryPassword: TEMP,
      },
    );
    expect(selfEmp.statusCode).toBe(400);
  });

  it("works for an account that never had a password ('!no-password-set')", async () => {
    await sqlite.exec(
      `UPDATE user_account SET password_hash = '!no-password-set', must_change_password = 0 WHERE email = 'sneha@sns.test'`,
    );
    expect((await login('sneha@sns.test', 'ChangeMe_demo_1')).statusCode).not.toBe(200);
    const hr = await signIn('anitha@sns.test');
    const res = await call(
      hr,
      `/api/v1/employees/${await eid('sneha@sns.test')}/temporary-password`,
      {
        temporaryPassword: TEMP,
      },
    );
    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: { created: boolean } }).data.created).toBe(false);
    const next = await login('sneha@sns.test', TEMP);
    expect(next.statusCode).toBe(200);
    expect(
      (next.json() as { data: { mustChangePassword?: boolean } }).data.mustChangePassword,
    ).toBe(true);
  });

  it('creates the sign-in for an employee with no account, username = lowercase employee code', async () => {
    const empId = await eid('sneha@sns.test');
    await sqlite.exec(
      `DELETE FROM user_role WHERE user_account_id = (SELECT id FROM user_account WHERE email = 'sneha@sns.test')`,
    );
    await sqlite.exec(
      `DELETE FROM session WHERE user_account_id = (SELECT id FROM user_account WHERE email = 'sneha@sns.test')`,
    );
    await sqlite.exec(`DELETE FROM user_account WHERE email = 'sneha@sns.test'`);
    const code = (
      await one<{ c: string }>(`SELECT employee_code AS c FROM employee WHERE id = ?`, empId)
    ).c;
    const res = await call(admin, `/api/v1/employees/${empId}/temporary-password`, {
      temporaryPassword: TEMP,
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain(TEMP);
    const data = (res.json() as { data: { created: boolean; username: string } }).data;
    expect(data.created).toBe(true);
    expect(data.username).toBe(code.toLowerCase());
    const acct = await one<{ m: number; algo: string; u: string }>(
      `SELECT must_change_password AS m, password_algo AS algo, username AS u FROM user_account WHERE employee_id = ?`,
      empId,
    );
    expect(Number(acct.m)).toBe(1);
    expect(acct.algo).toBe('argon2id');
    const next = await login(code.toLowerCase(), TEMP);
    expect(next.statusCode).toBe(200);
    expect(
      (next.json() as { data: { mustChangePassword?: boolean } }).data.mustChangePassword,
    ).toBe(true);
  });

  it("a plain employee cannot set anyone else's password", async () => {
    const staff = await signIn('vijay@sns.test');
    const res = await call(
      staff,
      `/api/v1/employees/${await eid('ramesh@sns.test')}/temporary-password`,
      {
        temporaryPassword: TEMP,
      },
    );
    expect(res.statusCode).toBe(403);
  });

  it('migration 0015 grants HR the reset permission on a database that lacks it, and is idempotent', async () => {
    await sqlite.exec(
      `DELETE FROM role_permission WHERE role_id = (SELECT id FROM role WHERE code = 'hr_officer')
         AND permission_id = (SELECT id FROM permission WHERE code = 'user.password.reset:company')`,
    );
    const sql = fs.readFileSync(
      new URL('../../../packages/database/src/sql/0015_hr_password_reset.sql', import.meta.url),
      'utf8',
    );
    await sqlite.exec(sql);
    await sqlite.exec(sql);
    const n = await one<{ n: number }>(
      `SELECT COUNT(*) AS n FROM role_permission rp JOIN role r ON r.id = rp.role_id JOIN permission p ON p.id = rp.permission_id
        WHERE r.code = 'hr_officer' AND p.code = 'user.password.reset:company'`,
    );
    expect(Number(n.n)).toBe(1);
  });
});

describe('migration SQL files', () => {
  it('never put a semicolon in a comment (Postgres splits statements on it)', () => {
    const sqlDir = new URL('../../../packages/database/src/sql/', import.meta.url);
    const bad: string[] = [];
    for (const name of fs.readdirSync(sqlDir)) {
      if (!name.endsWith('.sql')) continue;
      const text = fs.readFileSync(new URL(name, sqlDir), 'utf8');
      text.split(/\r?\n/).forEach((line, i) => {
        const at = line.indexOf('--');
        if (at >= 0 && line.slice(at).includes(';')) bad.push(`${name}:${i + 1}`);
      });
    }
    expect(bad).toEqual([]);
  });
});
