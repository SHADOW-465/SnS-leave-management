/**
 * Administrator controls: who approves whom, and who can do what.
 *
 * The approval chain (`approval.routing.manage`) is the administrator's.
 * Sign-in accounts (`user.account.create`, `role.assign`, `user.account.disable`) are
 * HR and the administrator. Only an administrator may grant or remove the administrator role.
 */
import { generateTemporaryPassword, hashPassword } from '@sns/auth';
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
  manager_id: string | null;
  joined_on: string;
  job_title: string | null;
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
              t.name AS team_name, e.department_id, d.name AS department_name, ua.id AS user_id,
              e.manager_employee_id AS manager_id, e.joined_on, j.name AS job_title
         FROM employee e
         JOIN department d ON d.id = e.department_id
         LEFT JOIN team t ON t.id = e.team_id
         LEFT JOIN job_title j ON j.id = e.job_title_id
         LEFT JOIN user_account ua ON ua.employee_id = e.id
        WHERE e.status != 'exited'
        ORDER BY d.name, t.name, e.first_name, e.last_name`,
    )
    .all()) as EmployeeRow[];

  const since = new Map(
    (
      (await ctx.sqlite
        .prepare(
          `SELECT employee_id AS "employeeId", effective_from AS "effectiveFrom"
             FROM employment_history WHERE effective_to IS NULL`,
        )
        .all()) as { employeeId: string; effectiveFrom: string }[]
    ).map((r) => [r.employeeId, r.effectiveFrom]),
  );

  const nameOf = new Map(people.map((p) => [p.id, `${p.first_name} ${p.last_name}`]));
  const titleOf = new Map(people.map((p) => [p.id, p.job_title]));

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
      jobTitle: person.job_title,
      reportingManager: person.manager_id
        ? {
            employeeId: person.manager_id,
            name: nameOf.get(person.manager_id) ?? 'Former employee',
            since: since.get(person.id) ?? person.joined_on,
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
          approverJobTitle:
            !r.selfApproved && r.approverEmployeeId
              ? (titleOf.get(r.approverEmployeeId) ?? null)
              : null,
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
  const unmanaged = rows.filter((r) => !r.reportingManager && r.position === 'Member');
  if (unmanaged.length) {
    warnings.push({
      level: 'notice',
      text: `${unmanaged.length} ${unmanaged.length === 1 ? 'person has' : 'people have'} no reporting manager, so their leave goes to their team lead or department head instead.`,
    });
  }
  // A missing lead or head only matters to people who fall back on it — those with no
  // reporting manager. Everyone else's leave never reaches that rung.
  for (const t of teams.filter((x) => !x.leadEmployeeId)) {
    const affected = rows.filter((r) => r.teamId === t.id && !r.reportingManager);
    if (!affected.length) continue;
    warnings.push({
      level: 'notice',
      text: `${t.name} has no team lead, so ${affected.map((r) => r.name).join(', ')} — with no reporting manager — go straight to the department head or HR.`,
    });
  }
  for (const d of departments.filter((x) => !x.headEmployeeId)) {
    const affected = rows.filter(
      (r) =>
        r.departmentId === d.id &&
        !r.reportingManager &&
        !teams.find((t) => t.id === r.teamId)?.leadEmployeeId,
    );
    if (!affected.length) continue;
    warnings.push({
      level: 'notice',
      text: `${d.name} has no department head, so ${affected.map((r) => r.name).join(', ')} — with no reporting manager or team lead — go to HR.`,
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
      .map((p) => ({
        id: p.id,
        name: `${p.first_name} ${p.last_name}`,
        jobTitle: p.job_title,
        team: p.team_name,
      })),
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
// Reporting managers: who approves whose leave, with dated history
// ---------------------------------------------------------------------------------------

function dayBefore(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

/**
 * Assigns (or clears) someone's reporting manager from a date. The manager decides their
 * leave from then on; requests already submitted stay with whoever they were sent to.
 * Every change is kept in `employment_history`, so "who managed Vijay in March" has an
 * answer.
 */
export async function changeReportingManager(
  ctx: RequestContext,
  input: {
    employeeId: string;
    managerEmployeeId: string | null;
    effectiveFrom?: string | null;
    reason?: string | null;
  },
): Promise<{ ok: true; changed: boolean; message: string }> {
  const p = requirePrincipal(ctx);
  await authorizeAction(ctx, 'approval.routing.manage', null);
  const person = (await ctx.sqlite
    .prepare(
      `SELECT e.id, e.first_name || ' ' || e.last_name AS name, e.status, e.joined_on AS "joinedOn",
              e.manager_employee_id AS "managerId", e.department_id AS "departmentId",
              e.job_title_id AS "jobTitleId", e.employment_type_id AS "employmentTypeId"
         FROM employee e WHERE e.id = ?`,
    )
    .get(input.employeeId)) as
    | {
        id: string;
        name: string;
        status: string;
        joinedOn: string;
        managerId: string | null;
        departmentId: string;
        jobTitleId: string | null;
        employmentTypeId: string | null;
      }
    | undefined;
  if (!person) throw new DomainError('NOT_FOUND', 'Employee not found.', { httpStatus: 404 });
  const managerId = input.managerEmployeeId ?? null;
  if (managerId === person.managerId) {
    return { ok: true, changed: false, message: `${person.name}: no change.` };
  }
  if (managerId === person.id) {
    throw new DomainError(
      'SELF_APPROVER',
      `${person.name} cannot be their own reporting manager.`,
      {
        httpStatus: 400,
      },
    );
  }
  let managerName: string | null = null;
  if (managerId) {
    managerName = (await requireSignInAccount(ctx, managerId, 'The reporting manager')).name;
    // Walk up from the new manager: reaching this person again would be a loop.
    let cursor: string | null = managerId;
    for (let hops = 0; cursor && hops < 50; hops++) {
      if (cursor === person.id) {
        throw new DomainError(
          'MANAGER_LOOP',
          `${managerName} already reports to ${person.name}, directly or through others. Change that first.`,
          { httpStatus: 409 },
        );
      }
      const up = (await ctx.sqlite
        .prepare(`SELECT manager_employee_id AS id FROM employee WHERE id = ?`)
        .get(cursor)) as { id: string | null } | undefined;
      cursor = up?.id ?? null;
    }
  }
  const from = input.effectiveFrom || ctx.today;
  if (from > ctx.today) {
    throw new DomainError('FUTURE_DATE', 'Choose today or an earlier date.', { httpStatus: 400 });
  }
  const current = (await ctx.sqlite
    .prepare(
      `SELECT id, effective_from AS "effectiveFrom" FROM employment_history
        WHERE employee_id = ? AND effective_to IS NULL`,
    )
    .get(person.id)) as { id: string; effectiveFrom: string } | undefined;
  const floor = current?.effectiveFrom ?? person.joinedOn;
  if (from < floor) {
    throw new DomainError(
      'DATE_TOO_EARLY',
      current
        ? `The previous change took effect on ${current.effectiveFrom}; choose that date or later.`
        : `${person.name} joined on ${person.joinedOn}; choose that date or later.`,
      { httpStatus: 400 },
    );
  }
  const reason = input.reason ?? 'Reporting manager changed';
  const insertRow = async (manager: string | null, start: string, end: string | null) =>
    ctx.sqlite
      .prepare(
        `INSERT INTO employment_history (id, employee_id, job_title_id, employment_type_id, department_id, manager_employee_id, effective_from, effective_to, reason, created_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        newId(),
        person.id,
        person.jobTitleId,
        person.employmentTypeId,
        person.departmentId,
        manager,
        start,
        end,
        end ? 'Arrangement before the first recorded change' : reason,
        ctx.now,
        p.userId,
      );

  await withTx(ctx.sqlite, async () => {
    if (current && current.effectiveFrom === from) {
      // A same-day correction replaces the open row rather than leaving a one-day stub.
      await ctx.sqlite
        .prepare(`UPDATE employment_history SET manager_employee_id = ?, reason = ? WHERE id = ?`)
        .run(managerId, reason, current.id);
    } else {
      if (current) {
        await ctx.sqlite
          .prepare(`UPDATE employment_history SET effective_to = ? WHERE id = ?`)
          .run(dayBefore(from), current.id);
      } else if (from > person.joinedOn) {
        // First recorded change: keep the arrangement that held until now.
        await insertRow(person.managerId, person.joinedOn, dayBefore(from));
      }
      await insertRow(managerId, from, null);
    }
    await ctx.sqlite
      .prepare(
        `UPDATE employee SET manager_employee_id = ?, version = version + 1, updated_at = ?, updated_by = ? WHERE id = ?`,
      )
      .run(managerId, ctx.now, p.userId, person.id);
    await audit(
      ctx,
      'employee.reporting_manager.changed',
      'employee',
      person.id,
      { managerEmployeeId: person.managerId },
      { managerEmployeeId: managerId, effectiveFrom: from, reason: input.reason ?? null },
    );
  });
  return {
    ok: true,
    changed: true,
    message: managerName
      ? `${person.name} now reports to ${managerName} (from ${from}).`
      : `${person.name} has no reporting manager; their leave goes to their team lead or department head.`,
  };
}

