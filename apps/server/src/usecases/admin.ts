/**
 * Administrator controls: who approves whom, and who can do what.
 *
 * Everything here needs a permission only the administrator role holds —
 * `approval.routing.manage` for the approval chain, `role.assign`, `user.account.disable`
 * and `user.session.revoke` for accounts. HR keeps day-to-day people and structure work;
 * deciding the approval hierarchy is the administrator's.
 */
import { withTx } from '@sns/database';
import {
  DomainError,
  ROLE_CODES,
  describeApprover,
  describeEscalation,
  newId,
  type RoleCode,
} from '@sns/domain';
import { authorizeAction, requirePrincipal, type RequestContext } from '../ctx.js';
import { audit, notify, requesterKindOf, resolveApprover } from './leave.js';

type EmployeeRow = {
  id: string;
  first_name: string;
  last_name: string;
  employee_code: string;
  status: string;
  team_id: string | null;
  team_name: string | null;
  department_id: string;
  department_name: string;
  user_id: string | null;
};

async function activeEmployee(
  ctx: RequestContext,
  employeeId: string,
  what: string,
): Promise<{ id: string; name: string; userId: string | null }> {
  const row = (await ctx.sqlite
    .prepare(
      `SELECT e.id, e.first_name || ' ' || e.last_name AS name, e.status, ua.id AS "userId",
              ua.is_disabled AS "isDisabled"
         FROM employee e LEFT JOIN user_account ua ON ua.employee_id = e.id
        WHERE e.id = ?`,
    )
    .get(employeeId)) as
    | { id: string; name: string; status: string; userId: string | null; isDisabled: number | null }
    | undefined;
  if (!row) throw new DomainError('NOT_FOUND', `${what} not found.`, { httpStatus: 404 });
  if (row.status === 'exited') {
    throw new DomainError('INACTIVE', `${row.name} has left the company and cannot approve.`, {
      httpStatus: 409,
    });
  }
  return { id: row.id, name: row.name, userId: row.userId };
}

async function requireSignInAccount(
  ctx: RequestContext,
  employeeId: string,
  what: string,
): Promise<{ id: string; name: string; userId: string }> {
  const e = await activeEmployee(ctx, employeeId, what);
  if (!e.userId) {
    throw new DomainError(
      'NO_ACCOUNT',
      `${e.name} has no sign-in account, so they could never see a request sent to them. Create one on the Employees page first.`,
      { httpStatus: 409 },
    );
  }
  return { ...e, userId: e.userId };
}

// ---------------------------------------------------------------------------------------
// The approval map
// ---------------------------------------------------------------------------------------

/**
 * Every active person, and exactly who their leave would go to today — resolved by the
 * same code that routes a real request, so the screen can never disagree with reality.
 */
