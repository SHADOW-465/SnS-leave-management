/**
 * The sample organisation used for development, testing and the hosted preview.
 *
 * Simon & Sons is a printing and publishing house. Everyone has a real designation, a
 * department, a reporting manager and a sign-in, so every screen — approvals, reports,
 * payroll — has something true to show the moment the app opens. All addresses end in
 * `@sns.test`, a reserved top-level domain that can never receive mail.
 *
 * Everything here is idempotent ("ensure", not "insert"), so the same code builds a fresh
 * demo and upgrades the older one on the hosted preview in place, without deleting data.
 */
import { hashPassword } from '@sns/auth';
import { withTx } from '@sns/database';
import { defaultRulesForCode, newId, type RoleCode } from '@sns/domain';
import { loadPrincipal, type RequestContext } from '../ctx.js';
import { uniqueUsername } from '../username.js';
import { standardHolidays } from '../holiday-sheet.js';
import { importHolidays } from './allowances.js';
import { decideLeave, submitLeave } from './leave.js';
import { currentPeriodId, grantOpeningBalances } from './setup.js';

export const DEMO_DOMAIN = '@sns.test';
export const DEMO_PASSWORD = 'ChangeMe_demo_1';
export const DEMO_ADMIN = {
  name: 'Arjun Das',
  email: `admin${DEMO_DOMAIN}`,
  password: 'ChangeMe_admin_1',
};

type Dept = { code: string; name: string };
const DEPARTMENTS: Dept[] = [
  { code: 'MGT', name: 'Management' },
  { code: 'PRD', name: 'Production' },
  { code: 'EDT', name: 'Editorial' },
  { code: 'QA', name: 'Quality Assurance' },
  { code: 'HR', name: 'Human Resources' },
  { code: 'FIN', name: 'Finance & Accounts' },
];
const TEAMS = [
  { key: 'PRINT', dept: 'PRD', name: 'Printing' },
  { key: 'BIND', dept: 'PRD', name: 'Binding & Finishing' },
  { key: 'CONTENT', dept: 'EDT', name: 'Content' },
];
const CATEGORIES = [
  { code: 'PROD', name: 'Production staff' },
  { code: 'MGMT', name: 'Management' },
];

type Person = {
  key: string;
  code: string;
  first: string;
  last: string;
  title: string;
  role: RoleCode;
  dept: string;
  team?: string;
  leads?: string;
  heads?: boolean;
  manager?: string;
  category: 'PERM' | 'PROD' | 'MGMT';
  joined: string;
  probationEnd?: string;
};

