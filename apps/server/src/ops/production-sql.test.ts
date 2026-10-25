/**
 * Runs the production wipe/roster scripts against a real Postgres (PGlite) that has been set up
 * the way the hosted sample database was: migrations, system seed, and the sample organisation
 * with sample leave activity. Then goes through the application's own sign-in and
 * role-assignment routes.
 *
 * Committed runs use a synthetic roster. To prove the real generated scripts, set
 *   LEAVEOS_OPS_SQL_DIR       folder holding 00/01/02 and the administrator password file
 *   LEAVEOS_OPS_ADMIN_CODE    employee code of the administrator
 *   LEAVEOS_OPS_HR_CODE       employee code of the HR officer
 *   LEAVEOS_OPS_PEOPLE        number of people in the roster
 * The real names then stay on the operator's machine and are never read by this file.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { generateTemporaryPassword, hashPassword } from '@sns/auth';
import { loadConfig } from '@sns/config';
import { isBootstrapped, migrate, toPostgresQuery, toPostgresSql, type Db } from '@sns/database';
import { buildApp } from '../app.js';
import { nowIso, todayInTimeZone } from '../time.js';
import type { RequestContext } from '../ctx.js';
import { ensureNavalurDataset } from '../navalur.js';
import { completeSetup } from '../usecases/setup.js';
import {
  buildPreviewSql,
  buildRosterSql,
  buildWipeSql,
  NO_PASSWORD_HASH,
} from './production-sql.js';

function splitSql(sql: string): string[] {
  const parts: string[] = [];
  let buf = '';
  let inDollar = false;
  let inComment = false;
  for (let i = 0; i < sql.length; i += 1) {
    if (!inDollar && sql.startsWith('--', i)) inComment = true;
    if (inComment && sql[i] === '\n') inComment = false;
    if (sql.startsWith('$$', i)) {
      inDollar = !inDollar;
      buf += '$$';
      i += 1;
      continue;
    }
    if (!inDollar && !inComment && sql[i] === ';') {
      if (buf.trim()) parts.push(buf.trim());
      buf = '';
      continue;
    }
    buf += sql[i];
  }
  if (buf.trim()) parts.push(buf.trim());
  return parts;
}

function pgAdapter(pg: PGlite): Db {
  return {
    dialect: 'postgres',
    prepare(text: string) {
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
}

type Scripts = { preview: string; wipe: string; roster: string };
type Scenario = {
  adminCode: string;
  hrCode: string;
  people: number;
  password: string;
  scripts: Scripts;
};

const opened: PGlite[] = [];
afterAll(async () => {
  for (const pg of opened) await pg.close();
});

/** `setup` = first-run setup with the sample organisation; `navalur` = the reset script the hosted preview ran. */
type SampleKind = 'setup' | 'navalur';

async function sampleHostedDatabase(kind: SampleKind) {
  const pg = new PGlite();
  opened.push(pg);
  const db = pgAdapter(pg);
  await migrate(db);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leaveos-ops-'));
  const config = loadConfig({ LEAVEOS_ENV: 'test', LEAVEOS_DATA_DIR: dataDir });
  const ctx: RequestContext = {
    requestId: 'ops-test',
    sqlite: db,
    config,
    principal: null,
    ip: '127.0.0.1',
    userAgent: 'test',
    now: nowIso(),
    today: todayInTimeZone('UTC'),
    attachmentsRoot: path.join(dataDir, 'attachments'),
    backupsRoot: path.join(dataDir, 'backups'),
  };
  if (kind === 'navalur') {
    await ensureNavalurDataset(ctx);
    return { pg, db, config };
  }
  await completeSetup(ctx, {
    companyName: 'Test Co',
    timezone: 'UTC',
    leaveYearStartMonth: 1,
    leaveYearStartDay: 1,
    adminName: 'Sample Admin',
    adminEmail: 'admin@sns.test',
    adminPassword: 'ChangeMe_admin_1',
    loadSampleData: true,
    sampleActivity: true,
  });
  return { pg, db, config };
}