export async function approvalMap(ctx: RequestContext) {
  requirePrincipal(ctx);
  await authorizeAction(ctx, 'approval.routing.manage', null);

  const people = (await ctx.sqlite
    .prepare(
      `SELECT e.id, e.first_name, e.last_name, e.employee_code, e.status, e.team_id,
              t.name AS team_name, e.department_id, d.name AS department_name, ua.id AS user_id
         FROM employee e
         JOIN department d ON d.id = e.department_id
         LEFT JOIN team t ON t.id = e.team_id
         LEFT JOIN user_account ua ON ua.employee_id = e.id
        WHERE e.status != 'exited'
        ORDER BY d.name, t.name, e.first_name, e.last_name`,
    )
    .all()) as EmployeeRow[];

  const overrides = (await ctx.sqlite
    .prepare(
      `SELECT o.employee_id, o.approver_employee_id, o.note,
              a.first_name || ' ' || a.last_name AS approver_name
         FROM approval_override o JOIN employee a ON a.id = o.approver_employee_id`,
    )
    .all()) as {
    employee_id: string;
    approver_employee_id: string;
    note: string | null;
    approver_name: string;
  }[];
  const overrideFor = new Map(overrides.map((o) => [o.employee_id, o]));

  const nameOf = new Map(people.map((p) => [p.id, `${p.first_name} ${p.last_name}`]));

  const rows = [];
  for (const person of people) {
    const base = {
      employeeId: person.id,
      name: `${person.first_name} ${person.last_name}`,
      code: person.employee_code,
      teamId: person.team_id,
      teamName: person.team_name,
      departmentId: person.department_id,
      departmentName: person.department_name,
      hasAccount: Boolean(person.user_id),
      override: overrideFor.get(person.id)
        ? {
            approverEmployeeId: overrideFor.get(person.id)!.approver_employee_id,
            approverName: overrideFor.get(person.id)!.approver_name,
            note: overrideFor.get(person.id)!.note,
          }
        : null,
    };
    if (!person.user_id) {
      rows.push({ ...base, position: 'Member', route: null, problem: 'No sign-in account' });
      continue;
    }
    const kind = await requesterKindOf(ctx, person.id);
    try {
      const r = await resolveApprover(ctx, person.id, person.user_id, kind);
      const role = describeApprover(r.approverKind, r.approverRole);
      rows.push({
        ...base,
        position: positionLabel(kind),
        route: {
          approverEmployeeId: r.approverEmployeeId,
          approverName: r.selfApproved
            ? 'Themselves'
            : (r.approverEmployeeId && nameOf.get(r.approverEmployeeId)) || role,
          approverRole: role,
          escalation: r.escalation ? describeEscalation(r.escalation) : null,
          coveringFor:
            r.delegatedFromEmployeeId && nameOf.get(r.delegatedFromEmployeeId)
              ? nameOf.get(r.delegatedFromEmployeeId)!
              : null,
          selfApproved: r.selfApproved,
        },
        problem: null,
      });
    } catch (err) {
      rows.push({
        ...base,
        position: positionLabel(kind),
        route: null,
        problem: err instanceof Error ? err.message : 'Cannot be routed',
      });
    }
  }

  const teams = (await ctx.sqlite
    .prepare(
      `SELECT t.id, t.name, t.department_id AS "departmentId", d.name AS "departmentName",
              t.lead_employee_id AS "leadEmployeeId",
              l.first_name || ' ' || l.last_name AS "leadName",
              (SELECT COUNT(*) FROM employee m WHERE m.team_id = t.id AND m.status != 'exited') AS "memberCount"
         FROM team t
         JOIN department d ON d.id = t.department_id
         LEFT JOIN employee l ON l.id = t.lead_employee_id
        WHERE t.archived_at IS NULL
        ORDER BY d.name, t.name`,
    )
    .all()) as {
    id: string;
    name: string;
    departmentId: string;
    departmentName: string;
    leadEmployeeId: string | null;
    leadName: string | null;
    memberCount: number;
  }[];

  const departments = (await ctx.sqlite
    .prepare(
      `SELECT d.id, d.name, d.head_employee_id AS "headEmployeeId",
              h.first_name || ' ' || h.last_name AS "headName",
              (SELECT COUNT(*) FROM employee m WHERE m.department_id = d.id AND m.status != 'exited') AS "memberCount"
         FROM department d LEFT JOIN employee h ON h.id = d.head_employee_id
        WHERE d.archived_at IS NULL
        ORDER BY d.name`,
    )
    .all()) as {
    id: string;
    name: string;
    headEmployeeId: string | null;
    headName: string | null;
    memberCount: number;
  }[];

  const delegations = await listDelegationsRaw(ctx);

  // Things an administrator should fix, in plain language, most important first.
  const warnings: { level: 'problem' | 'notice'; text: string }[] = [];
  for (const r of rows.filter((x) => x.problem)) {
    warnings.push({ level: 'problem', text: `${r.name}: ${r.problem}` });
  }
  for (const t of teams.filter((x) => !x.leadEmployeeId && Number(x.memberCount) > 0)) {
    warnings.push({
      level: 'notice',
      text: `${t.name} (${t.departmentName}) has no team lead, so its leave goes straight to the department head or HR.`,
    });
  }
  for (const d of departments.filter((x) => !x.headEmployeeId && Number(x.memberCount) > 0)) {
    warnings.push({
      level: 'notice',
      text: `${d.name} has no department head, so its team leads' leave goes to HR.`,
    });
  }
  const escalated = rows.filter((r) => r.route?.escalation);
  if (escalated.length) {
    warnings.push({
      level: 'notice',
      text: `${escalated.length} ${escalated.length === 1 ? 'person’s' : 'people’s'} leave currently skips their usual approver.`,
    });
  }

  return {
    people: rows,
    teams: teams.map((t) => ({ ...t, memberCount: Number(t.memberCount) })),
    departments: departments.map((d) => ({ ...d, memberCount: Number(d.memberCount) })),
    delegations,
    warnings,
    candidates: people
      .filter((p) => p.user_id)
      .map((p) => ({ id: p.id, name: `${p.first_name} ${p.last_name}`, team: p.team_name })),
  };
}