/** Ordered as the sign-in screen lists them: who you would test as, top down. */
export const DEMO_PEOPLE: Person[] = [
  {
    key: 'anitha',
    code: 'SNS-1015',
    first: 'Anitha',
    last: 'Joseph',
    title: 'HR Manager',
    role: 'hr_officer',
    dept: 'HR',
    heads: true,
    manager: 'rajesh',
    category: 'MGMT',
    joined: '2016-01-11',
  },
  {
    key: 'rajesh',
    code: 'SNS-1001',
    first: 'Rajesh',
    last: 'Menon',
    title: 'Managing Director',
    role: 'director',
    dept: 'MGT',
    heads: true,
    category: 'MGMT',
    joined: '2015-04-01',
  },
  {
    key: 'david',
    code: 'SNS-1002',
    first: 'David',
    last: 'Fernandes',
    title: 'Production Manager',
    role: 'manager',
    dept: 'PRD',
    heads: true,
    manager: 'anitha',
    category: 'MGMT',
    joined: '2017-06-12',
  },
  {
    key: 'john',
    code: 'SNS-1003',
    first: 'John',
    last: 'Mathew',
    title: 'Printing Supervisor',
    role: 'manager',
    dept: 'PRD',
    team: 'PRINT',
    leads: 'PRINT',
    manager: 'david',
    category: 'PROD',
    joined: '2018-02-05',
  },
  {
    key: 'kumar',
    code: 'SNS-1004',
    first: 'Kumar',
    last: 'Swamy',
    title: 'Binding Supervisor',
    role: 'manager',
    dept: 'PRD',
    team: 'BIND',
    leads: 'BIND',
    manager: 'david',
    category: 'PROD',
    joined: '2019-07-22',
  },
  {
    key: 'vijay',
    code: 'SNS-1005',
    first: 'Vijay',
    last: 'Anand',
    title: 'Machine Operator',
    role: 'employee',
    dept: 'PRD',
    team: 'PRINT',
    manager: 'john',
    category: 'PROD',
    joined: '2021-03-15',
  },
  {
    key: 'priya',
    code: 'SNS-1006',
    first: 'Priya',
    last: 'Sharma',
    title: 'Press Assistant',
    role: 'employee',
    dept: 'PRD',
    team: 'PRINT',
    manager: 'john',
    category: 'PROD',
    joined: '2022-09-01',
  },
  {
    key: 'ravi',
    code: 'SNS-1007',
    first: 'Ravi',
    last: 'Shankar',
    title: 'Binding Operator',
    role: 'employee',
    dept: 'PRD',
    team: 'BIND',
    manager: 'kumar',
    category: 'PROD',
    joined: '2020-11-09',
  },
  {
    key: 'suresh',
    code: 'SNS-1008',
    first: 'Suresh',
    last: 'Babu',
    title: 'Production Planner',
    role: 'employee',
    dept: 'PRD',
    manager: 'david',
    category: 'PERM',
    joined: '2019-01-14',
  },
  {
    key: 'meera',
    code: 'SNS-1009',
    first: 'Meera',
    last: 'Krishnan',
    title: 'Editorial Head',
    role: 'manager',
    dept: 'EDT',
    heads: true,
    manager: 'anitha',
    category: 'MGMT',
    joined: '2016-08-01',
  },
  {
    key: 'arun',
    code: 'SNS-1010',
    first: 'Arun',
    last: 'Prakash',
    title: 'Senior Editor',
    role: 'manager',
    dept: 'EDT',
    team: 'CONTENT',
    leads: 'CONTENT',
    manager: 'meera',
    category: 'PERM',
    joined: '2018-10-03',
  },
  {
    key: 'divya',
    code: 'SNS-1011',
    first: 'Divya',
    last: 'Nair',
    title: 'Copy Editor',
    role: 'employee',
    dept: 'EDT',
    team: 'CONTENT',
    manager: 'arun',
    category: 'PERM',
    joined: '2023-01-16',
  },
  {
    key: 'karthik',
    code: 'SNS-1012',
    first: 'Karthik',
    last: 'Raja',
    title: 'Proof Reader',
    role: 'employee',
    dept: 'EDT',
    team: 'CONTENT',
    manager: 'arun',
    category: 'PERM',
    joined: '2026-08-17',
    probationEnd: '2027-02-16',
  },
  {
    key: 'lakshmi',
    code: 'SNS-1013',
    first: 'Lakshmi',
    last: 'Iyer',
    title: 'QA Lead',
    role: 'manager',
    dept: 'QA',
    heads: true,
    manager: 'anitha',
    category: 'MGMT',
    joined: '2017-03-20',
  },
  {
    key: 'sneha',
    code: 'SNS-1014',
    first: 'Sneha',
    last: 'Reddy',
    title: 'QA Analyst',
    role: 'employee',
    dept: 'QA',
    manager: 'lakshmi',
    category: 'PERM',
    joined: '2022-04-11',
  },
  {
    key: 'ramesh',
    code: 'SNS-1016',
    first: 'Ramesh',
    last: 'Nagarajan',
    title: 'Payroll Accountant',
    role: 'payroll_officer',
    dept: 'FIN',
    manager: 'anitha',
    category: 'PERM',
    joined: '2018-05-07',
    heads: true,
  },
  {
    key: 'sanjay',
    code: 'SNS-1017',
    first: 'Sanjay',
    last: 'Gupta',
    title: 'Internal Auditor',
    role: 'auditor',
    dept: 'FIN',
    manager: 'ramesh',
    category: 'PERM',
    joined: '2020-02-03',
  },
];

export const demoEmail = (key: string) => `${key}${DEMO_DOMAIN}`;

