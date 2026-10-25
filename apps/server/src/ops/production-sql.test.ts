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
import {
  MIGRATIONS,
  isBootstrapped,
  migrate,
  migrationSql,
  toPostgresQuery,
  toPostgresSql,
  type Db,
} from '@sns/database';
import { buildApp } from '../app.js';
import { nowIso, todayInTimeZone } from '../time.js';
import type { RequestContext } from '../ctx.js';
import { ensureNavalurDataset } from '../navalur.js';
import { completeSetup } from '../usecases/setup.js';
import {
  buildInspectSql,
  buildPreviewSql,
  buildRosterSql,
  buildSchemaUpgradeSql,
  buildWipeSql,
  NO_PASSWORD_HASH,
  pendingMigrations,
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

type Scripts = { preview: string; wipe: string; roster: string; upgrade: string; inspect: string };
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

/**
 * `branch` = the schema this code builds. `legacy` = the schema the live Supabase database has:
 * every migration up to the deployed baseline (main 94e69a1), none of the later ones. Migrations
 * 0001-0012 are byte-identical between 94e69a1 and this branch, so building from the current
 * files is building 94e69a1's schema.
 */
type SchemaKind = 'branch' | 'legacy';

async function migrateLegacy(db: Db) {
  await db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migration (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`,
  );
  const later = new Set(pendingMigrations().map((m) => m.id));
  for (const m of MIGRATIONS.filter((x) => !later.has(x.id))) {
    await db.exec(migrationSql(m.id, 'postgres'));
    await db
      .prepare('INSERT INTO schema_migration (id, applied_at) VALUES (?, ?)')
      .run(m.id, new Date().toISOString());
  }
}

const migrationRows = async (pg: PGlite) =>
  (await pg.query(`SELECT id, applied_at FROM schema_migration ORDER BY id`)).rows as {
    id: string;
    applied_at: string;
  }[];

const tableExists = async (pg: PGlite, t: string) =>
  ((await pg.query(`SELECT to_regclass('public.${t}') AS r`)).rows[0] as { r: string | null }).r !==
  null;

/** The rows the last statement of a script returned (00 and 99 end with a SELECT). */
async function resultRows(pg: PGlite, sql: string) {
  const results = await pg.exec(sql);
  return results[results.length - 1]!.rows as Record<string, unknown>[];
}

/** `setup` = first-run setup with the sample organisation; `navalur` = the reset script the hosted preview ran. */
type SampleKind = 'setup' | 'navalur';

async function sampleHostedDatabase(kind: SampleKind, schema: SchemaKind = 'branch') {
  const pg = new PGlite();
  opened.push(pg);
  const db = pgAdapter(pg);
  if (schema === 'legacy') await migrateLegacy(db);
  else await migrate(db);
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

function runScenario(
  label: string,
  kind: SampleKind,
  schema: SchemaKind,
  load: () => Promise<Scenario>,
) {
  describe(label, () => {
    it('upgrades, wipes the sample data, loads the roster, and the administrator can sign in and grant a role', async () => {
      const s = await load();
      const { pg, db, config } = await sampleHostedDatabase(kind, schema);

      // The sample database really has sample data to remove.
      expect(await count(pg, 'employee')).toBeGreaterThan(5);
      expect(await count(pg, 'leave_request')).toBeGreaterThan(0);
      expect(await count(pg, 'balance_ledger')).toBeGreaterThan(0);
      if (kind === 'setup') expect(await count(pg, 'audit_event')).toBeGreaterThan(0);
      const rolesBefore = await count(pg, 'role');
      const permsBefore = await count(pg, 'permission');
      const typesBefore = await count(pg, 'leave_type');
      const locationsBefore = await count(pg, 'location');

      // 99 and 00 read only, and report the schema instead of failing on it.
      const before = await count(pg, 'employee');
      const inspect = await resultRows(pg, s.scripts.inspect);
      const pendingBefore = inspect.filter((r) => r.section === 'pending').map((r) => r.name);
      const preview = await resultRows(pg, s.scripts.preview);
      expect(preview.length).toBeGreaterThan(0);
      expect(await count(pg, 'employee')).toBe(before);
      const schemaRows = preview.filter((r) => r.action === 'schema');
      expect(schemaRows).toHaveLength(MIGRATIONS.length);
      const pending = pendingMigrations().map((m) => m.id);
      if (schema === 'legacy') {
        expect(await tableExists(pg, 'browser_device')).toBe(false);
        expect(pendingBefore).toEqual(pending);
        expect(
          schemaRows.filter((r) => String(r.note).startsWith('PENDING')).map((r) => r.table),
        ).toEqual(pending);
        const bd = preview.find((r) => r.table === 'browser_device')!;
        expect(bd.rows).toBeNull();
        expect(String(bd.note)).toMatch(/^MISSING/);
        expect(await count(pg, 'leave_type WHERE archived_at IS NOT NULL')).toBe(0);
        // A second leave type, as an older sample could carry: 0014 must archive it, not delete it.
        await pg.exec(
          `INSERT INTO leave_type (id, code, name, colour_token, is_paid, created_at, created_by, updated_at, updated_by)
           VALUES ('lt-extra', 'XL', 'Extra Leave', 'accent', 1, 'x', 'x', 'x', 'x')`,
        );
      } else {
        expect(pendingBefore).toEqual([]);
      }

      // 03 brings the schema up to date; running it again, or the app's own migrator after it,
      // changes nothing and does not fail.
      const typeRows = await count(pg, 'leave_type');
      await runScript(pg, '03', s.scripts.upgrade);
      const recorded = await migrationRows(pg);
      expect(recorded.map((r) => r.id)).toEqual(MIGRATIONS.map((m) => m.id));
      for (const r of recorded) expect(r.applied_at).toMatch(/^\d{4}-\d\d-\d\dT[\d:.]+Z$/);
      expect(await tableExists(pg, 'browser_device')).toBe(true);
      await runScript(pg, '03 again', s.scripts.upgrade);
      await migrate(db);
      expect(await migrationRows(pg)).toEqual(recorded);
      expect(await count(pg, 'leave_type')).toBe(typeRows);
      expect(await count(pg, "leave_type WHERE code <> 'AL' AND archived_at IS NULL")).toBe(0);
      if (schema === 'legacy') {
        expect(
          await count(pg, "leave_type WHERE id = 'lt-extra' AND archived_at IS NOT NULL"),
        ).toBe(1);
      }
      expect(
        (await resultRows(pg, s.scripts.preview)).filter(
          (r) => r.action === 'schema' && r.note !== 'applied',
        ),
      ).toEqual([]);
      expect(
        (await resultRows(pg, s.scripts.inspect)).filter((r) => r.section === 'pending'),
      ).toEqual([]);

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
      expect(await count(pg, 'leave_type')).toBe(typesBefore + (schema === 'legacy' ? 1 : 0));
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
      // The app starting on this database applies nothing and does not clash with the script.
      await migrate(db);
      expect(await migrationRows(pg)).toEqual(recorded);
      const after = await resultRows(pg, s.scripts.preview);
      const rowsOf = (t: string) => after.find((r) => r.action === 'delete' && r.table === t)?.rows;
      expect(Number(rowsOf('employee'))).toBe(s.people);
      expect(Number(rowsOf('balance_ledger'))).toBe(0);
      expect(Number(rowsOf('browser_device'))).toBe(0);
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

for (const [kind, schema] of [
  ['setup', 'branch'],
  ['navalur', 'branch'],
  ['setup', 'legacy'],
  ['navalur', 'legacy'],
] as const) {
  runScenario(
    `production SQL on a ${kind}-seeded hosted database at the ${schema} schema (synthetic roster)`,
    kind,
    schema,
    async () => {
      const password = generateTemporaryPassword();
      return {
        adminCode: 'TST001',
        hrCode: 'TST002',
        people: SYNTHETIC.length,
        password,
        scripts: {
          preview: buildPreviewSql(),
          upgrade: buildSchemaUpgradeSql(),
          inspect: buildInspectSql(),
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
    'production SQL on a sample hosted database at the legacy schema (generated files)',
    'navalur',
    'legacy',
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
          upgrade: read('03_schema_upgrade.sql'),
          inspect: read('99_inspect_live_schema.sql'),
          wipe: read('01_partA_wipe_sample.sql'),
          roster: read('02_partB_employees.sql'),
        },
      };
    },
  );
}

describe('production SQL against a schema that is not what it expects', () => {
  const roster = async () =>
    buildRosterSql({
      roster: SYNTHETIC,
      adminCode: 'TST001',
      hrCode: 'TST002',
      adminPasswordHash: await hashPassword(generateTemporaryPassword()),
      joinedOn: '2026-10-26',
    });

  async function emptyLegacy() {
    const pg = new PGlite();
    opened.push(pg);
    await migrateLegacy(pgAdapter(pg));
    return pg;
  }

  it('01 and 00 work on the old schema without 03 (a missing table is skipped, not an error)', async () => {
    const { pg } = await sampleHostedDatabase('navalur', 'legacy');
    const preview = await resultRows(pg, buildPreviewSql());
    expect(preview.find((r) => r.table === 'browser_device')?.note).toMatch(/^MISSING/);
    await runScript(pg, '01', buildWipeSql());
    expect(await count(pg, 'employee')).toBe(0);
    expect(await tableExists(pg, 'browser_device')).toBe(false);
  }, 120_000);

  it('deploying first is equivalent: the app migrates, and 03 afterwards is a no-op', async () => {
    const { pg, db } = await sampleHostedDatabase('setup', 'legacy');
    await migrate(db);
    const recorded = await migrationRows(pg);
    expect(recorded.map((r) => r.id)).toEqual(MIGRATIONS.map((m) => m.id));
    await runScript(pg, '03', buildSchemaUpgradeSql());
    expect(await migrationRows(pg)).toEqual(recorded);
  }, 120_000);

  it('03 produces the same schema and the same migration records as the app migrator', async () => {
    const viaScript = await emptyLegacy();
    await runScript(viaScript, '03', buildSchemaUpgradeSql());
    const viaApp = new PGlite();
    opened.push(viaApp);
    const appDb = pgAdapter(viaApp);
    await migrateLegacy(appDb);
    await migrate(appDb);
    expect((await migrationRows(viaScript)).map((r) => r.id)).toEqual(
      (await migrationRows(viaApp)).map((r) => r.id),
    );
    const shape = async (pg: PGlite) =>
      (
        await pg.query(
          `SELECT table_name, column_name, data_type, is_nullable FROM information_schema.columns
            WHERE table_schema = 'public' ORDER BY 1, 2`,
        )
      ).rows;
    expect(await shape(viaScript)).toEqual(await shape(viaApp));
    const indexes = async (pg: PGlite) =>
      (await pg.query(`SELECT indexname FROM pg_indexes WHERE schemaname = 'public' ORDER BY 1`))
        .rows;
    expect(await indexes(viaScript)).toEqual(await indexes(viaApp));
  }, 120_000);

  it('03 stops, changing nothing, on a database that is not Leave OS or is older than the baseline', async () => {
    const empty = new PGlite();
    opened.push(empty);
    await expect(runScript(empty, '03', buildSchemaUpgradeSql())).rejects.toThrow(
      /schema_migration does not exist/,
    );
    const old = await emptyLegacy();
    await old.exec(`DELETE FROM schema_migration WHERE id = '0011_account_username'`);
    await expect(runScript(old, '03', buildSchemaUpgradeSql())).rejects.toThrow(
      /older than the expected baseline \(missing: 0011_account_username\)/,
    );
    expect(await tableExists(old, 'browser_device')).toBe(false);
  });

  it('01 refuses, deleting nothing, when a core table is missing', async () => {
    const { pg } = await sampleHostedDatabase('setup', 'legacy');
    await pg.exec(`DROP TABLE policy_assignment`);
    await expect(runScript(pg, '01', buildWipeSql())).rejects.toThrow(
      /core table\(s\) missing: policy_assignment/,
    );
    expect(await count(pg, 'employee')).toBeGreaterThan(0);
  }, 120_000);

  it('02 lists a missing column and writes nothing', async () => {
    const pg = await emptyLegacy();
    await pg.exec(
      `DROP INDEX user_account_username; ALTER TABLE user_account DROP COLUMN username`,
    );
    await expect(runScript(pg, '02', await roster())).rejects.toThrow(
      /Cannot load the roster: missing user_account\.username/,
    );
    expect(await count(pg, 'employee')).toBe(0);
    expect(await count(pg, 'permission')).toBe(0);
  });

  it('99 changes nothing and lists the migrations table, the tables and the schemas', async () => {
    const pg = await emptyLegacy();
    const publicObjects = async () =>
      (
        await pg.query(
          `SELECT count(*)::int AS n FROM pg_class WHERE relnamespace = 'public'::regnamespace`,
        )
      ).rows;
    const before = await publicObjects();
    const rows = await resultRows(pg, buildInspectSql());
    expect(rows.filter((r) => r.section === 'migration').map((r) => r.name)).toEqual(
      MIGRATIONS.slice(0, MIGRATIONS.length - pendingMigrations().length).map((m) => m.id),
    );
    expect(rows.some((r) => r.section === 'table' && r.name === 'public.employee')).toBe(true);
    expect(rows.some((r) => r.section === 'schema' && r.name === 'public')).toBe(true);
    expect(rows.filter((r) => r.section === 'trigger')).toHaveLength(4);
    expect(await publicObjects()).toEqual(before);
    // An empty database is reported, not an error.
    const blank = new PGlite();
    opened.push(blank);
    const blankRows = await resultRows(blank, buildInspectSql());
    expect(blankRows.find((r) => r.section === 'migration')?.detail).toBe('TABLE DOES NOT EXIST');
    const blankPreview = await resultRows(blank, buildPreviewSql());
    expect(blankPreview.every((r) => r.rows === null)).toBe(true);
  });
});