const count = async (pg: PGlite, table: string) =>
  Number(((await pg.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0] as { n: number }).n);

type Session = { cookie: string; csrf: string };
function sessionFrom(res: { headers: Record<string, unknown> }): Session {
  const raw = res.headers['set-cookie'];
  const cookie = Array.isArray(raw)
    ? raw.map((c) => String(c).split(';')[0]).join('; ')
    : String(raw ?? '');
  return { cookie, csrf: /leaveos\.csrf=([^;]*)/.exec(cookie)?.[1] ?? '' };
}

async function runScript(pg: PGlite, name: string, sql: string) {
  try {
    return await pg.exec(sql);
  } catch (err) {
    try {
      await pg.exec('ROLLBACK');
    } catch {
      // nothing open
    }
    throw new Error(`${name}: ${(err as Error).message}`, { cause: err });
  }
}

function runScenario(label: string, kind: SampleKind, load: () => Promise<Scenario>) {
  describe(label, () => {
    it('wipes the sample data, loads the roster, and the administrator can sign in and grant a role', async () => {
      const s = await load();
      const { pg, db, config } = await sampleHostedDatabase(kind);

      // The sample database really has sample data to remove.
      expect(await count(pg, 'employee')).toBeGreaterThan(5);
      expect(await count(pg, 'leave_request')).toBeGreaterThan(0);
      expect(await count(pg, 'balance_ledger')).toBeGreaterThan(0);
      if (kind === 'setup') expect(await count(pg, 'audit_event')).toBeGreaterThan(0);
      const rolesBefore = await count(pg, 'role');
      const permsBefore = await count(pg, 'permission');
      const typesBefore = await count(pg, 'leave_type');
      const locationsBefore = await count(pg, 'location');

      // 00 reads only.
      const before = await count(pg, 'employee');
      const preview = await runScript(pg, '00', s.scripts.preview);
      expect(preview.length).toBeGreaterThan(0);
      expect(await count(pg, 'employee')).toBe(before);

      // 01
      await runScript(pg, '01', s.scripts.wipe);
      for (const t of [
        'employee',
        'user_account',
        'user_role',
        'session',
        'leave_request',
        'leave_request_day',
        'approval_step_instance',
        'balance_ledger',
        'notification',
        'department',
        'team',
        'job_title',
        'attendance_raw',
      ]) {
        expect(await count(pg, t), `${t} after wipe`).toBe(0);
      }
      expect(await count(pg, 'audit_event')).toBe(1);
      expect(await count(pg, 'role')).toBe(rolesBefore);
      expect(await count(pg, 'permission')).toBe(permsBefore);
      expect(await count(pg, 'leave_type')).toBe(typesBefore);
      expect(await count(pg, 'location')).toBe(locationsBefore);
      expect(await count(pg, 'company')).toBe(1);
      expect(
        Number(
          (
            (await pg.query(`SELECT count(*)::int AS n FROM app_setting WHERE key LIKE 'demo.%'`))
              .rows[0] as { n: number }
          ).n,
        ),
      ).toBe(0);
      // Append-only triggers are back, so the wipe left no hole in the audit trail's protection.
      await expect(pg.exec(`DELETE FROM audit_event`)).rejects.toThrow(/append-only/);
      await expect(pg.exec(`DELETE FROM balance_ledger`)).resolves.toBeDefined(); // empty: no row to fire on
      expect(await isBootstrapped(db)).toBe(false);

      // 02
      await runScript(pg, '02', s.scripts.roster);
      expect(await count(pg, 'employee')).toBe(s.people);
      expect(await count(pg, 'user_account')).toBe(s.people);
      expect(await count(pg, 'balance_ledger')).toBe(0);
      const roleCounts = (
        await pg.query(
          `SELECT r.code, count(*)::int AS n FROM user_role ur JOIN role r ON r.id = ur.role_id GROUP BY r.code`,
        )
      ).rows as { code: string; n: number }[];
      const byRole = Object.fromEntries(roleCounts.map((r) => [r.code, r.n]));
      expect(byRole.admin).toBe(1);
      expect(byRole.hr_officer).toBe(1);
      expect(byRole.employee).toBe(s.people - 1);
      expect(await isBootstrapped(db)).toBe(true);
      const hashesBefore = (
        await pg.query(`SELECT employee_id, password_hash FROM user_account ORDER BY employee_id`)
      ).rows;

      // Idempotent: a second run changes nothing, and never rotates a password.
      await pg.exec(s.scripts.roster);
      expect(await count(pg, 'employee')).toBe(s.people);
      expect(await count(pg, 'user_account')).toBe(s.people);
      expect(await count(pg, 'user_role')).toBe(s.people + 1);
      expect(
        (await pg.query(`SELECT employee_id, password_hash FROM user_account ORDER BY employee_id`))
          .rows,
      ).toEqual(hashesBefore);

      // 01 now refuses, so it cannot wipe the real roster by mistake.
      await expect(runScript(pg, '01', s.scripts.wipe)).rejects.toThrow(
        /production roster is already loaded/,
      );
      expect(await count(pg, 'employee')).toBe(s.people);

      // Setup cannot be reopened: the application sees an administrator.
      const app = await buildApp(config, db);
      await app.ready();
      try {
        const status = await app.inject({ method: 'GET', url: '/api/v1/setup/status' });
        expect((status.json() as { data: { needsSetup: boolean } }).data.needsSetup).toBe(false);

        // Nobody but the administrator has a usable password, whatever is typed.
        const staff = (
          await pg.query(
            `SELECT e.employee_code AS code FROM employee e WHERE lower(e.employee_code) NOT IN (lower($1), lower($2)) ORDER BY e.employee_code LIMIT 1`,
            [s.adminCode, s.hrCode],
          )
        ).rows[0] as { code: string };
        for (const guess of [NO_PASSWORD_HASH, '', 'ChangeMe_demo_1', 'password']) {
          const res = await app.inject({
            method: 'POST',
            url: '/api/v1/auth/login',
            payload: { email: staff.code, password: guess || 'x' },
          });
          expect(res.statusCode, `guess "${guess}"`).toBe(401);
        }
        // The sample accounts are gone.
        const demo = await app.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          payload: { email: 'admin@sns.test', password: 'ChangeMe_admin_1' },
        });
        expect(demo.statusCode).toBe(401);

        // The administrator signs in with the one-time password, by employee ID.
        const login = await app.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          payload: { email: s.adminCode, password: s.password },
        });
        expect(login.statusCode).toBe(200);
        expect(
          (login.json() as { data: { mustChangePassword: boolean } }).data.mustChangePassword,
        ).toBe(true);
        let admin = sessionFrom(login);

        // ...must choose a new password before anything else...
        const changed = await app.inject({
          method: 'POST',
          url: '/api/v1/auth/password',
          headers: { cookie: admin.cookie, 'x-csrf-token': admin.csrf },
          payload: { currentPassword: s.password, newPassword: 'A-brand-new-passphrase-1' },
        });
        expect(changed.statusCode).toBe(200);
        const again = await app.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          payload: { email: s.adminCode, password: 'A-brand-new-passphrase-1' },
        });
        expect(again.statusCode).toBe(200);
        expect(
          (again.json() as { data: { mustChangePassword: boolean } }).data.mustChangePassword,
        ).toBe(false);
        admin = sessionFrom(again);
        const auth = { cookie: admin.cookie, 'x-csrf-token': admin.csrf };

        // ...then assigns a role to a staff member through Users & access.
        const users = await app.inject({
          method: 'GET',
          url: '/api/v1/admin/users',
          headers: auth,
        });
        expect(users.statusCode).toBe(200);
        const list = (
          users.json() as {
            data: {
              users: {
                id: string;
                employeeCode: string;
                roles: string[];
                mustChangePassword: boolean;
              }[];
            };
          }
        ).data.users;
        expect(list).toHaveLength(s.people);
        const target = list.find((u) => u.employeeCode.toLowerCase() === staff.code.toLowerCase())!;
        expect(target.roles).toEqual(['employee']);
        expect(target.mustChangePassword).toBe(true);
        const assigned = await app.inject({
          method: 'PUT',
          url: `/api/v1/admin/users/${target.id}/roles`,
          headers: auth,
          payload: { roles: ['employee', 'manager'] },
        });
        expect(assigned.statusCode).toBe(200);
        const roles = (
          await pg.query(
            `SELECT r.code FROM user_role ur JOIN role r ON r.id = ur.role_id WHERE ur.user_account_id = $1 ORDER BY r.code`,
            [target.id],
          )
        ).rows as { code: string }[];
        expect(roles.map((r) => r.code)).toEqual(['employee', 'manager']);

        // The administrator sets that person's password; they must change it at first sign-in.
        const reset = await app.inject({
          method: 'POST',
          url: `/api/v1/accounts/${target.id}/reset-password`,
          headers: auth,
        });
        expect(reset.statusCode).toBe(200);
        const temp = (reset.json() as { data: { temporaryPassword: string } }).data
          .temporaryPassword;
        const staffLogin = await app.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          payload: { email: staff.code, password: temp },
        });
        expect(staffLogin.statusCode).toBe(200);
        expect(
          (staffLogin.json() as { data: { mustChangePassword: boolean } }).data.mustChangePassword,
        ).toBe(true);

        // Re-running the roster does not undo the role change.
        await pg.exec(s.scripts.roster);
        const rolesAfterRerun = (
          await pg.query(
            `SELECT r.code FROM user_role ur JOIN role r ON r.id = ur.role_id WHERE ur.user_account_id = $1 ORDER BY r.code`,
            [target.id],
          )
        ).rows as { code: string }[];
        expect(rolesAfterRerun.map((r) => r.code)).toEqual(['employee', 'manager']);
      } finally {
        await app.close();
      }
    }, 180_000);
  });
}

