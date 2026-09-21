import { hashPassword } from '@sns/auth';
import { isBootstrapped, seedSystem, withTx } from '@sns/database';
import {
  DomainError,
  defaultRulesForCode,
  monthlyAccrualHalfDays,
  monthsInclusive,
  newId,
  periodBounds,
  prorateJoinerHalfDays,
  type LeavePolicyRules,
} from '@sns/domain';
import type { RequestContext } from '../ctx.js';
/** Shared password for the synthetic sample accounts. Development convenience only. */
export const DEMO_PASSWORD = 'ChangeMe_demo_1';
/** Sample accounts are only ever created at these reserved, undeliverable addresses. */
export const DEMO_EMAIL_SUFFIX = '@example.invalid';

export async function setupStatus(ctx: RequestContext) {
  return { needsSetup: !(await isBootstrapped(ctx.sqlite)) };
}

/**
 * Lists the synthetic sample accounts so they can be shown on the sign-in screen while
 * developing. Returns nothing outside development, and never returns an account whose
 * address is not a reserved `@example.invalid` one — so a real account can never leak
 * here even if the environment is misconfigured.
 */
export async function demoAccounts(ctx: RequestContext): Promise<{
  password: string;
  accounts: { email: string; name: string; roles: string; password?: string }[];
}> {
  if (ctx.config.env === 'production' || !ctx.config.showDemoAccounts)
    return { password: '', accounts: [] };

  const rows = (await ctx.sqlite
    .prepare(
      `SELECT ua.email AS email,
              COALESCE(e.first_name || ' ' || e.last_name, ua.email) AS name,
              GROUP_CONCAT(r.code, ', ') AS roles
       FROM user_account ua
       LEFT JOIN employee e ON e.id = ua.employee_id
       LEFT JOIN user_role ur ON ur.user_account_id = ua.id
       LEFT JOIN role r ON r.id = ur.role_id
       WHERE ua.email LIKE '%${DEMO_EMAIL_SUFFIX}' AND ua.is_disabled = 0
       GROUP BY ua.id, ua.email, ua.created_at, e.first_name, e.last_name
       ORDER BY ua.created_at`,
    )
    .all()) as { email: string; name: string; roles: string | null }[];

  const accounts = rows.map((r) => ({
    email: r.email,
    name: r.name,
    roles: r.roles ?? 'no role',
    password: r.email.startsWith('admin') ? 'ChangeMe_admin_1' : DEMO_PASSWORD,
  }));

  return {
    password: DEMO_PASSWORD,
    accounts,
  };
}

/**
 * Hosted preview only. The first Vercel deploy seeded the older sample people (no Sofia,
 * no Engineering org). `seedOnEmpty` will not run again on a bootstrapped database, so
 * this backfills the missing department-head rung and seats the existing sample people
 * into it. Safe to call on every cold start: existing rows are left alone.
 */