/** The first sample set used `@example.invalid` and placeholder names. */
const LEGACY: Record<string, string> = {
  'amina@example.invalid': 'vijay',
  'ravi@example.invalid': 'john',
  'sofia@example.invalid': 'david',
  'helen@example.invalid': 'anitha',
  'paul@example.invalid': 'ramesh',
  'nora@example.invalid': 'sanjay',
};

async function ensureId(
  ctx: RequestContext,
  find: { sql: string; params: string[] },
  create: (id: string) => Promise<unknown>,
): Promise<string> {
  const row = (await ctx.sqlite.prepare(find.sql).get(...find.params)) as
    { id: string } | undefined;
  if (row) return row.id;
  const id = newId();
  await create(id);
  return id;
}

/**
 * Builds (or completes) the sample organisation. `actorId` is the administrator the
 * records are attributed to.
 */
export async function ensureDemoOrganisation(
  ctx: RequestContext,
  actorId: string,
  opts: { upgradeLegacy?: boolean } = {},
): Promise<void> {
  const now = ctx.now;
  const location = (await ctx.sqlite
    .prepare(`SELECT id FROM location ORDER BY created_at LIMIT 1`)
    .get()) as { id: string } | undefined;
  if (!location) return;
  const periodId = await currentPeriodId(ctx);
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  await withTx(ctx.sqlite, async () => {
    // Older preview data: rename the placeholder people and their Engineering department in
    // place, so their history carries over. Never on a fresh setup.
    if (opts.upgradeLegacy) await upgradeLegacyDemo(ctx, now);
  });
  await withTx(ctx.sqlite, async () => {
    // Departments, teams, staff categories.
    const deptId = new Map<string, string>();
    for (const d of DEPARTMENTS) {
      deptId.set(
        d.code,
        await ensureId(
          ctx,
          {
            sql: `SELECT id FROM department WHERE code = ? AND archived_at IS NULL`,
            params: [d.code],
          },
          (id) =>
            ctx.sqlite
              .prepare(
                `INSERT INTO department (id, name, code, created_at, created_by, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)`,
              )
              .run(id, d.name, d.code, now, actorId, now, actorId),
        ),
      );
    }
    const teamId = new Map<string, string>();
    for (const t of TEAMS) {
      const dept = deptId.get(t.dept)!;
      teamId.set(
        t.key,
        await ensureId(
          ctx,
          { sql: `SELECT id FROM team WHERE name = ? AND archived_at IS NULL`, params: [t.name] },
          (id) =>
            ctx.sqlite
              .prepare(
                `INSERT INTO team (id, department_id, name, created_at, created_by, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)`,
              )
              .run(id, dept, t.name, now, actorId, now, actorId),
        ),
      );
      await ctx.sqlite
        .prepare(`UPDATE team SET department_id = ? WHERE id = ?`)
        .run(dept, teamId.get(t.key)!);
    }
    const categoryId = new Map<string, string>();
    for (const c of [...CATEGORIES, { code: 'PERM', name: 'Permanent' }]) {
      categoryId.set(
        c.code,
        await ensureId(
          ctx,
          { sql: `SELECT id FROM employment_type WHERE code = ?`, params: [c.code] },
          (id) =>
            ctx.sqlite
              .prepare(
                `INSERT INTO employment_type (id, name, code, is_leave_eligible, created_at, created_by, updated_at, updated_by) VALUES (?, ?, ?, 1, ?, ?, ?, ?)`,
              )
              .run(id, c.name, c.code, now, actorId, now, actorId),
        ),
      );
    }
    const titleId = async (name: string) =>
      ensureId(
        ctx,
        { sql: `SELECT id FROM job_title WHERE name = ? AND archived_at IS NULL`, params: [name] },
        (id) =>
          ctx.sqlite
            .prepare(
              `INSERT INTO job_title (id, name, created_at, created_by, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?)`,
            )
            .run(id, name, now, actorId, now, actorId),
      );

    // Annual Leave uses the company schedule: 1.5 days a month until 3 years, then 2;
    // experienced hires on probation earn 1 day and freshers earn none.
    await publishDemoEarnedLeavePolicy(ctx, actorId);

    // People.
    const employeeId = new Map<string, string>();
    for (const p of DEMO_PEOPLE) {
      const email = demoEmail(p.key);
      const existing = (await ctx.sqlite
        .prepare(`SELECT employee_id AS id FROM user_account WHERE email = ?`)
        .get(email)) as { id: string | null } | undefined;
      let empId = existing?.id ?? null;
      const status = p.probationEnd && p.probationEnd > ctx.today ? 'probation' : 'active';
      if (!empId) {
        empId = newId();
        const codeTaken = await ctx.sqlite
          .prepare(`SELECT id FROM employee WHERE employee_code = ?`)
          .get(p.code);
        await ctx.sqlite
          .prepare(
            `INSERT INTO employee (id, employee_code, first_name, last_name, work_email, status, joined_on, probation_end_on, location_id, department_id, team_id, job_title_id, employment_type_id, retention_class, created_at, created_by, updated_at, updated_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'standard', ?, ?, ?, ?)`,
          )
          .run(
            empId,
            codeTaken ? `${p.code}-${empId.slice(-3)}` : p.code,
            p.first,
            p.last,
            email,
            status,
            p.joined,
            p.probationEnd ?? null,
            location.id,
            deptId.get(p.dept)!,
            p.team ? teamId.get(p.team)! : null,
            await titleId(p.title),
            categoryId.get(p.category)!,
            now,
            actorId,
            now,
            actorId,
          );
        const userId = newId();
        await ctx.sqlite
          .prepare(
            `INSERT INTO user_account (id, employee_id, email, username, password_hash, password_algo, must_change_password, is_disabled, created_at, created_by, updated_at, updated_by)
             VALUES (?, ?, ?, ?, ?, 'argon2id', 0, 0, ?, ?, ?, ?)`,
          )
          .run(
            userId,
            empId,
            email,
            await uniqueUsername(ctx.sqlite, email.split('@')[0] || p.code),
            passwordHash,
            now,
            actorId,
            now,
            actorId,
          );
        await ctx.sqlite
          .prepare(
            `INSERT INTO user_role (user_account_id, role_id, granted_by, granted_at)
             SELECT ?, id, ?, ? FROM role WHERE code = ?`,
          )
          .run(userId, actorId, now, p.role);
        await grantOpeningBalances(ctx, empId, periodId, actorId);
      } else {
        await ctx.sqlite
          .prepare(
            `UPDATE employee SET department_id = ?, team_id = ?, job_title_id = ?, employment_type_id = ?,
                    status = CASE WHEN status = 'exited' THEN status ELSE ? END, probation_end_on = ?, updated_at = ?
              WHERE id = ?`,
          )
          .run(
            deptId.get(p.dept)!,
            p.team ? teamId.get(p.team)! : null,
            await titleId(p.title),
            categoryId.get(p.category)!,
            status,
            p.probationEnd ?? null,
            now,
            empId,
          );
      }
      employeeId.set(p.key, empId);
      await ctx.sqlite
        .prepare(
          `DELETE FROM user_role WHERE user_account_id = (SELECT id FROM user_account WHERE email = ?)
             AND role_id NOT IN (SELECT id FROM role WHERE code = ?)`,
        )
        .run(email, p.role);
      await ctx.sqlite
        .prepare(
          `INSERT INTO user_role (user_account_id, role_id, granted_by, granted_at)
           SELECT ua.id, r.id, ?, ? FROM user_account ua, role r
            WHERE ua.email = ? AND r.code = ?
              AND NOT EXISTS (SELECT 1 FROM user_role x WHERE x.user_account_id = ua.id AND x.role_id = r.id)`,
        )
        .run(actorId, now, email, p.role);
    }

    // Leadership and reporting lines, now that everyone exists.
    for (const p of DEMO_PEOPLE) {
      const empId = employeeId.get(p.key)!;
      if (p.leads) {
        await ctx.sqlite
          .prepare(`UPDATE team SET lead_employee_id = ? WHERE id = ?`)
          .run(empId, teamId.get(p.leads)!);
      }
      if (p.heads) {
        await ctx.sqlite
          .prepare(`UPDATE department SET head_employee_id = ? WHERE id = ?`)
          .run(empId, deptId.get(p.dept)!);
      }
      const managerId = p.manager ? employeeId.get(p.manager)! : null;
      const current = (await ctx.sqlite
        .prepare(`SELECT manager_employee_id AS id FROM employee WHERE id = ?`)
        .get(empId)) as { id: string | null };
      if (current.id !== managerId) {
        await ctx.sqlite
          .prepare(`UPDATE employee SET manager_employee_id = ? WHERE id = ?`)
          .run(managerId, empId);
        await ctx.sqlite
          .prepare(
            `UPDATE employment_history SET effective_to = ? WHERE employee_id = ? AND effective_to IS NULL`,
          )
          .run(ctx.today, empId);
        await ctx.sqlite
          .prepare(
            `INSERT INTO employment_history (id, employee_id, job_title_id, employment_type_id, department_id, manager_employee_id, effective_from, effective_to, reason, created_at, created_by)
             SELECT ?, id, job_title_id, employment_type_id, department_id, manager_employee_id, joined_on, NULL, 'Joined', ?, ?
               FROM employee WHERE id = ?`,
          )
          .run(newId(), now, actorId, empId);
      }
    }

    // The administrator created at setup sits in a placeholder "General / Default"; give
    // them a real place in the organisation.
    const admin = (await ctx.sqlite
      .prepare(`SELECT employee_id AS id FROM user_account WHERE email = ?`)
      .get(DEMO_ADMIN.email)) as { id: string | null } | undefined;
    if (admin?.id) {
      await ctx.sqlite
        .prepare(
          `UPDATE department SET name = 'Administration' WHERE code = 'GEN' AND name = 'General'`,
        )
        .run();
      await ctx.sqlite
        .prepare(
          `UPDATE employee SET job_title_id = ?, team_id = NULL, manager_employee_id = ?, employee_code = CASE WHEN employee_code = 'ADM-0001' THEN 'SNS-1000' ELSE employee_code END
            WHERE id = ?`,
        )
        .run(await titleId('IT Administrator'), employeeId.get('rajesh')!, admin.id);
      await ctx.sqlite
        .prepare(
          `UPDATE team SET archived_at = ? WHERE name = 'Default' AND archived_at IS NULL
             AND NOT EXISTS (SELECT 1 FROM employee e WHERE e.team_id = team.id AND e.status != 'exited')`,
        )
        .run(now);
    }

    await ctx.sqlite.prepare(`DELETE FROM app_setting WHERE key = 'demo.accounts'`).run();
    await ctx.sqlite
      .prepare(
        `INSERT INTO app_setting (key, value_json, updated_by, updated_at) VALUES ('demo.accounts', ?, ?, ?)`,
      )
      .run(
        JSON.stringify([DEMO_ADMIN.email, ...DEMO_PEOPLE.map((p) => demoEmail(p.key))]),
        actorId,
        now,
      );
  });
}