// Fictional on purpose: obviously not anyone's real name.
const SYNTHETIC = [
  { code: 'TST001', name: 'A. Test Administrator' },
  { code: 'TST002', name: 'Hana Test Hr' },
  { code: 'TST003', name: 'Sam Example Staff' },
  { code: 'TST004', name: "Oliver O'Test Staff" },
  { code: 'TST005', name: 'Zed Placeholder' },
];

for (const kind of ['setup', 'navalur'] as const) {
  runScenario(
    `production SQL on a ${kind}-seeded hosted database (synthetic roster)`,
    kind,
    async () => {
      const password = generateTemporaryPassword();
      return {
        adminCode: 'TST001',
        hrCode: 'TST002',
        people: SYNTHETIC.length,
        password,
        scripts: {
          preview: buildPreviewSql(),
          wipe: buildWipeSql(),
          roster: buildRosterSql({
            roster: SYNTHETIC,
            adminCode: 'TST001',
            hrCode: 'TST002',
            adminPasswordHash: await hashPassword(password),
            joinedOn: '2026-10-26',
          }),
        },
      };
    },
  );
}

const realDir = process.env.LEAVEOS_OPS_SQL_DIR;
if (realDir) {
  runScenario(
    'production SQL on a sample hosted database (generated files)',
    'navalur',
    async () => {
      const read = (f: string) => fs.readFileSync(path.join(realDir, f), 'utf8');
      const password = /One-time password: (\S+)/.exec(read('vijay_temp_password.txt'))![1]!;
      return {
        adminCode: process.env.LEAVEOS_OPS_ADMIN_CODE!,
        hrCode: process.env.LEAVEOS_OPS_HR_CODE!,
        people: Number(process.env.LEAVEOS_OPS_PEOPLE),
        password,
        scripts: {
          preview: read('00_preview_counts.sql'),
          wipe: read('01_partA_wipe_sample.sql'),
          roster: read('02_partB_employees.sql'),
        },
      };
    },
  );
}
