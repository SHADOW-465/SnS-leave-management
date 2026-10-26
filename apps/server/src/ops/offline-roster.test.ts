import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { verifyPassword } from '@sns/auth';
import { loadConfig, pathsFor } from '@sns/config';
import { openDatabase, type Db } from '@sns/database';
import { buildApp } from '../app.js';
import { loadOfflineRoster, rosterFromHostedSql } from './offline-roster.js';

const opened: { sqlite: Db; dir: string }[] = [];
afterEach(async () => {
  for (const item of opened.splice(0)) {
    await item.sqlite.close();
    fs.rmSync(item.dir, { recursive: true, force: true });
  }
});

async function boot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leaveos-roster-'));
  const config = loadConfig({ LEAVEOS_DATA_DIR: dir, LEAVEOS_ENV: 'test' });
  const dbPath = pathsFor(config).db;
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const sqlite = await openDatabase(dbPath);
  opened.push({ sqlite, dir });
  const app = await buildApp(config, sqlite);
  await app.ready();
  await app.inject({
    method: 'POST',
    url: '/api/v1/setup',
    payload: {
      companyName: 'Test Co',
      timezone: 'UTC',
      leaveYearStartMonth: 1,
      leaveYearStartDay: 1,
      adminName: 'Setup Admin',
      adminEmail: 'setup@example.invalid',
      adminPassword: 'ChangeMe_admin_1',
    },
  });
  return { app, sqlite };
}

const roster = Array.from({ length: 33 }, (_, i) => ({
  code: `SYN${String(i + 1).padStart(3, '0')}`,
  name: `Synthetic${i + 1} Example`,
}));
const opts = {
  roster,
  adminCode: 'SYN001',
  hrCode: 'SYN078'.replace('078', '002'),
  joinedOn: '2026-01-01',
};

async function rolesOf(sqlite: Db, username: string) {
  const rows = (await sqlite
    .prepare(
      `SELECT r.code AS code FROM user_account ua JOIN user_role ur ON ur.user_account_id = ua.id
         JOIN role r ON r.id = ur.role_id WHERE ua.username = ? ORDER BY r.code`,
    )
    .all(username)) as { code: string }[];
  return rows.map((r) => r.code);
}

describe('offline roster loader', () => {
  it('loads 33 people: admin with a one-time password, HR + employee, the rest employee', async () => {
    const { app, sqlite } = await boot();
    const res = await loadOfflineRoster(sqlite, { ...opts, disableOtherAdmins: true });
    expect(res.created).toBe(33);
    expect(res.disabledAdmins).toBe(1);
    expect(res.adminTemporaryPassword).toBeTruthy();
    expect(await rolesOf(sqlite, 'syn001')).toEqual(['admin']);
    expect(await rolesOf(sqlite, 'syn002')).toEqual(['employee', 'hr_officer']);
    expect(await rolesOf(sqlite, 'syn033')).toEqual(['employee']);
    const admin = (await sqlite
      .prepare(
        `SELECT password_hash AS h, must_change_password AS m FROM user_account WHERE username = 'syn001'`,
      )
      .get()) as { h: string; m: number };
    expect(await verifyPassword(admin.h, res.adminTemporaryPassword!)).toBe(true);
    expect(admin.m).toBe(1);
    const other = (await sqlite
      .prepare(`SELECT password_hash AS h FROM user_account WHERE username = 'syn010'`)
      .get()) as { h: string };
    expect(other.h).toBe('!no-password-set');

    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'syn001', password: res.adminTemporaryPassword },
    });
    expect(login.statusCode).toBe(200);
    const setup = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'setup@example.invalid', password: 'ChangeMe_admin_1' },
    });
    expect(setup.statusCode).not.toBe(200);
  });

  it('is idempotent and never rotates a password', async () => {
    const { sqlite } = await boot();
    await loadOfflineRoster(sqlite, opts);
    const before = (await sqlite
      .prepare(`SELECT password_hash AS h FROM user_account WHERE username = 'syn001'`)
      .get()) as { h: string };
    const again = await loadOfflineRoster(sqlite, opts);
    expect(again.created).toBe(0);
    expect(again.existing).toBe(33);
    expect(again.adminTemporaryPassword).toBeNull();
    const after = (await sqlite
      .prepare(`SELECT password_hash AS h FROM user_account WHERE username = 'syn001'`)
      .get()) as { h: string };
    expect(after.h).toBe(before.h);
    const count = (await sqlite.prepare(`SELECT COUNT(*) AS n FROM employee`).get()) as {
      n: number;
    };
    expect(Number(count.n)).toBe(34);
  });

  it('refuses a roster missing the admin or HR code', async () => {
    const { sqlite } = await boot();
    await expect(loadOfflineRoster(sqlite, { ...opts, hrCode: 'NOPE' })).rejects.toThrow(
      /not in the roster/,
    );
  });

  it('reads people from the hosted 02 script without the hash', () => {
    const sql =
      "x\nINSERT INTO _ops_roster VALUES\n  ('SnS001', 'Vijay', '-', 'a@b', 'sns001', 'HASH', 'admin'),\n  ('SnS078', 'Anjusha', 'K', 'c@d', 'sns078', '!no-password-set', 'employee,hr_officer');\nmore";
    expect(rosterFromHostedSql(sql)).toEqual([
      { code: 'SnS001', name: 'Vijay' },
      { code: 'SnS078', name: 'Anjusha K' },
    ]);
  });
});