async function upgradeLegacyDemo(ctx: RequestContext, now: string) {
  await ctx.sqlite
    .prepare(
      `UPDATE department SET name = 'Production', code = 'PRD', updated_at = ? WHERE code = 'ENG'`,
    )
    .run(now);
  await ctx.sqlite
    .prepare(`UPDATE team SET name = 'Printing', updated_at = ? WHERE name = 'Platform'`)
    .run(now);
  await ctx.sqlite
    .prepare(
      `UPDATE team SET name = 'Binding & Finishing', updated_at = ? WHERE name = 'Customer Support'`,
    )
    .run(now);
  await ctx.sqlite
    .prepare(
      `UPDATE department SET name = 'Administration', updated_at = ? WHERE code = 'GEN' AND name = 'General'`,
    )
    .run(now);
  for (const [oldEmail, key] of Object.entries(LEGACY)) {
    const person = DEMO_PEOPLE.find((p) => p.key === key)!;
    const account = (await ctx.sqlite
      .prepare(`SELECT id, employee_id AS "employeeId" FROM user_account WHERE email = ?`)
      .get(oldEmail)) as { id: string; employeeId: string | null } | undefined;
    if (!account) continue;
    const taken = await ctx.sqlite
      .prepare(`SELECT id FROM user_account WHERE email = ?`)
      .get(demoEmail(key));
    if (taken) continue;
    await ctx.sqlite
      .prepare(`UPDATE user_account SET email = ?, updated_at = ? WHERE id = ?`)
      .run(demoEmail(key), now, account.id);
    if (account.employeeId) {
      await ctx.sqlite
        .prepare(
          `UPDATE employee SET first_name = ?, last_name = ?, work_email = ?, employee_code = ?,
                    joined_on = ?, updated_at = ? WHERE id = ?`,
        )
        .run(
          person.first,
          person.last,
          demoEmail(key),
          person.code,
          person.joined,
          now,
          account.employeeId,
        );
    }
  }
  const admin = (await ctx.sqlite
    .prepare(
      `SELECT id, employee_id AS "employeeId" FROM user_account WHERE email = 'admin@example.invalid'`,
    )
    .get()) as { id: string; employeeId: string | null } | undefined;
  if (
    admin &&
    !(await ctx.sqlite.prepare(`SELECT id FROM user_account WHERE email = ?`).get(DEMO_ADMIN.email))
  ) {
    await ctx.sqlite
      .prepare(`UPDATE user_account SET email = ? WHERE id = ?`)
      .run(DEMO_ADMIN.email, admin.id);
    if (admin.employeeId) {
      await ctx.sqlite
        .prepare(
          `UPDATE employee SET first_name = 'Arjun', last_name = 'Das', work_email = ? WHERE id = ?`,
        )
        .run(DEMO_ADMIN.email, admin.employeeId);
    }
  }
}

