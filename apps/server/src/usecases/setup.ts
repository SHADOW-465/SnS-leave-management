import { hashPassword } from '@sns/auth';
import { isBootstrapped, seedSystem, withTx } from '@sns/database';
import { DomainError, defaultRulesForCode, newId, periodBounds } from '@sns/domain';
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
  if (!ctx.config.showDemoAccounts) return { password: '', accounts: [] };

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
  const emp = newId();
  await ctx.sqlite
    .prepare(
      `INSERT INTO approval_workflow (id, name, is_active, match_json, priority, created_at, created_by, updated_at, updated_by)
       VALUES (?, 'Employee and manager requests → HR', 1, ?, 10, ?, ?, ?, ?)`,
    )
    .run(
      emp,
      JSON.stringify({ requesterRoles: ['employee', 'manager'] }),
      ctx.now,
      actor,
      ctx.now,
      actor,
    );
  await ctx.sqlite
    .prepare(
      `INSERT INTO approval_workflow_step (id, workflow_id, step_no, approver_kind, approver_ref, is_optional, sla_hours)
       VALUES (?, ?, 1, 'role', 'hr_officer', 0, 48)`,
    )
    .run(newId(), emp);
  const hr = newId();
  await ctx.sqlite
    .prepare(
      `INSERT INTO approval_workflow (id, name, is_active, match_json, priority, created_at, created_by, updated_at, updated_by)
       VALUES (?, 'HR and Admin requests → Admin', 1, ?, 20, ?, ?, ?, ?)`,
    )
    .run(
      hr,
      JSON.stringify({ requesterRoles: ['hr_officer', 'admin'] }),
      ctx.now,
      actor,
      ctx.now,
      actor,
    );
  await ctx.sqlite
    .prepare(
      `INSERT INTO approval_workflow_step (id, workflow_id, step_no, approver_kind, approver_ref, is_optional, sla_hours)
       VALUES (?, ?, 1, 'role', 'admin', 0, 48)`,
    )
    .run(newId(), hr);
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
  // Synthetic sign-in accounts, one per role, so every permission path is testable
  // immediately. They sign in without a forced password change on purpose — the forced
  // change flow belongs to real provisioning (bulkProvision) and to admin reset, and both
  // still set it. Every address is @example.invalid, which is a reserved, undeliverable TLD.
  const demoPassword = await hashPassword(DEMO_PASSWORD);
  const people = [
    {
      code: 'E-1001',
      first: 'Amina',
      last: 'Example',
      email: 'amina@example.invalid',
      role: 'employee' as const,
    },
    {
      code: 'E-1002',
      first: 'Ravi',
      last: 'Example',
      email: 'ravi@example.invalid',
      role: 'manager' as const,
    },
    {
      code: 'E-1003',
      first: 'Helen',
      last: 'Example',
      email: 'helen@example.invalid',
      role: 'hr_officer' as const,
    },
    {
      code: 'E-1004',
      first: 'Paul',
      last: 'Example',
      email: 'paul@example.invalid',
      role: 'payroll_officer' as const,
    },
    {
      code: 'E-1005',
      first: 'Nora',
      last: 'Example',
      email: 'nora@example.invalid',
      role: 'auditor' as const,
    },
  ];
  await withTx(ctx.sqlite, async () => {
    const job = (await ctx.sqlite.prepare(`SELECT id FROM job_title LIMIT 1`).get()) as {
      id: string;
    };
    const type = (await ctx.sqlite
      .prepare(`SELECT id FROM employment_type WHERE code = 'PERM'`)
      .get()) as {
      id: string;
    };
    let managerId: string | null = null;
    for (const p of people) {
      const empId = newId();
      const userId = newId();
      await ctx.sqlite
        .prepare(
          `INSERT INTO employee (id, employee_code, first_name, last_name, work_email, status, joined_on, location_id, department_id, manager_employee_id, job_title_id, employment_type_id, retention_class, created_at, created_by, updated_at, updated_by)
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
          ids.deptId,
          p.role === 'employee' ? managerId : null,
          job.id,
          type.id,
          ctx.now,
          ids.actorId,
          ctx.now,
          ids.actorId,
        );
      if (p.role === 'manager') managerId = empId;
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
  for (const t of types) {
    const rules = defaultRulesForCode(t.code);
    if (rules.entitlementHalfDays <= 0) continue;
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