export async function ensureDemoHierarchy(ctx: RequestContext): Promise<void> {
  if (!(await isBootstrapped(ctx.sqlite))) return;

  const actor = (await ctx.sqlite
    .prepare(
      `SELECT ua.id AS id FROM user_account ua
         JOIN user_role ur ON ur.user_account_id = ua.id
         JOIN role r ON r.id = ur.role_id
        WHERE r.code = 'admin' AND ua.is_disabled = 0
        ORDER BY ua.created_at
        LIMIT 1`,
    )
    .get()) as { id: string } | undefined;
  const location = (await ctx.sqlite.prepare(`SELECT id FROM location LIMIT 1`).get()) as
    { id: string } | undefined;
  const job = (await ctx.sqlite.prepare(`SELECT id FROM job_title LIMIT 1`).get()) as
    { id: string } | undefined;
  const type = (await ctx.sqlite
    .prepare(`SELECT id FROM employment_type WHERE code = 'PERM'`)
    .get()) as { id: string } | undefined;
  if (!actor || !location || !job || !type) return;

  const periodId = await currentPeriodId(ctx);
  const demoPassword = await hashPassword(DEMO_PASSWORD);

  await withTx(ctx.sqlite, async () => {
    const engineeringId = await ensureNamedDepartment(ctx, actor.id, 'ENG', 'Engineering');
    const platformTeamId = await ensureNamedTeam(ctx, actor.id, engineeringId, 'Platform');
    const supportTeamId = await ensureNamedTeam(ctx, actor.id, engineeringId, 'Customer Support');

    await ensureDemoPerson(ctx, {
      code: 'E-1006',
      first: 'Sofia',
      last: 'Example',
      email: 'sofia@example.invalid',
      role: 'manager',
      departmentId: engineeringId,
      teamId: null,
      locationId: location.id,
      jobId: job.id,
      typeId: type.id,
      periodId,
      actorId: actor.id,
      passwordHash: demoPassword,
    });

    await placeDemoEmployee(ctx, 'amina@example.invalid', engineeringId, platformTeamId);
    await placeDemoEmployee(ctx, 'ravi@example.invalid', engineeringId, platformTeamId);
    await placeDemoEmployee(ctx, 'paul@example.invalid', engineeringId, supportTeamId);

    const raviId = await employeeIdForEmail(ctx, 'ravi@example.invalid');
    const sofiaId = await employeeIdForEmail(ctx, 'sofia@example.invalid');
    if (raviId) {
      const lead = (await ctx.sqlite
        .prepare(`SELECT lead_employee_id AS id FROM team WHERE id = ?`)
        .get(platformTeamId)) as { id: string | null };
      if (!lead.id) {
        await ctx.sqlite
          .prepare(`UPDATE team SET lead_employee_id = ?, updated_at = ? WHERE id = ?`)
          .run(raviId, ctx.now, platformTeamId);
      }
    }
    if (sofiaId) {
      const head = (await ctx.sqlite
        .prepare(`SELECT head_employee_id AS id FROM department WHERE id = ?`)
        .get(engineeringId)) as { id: string | null };
      if (!head.id) {
        await ctx.sqlite
          .prepare(`UPDATE department SET head_employee_id = ?, updated_at = ? WHERE id = ?`)
          .run(sofiaId, ctx.now, engineeringId);
      }
    }

    const teamLeadStep = (await ctx.sqlite
      .prepare(`SELECT id FROM approval_workflow_step WHERE approver_kind = 'team_lead' LIMIT 1`)
      .get()) as { id: string } | undefined;
    if (!teamLeadStep) {
      await ctx.sqlite
        .prepare(`UPDATE approval_workflow SET is_active = 0, updated_at = ? WHERE is_active = 1`)
        .run(ctx.now);
      await seedWorkflows(ctx, actor.id);
    }

    const emails = (
      (await ctx.sqlite
        .prepare(
          `SELECT email FROM user_account
            WHERE email LIKE '%${DEMO_EMAIL_SUFFIX}' AND is_disabled = 0
            ORDER BY created_at`,
        )
        .all()) as { email: string }[]
    ).map((r) => r.email);
    const setting = (await ctx.sqlite
      .prepare(`SELECT key FROM app_setting WHERE key = 'demo.accounts'`)
      .get()) as { key: string } | undefined;
    const payload = JSON.stringify(emails);
    if (setting) {
      await ctx.sqlite
        .prepare(
          `UPDATE app_setting SET value_json = ?, updated_by = ?, updated_at = ? WHERE key = 'demo.accounts'`,
        )
        .run(payload, actor.id, ctx.now);
    } else {
      await ctx.sqlite
        .prepare(
          `INSERT INTO app_setting (key, value_json, updated_by, updated_at) VALUES ('demo.accounts', ?, ?, ?)`,
        )
        .run(payload, actor.id, ctx.now);
    }
  });
}

