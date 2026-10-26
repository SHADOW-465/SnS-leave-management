import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type Db } from '@sns/database';
import { loadConfig } from '@sns/config';
import { ulid } from '@sns/contracts';
import { buildApp } from './app.js';

// The hosted roster loader keys rows with short readable ids ('ops-dept-gen', 'emp-sns001').
// Every form that sends one of those ids must accept it (Create Team failed with
// "Some fields could not be read." because ids had to be 16+ characters).

const opened: { sqlite: Db; dir: string }[] = [];
const ADMIN = { email: 'admin@example.invalid', password: 'ChangeMe_admin_1' };

afterEach(async () => {
  for (const item of opened.splice(0)) {
    await item.sqlite.close();
    fs.rmSync(item.dir, { recursive: true, force: true });
  }
});

async function boot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leaveos-shortid-'));
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
    },
  });
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: ADMIN });
  const raw = res.headers['set-cookie'];
  const header = Array.isArray(raw)
    ? raw.map((c) => c.split(';')[0]).join('; ')
    : String(raw ?? '');
  const csrf = /leaveos\.csrf=([^;]*)/.exec(header)?.[1] ?? '';
  return { app, sqlite, headers: { cookie: header, 'x-csrf-token': csrf } };
}

async function seedRosterRows(sqlite: Db) {
  const now = new Date().toISOString();
  await sqlite
    .prepare(
      `INSERT INTO department (id, name, code, created_at, created_by, updated_at, updated_by)
       VALUES ('ops-dept-ros', 'Roster', 'ROS', ?, 'ops-sql', ?, 'ops-sql')`,
    )
    .run(now, now);
  const loc = (await sqlite.prepare(`SELECT id FROM location LIMIT 1`).get()) as { id: string };
  for (const code of ['sns901', 'sns902']) {
    await sqlite
      .prepare(
        `INSERT INTO employee (id, employee_code, first_name, last_name, work_email, status, joined_on,
           location_id, department_id, retention_class, created_at, created_by, updated_at, updated_by)
         VALUES (?, ?, 'Abinash', '-', ?, 'active', '2026-01-01', ?, 'ops-dept-ros', 'standard', ?, 'ops-sql', ?, 'ops-sql')`,
      )
      .run(`emp-${code}`, code.toUpperCase(), `${code}@example.invalid`, loc.id, now, now);
    await sqlite
      .prepare(
        `INSERT INTO user_account (id, employee_id, email, username, password_hash, password_algo,
           must_change_password, is_disabled, created_at, created_by, updated_at, updated_by)
         VALUES (?, ?, ?, ?, 'x', 'argon2id', 1, 0, ?, 'ops-sql', ?, 'ops-sql')`,
      )
      .run(`usr-${code}`, `emp-${code}`, `${code}@example.invalid`, code, now, now);
    await sqlite
      .prepare(
        `INSERT INTO user_role (user_account_id, role_id, granted_by, granted_at)
         SELECT ?, id, 'ops-sql', ? FROM role WHERE code = 'employee'`,
      )
      .run(`usr-${code}`, now);
  }
}

describe('short operator ids', () => {
  it('the id rule accepts roster ids and still refuses junk', () => {
    for (const ok of ['ops-dept-gen', 'emp-sns001', 'usr-sns078', '01HZX3V8K2N4Q6R8T0W2Y4A6C8']) {
      expect(ulid.safeParse(ok).success, ok).toBe(true);
    }
    for (const bad of ['', 'ab', 'a b c', "x';--", 'a'.repeat(65), '../etc']) {
      expect(ulid.safeParse(bad).success, bad).toBe(false);
    }
  });

  it('creates a team in a roster department with a roster lead', async () => {
    const { app, sqlite, headers } = await boot();
    await seedRosterRows(sqlite);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/teams',
      headers,
      payload: { departmentId: 'ops-dept-ros', name: 'printing', leadEmployeeId: 'emp-sns901' },
    });
    expect(res.statusCode, res.body).toBe(201);
  });

  it('lets an administrator change a roster employee role and edit the account', async () => {
    const { app, sqlite, headers } = await boot();
    await seedRosterRows(sqlite);
    const roles = await app.inject({
      method: 'PUT',
      url: '/api/v1/admin/users/usr-sns901/roles',
      headers,
      payload: { roles: ['employee', 'manager'] },
    });
    expect(roles.statusCode, roles.body).toBe(200);
    const patch = await app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/users/usr-sns901',
      headers,
      payload: { lastName: 'Kumar', email: 'sns901@example.invalid', expectedVersion: 1 },
    });
    expect(patch.statusCode, patch.body).toBe(200);
  });

  it('assigns a roster reporting manager', async () => {
    const { app, sqlite, headers } = await boot();
    await seedRosterRows(sqlite);
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/admin/reporting-managers',
      headers,
      payload: { employeeIds: ['emp-sns902'], managerEmployeeId: 'emp-sns901' },
    });
    expect(res.statusCode, res.body).toBeLessThan(300);
  });
});