/** Assigns one manager to several people at once, reporting who could not be changed. */
export async function assignReportingManager(
  ctx: RequestContext,
  input: {
    employeeIds: string[];
    managerEmployeeId: string | null;
    effectiveFrom?: string | null;
    reason?: string | null;
  },
) {
  requirePrincipal(ctx);
  await authorizeAction(ctx, 'approval.routing.manage', null);
  let changed = 0;
  const failed: { employeeId: string; reason: string }[] = [];
  for (const employeeId of [...new Set(input.employeeIds)]) {
    try {
      const r = await changeReportingManager(ctx, { ...input, employeeId });
      if (r.changed) changed += 1;
    } catch (err) {
      failed.push({ employeeId, reason: err instanceof Error ? err.message : 'Could not change' });
    }
  }
  return {
    changed,
    failed,
    message:
      `${changed} ${changed === 1 ? 'person' : 'people'} updated.` +
      (failed.length ? ` ${failed.length} could not be changed.` : ''),
  };
}

/** Who managed this person, and when. Newest first. */
export async function reportingManagerHistory(ctx: RequestContext, employeeId: string) {
  requirePrincipal(ctx);
  await authorizeAction(ctx, 'employee.read', employeeId);
  return (await ctx.sqlite
    .prepare(
      `SELECT h.effective_from AS "effectiveFrom", h.effective_to AS "effectiveTo", h.reason,
              h.manager_employee_id AS "managerEmployeeId",
              m.first_name || ' ' || m.last_name AS "managerName"
         FROM employment_history h LEFT JOIN employee m ON m.id = h.manager_employee_id
        WHERE h.employee_id = ?
        ORDER BY h.effective_from DESC`,
    )
    .all(employeeId)) as {
    effectiveFrom: string;
    effectiveTo: string | null;
    reason: string | null;
    managerEmployeeId: string | null;
    managerName: string | null;
  }[];
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

/** Only an administrator may grant the administrator role, or change an account that has it. */
export function assertMayGrantAdmin(
  actorIsAdmin: boolean,
  next: readonly string[],
  previous: readonly string[],
): void {
  if (actorIsAdmin) return;
  if (next.includes('admin') || previous.includes('admin')) {
    throw new DomainError(
      'ADMIN_ROLE',
      'Only an administrator can grant or change the administrator role.',
      { httpStatus: 403 },
    );
  }
}

function nextEmployeeCode(codes: string[]): string {
  let prefix = 'SNS-';
  let max = 1000;
  for (const code of codes) {
    const match = /^(.*?)(\d+)$/.exec(code);
    if (!match) continue;
    const n = Number(match[2]);
    if (n >= max) {
      max = n;
      prefix = match[1] || 'SNS-';
    }
  }
  return `${prefix}${max + 1}`;
}

export async function listUsers(ctx: RequestContext) {
  requirePrincipal(ctx);
  await authorizeAction(ctx, 'user.account.create', null);
  const rows = (await ctx.sqlite
    .prepare(
      `SELECT ua.id, ua.email, ua.is_disabled AS "isDisabled", ua.last_login_at AS "lastLoginAt",
              ua.must_change_password AS "mustChangePassword",
              e.id AS "employeeId", e.employee_code AS "employeeCode",
              e.first_name AS "firstName", e.last_name AS "lastName",
              e.first_name || ' ' || e.last_name AS name, e.status, e.version AS "employeeVersion",
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
    employeeCode: string | null;
    firstName: string | null;
    lastName: string | null;
    name: string | null;
    status: string | null;
    employeeVersion: number | null;
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
      employeeVersion: u.employeeVersion == null ? null : Number(u.employeeVersion),
      roles: rolesFor.get(u.id) ?? [],
    })),
    nextEmployeeCode: nextEmployeeCode(
      (
        (await ctx.sqlite.prepare(`SELECT employee_code AS code FROM employee`).all()) as {
          code: string;
        }[]
      ).map((r) => r.code),
    ),
    roles: ROLE_CODES.map((code) => ({ code, ...ROLE_INFO[code] })),
    // Employees who cannot sign in yet — the admin creates their login from here.
    withoutAccount: (await ctx.sqlite
      .prepare(
        `SELECT e.id AS "employeeId", e.employee_code AS code,
                e.first_name || ' ' || e.last_name AS name, e.work_email AS email,
                d.name AS "departmentName"
           FROM employee e JOIN department d ON d.id = e.department_id
          WHERE e.status != 'exited'
            AND NOT EXISTS (SELECT 1 FROM user_account ua WHERE ua.employee_id = e.id)
          ORDER BY e.first_name, e.last_name`,
      )
      .all()) as {
      employeeId: string;
      code: string;
      name: string;
      email: string;
      departmentName: string;
    }[],
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

  assertMayGrantAdmin(p.roles.includes('admin'), unique, current);
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

// ---------------------------------------------------------------------------------------
// Sign-in accounts
// ---------------------------------------------------------------------------------------

export async function updateAccount(
  ctx: RequestContext,
  userId: string,
  input: {
    firstName?: string;
    lastName?: string;
    email?: string;
    employeeCode?: string;
    expectedVersion?: number;
  },
) {
  const p = requirePrincipal(ctx);
  const user = (await ctx.sqlite
    .prepare(`SELECT id, email, employee_id AS "employeeId" FROM user_account WHERE id = ?`)
    .get(userId)) as { id: string; email: string; employeeId: string | null } | undefined;
  if (!user) throw new DomainError('NOT_FOUND', 'Account not found.', { httpStatus: 404 });

  if (!user.employeeId) {
    await authorizeAction(ctx, 'user.account.create', null);
    if (!input.email || input.email.toLowerCase() === user.email.toLowerCase()) {
      return { ok: true, message: 'Nothing to change.' };
    }
    const taken = await ctx.sqlite
      .prepare(`SELECT id FROM user_account WHERE LOWER(email) = LOWER(?) AND id != ?`)
      .get(input.email, userId);
    if (taken) {
      throw new DomainError('DUPLICATE', `${input.email} is already used by another sign-in.`, {
        httpStatus: 409,
      });
    }
    await withTx(ctx.sqlite, async () => {
      await ctx.sqlite
        .prepare(`UPDATE user_account SET email = ?, updated_at = ?, updated_by = ? WHERE id = ?`)
        .run(input.email, ctx.now, p.userId, userId);
      await audit(
        ctx,
        'user.account.updated',
        'user_account',
        userId,
        { email: user.email },
        {
          email: input.email,
        },
      );
    });
    return { ok: true, message: `Sign-in email is now ${input.email}.` };
  }

  await authorizeAction(ctx, 'employee.update', user.employeeId);
  if (input.expectedVersion == null) {
    throw new DomainError('VERSION_REQUIRED', 'Reload the page and try the edit again.', {
      httpStatus: 400,
    });
  }
  const employee = (await ctx.sqlite
    .prepare(
      `SELECT id, employee_code AS code, first_name AS "firstName", last_name AS "lastName",
              work_email AS email, version
         FROM employee WHERE id = ?`,
    )
    .get(user.employeeId)) as
    | {
        id: string;
        code: string;
        firstName: string;
        lastName: string;
        email: string;
        version: number;
      }
    | undefined;
  if (!employee) throw new DomainError('NOT_FOUND', 'Employee not found.', { httpStatus: 404 });
  if (Number(employee.version) !== input.expectedVersion) {
    throw new DomainError('CONFLICT', 'This record has already changed. Reload and try again.', {
      httpStatus: 409,
    });
  }
  const firstName = input.firstName ?? employee.firstName;
  const lastName = input.lastName ?? employee.lastName;
  const email = input.email ?? employee.email;
  const code = input.employeeCode ?? employee.code;
  if (code !== employee.code) {
    const clash = await ctx.sqlite
      .prepare(`SELECT id FROM employee WHERE employee_code = ? AND id != ?`)
      .get(code, employee.id);
    if (clash) {
      throw new DomainError('DUPLICATE', `Employee ID '${code}' is already in use.`, {
        httpStatus: 409,
      });
    }
  }
  if (email.toLowerCase() !== employee.email.toLowerCase()) {
    const clash = await ctx.sqlite
      .prepare(
        `SELECT id FROM employee WHERE LOWER(work_email) = LOWER(?) AND id != ?
         UNION SELECT id FROM user_account WHERE LOWER(email) = LOWER(?) AND id != ?`,
      )
      .get(email, employee.id, email, userId);
    if (clash) {
      throw new DomainError('DUPLICATE', `Work email '${email}' is already in use.`, {
        httpStatus: 409,
      });
    }
  }
  const version = Number(employee.version) + 1;
  await withTx(ctx.sqlite, async () => {
    const bump = await ctx.sqlite
      .prepare(
        `UPDATE employee SET employee_code = ?, first_name = ?, last_name = ?, work_email = ?,
                version = ?, updated_at = ?, updated_by = ? WHERE id = ? AND version = ?`,
      )
      .run(
        code,
        firstName,
        lastName,
        email,
        version,
        ctx.now,
        p.userId,
        employee.id,
        input.expectedVersion,
      );
    if (bump.changes !== 1) {
      throw new DomainError('CONFLICT', 'This record has already changed. Reload and try again.', {
        httpStatus: 409,
      });
    }
    await ctx.sqlite
      .prepare(`UPDATE user_account SET email = ?, updated_at = ?, updated_by = ? WHERE id = ?`)
      .run(email, ctx.now, p.userId, userId);
    await audit(
      ctx,
      'employee.updated',
      'employee',
      employee.id,
      {
        employeeCode: employee.code,
        firstName: employee.firstName,
        lastName: employee.lastName,
        workEmail: employee.email,
      },
      { employeeCode: code, firstName, lastName, workEmail: email },
    );
  });
  return { ok: true, version, message: `${firstName} ${lastName} was updated.` };
}

/**
 * Creates a sign-in for an employee who has none. The temporary password is returned once
 * and must be changed at first sign-in. They can sign in with the email or their employee ID.
 */
export async function createLogin(
  ctx: RequestContext,
  input: { employeeId: string; email?: string | null; roles: RoleCode[] },
) {
  const p = requirePrincipal(ctx);
  await authorizeAction(ctx, 'user.account.create', null);
  if (input.roles.length) await authorizeAction(ctx, 'role.assign', null);
  const emp = (await ctx.sqlite
    .prepare(
      `SELECT e.id, e.employee_code AS code, e.first_name || ' ' || e.last_name AS name,
              e.work_email AS email, e.status
         FROM employee e WHERE e.id = ?`,
    )
    .get(input.employeeId)) as
    { id: string; code: string; name: string; email: string; status: string } | undefined;
  if (!emp) throw new DomainError('NOT_FOUND', 'Employee not found.', { httpStatus: 404 });
  if (emp.status === 'exited') {
    throw new DomainError('INACTIVE', `${emp.name} has left the company.`, { httpStatus: 409 });
  }
  const existing = await ctx.sqlite
    .prepare(`SELECT id FROM user_account WHERE employee_id = ?`)
    .get(emp.id);
  if (existing) {
    throw new DomainError('HAS_ACCOUNT', `${emp.name} already has a sign-in.`, { httpStatus: 409 });
  }
  const email = (input.email || emp.email).trim().toLowerCase();
  const taken = await ctx.sqlite
    .prepare(`SELECT id FROM user_account WHERE LOWER(email) = ?`)
    .get(email);
  if (taken) {
    throw new DomainError('DUPLICATE', `${email} is already used by another sign-in.`, {
      httpStatus: 409,
    });
  }
  const roles: RoleCode[] = input.roles.length ? [...new Set(input.roles)] : ['employee'];
  assertMayGrantAdmin(p.roles.includes('admin'), roles, []);
  const temp = generateTemporaryPassword();
  const hash = await hashPassword(temp);
  const userId = newId();
  await withTx(ctx.sqlite, async () => {
    await ctx.sqlite
      .prepare(
        `INSERT INTO user_account (id, employee_id, email, password_hash, password_algo, must_change_password, is_disabled, created_at, created_by, updated_at, updated_by)
         VALUES (?, ?, ?, ?, 'argon2id', 1, 0, ?, ?, ?, ?)`,
      )
      .run(userId, emp.id, email, hash, ctx.now, p.userId, ctx.now, p.userId);
    for (const code of roles) {
      const role = (await ctx.sqlite.prepare(`SELECT id FROM role WHERE code = ?`).get(code)) as
        { id: string } | undefined;
      if (!role) continue;
      await ctx.sqlite
        .prepare(
          `INSERT INTO user_role (user_account_id, role_id, granted_by, granted_at) VALUES (?, ?, ?, ?)`,
        )
        .run(userId, role.id, p.userId, ctx.now);
    }
    await audit(ctx, 'user.account.created', 'user_account', userId, null, {
      employeeId: emp.id,
      email,
      roles,
    });
  });
  return {
    userId,
    email,
    employeeCode: emp.code,
    temporaryPassword: temp,
    message: `${emp.name} can now sign in with ${email} or ${emp.code}. Give them the temporary password; they will choose their own at first sign-in.`,
  };
}
