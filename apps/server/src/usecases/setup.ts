import { hashPassword } from '@sns/auth';
import { isBootstrapped, seedSystem, withTx } from '@sns/database';
import {
  DomainError,
  defaultRulesForCode,
  monthsInclusive,
  newId,
  parseRules,
  periodBounds,
  planRollover,
  type LeavePolicyRules,
} from '@sns/domain';
import type { RequestContext } from '../ctx.js';
import {
  DEMO_ADMIN,
  DEMO_DOMAIN,
  DEMO_PASSWORD,
  adoptAnnualLeave,
  ensureDemoOrganisation,
  openDemoBalances,
  seedDemoActivity,
} from './demo.js';
import { creditMonth } from '../jobs/balance.js';
export { DEMO_PASSWORD } from './demo.js';

/** Sample accounts live only at these reserved, undeliverable domains. */
const DEMO_DOMAINS = [DEMO_DOMAIN, '@example.invalid'];

export async function setupStatus(ctx: RequestContext) {
  return { needsSetup: !(await isBootstrapped(ctx.sqlite)) };
}

/**
 * Lists the sample sign-ins for the sign-in screen while developing or on the hosted
 * preview. Returns nothing in production, and never an account outside the reserved demo
 * domains — so a real account cannot leak here even if the environment is misconfigured.
 */
export async function demoAccounts(ctx: RequestContext): Promise<{
  password: string;
  accounts: {
    email: string;
    name: string;
    roles: string;
    title: string | null;
    code: string | null;
    department: string | null;
    password?: string;
  }[];
}> {
  if (ctx.config.env === 'production' || !ctx.config.showDemoAccounts)
    return { password: '', accounts: [] };

  const rows = (await ctx.sqlite
    .prepare(
      `SELECT ua.email AS email,
              COALESCE(e.first_name || ' ' || e.last_name, ua.email) AS name,
              j.name AS title, e.employee_code AS code, d.name AS department,
              (SELECT GROUP_CONCAT(r.code, ', ') FROM user_role ur JOIN role r ON r.id = ur.role_id
                WHERE ur.user_account_id = ua.id) AS roles
       FROM user_account ua
       LEFT JOIN employee e ON e.id = ua.employee_id
       LEFT JOIN job_title j ON j.id = e.job_title_id
       LEFT JOIN department d ON d.id = e.department_id
       WHERE ua.is_disabled = 0 AND (ua.email LIKE ? OR ua.email LIKE ?)
       ORDER BY ua.created_at`,
    )
    .all(`%${DEMO_DOMAINS[0]}`, `%${DEMO_DOMAINS[1]}`)) as {
    email: string;
    name: string;
    roles: string | null;
    title: string | null;
    code: string | null;
    department: string | null;
  }[];
  const order = (await ctx.sqlite
    .prepare(`SELECT value_json FROM app_setting WHERE key = 'demo.accounts'`)
    .get()) as { value_json: string } | undefined;
  const rank = new Map<string, number>(
    (order ? (JSON.parse(order.value_json) as string[]) : []).map((e, i) => [e, i]),
  );
  rows.sort((x, y) => (rank.get(x.email) ?? 999) - (rank.get(y.email) ?? 999));

  return {
    password: DEMO_PASSWORD,
    accounts: rows.map((r) => ({
      ...r,
      roles: r.roles ?? 'no role',
      password: r.email.startsWith('admin') ? DEMO_ADMIN.password : DEMO_PASSWORD,
    })),
  };
}

/**
 * Hosted preview only. Brings an already-bootstrapped demo database up to the current
 * sample organisation — renaming the older placeholder people in place, never deleting —
 * once. Cheap on every later cold start.
 */