function positionLabel(kind: string): string {
  switch (kind) {
    case 'team_lead':
      return 'Team lead';
    case 'department_head':
      return 'Department head';
    case 'hr_officer':
      return 'HR';
    case 'admin':
      return 'Administrator';
    default:
      return 'Member';
  }
}

// ---------------------------------------------------------------------------------------
// Leads and heads
// ---------------------------------------------------------------------------------------

export async function setTeamLead(
  ctx: RequestContext,
  teamId: string,
  leadEmployeeId: string | null,
) {
  const p = requirePrincipal(ctx);
  await authorizeAction(ctx, 'approval.routing.manage', null);
  const team = (await ctx.sqlite
    .prepare(`SELECT id, name, lead_employee_id FROM team WHERE id = ? AND archived_at IS NULL`)
    .get(teamId)) as { id: string; name: string; lead_employee_id: string | null } | undefined;
  if (!team) throw new DomainError('NOT_FOUND', 'Team not found.', { httpStatus: 404 });

  let leadName: string | null = null;
  if (leadEmployeeId) {
    leadName = (await requireSignInAccount(ctx, leadEmployeeId, 'The new team lead')).name;
  }
  await withTx(ctx.sqlite, async () => {
    await ctx.sqlite
      .prepare(`UPDATE team SET lead_employee_id = ?, updated_at = ?, updated_by = ? WHERE id = ?`)
      .run(leadEmployeeId, ctx.now, p.userId, teamId);
    await audit(
      ctx,
      'approval.team_lead.changed',
      'team',
      teamId,
      { leadEmployeeId: team.lead_employee_id },
      { leadEmployeeId },
    );
  });
  return {
    ok: true,
    message: leadName
      ? `${leadName} now approves leave for ${team.name}.`
      : `${team.name} has no team lead. Its leave will go to the department head.`,
  };
}

export async function setDepartmentHead(
  ctx: RequestContext,
  departmentId: string,
  headEmployeeId: string | null,
) {
  const p = requirePrincipal(ctx);
  await authorizeAction(ctx, 'approval.routing.manage', null);
  const dept = (await ctx.sqlite
    .prepare(
      `SELECT id, name, head_employee_id FROM department WHERE id = ? AND archived_at IS NULL`,
    )
    .get(departmentId)) as
    { id: string; name: string; head_employee_id: string | null } | undefined;
  if (!dept) throw new DomainError('NOT_FOUND', 'Department not found.', { httpStatus: 404 });

  let headName: string | null = null;
  if (headEmployeeId) {
    headName = (await requireSignInAccount(ctx, headEmployeeId, 'The new department head')).name;
  }
  await withTx(ctx.sqlite, async () => {
    await ctx.sqlite
      .prepare(
        `UPDATE department SET head_employee_id = ?, updated_at = ?, updated_by = ? WHERE id = ?`,
      )
      .run(headEmployeeId, ctx.now, p.userId, departmentId);
    await audit(
      ctx,
      'approval.department_head.changed',
      'department',
      departmentId,
      { headEmployeeId: dept.head_employee_id },
      { headEmployeeId },
    );
  });
  return {
    ok: true,
    message: headName
      ? `${headName} now heads ${dept.name}.`
      : `${dept.name} has no head. Its team leads' leave will go to HR.`,
  };
}

// ---------------------------------------------------------------------------------------
// Overrides: "X's leave always goes to Y"
// ---------------------------------------------------------------------------------------