/**
 * Older demo databases carry Casual, Sick, Earned and Loss of Pay. The framework describes a
 * single type, Annual Leave: add it, open everyone's balance, and archive the rest (their
 * history stays in every report).
 */
export async function adoptAnnualLeave(ctx: RequestContext, actorId: string): Promise<void> {
  const periodId = await currentPeriodId(ctx);
  const period = (await ctx.sqlite
    .prepare(`SELECT starts_on AS "startsOn" FROM leave_period WHERE id = ?`)
    .get(periodId)) as { startsOn: string };
  await withTx(ctx.sqlite, async () => {
    const existing = (await ctx.sqlite
      .prepare(`SELECT id FROM leave_type WHERE code = 'AL'`)
      .get()) as { id: string } | undefined;
    if (!existing) {
      const typeId = newId();
      const versionId = newId();
      await ctx.sqlite
        .prepare(
          `INSERT INTO leave_type (id, code, name, colour_token, is_paid, created_at, created_by, updated_at, updated_by)
           VALUES (?, 'AL', 'Annual Leave', 'accent', 1, ?, ?, ?, ?)`,
        )
        .run(typeId, ctx.now, actorId, ctx.now, actorId);
      await ctx.sqlite
        .prepare(
          `INSERT INTO leave_policy_version (id, leave_type_id, version_no, effective_from, rules_json, published_at, published_by, created_at, created_by)
           VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          versionId,
          typeId,
          period.startsOn,
          JSON.stringify(defaultRulesForCode('AL')),
          ctx.now,
          actorId,
          ctx.now,
          actorId,
        );
      await ctx.sqlite
        .prepare(
          `INSERT INTO policy_assignment (id, leave_policy_version_id, scope_type, scope_id, priority) VALUES (?, ?, 'company', 'company', 0)`,
        )
        .run(newId(), versionId);
    } else {
      await ctx.sqlite
        .prepare(`UPDATE leave_type SET archived_at = NULL WHERE id = ?`)
        .run(existing.id);
    }
    await ctx.sqlite
      .prepare(
        `UPDATE leave_type SET archived_at = ?, updated_at = ? WHERE code != 'AL' AND archived_at IS NULL`,
      )
      .run(ctx.now, ctx.now);
  });
}

/** Opens this year's balance of every current type for everyone (idempotent). */
export async function openDemoBalances(ctx: RequestContext, actorId: string): Promise<void> {
  const periodId = await currentPeriodId(ctx);
  const people = (await ctx.sqlite
    .prepare(`SELECT id FROM employee WHERE status != 'exited'`)
    .all()) as { id: string }[];
  await withTx(ctx.sqlite, async () => {
    for (const person of people) await grantOpeningBalances(ctx, person.id, periodId, actorId);
  });
}

async function publishDemoEarnedLeavePolicy(ctx: RequestContext, actorId: string) {
  const el = (await ctx.sqlite.prepare(`SELECT id FROM leave_type WHERE code = 'AL'`).get()) as
    { id: string } | undefined;
  if (!el) return;
  const latest = (await ctx.sqlite
    .prepare(
      `SELECT version_no AS n, rules_json AS rules FROM leave_policy_version WHERE leave_type_id = ? ORDER BY version_no DESC LIMIT 1`,
    )
    .get(el.id)) as { n: number; rules: string } | undefined;
  if (latest && latest.rules.includes('confirmedUnderMonthlyHalfDays')) return;
  const rules = defaultRulesForCode('AL');
  const versionId = newId();
  const period = (await ctx.sqlite
    .prepare(`SELECT starts_on AS "startsOn" FROM leave_period WHERE id = ?`)
    .get(await currentPeriodId(ctx))) as { startsOn: string };
  await ctx.sqlite
    .prepare(
      `INSERT INTO leave_policy_version (id, leave_type_id, version_no, effective_from, rules_json, published_at, published_by, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      versionId,
      el.id,
      (latest?.n ?? 0) + 1,
      period.startsOn,
      JSON.stringify(rules),
      ctx.now,
      actorId,
      ctx.now,
      actorId,
    );
  await ctx.sqlite
    .prepare(
      `INSERT INTO policy_assignment (id, leave_policy_version_id, scope_type, scope_id, priority) VALUES (?, ?, 'company', 'company', 0)`,
    )
    .run(newId(), versionId);
}

// ---------------------------------------------------------------------------------------
// Sample activity: a few requests at every stage, created through the real use-cases
// ---------------------------------------------------------------------------------------

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** The next Monday on or after a date, so sample leave never starts on a weekend. */
function monday(iso: string): string {
  const dow = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return addDays(iso, (8 - dow) % 7);
}

async function actingAs(
  ctx: RequestContext,
  key: string,
  today = ctx.today,
): Promise<RequestContext | null> {
  const user = (await ctx.sqlite
    .prepare(`SELECT id FROM user_account WHERE email = ?`)
    .get(demoEmail(key))) as { id: string } | undefined;
  if (!user) return null;
  const principal = await loadPrincipal(ctx.sqlite, user.id);
  return principal ? { ...ctx, principal, today } : null;
}

async function leaveTypeId(ctx: RequestContext, code: string): Promise<string | null> {
  const row = (await ctx.sqlite.prepare(`SELECT id FROM leave_type WHERE code = ?`).get(code)) as
    { id: string } | undefined;
  return row?.id ?? null;
}

/**
 * Past approved leave, upcoming approved leave, requests waiting for a decision, and one
 * rejection — so dashboards, the approvals inbox and the payroll report are not empty.
 * Every step is optional: a request the policy refuses is simply skipped.
 */
export async function seedDemoActivity(ctx: RequestContext): Promise<void> {
  // Holidays first, so the sample requests are counted around them. HR loads them, as HR
  // would: the fixed-date national holidays, plus the 2026 dates the framework lists.
  const hr = await actingAs(ctx, 'anitha');
  if (hr) {
    const year = Number(ctx.today.slice(0, 4));
    const rows = [
      ...standardHolidays(year),
      ...(year === 2026
        ? [
            { date: '2026-01-15', name: 'Pongal', kind: 'public' as const },
            { date: '2026-01-16', name: 'Thiruvalluvar Day', kind: 'public' as const },
            { date: '2026-01-17', name: 'Uzhavar Thirunal', kind: 'public' as const },
          ]
        : []),
    ];
    await importHolidays(hr, { rows }).catch(() => undefined);
  }
  const period = (await ctx.sqlite
    .prepare(`SELECT starts_on AS "startsOn" FROM leave_period WHERE id = ?`)
    .get(await currentPeriodId(ctx))) as { startsOn: string };
  const plan: {
    who: string;
    approver: string;
    type: string;
    start: string;
    days: number;
    reason: string;
    decision?: 'approve' | 'reject';
    note?: string;
  }[] = [
    {
      who: 'vijay',
      approver: 'john',
      type: 'AL',
      start: monday(addDays(ctx.today, -120)),
      days: 3,
      reason: 'Family function in Madurai',
      decision: 'approve',
    },
    {
      who: 'vijay',
      approver: 'john',
      type: 'AL',
      start: monday(addDays(ctx.today, -45)),
      days: 1,
      reason: 'Bank work',
      decision: 'approve',
    },
    {
      who: 'vijay',
      approver: 'john',
      type: 'AL',
      start: monday(addDays(ctx.today, 14)),
      days: 2,
      reason: 'Travelling home for a wedding',
    },
    {
      who: 'priya',
      approver: 'john',
      type: 'AL',
      start: monday(addDays(ctx.today, 3)),
      days: 1,
      reason: 'Child’s school annual day',
    },
    {
      who: 'ravi',
      approver: 'kumar',
      type: 'AL',
      start: monday(addDays(ctx.today, -60)),
      days: 2,
      reason: 'Fever',
      decision: 'approve',
    },
    {
      who: 'ravi',
      approver: 'kumar',
      type: 'AL',
      start: monday(addDays(ctx.today, 10)),
      days: 3,
      reason: 'Pilgrimage to Tirupati',
    },
    {
      who: 'suresh',
      approver: 'david',
      type: 'AL',
      start: monday(addDays(ctx.today, 5)),
      days: 1,
      reason: 'Personal work',
    },
    {
      who: 'divya',
      approver: 'arun',
      type: 'AL',
      start: monday(addDays(ctx.today, 21)),
      days: 5,
      reason: 'Holiday with family',
      decision: 'reject',
      note: 'The Diwali special issue goes to print that week. Please pick the following week.',
    },
    {
      who: 'sneha',
      approver: 'lakshmi',
      type: 'AL',
      start: monday(addDays(ctx.today, 9)),
      days: 2,
      reason: 'Sister’s engagement',
      decision: 'approve',
    },
    // Higher up the hierarchy: HR's leave goes to the MD, a manager's to HR.
    {
      who: 'anitha',
      approver: 'rajesh',
      type: 'AL',
      start: monday(addDays(ctx.today, 17)),
      days: 2,
      reason: 'Annual health check-up and family visit',
    },
    {
      who: 'david',
      approver: 'anitha',
      type: 'AL',
      start: monday(addDays(ctx.today, 24)),
      days: 3,
      reason: 'Vacation with family',
    },
  ];
  for (const item of plan) {
    try {
      const typeId = await leaveTypeId(ctx, item.type);
      if (!typeId || item.start < period.startsOn) continue;
      // Past leave is applied for ahead of time, as it would have been.
      const appliedOn = item.start < ctx.today ? addDays(item.start, -10) : ctx.today;
      if (appliedOn < period.startsOn) continue;
      const as = await actingAs(ctx, item.who, appliedOn);
      if (!as) continue;
      const { id } = (await submitLeave(as, {
        leaveTypeId: typeId,
        startDate: item.start,
        endDate: addDays(item.start, item.days - 1),
        reason: item.reason,
      })) as { id: string };
      if (!item.decision) continue;
      const approver = await actingAs(ctx, item.approver, appliedOn);
      if (!approver) continue;
      const v = (await ctx.sqlite
        .prepare(`SELECT version FROM leave_request WHERE id = ?`)
        .get(id)) as {
        version: number;
      };
      await decideLeave(approver, {
        requestId: id,
        decision: item.decision,
        expectedVersion: v.version,
        ...(item.decision === 'reject'
          ? { reason: item.note ?? 'Not this time.' }
          : { note: item.note }),
      });
    } catch {
      // A sample request the policy refuses is skipped, never a failed setup.
    }
  }
}