export async function ensureDemoHierarchy(ctx: RequestContext): Promise<void> {
  if (!(await isBootstrapped(ctx.sqlite))) return;
  const done = await ctx.sqlite
    .prepare(`SELECT key FROM app_setting WHERE key = 'demo.version' AND value_json = '3'`)
    .get();
  if (done) return;
  const hasDemo = await ctx.sqlite
    .prepare(`SELECT id FROM user_account WHERE email LIKE ? OR email LIKE ? LIMIT 1`)
    .get(`%${DEMO_DOMAINS[0]}`, `%${DEMO_DOMAINS[1]}`);
  if (!hasDemo) return;
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
  if (!actor) return;
  // Version 3: the framework's single Annual Leave, and ADMIN/MD → HR → manager → team
  // lead → employee (the MD gets the Managing Director role; managers report to HR).
  await adoptAnnualLeave(ctx, actor.id);
  await ensureDemoOrganisation(ctx, actor.id, { upgradeLegacy: true });
  await openDemoBalances(ctx, actor.id);
  await markDemoVersion(ctx, actor.id);
}

async function markDemoVersion(ctx: RequestContext, actorId: string) {
  await ctx.sqlite.prepare(`DELETE FROM app_setting WHERE key = 'demo.version'`).run();
  await ctx.sqlite
    .prepare(
      `INSERT INTO app_setting (key, value_json, updated_by, updated_at) VALUES ('demo.version', '3', ?, ?)`,
    )
    .run(actorId, ctx.now);
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
    /** Also create sample leave requests at every stage (development and the preview). */
    sampleActivity?: boolean;
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
    await seedLeaveTypes(ctx, adminUserId, period.startsOn);
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
    await ensureDemoOrganisation(ctx, adminUserId);
    await markDemoVersion(ctx, adminUserId);
    if (input.sampleActivity) await seedDemoActivity(ctx);
  }
  return { ok: true };
}
/**
 * The first rules take effect from the start of the current leave year, not the day the
 * app was installed: leave taken earlier in the year is recorded under them too.
 */
async function seedLeaveTypes(ctx: RequestContext, actor: string, effectiveFrom: string) {
  // The Leave Tracker functional framework describes one leave type: Annual Leave, 2 days
  // a month. That is the default. Casual, sick, earned and unpaid leave are templates an
  // administrator can add from Leave types when the company uses them.
  const types = [{ code: 'AL', name: 'Annual Leave', token: 'accent', paid: 1 }];
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
      .run(versionId, typeId, effectiveFrom, JSON.stringify(rules), ctx.now, actor, ctx.now, actor);
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
export async function grantOpeningBalances(
  ctx: RequestContext,
  employeeId: string,
  periodId: string,
  actor: string,
) {
  const types = (await ctx.sqlite
    .prepare(`SELECT id, code FROM leave_type WHERE archived_at IS NULL`)
    .all()) as {
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
    // Recorded before anything is granted, so the leave-year job never opens this year for
    // this person a second time. Without it, everyone set up here was credited twice.
    const opened = await ctx.sqlite
      .prepare(
        `SELECT id FROM period_rollover_run WHERE period_id = ? AND employee_id = ? AND leave_type_id = ?`,
      )
      .get(periodId, employeeId, t.id);
    if (!opened) {
      await ctx.sqlite
        .prepare(
          `INSERT INTO period_rollover_run (id, period_id, employee_id, leave_type_id, ran_at) VALUES (?, ?, ?, ?, ?)`,
        )
        .run(newId(), periodId, employeeId, t.id, ctx.now);
    }
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
    if (opened) continue;
    // Same calculation as the leave-year job, so someone who joins in July gets half a
    // year's entitlement whether they were added mid-year or rolled over.
    const plan = planRollover({
      rules,
      closingBalanceHalfDays: 0,
      joinedOn: employee?.joinedOn ?? ctx.today,
      periodStartsOn: period?.startsOn ?? ctx.today,
      employeeStatus: 'active',
    });
    if (plan.grantHalfDays <= 0) continue;
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
        plan.grantHalfDays,
        period?.startsOn ?? ctx.today,
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
    return parseRules(row.rules_json);
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
    await creditMonth(ctx.sqlite, {
      employeeId: input.employeeId,
      leaveTypeId: input.leaveTypeId,
      periodId: input.periodId,
      month,
      rules: input.rules,
      actor: input.actor,
      now: ctx.now,
      effectiveOn: month === input.joinedOn.slice(0, 7) ? input.joinedOn : `${month}-01`,
    });
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