export async function completeSetup(
  ctx: RequestContext,
  input: {
    companyName: string;
    timezone: string;
    leaveYearStartMonth: number;
    leaveYearStartDay: number;
    adminName: string;
    adminEmail: string;
    adminPassword: string;
    loadSampleData: boolean;
  },
) {
  if (await isBootstrapped(ctx.sqlite)) {
    throw new DomainError('SETUP_DONE', 'This installation already has an administrator.');
  }
  const passwordHash = await hashPassword(input.adminPassword);
  const adminUserId = newId();
  const adminEmployeeId = newId();
  const locationId = newId();
  const deptId = newId();
  const teamId = newId();
  const jobId = newId();
  const typeId = newId();
  const calendarId = newId();
  const period = periodBounds(ctx.today, {
    startMonth: input.leaveYearStartMonth,
    startDay: input.leaveYearStartDay,
  });
  const periodId = newId();
  await withTx(ctx.sqlite, async () => {
    await seedSystem(ctx.sqlite, adminUserId);
    await ctx.sqlite
      .prepare(
        `INSERT INTO company (id, name, timezone, leave_year_start_month, leave_year_start_day, created_at, created_by, updated_at, updated_by)
         VALUES ('company', ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.companyName,
        input.timezone,
        input.leaveYearStartMonth,
        input.leaveYearStartDay,
        ctx.now,
        adminUserId,
        ctx.now,
        adminUserId,
      );
    await ctx.sqlite
      .prepare(
        `INSERT INTO holiday_calendar (id, name, year, created_at, created_by, updated_at, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        calendarId,
        `${period.label} HQ calendar`,
        Number(period.startsOn.slice(0, 4)),
        ctx.now,
        adminUserId,
        ctx.now,
        adminUserId,
      );
    await ctx.sqlite
      .prepare(
        `INSERT INTO location (id, name, code, timezone, holiday_calendar_id, created_at, created_by, updated_at, updated_by)
         VALUES (?, 'Headquarters', 'HQ', ?, ?, ?, ?, ?, ?)`,
      )
      .run(locationId, input.timezone, calendarId, ctx.now, adminUserId, ctx.now, adminUserId);
    await ctx.sqlite
      .prepare(
        `INSERT INTO department (id, name, code, created_at, created_by, updated_at, updated_by)
         VALUES (?, 'General', 'GEN', ?, ?, ?, ?)`,
      )
      .run(deptId, ctx.now, adminUserId, ctx.now, adminUserId);
    await ctx.sqlite
      .prepare(
        `INSERT INTO team (id, department_id, name, created_at, created_by, updated_at, updated_by)
         VALUES (?, ?, 'Default', ?, ?, ?, ?)`,
      )
      .run(teamId, deptId, ctx.now, adminUserId, ctx.now, adminUserId);
    await ctx.sqlite
      .prepare(
        `INSERT INTO job_title (id, name, created_at, created_by, updated_at, updated_by)
         VALUES (?, 'Staff', ?, ?, ?, ?)`,
      )
      .run(jobId, ctx.now, adminUserId, ctx.now, adminUserId);
    await ctx.sqlite
      .prepare(
        `INSERT INTO employment_type (id, name, code, is_leave_eligible, created_at, created_by, updated_at, updated_by)
         VALUES (?, 'Permanent', 'PERM', 1, ?, ?, ?, ?)`,
      )
      .run(typeId, ctx.now, adminUserId, ctx.now, adminUserId);
    for (const t of [
      { code: 'PROB', name: 'Probation', eligible: 1 },
      { code: 'CONT', name: 'Contract', eligible: 1 },
      { code: 'INT', name: 'Intern', eligible: 1 },
    ]) {
      await ctx.sqlite
        .prepare(
          `INSERT INTO employment_type (id, name, code, is_leave_eligible, created_at, created_by, updated_at, updated_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(newId(), t.name, t.code, t.eligible, ctx.now, adminUserId, ctx.now, adminUserId);
    }
    const names = input.adminName.trim().split(/\s+/);
    const first = names[0] ?? 'Admin';
    const last = names.slice(1).join(' ') || 'User';
    await ctx.sqlite
      .prepare(
        `INSERT INTO employee (id, employee_code, first_name, last_name, work_email, status, joined_on, location_id, department_id, team_id, job_title_id, employment_type_id, retention_class, created_at, created_by, updated_at, updated_by)
         VALUES (?, 'ADM-0001', ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, 'standard', ?, ?, ?, ?)`,
      )
      .run(
        adminEmployeeId,
        first,
        last,
        input.adminEmail,
        ctx.today,
        locationId,
        deptId,
        teamId,
        jobId,
        typeId,
        ctx.now,
        adminUserId,
        ctx.now,
        adminUserId,
      );
    await ctx.sqlite
      .prepare(
        `INSERT INTO user_account (id, employee_id, email, password_hash, password_algo, must_change_password, is_disabled, created_at, created_by, updated_at, updated_by)
         VALUES (?, ?, ?, ?, 'argon2id', 0, 0, ?, ?, ?, ?)`,
      )
      .run(
        adminUserId,
        adminEmployeeId,
        input.adminEmail,
        passwordHash,
        ctx.now,
        adminUserId,
        ctx.now,
        adminUserId,
      );
    const adminRole = (await ctx.sqlite
      .prepare(`SELECT id FROM role WHERE code = 'admin'`)
      .get()) as {
      id: string;
    };
    await ctx.sqlite
      .prepare(
        `INSERT INTO user_role (user_account_id, role_id, granted_by, granted_at) VALUES (?, ?, ?, ?)`,
      )
      .run(adminUserId, adminRole.id, adminUserId, ctx.now);
    await ctx.sqlite
      .prepare(`INSERT INTO leave_period (id, label, starts_on, ends_on) VALUES (?, ?, ?, ?)`)
      .run(periodId, period.label, period.startsOn, period.endsOn);
    // These must complete before balances are granted: grantOpeningBalances reads
    // leave_type, and un-awaited calls here left the administrator with only whichever
    // types happened to be inserted first.
    await seedLeaveTypes(ctx, adminUserId);
    await seedWorkflows(ctx, adminUserId);
    await grantOpeningBalances(ctx, adminEmployeeId, periodId, adminUserId);
    await ctx.sqlite
      .prepare(
        `INSERT INTO audit_event (id, occurred_at, actor_user_id, actor_label, action, entity_type, entity_id, request_id, result)
         VALUES (?, ?, ?, ?, 'system.setup.completed', 'company', 'company', ?, 'ok')`,
      )
      .run(newId(), ctx.now, adminUserId, input.adminEmail, ctx.requestId);
  });
  if (input.loadSampleData) {
    await seedDemoPeople(ctx, { locationId, deptId, calendarId, periodId, actorId: adminUserId });
  }
  return { ok: true };
}
async function seedLeaveTypes(ctx: RequestContext, actor: string) {
  const types = [
    { code: 'CL', name: 'Casual leave', token: 'accent', paid: 1 },
    { code: 'SL', name: 'Sick leave', token: 'status-pending', paid: 1 },
    { code: 'EL', name: 'Earned leave', token: 'status-approved', paid: 1 },
    { code: 'LOP', name: 'Loss of pay', token: 'status-neutral', paid: 0 },
  ];
  for (const t of types) {
    const typeId = newId();
    await ctx.sqlite
      .prepare(
        `INSERT INTO leave_type (id, code, name, colour_token, is_paid, created_at, created_by, updated_at, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(typeId, t.code, t.name, t.token, t.paid, ctx.now, actor, ctx.now, actor);
    const rules = defaultRulesForCode(t.code);
    const versionId = newId();
    await ctx.sqlite
      .prepare(
        `INSERT INTO leave_policy_version (id, leave_type_id, version_no, effective_from, rules_json, published_at, published_by, created_at, created_by)
         VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?)`,
      )
      .run(versionId, typeId, ctx.today, JSON.stringify(rules), ctx.now, actor, ctx.now, actor);
    await ctx.sqlite
      .prepare(
        `INSERT INTO policy_assignment (id, leave_policy_version_id, scope_type, scope_id, priority)
         VALUES (?, ?, 'company', 'company', 0)`,
      )
      .run(newId(), versionId);
  }
}
async function seedWorkflows(ctx: RequestContext, actor: string) {
  // One workflow per rung of the hierarchy. The engine walks the ladder in
  // packages/domain/src/leave/routing.ts; these rows describe it for the UI and make
  // the chain visible and editable rather than hidden in code.
  const chains: { name: string; kinds: string[]; steps: [string, string | null][] }[] = [
    {
      name: 'Team member → team lead',
      kinds: ['employee'],
      steps: [
        ['team_lead', null],
        ['department_head', null],
        ['role', 'hr_officer'],
      ],
    },
    {
      name: 'Team lead → department head',
      kinds: ['team_lead'],
      steps: [
        ['department_head', null],
        ['role', 'hr_officer'],
      ],
    },
    {
      name: 'Department head → HR',
      kinds: ['department_head'],
      steps: [['role', 'hr_officer']],
    },
    {
      name: 'HR and administrator requests → administrator',
      kinds: ['hr_officer', 'admin'],
      steps: [['role', 'admin']],
    },
  ];

  let priority = 10;
  for (const chain of chains) {
    const id = newId();
    await ctx.sqlite
      .prepare(
        `INSERT INTO approval_workflow (id, name, is_active, match_json, priority, created_at, created_by, updated_at, updated_by)
         VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        chain.name,
        JSON.stringify({ requesterRoles: chain.kinds }),
        priority,
        ctx.now,
        actor,
        ctx.now,
        actor,
      );
    let stepNo = 1;
    for (const [kind, ref] of chain.steps) {
      await ctx.sqlite
        .prepare(
          `INSERT INTO approval_workflow_step (id, workflow_id, step_no, approver_kind, approver_ref, is_optional, sla_hours)
           VALUES (?, ?, ?, ?, ?, 0, 48)`,
        )
        .run(newId(), id, stepNo, kind, ref);
      stepNo += 1;
    }
    priority += 10;
  }
}
async function seedDemoPeople(
  ctx: RequestContext,
  ids: {
    locationId: string;
    deptId: string;
    calendarId: string;
    periodId: string;
    actorId: string;
  },
) {
  const { hashPassword } = await import('@sns/auth');
  // Synthetic sign-in accounts covering every rung of the approval hierarchy, so the
  // chain is visible the moment someone opens the app rather than something you have to
  // construct by hand. They sign in without a forced password change on purpose: the
  // forced change belongs to real provisioning and to admin reset, and both still set it.
  // Every address is @example.invalid, a reserved, undeliverable TLD.
  const demoPassword = await hashPassword(DEMO_PASSWORD);

  await withTx(ctx.sqlite, async () => {
    const job = (await ctx.sqlite.prepare(`SELECT id FROM job_title LIMIT 1`).get()) as {
      id: string;
    };
    const type = (await ctx.sqlite
      .prepare(`SELECT id FROM employment_type WHERE code = 'PERM'`)
      .get()) as { id: string };

    // A small but complete organisation: one department with two teams, each with a
    // lead, and a department head above them.
    const engineeringId = newId();
    await ctx.sqlite
      .prepare(
        `INSERT INTO department (id, name, code, created_at, created_by, updated_at, updated_by)
         VALUES (?, 'Engineering', 'ENG', ?, ?, ?, ?)`,
      )
      .run(engineeringId, ctx.now, ids.actorId, ctx.now, ids.actorId);

    const platformTeamId = newId();
    const supportTeamId = newId();
    const teams: [string, string][] = [
      [platformTeamId, 'Platform'],
      [supportTeamId, 'Customer Support'],
    ];
    for (const [id, name] of teams) {
      await ctx.sqlite
        .prepare(
          `INSERT INTO team (id, department_id, name, created_at, created_by, updated_at, updated_by)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(id, engineeringId, name, ctx.now, ids.actorId, ctx.now, ids.actorId);
    }

    type Person = {
      code: string;
      first: string;
      last: string;
      email: string;
      role: 'employee' | 'manager' | 'hr_officer' | 'payroll_officer' | 'auditor';
      teamId: string | null;
      leadsTeamId?: string;
      headsDepartment?: boolean;
    };

    const people: Person[] = [
      {
        code: 'E-1001',
        first: 'Amina',
        last: 'Example',
        email: 'amina@example.invalid',
        role: 'employee',
        teamId: platformTeamId,
      },
      {
        code: 'E-1002',
        first: 'Ravi',
        last: 'Example',
        email: 'ravi@example.invalid',
        role: 'manager',
        teamId: platformTeamId,
        leadsTeamId: platformTeamId,
      },
      {
        code: 'E-1006',
        first: 'Sofia',
        last: 'Example',
        email: 'sofia@example.invalid',
        role: 'manager',
        teamId: null,
        headsDepartment: true,
      },
      {
        code: 'E-1003',
        first: 'Helen',
        last: 'Example',
        email: 'helen@example.invalid',
        role: 'hr_officer',
        teamId: null,
      },
      {
        code: 'E-1004',
        first: 'Paul',
        last: 'Example',
        email: 'paul@example.invalid',
        role: 'payroll_officer',
        teamId: supportTeamId,
      },
      {
        code: 'E-1005',
        first: 'Nora',
        last: 'Example',
        email: 'nora@example.invalid',
        role: 'auditor',
        teamId: null,
      },
    ];

    const employeeIdByEmail = new Map<string, string>();
    for (const p of people) {
      const empId = newId();
      const userId = newId();
      employeeIdByEmail.set(p.email, empId);
      // People in a team sit in Engineering; HR, payroll and audit stay in the default
      // department so their chain escalates upward rather than looping back to itself.
      const departmentId = p.teamId || p.headsDepartment ? engineeringId : ids.deptId;
      await ctx.sqlite
        .prepare(
          `INSERT INTO employee (id, employee_code, first_name, last_name, work_email, status, joined_on, location_id, department_id, team_id, job_title_id, employment_type_id, retention_class, created_at, created_by, updated_at, updated_by)
           VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, 'standard', ?, ?, ?, ?)`,
        )
        .run(
          empId,
          p.code,
          p.first,
          p.last,
          p.email,
          '2024-01-15',
          ids.locationId,
          departmentId,
          p.teamId,
          job.id,
          type.id,
          ctx.now,
          ids.actorId,
          ctx.now,
          ids.actorId,
        );
      await ctx.sqlite
        .prepare(
          `INSERT INTO user_account (id, employee_id, email, password_hash, password_algo, must_change_password, is_disabled, created_at, created_by, updated_at, updated_by)
           VALUES (?, ?, ?, ?, 'argon2id', 0, 0, ?, ?, ?, ?)`,
        )
        .run(userId, empId, p.email, demoPassword, ctx.now, ids.actorId, ctx.now, ids.actorId);
      const role = (await ctx.sqlite.prepare(`SELECT id FROM role WHERE code = ?`).get(p.role)) as {
        id: string;
      };
      await ctx.sqlite
        .prepare(
          `INSERT INTO user_role (user_account_id, role_id, granted_by, granted_at) VALUES (?, ?, ?, ?)`,
        )
        .run(userId, role.id, ids.actorId, ctx.now);
      await grantOpeningBalances(ctx, empId, ids.periodId, ids.actorId);
    }

    // Appoint the leadership now that everyone exists.
    for (const p of people) {
      const empId = employeeIdByEmail.get(p.email);
      if (!empId) continue;
      if (p.leadsTeamId) {
        await ctx.sqlite
          .prepare(`UPDATE team SET lead_employee_id = ?, updated_at = ? WHERE id = ?`)
          .run(empId, ctx.now, p.leadsTeamId);
      }
      if (p.headsDepartment) {
        await ctx.sqlite
          .prepare(`UPDATE department SET head_employee_id = ?, updated_at = ? WHERE id = ?`)
          .run(empId, ctx.now, engineeringId);
      }
    }

    // Recorded so the sign-in screen can list exactly these accounts in development,
    // rather than guessing from the address.
    await ctx.sqlite
      .prepare(
        `INSERT INTO app_setting (key, value_json, updated_by, updated_at)
         VALUES ('demo.accounts', ?, ?, ?)`,
      )
      .run(JSON.stringify(people.map((p) => p.email)), ids.actorId, ctx.now);
  });
}

async function ensureNamedDepartment(
  ctx: RequestContext,
  actorId: string,
  code: string,
  name: string,
): Promise<string> {
  const existing = (await ctx.sqlite
    .prepare(`SELECT id FROM department WHERE code = ? AND archived_at IS NULL`)
    .get(code)) as { id: string } | undefined;
  if (existing) return existing.id;
  const id = newId();
  await ctx.sqlite
    .prepare(
      `INSERT INTO department (id, name, code, created_at, created_by, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, name, code, ctx.now, actorId, ctx.now, actorId);
  return id;
}

async function ensureNamedTeam(
  ctx: RequestContext,
  actorId: string,
  departmentId: string,
  name: string,
): Promise<string> {
  const existing = (await ctx.sqlite
    .prepare(`SELECT id FROM team WHERE department_id = ? AND name = ? AND archived_at IS NULL`)
    .get(departmentId, name)) as { id: string } | undefined;
  if (existing) return existing.id;
  const id = newId();
  await ctx.sqlite
    .prepare(
      `INSERT INTO team (id, department_id, name, created_at, created_by, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, departmentId, name, ctx.now, actorId, ctx.now, actorId);
  return id;
}

async function employeeIdForEmail(ctx: RequestContext, email: string): Promise<string | null> {
  const row = (await ctx.sqlite
    .prepare(`SELECT employee_id AS id FROM user_account WHERE email = ?`)
    .get(email)) as { id: string | null } | undefined;
  return row?.id ?? null;
}

async function placeDemoEmployee(
  ctx: RequestContext,
  email: string,
  departmentId: string,
  teamId: string,
): Promise<void> {
  const emp = (await ctx.sqlite
    .prepare(
      `SELECT e.id AS id, e.team_id AS teamId, t.name AS teamName
         FROM employee e
         JOIN user_account ua ON ua.employee_id = e.id
         LEFT JOIN team t ON t.id = e.team_id
        WHERE ua.email = ?`,
    )
    .get(email)) as { id: string; teamId: string | null; teamName: string | null } | undefined;
  if (!emp) return;
  if (emp.teamId && emp.teamName !== 'Default') return;
  await ctx.sqlite
    .prepare(`UPDATE employee SET department_id = ?, team_id = ?, updated_at = ? WHERE id = ?`)
    .run(departmentId, teamId, ctx.now, emp.id);
}

async function ensureDemoPerson(
  ctx: RequestContext,
  input: {
    code: string;
    first: string;
    last: string;
    email: string;
    role: string;
    departmentId: string;
    teamId: string | null;
    locationId: string;
    jobId: string;
    typeId: string;
    periodId: string;
    actorId: string;
    passwordHash: string;
  },
): Promise<void> {
  if (await employeeIdForEmail(ctx, input.email)) return;
  const taken = (await ctx.sqlite
    .prepare(`SELECT id FROM employee WHERE employee_code = ?`)
    .get(input.code)) as { id: string } | undefined;
  const code = taken ? `E-${newId().slice(-4)}` : input.code;
  const empId = newId();
  const userId = newId();
  await ctx.sqlite
    .prepare(
      `INSERT INTO employee (id, employee_code, first_name, last_name, work_email, status, joined_on, location_id, department_id, team_id, job_title_id, employment_type_id, retention_class, created_at, created_by, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, 'standard', ?, ?, ?, ?)`,
    )
    .run(
      empId,
      code,
      input.first,
      input.last,
      input.email,
      '2024-01-15',
      input.locationId,
      input.departmentId,
      input.teamId,
      input.jobId,
      input.typeId,
      ctx.now,
      input.actorId,
      ctx.now,
      input.actorId,
    );
  await ctx.sqlite
    .prepare(
      `INSERT INTO user_account (id, employee_id, email, password_hash, password_algo, must_change_password, is_disabled, created_at, created_by, updated_at, updated_by)
       VALUES (?, ?, ?, ?, 'argon2id', 0, 0, ?, ?, ?, ?)`,
    )
    .run(
      userId,
      empId,
      input.email,
      input.passwordHash,
      ctx.now,
      input.actorId,
      ctx.now,
      input.actorId,
    );
  const role = (await ctx.sqlite.prepare(`SELECT id FROM role WHERE code = ?`).get(input.role)) as {
    id: string;
  };
  await ctx.sqlite
    .prepare(
      `INSERT INTO user_role (user_account_id, role_id, granted_by, granted_at) VALUES (?, ?, ?, ?)`,
    )
    .run(userId, role.id, input.actorId, ctx.now);
  await grantOpeningBalances(ctx, empId, input.periodId, input.actorId);
}

export async function grantOpeningBalances(
  ctx: RequestContext,
  employeeId: string,
  periodId: string,
  actor: string,
) {
  const types = (await ctx.sqlite.prepare(`SELECT id, code FROM leave_type`).all()) as {
    id: string;
    code: string;
  }[];
  const period = (await ctx.sqlite
    .prepare(`SELECT starts_on AS startsOn, ends_on AS endsOn FROM leave_period WHERE id = ?`)
    .get(periodId)) as { startsOn: string; endsOn: string } | undefined;
  const employee = (await ctx.sqlite
    .prepare(`SELECT joined_on AS joinedOn FROM employee WHERE id = ?`)
    .get(employeeId)) as { joinedOn: string } | undefined;
  for (const t of types) {
    const rules = (await publishedRules(ctx, t.id)) ?? defaultRulesForCode(t.code);
    if (rules.entitlementHalfDays <= 0) continue;
    if (rules.accrualMethod === 'monthly') {
      await grantMonthlyCatchUp(ctx, {
        employeeId,
        leaveTypeId: t.id,
        periodId,
        actor,
        rules,
        joinedOn: employee?.joinedOn ?? ctx.today,
        periodStart: period?.startsOn ?? ctx.today,
        periodEnd: period?.endsOn ?? ctx.today,
      });
      continue;
    }
    await ctx.sqlite
      .prepare(
        `INSERT INTO balance_ledger (id, employee_id, leave_type_id, period_id, entry_type, quantity_half_days, effective_on, source_type, reason, created_by, created_at)
         VALUES (?, ?, ?, ?, 'ENTITLEMENT_GRANT', ?, ?, 'job_run', 'Opening entitlement for the current leave year', ?, ?)`,
      )
      .run(
        newId(),
        employeeId,
        t.id,
        periodId,
        rules.entitlementHalfDays,
        ctx.today,
        actor,
        ctx.now,
      );
  }
}

async function publishedRules(
  ctx: RequestContext,
  leaveTypeId: string,
): Promise<LeavePolicyRules | null> {
  const row = (await ctx.sqlite
    .prepare(
      `SELECT rules_json FROM leave_policy_version
        WHERE leave_type_id = ? AND published_at IS NOT NULL AND effective_from <= ?
        ORDER BY version_no DESC LIMIT 1`,
    )
    .get(leaveTypeId, ctx.today)) as { rules_json: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.rules_json) as LeavePolicyRules;
  } catch {
    return null;
  }
}

/**
 * Credits every elapsed month in the current leave year so a mid-year joiner (or a
 * first-run seed) does not wait until the next 1st of the month to have a balance.
 * Writes `accrual_run` so the monthly job cannot double-credit those months.
 */
async function grantMonthlyCatchUp(
  ctx: RequestContext,
  input: {
    employeeId: string;
    leaveTypeId: string;
    periodId: string;
    actor: string;
    rules: LeavePolicyRules;
    joinedOn: string;
    periodStart: string;
    periodEnd: string;
  },
) {
  const from = input.joinedOn > input.periodStart ? input.joinedOn : input.periodStart;
  const to = ctx.today < input.periodEnd ? ctx.today : input.periodEnd;
  if (from > to) return;
  for (const month of monthsInclusive(from, to)) {
    const already = (await ctx.sqlite
      .prepare(
        `SELECT id FROM accrual_run
          WHERE employee_id = ? AND leave_type_id = ? AND accrual_month = ?`,
      )
      .get(input.employeeId, input.leaveTypeId, month)) as { id: string } | undefined;
    if (already) continue;
    const quantity =
      month === input.joinedOn.slice(0, 7)
        ? prorateJoinerHalfDays({
            entitlementHalfDays: input.rules.entitlementHalfDays,
            joinedOn: input.joinedOn,
            monthIso: month,
          })
        : monthlyAccrualHalfDays(input.rules.entitlementHalfDays);
    const effectiveOn = `${month}-01`;
    if (quantity > 0) {
      await ctx.sqlite
        .prepare(
          `INSERT INTO balance_ledger (id, employee_id, leave_type_id, period_id, entry_type, quantity_half_days, effective_on, source_type, reason, created_by, created_at)
           VALUES (?, ?, ?, ?, 'ACCRUAL', ?, ?, 'job_run', ?, ?, ?)`,
        )
        .run(
          newId(),
          input.employeeId,
          input.leaveTypeId,
          input.periodId,
          quantity,
          effectiveOn,
          `Monthly accrual for ${month}`,
          input.actor,
          ctx.now,
        );
    }
    await ctx.sqlite
      .prepare(
        `INSERT INTO accrual_run (id, period_id, employee_id, leave_type_id, accrual_month, ran_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(newId(), input.periodId, input.employeeId, input.leaveTypeId, month, ctx.now);
  }
}
export async function currentPeriodId(ctx: RequestContext): Promise<string> {
  const company = (await ctx.sqlite
    .prepare(
      `SELECT leave_year_start_month AS m, leave_year_start_day AS d FROM company WHERE id = 'company'`,
    )
    .get()) as {
    m: number;
    d: number;
  };
  const bounds = periodBounds(ctx.today, { startMonth: company.m, startDay: company.d });
  const existing = (await ctx.sqlite
    .prepare(`SELECT id FROM leave_period WHERE starts_on = ? AND ends_on = ?`)
    .get(bounds.startsOn, bounds.endsOn)) as
    | {
        id: string;
      }
    | undefined;
  if (existing) return existing.id;
  const id = newId();
  await ctx.sqlite
    .prepare(`INSERT INTO leave_period (id, label, starts_on, ends_on) VALUES (?, ?, ?, ?)`)
    .run(id, bounds.label, bounds.startsOn, bounds.endsOn);
  return id;
}