export async function setOverride(
  ctx: RequestContext,
  employeeId: string,
  approverEmployeeId: string | null,
  note: string | null,
) {
  const p = requirePrincipal(ctx);
  await authorizeAction(ctx, 'approval.routing.manage', null);
  const person = await activeEmployee(ctx, employeeId, 'Employee');
  const before = (await ctx.sqlite
    .prepare(`SELECT approver_employee_id FROM approval_override WHERE employee_id = ?`)
    .get(employeeId)) as { approver_employee_id: string } | undefined;

  if (!approverEmployeeId) {
    await withTx(ctx.sqlite, async () => {
      await ctx.sqlite
        .prepare(`DELETE FROM approval_override WHERE employee_id = ?`)
        .run(employeeId);
      await audit(ctx, 'approval.override.cleared', 'employee', employeeId, before ?? null, null);
    });
    return {
      ok: true,
      message: `${person.name}'s leave follows their team and department again.`,
    };
  }

  if (approverEmployeeId === employeeId) {
    throw new DomainError('SELF_APPROVER', 'Nobody can approve their own leave.', {
      httpStatus: 400,
    });
  }
  const approver = await requireSignInAccount(ctx, approverEmployeeId, 'The chosen approver');
  await withTx(ctx.sqlite, async () => {
    await ctx.sqlite
      .prepare(
        `INSERT INTO approval_override (employee_id, approver_employee_id, note, created_at, created_by)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (employee_id)
         DO UPDATE SET approver_employee_id = excluded.approver_employee_id, note = excluded.note,
                       created_at = excluded.created_at, created_by = excluded.created_by`,
      )
      .run(employeeId, approverEmployeeId, note, ctx.now, p.userId);
    await audit(ctx, 'approval.override.set', 'employee', employeeId, before ?? null, {
      approverEmployeeId,
      note,
    });
  });
  return { ok: true, message: `${person.name}'s leave now goes to ${approver.name}.` };
}

// ---------------------------------------------------------------------------------------
// Cover while someone is away
// ---------------------------------------------------------------------------------------

async function listDelegationsRaw(ctx: RequestContext) {
  const rows = (await ctx.sqlite
    .prepare(
      `SELECT dl.id, dl.approver_employee_id AS "approverEmployeeId",
              a.first_name || ' ' || a.last_name AS "approverName",
              dl.delegate_employee_id AS "delegateEmployeeId",
              d.first_name || ' ' || d.last_name AS "delegateName",
              dl.starts_on AS "startsOn", dl.ends_on AS "endsOn", dl.note
         FROM approval_delegation dl
         JOIN employee a ON a.id = dl.approver_employee_id
         JOIN employee d ON d.id = dl.delegate_employee_id
        WHERE dl.ends_on >= ?
        ORDER BY dl.starts_on`,
    )
    .all(ctx.today)) as {
    id: string;
    approverEmployeeId: string;
    approverName: string;
    delegateEmployeeId: string;
    delegateName: string;
    startsOn: string;
    endsOn: string;
    note: string | null;
  }[];
  return rows.map((r) => ({ ...r, active: r.startsOn <= ctx.today }));
}

export async function createDelegation(
  ctx: RequestContext,
  input: {
    approverEmployeeId: string;
    delegateEmployeeId: string;
    startsOn: string;
    endsOn: string;
    note?: string | null;
  },
) {
  const p = requirePrincipal(ctx);
  await authorizeAction(ctx, 'approval.routing.manage', null);
  if (input.approverEmployeeId === input.delegateEmployeeId) {
    throw new DomainError('SAME_PERSON', 'Choose someone other than the person who is away.', {
      httpStatus: 400,
    });
  }
  if (input.endsOn < input.startsOn) {
    throw new DomainError('BAD_RANGE', 'The cover must end on or after the day it starts.', {
      httpStatus: 400,
    });
  }
  if (input.endsOn < ctx.today) {
    throw new DomainError('IN_PAST', 'That date range is already over.', { httpStatus: 400 });
  }
  const from = await activeEmployee(ctx, input.approverEmployeeId, 'The approver');
  const to = await requireSignInAccount(ctx, input.delegateEmployeeId, 'The cover');
  const id = newId();
  await withTx(ctx.sqlite, async () => {
    await ctx.sqlite
      .prepare(
        `INSERT INTO approval_delegation (id, approver_employee_id, delegate_employee_id, starts_on, ends_on, note, created_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.approverEmployeeId,
        input.delegateEmployeeId,
        input.startsOn,
        input.endsOn,
        input.note ?? null,
        ctx.now,
        p.userId,
      );
    await audit(ctx, 'approval.delegation.created', 'approval_delegation', id, null, input);
    await notify(
      ctx,
      to.userId,
      'approval.delegation',
      'You are covering approvals',
      `From ${input.startsOn} to ${input.endsOn} you decide leave that would normally go to ${from.name}.`,
      'approval_delegation',
      id,
    );
  });
  return {
    ok: true,
    id,
    message: `${to.name} covers ${from.name}'s approvals from ${input.startsOn} to ${input.endsOn}.`,
  };
}

export async function deleteDelegation(ctx: RequestContext, id: string) {
  requirePrincipal(ctx);
  await authorizeAction(ctx, 'approval.routing.manage', null);
  const row = (await ctx.sqlite
    .prepare(`SELECT * FROM approval_delegation WHERE id = ?`)
    .get(id)) as Record<string, unknown> | undefined;
  if (!row) throw new DomainError('NOT_FOUND', 'Cover arrangement not found.', { httpStatus: 404 });
  await withTx(ctx.sqlite, async () => {
    await ctx.sqlite.prepare(`DELETE FROM approval_delegation WHERE id = ?`).run(id);
    await audit(ctx, 'approval.delegation.removed', 'approval_delegation', id, row, null);
  });
  return { ok: true, message: 'Cover removed. New requests follow the normal chain again.' };
}

// ---------------------------------------------------------------------------------------
// Reassigning a pending request
// ---------------------------------------------------------------------------------------

/**
 * Moves a pending request to a different approver — the fix when a request is stuck with
 * someone who has left, is unreachable, or was the wrong person.
 */
export async function reassignRequest(
  ctx: RequestContext,
  requestId: string,
  approverEmployeeId: string,
  note: string | null,
) {
  requirePrincipal(ctx);
  await authorizeAction(ctx, 'approval.routing.manage', null);
  const req = (await ctx.sqlite
    .prepare(
      `SELECT r.id, r.status, r.employee_id, e.first_name || ' ' || e.last_name AS name
         FROM leave_request r JOIN employee e ON e.id = r.employee_id WHERE r.id = ?`,
    )
    .get(requestId)) as
    { id: string; status: string; employee_id: string; name: string } | undefined;
  if (!req) throw new DomainError('NOT_FOUND', 'Request not found.', { httpStatus: 404 });
  if (req.status !== 'pending_approval') {
    throw new DomainError(
      'NOT_PENDING',
      'Only a request that is still waiting for a decision can be reassigned.',
      { httpStatus: 409 },
    );
  }
  if (approverEmployeeId === req.employee_id) {
    throw new DomainError('SELF_APPROVER', 'Nobody can approve their own leave.', {
      httpStatus: 400,
    });
  }
  const approver = await requireSignInAccount(ctx, approverEmployeeId, 'The new approver');
  const step = (await ctx.sqlite
    .prepare(
      `SELECT id, approver_user_id, approver_employee_id FROM approval_step_instance
        WHERE leave_request_id = ? AND status = 'pending' ORDER BY step_no LIMIT 1`,
    )
    .get(requestId)) as
    | { id: string; approver_user_id: string | null; approver_employee_id: string | null }
    | undefined;
  if (!step) {
    throw new DomainError('NOT_PENDING', 'This request has no step waiting for a decision.', {
      httpStatus: 409,
    });
  }
  await withTx(ctx.sqlite, async () => {
    await ctx.sqlite
      .prepare(
        `UPDATE approval_step_instance SET approver_user_id = ?, approver_employee_id = ? WHERE id = ?`,
      )
      .run(approver.userId, approver.id, step.id);
    await ctx.sqlite
      .prepare(
        `UPDATE leave_request SET approver_kind = 'specific_employee', escalation_reason = NULL,
                version = version + 1, updated_at = ? WHERE id = ?`,
      )
      .run(ctx.now, requestId);
    await audit(
      ctx,
      'leave.request.reassigned',
      'leave_request',
      requestId,
      { approverEmployeeId: step.approver_employee_id },
      { approverEmployeeId: approver.id, note },
    );
    await notify(
      ctx,
      approver.userId,
      'leave.submitted',
      'Leave request awaiting your decision',
      `${req.name}'s request was passed to you by an administrator.${note ? ` Note: ${note}` : ''}`,
      'leave_request',
      requestId,
    );
  });
  return { ok: true, message: `${req.name}'s request now waits for ${approver.name}.` };
}

// ---------------------------------------------------------------------------------------
// Users and access
// ---------------------------------------------------------------------------------------

export async function listUsers(ctx: RequestContext) {
  requirePrincipal(ctx);
  await authorizeAction(ctx, 'role.assign', null);
  const rows = (await ctx.sqlite
    .prepare(
      `SELECT ua.id, ua.email, ua.is_disabled AS "isDisabled", ua.last_login_at AS "lastLoginAt",
              ua.must_change_password AS "mustChangePassword",
              e.id AS "employeeId", e.first_name || ' ' || e.last_name AS name, e.status,
              d.name AS "departmentName", t.name AS "teamName",
              (SELECT COUNT(*) FROM session s WHERE s.user_account_id = ua.id
                  AND s.revoked_at IS NULL AND s.expires_at > ?) AS "activeSessions",
              (SELECT w.last_seen_ip FROM workstation_device w
                WHERE w.employee_id = ua.employee_id AND w.is_active = 1
                ORDER BY w.last_seen_at DESC LIMIT 1) AS "workstationIp",
              (SELECT w.last_seen_at FROM workstation_device w
                WHERE w.employee_id = ua.employee_id AND w.is_active = 1
                ORDER BY w.last_seen_at DESC LIMIT 1) AS "workstationSeenAt"
         FROM user_account ua
         LEFT JOIN employee e ON e.id = ua.employee_id
         LEFT JOIN department d ON d.id = e.department_id
         LEFT JOIN team t ON t.id = e.team_id
        ORDER BY ua.is_disabled, e.first_name, e.last_name, ua.email`,
    )
    .all(ctx.now)) as {
    id: string;
    email: string;
    isDisabled: number;
    lastLoginAt: string | null;
    mustChangePassword: number;
    employeeId: string | null;
    name: string | null;
    status: string | null;
    departmentName: string | null;
    teamName: string | null;
    activeSessions: number;
    workstationIp: string | null;
    workstationSeenAt: string | null;
  }[];
  const roleRows = (await ctx.sqlite
    .prepare(
      `SELECT ur.user_account_id AS "userId", r.code FROM user_role ur JOIN role r ON r.id = ur.role_id`,
    )
    .all()) as { userId: string; code: RoleCode }[];
  const rolesFor = new Map<string, RoleCode[]>();
  for (const r of roleRows) {
    rolesFor.set(r.userId, [...(rolesFor.get(r.userId) ?? []), r.code]);
  }
  return {
    users: rows.map((u) => ({
      ...u,
      isDisabled: Number(u.isDisabled) === 1,
      mustChangePassword: Number(u.mustChangePassword) === 1,
      activeSessions: Number(u.activeSessions),
      roles: rolesFor.get(u.id) ?? [],
    })),
    roles: ROLE_CODES.map((code) => ({ code, ...ROLE_INFO[code] })),
  };
}

/** Plain-language description of what each role can do, shown next to the checkboxes. */
const ROLE_INFO: Record<RoleCode, { name: string; description: string }> = {
  employee: {
    name: 'Employee',
    description: 'Applies for leave and sees their own balance and history.',
  },
  manager: {
    name: 'Manager',
    description:
      'Also sees leave for the people who report to them. Does not approve by itself — leading a team does.',
  },
  hr_officer: {
    name: 'HR',
    description: 'Manages people, leave rules and holidays, and decides escalated leave.',
  },
  payroll_officer: {
    name: 'Payroll',
    description: 'Reads balances and exports leave for payroll. Cannot approve.',
  },
  admin: {
    name: 'Administrator',
    description: 'Full control, including who approves whom and who has access.',
  },
  auditor: {
    name: 'Auditor',
    description: 'Read-only access to everything, including the audit log.',
  },
};

async function activeAdminCount(ctx: RequestContext, excludingUserId?: string): Promise<number> {
  const row = (await ctx.sqlite
    .prepare(
      `SELECT COUNT(*) AS n FROM user_account ua
         JOIN user_role ur ON ur.user_account_id = ua.id
         JOIN role r ON r.id = ur.role_id
        WHERE r.code = 'admin' AND ua.is_disabled = 0 AND ua.id != ?`,
    )
    .get(excludingUserId ?? '')) as { n: number };
  return Number(row.n);
}

export async function setUserRoles(ctx: RequestContext, userId: string, roles: RoleCode[]) {
  const p = requirePrincipal(ctx);
  await authorizeAction(ctx, 'role.assign', null);
  const unique = [...new Set(roles)].filter((r) => (ROLE_CODES as readonly string[]).includes(r));
  if (unique.length === 0) {
    throw new DomainError('NO_ROLES', 'Everyone needs at least one role. Use Employee for staff.', {
      httpStatus: 400,
    });
  }
  const user = (await ctx.sqlite
    .prepare(`SELECT id, email, is_disabled FROM user_account WHERE id = ?`)
    .get(userId)) as { id: string; email: string; is_disabled: number } | undefined;
  if (!user) throw new DomainError('NOT_FOUND', 'Account not found.', { httpStatus: 404 });

  const current = (
    (await ctx.sqlite
      .prepare(
        `SELECT r.code FROM user_role ur JOIN role r ON r.id = ur.role_id WHERE ur.user_account_id = ?`,
      )
      .all(userId)) as { code: RoleCode }[]
  ).map((r) => r.code);

  const losingAdmin = current.includes('admin') && !unique.includes('admin');
  if (losingAdmin && userId === p.userId) {
    throw new DomainError(
      'SELF_LOCKOUT',
      'You cannot remove your own administrator role. Ask another administrator to do it.',
      { httpStatus: 409 },
    );
  }
  if (losingAdmin && (await activeAdminCount(ctx, userId)) === 0) {
    throw new DomainError(
      'LAST_ADMIN',
      'This is the only active administrator. Make someone else an administrator first.',
      { httpStatus: 409 },
    );
  }

  await withTx(ctx.sqlite, async () => {
    await ctx.sqlite.prepare(`DELETE FROM user_role WHERE user_account_id = ?`).run(userId);
    for (const code of unique) {
      const role = (await ctx.sqlite.prepare(`SELECT id FROM role WHERE code = ?`).get(code)) as {
        id: string;
      };
      await ctx.sqlite
        .prepare(
          `INSERT INTO user_role (user_account_id, role_id, granted_by, granted_at) VALUES (?, ?, ?, ?)`,
        )
        .run(userId, role.id, p.userId, ctx.now);
    }
    // A change of role takes effect on the next request; existing sessions keep their old
    // permissions until then, which is a few seconds at most because the principal is
    // reloaded on every request.
    await audit(
      ctx,
      'user.roles.changed',
      'user_account',
      userId,
      { roles: current },
      {
        roles: unique,
      },
    );
  });
  return { ok: true, message: `Access updated for ${user.email}.` };
}

export async function setAccountDisabled(ctx: RequestContext, userId: string, disabled: boolean) {
  const p = requirePrincipal(ctx);
  await authorizeAction(ctx, 'user.account.disable', null);
  if (disabled && userId === p.userId) {
    throw new DomainError('SELF_LOCKOUT', 'You cannot disable your own account.', {
      httpStatus: 409,
    });
  }
  const user = (await ctx.sqlite
    .prepare(`SELECT id, email FROM user_account WHERE id = ?`)
    .get(userId)) as { id: string; email: string } | undefined;
  if (!user) throw new DomainError('NOT_FOUND', 'Account not found.', { httpStatus: 404 });
  const isAdmin = Boolean(
    await ctx.sqlite
      .prepare(
        `SELECT 1 FROM user_role ur JOIN role r ON r.id = ur.role_id
          WHERE ur.user_account_id = ? AND r.code = 'admin'`,
      )
      .get(userId),
  );
  if (disabled && isAdmin && (await activeAdminCount(ctx, userId)) === 0) {
    throw new DomainError(
      'LAST_ADMIN',
      'This is the only active administrator and cannot be disabled.',
      { httpStatus: 409 },
    );
  }
  await withTx(ctx.sqlite, async () => {
    await ctx.sqlite
      .prepare(
        `UPDATE user_account SET is_disabled = ?, updated_at = ?, updated_by = ? WHERE id = ?`,
      )
      .run(disabled ? 1 : 0, ctx.now, p.userId, userId);
    if (disabled) {
      await ctx.sqlite
        .prepare(
          `UPDATE session SET revoked_at = ?, revoked_reason = 'account_disabled'
            WHERE user_account_id = ? AND revoked_at IS NULL`,
        )
        .run(ctx.now, userId);
    }
    await audit(
      ctx,
      disabled ? 'user.account.disabled' : 'user.account.enabled',
      'user_account',
      userId,
      null,
      null,
    );
  });
  return {
    ok: true,
    message: disabled
      ? `${user.email} is disabled and signed out everywhere. Their leave requests will route past them.`
      : `${user.email} can sign in again.`,
  };
}

export async function revokeUserSessions(
  ctx: RequestContext,
  userId: string,
  /** The caller's own session, kept alive when they sign themselves out elsewhere. */
  keepTokenHash: string | null,
) {
  const p = requirePrincipal(ctx);
  await authorizeAction(ctx, 'user.session.revoke', null);
  const result = await ctx.sqlite
    .prepare(
      `UPDATE session SET revoked_at = ?, revoked_reason = 'admin_revoked'
        WHERE user_account_id = ? AND revoked_at IS NULL AND token_hash != ?`,
    )
    .run(ctx.now, userId, userId === p.userId ? (keepTokenHash ?? '') : '');
  await audit(ctx, 'user.sessions.revoked', 'user_account', userId, null, {
    count: result.changes,
  });
  return {
    ok: true,
    message:
      userId === p.userId
        ? 'Signed out on every other device. This one stays signed in until you sign out.'
        : `Signed out on ${result.changes} device${result.changes === 1 ? '' : 's'}.`,
  };
}

/**
 * Frees a person from the office computer their account is tied to, so they can sign in on
 * a replacement. Without this, workstation binding locked anyone with a new PC out for
 * good, and the sign-in error sent them to an administrator who had no way to help.
 */
export async function releaseWorkstations(ctx: RequestContext, userId: string) {
  requirePrincipal(ctx);
  await authorizeAction(ctx, 'user.account.disable', null);
  const user = (await ctx.sqlite
    .prepare(`SELECT id, email, employee_id FROM user_account WHERE id = ?`)
    .get(userId)) as { id: string; email: string; employee_id: string | null } | undefined;
  if (!user) throw new DomainError('NOT_FOUND', 'Account not found.', { httpStatus: 404 });
  if (!user.employee_id) {
    return { ok: true, message: `${user.email} has no workstation to release.` };
  }
  const devices = (await ctx.sqlite
    .prepare(`SELECT * FROM workstation_device WHERE employee_id = ?`)
    .all(user.employee_id)) as Record<string, unknown>[];
  if (devices.length === 0) {
    return { ok: true, message: `${user.email} is not tied to any computer.` };
  }
  await withTx(ctx.sqlite, async () => {
    // The binding is an operational link, not employee history; the audit event keeps a
    // full copy of what was released.
    await ctx.sqlite
      .prepare(`DELETE FROM workstation_device WHERE employee_id = ?`)
      .run(user.employee_id);
    await audit(ctx, 'user.workstation.released', 'user_account', userId, { devices }, null);
  });
  return {
    ok: true,
    message: `${user.email} can now sign in on a different computer. The next one they use becomes theirs.`,
  };
}
