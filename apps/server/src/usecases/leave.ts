import { withTx } from '@sns/database';
import {
  ConflictError,
  DomainError,
  applyTransition,
  classifyRequestDays,
  formatDisplayDate,
  formatHalfDays,
  holdQuantity,
  leaveRangesOverlap,
  newId,
  releaseQuantity,
  NoApproverError,
  describeApprover,
  describeEscalation,
  requesterKindFrom,
  resolveApproverChain,
  roleRungsFor,
  skippedSummary,
  sumHalfDays,
  totalCountedHalfDays,
  validatePolicyAgainstRequest,
  type DayPortion,
  type ApproverCandidate,
  type Holiday,
  type LeavePolicyRules,
  type RequesterKind,
  type ResolvedApprover,
  type RoleCode,
} from '@sns/domain';
import { authorizeAction, requirePrincipal, type RequestContext } from '../ctx.js';
import { previewLeaveEmail } from '../email.js';
import { currentPeriodId } from './setup.js';
type LeaveRow = {
  id: string;
  employee_id: string;
  leave_type_id: string;
  policy_version_id: string;
  start_date: string;
  end_date: string;
  half_day_start: DayPortion | null;
  half_day_end: DayPortion | null;
  total_half_days: number;
  reason: string;
  status: string;
  version: number;
  was_self_approved: number;
  current_step_no: number | null;
  workflow_id: string | null;
};
async function holidaysForEmployee(ctx: RequestContext, employeeId: string): Promise<Holiday[]> {
  const emp = (await ctx.sqlite
    .prepare(
      `SELECT l.holiday_calendar_id AS cid FROM employee e LEFT JOIN location l ON l.id = e.location_id WHERE e.id = ?`,
    )
    .get(employeeId)) as
    | {
        cid: string | null;
      }
    | undefined;
  let cid = emp?.cid;
  if (!cid) {
    const defaultCal = (await ctx.sqlite
      .prepare(`SELECT id FROM holiday_calendar ORDER BY year DESC LIMIT 1`)
      .get()) as { id: string } | undefined;
    cid = defaultCal?.id ?? null;
  }
  if (!cid) return [];
  return (await ctx.sqlite
    .prepare(`SELECT date, kind, name FROM holiday WHERE holiday_calendar_id = ?`)
    .all(cid)) as Holiday[];
}
async function currentPolicy(
  ctx: RequestContext,
  leaveTypeId: string,
): Promise<{
  id: string;
  rules: LeavePolicyRules;
}> {
  const row = (await ctx.sqlite
    .prepare(
      `SELECT id, rules_json FROM leave_policy_version
       WHERE leave_type_id = ? AND published_at IS NOT NULL AND effective_from <= ?
       ORDER BY version_no DESC LIMIT 1`,
    )
    .get(leaveTypeId, ctx.today)) as
    | {
        id: string;
        rules_json: string;
      }
    | undefined;
  if (!row)
    throw new DomainError('LEAVE_NO_POLICY', 'No published policy exists for this leave type.');
  return { id: row.id, rules: JSON.parse(row.rules_json) as LeavePolicyRules };
}
async function hasOwnOverlappingLeave(
  ctx: RequestContext,
  employeeId: string,
  range: {
    startDate: string;
    endDate: string;
    halfDayStart: DayPortion | null;
    halfDayEnd: DayPortion | null;
    ignoreRequestId?: string;
  },
): Promise<boolean> {
  const rows = (await ctx.sqlite
    .prepare(
      `SELECT id, start_date, end_date, half_day_start, half_day_end
       FROM leave_request
       WHERE employee_id = ?
         AND status IN ('pending_approval','approved','cancellation_requested')
         AND start_date <= ? AND end_date >= ?`,
    )
    .all(employeeId, range.endDate, range.startDate)) as {
    id: string;
    start_date: string;
    end_date: string;
    half_day_start: DayPortion | null;
    half_day_end: DayPortion | null;
  }[];
  return rows.some((row) => {
    if (range.ignoreRequestId && row.id === range.ignoreRequestId) return false;
    return leaveRangesOverlap(
      {
        startDate: range.startDate,
        endDate: range.endDate,
        halfDayStart: range.halfDayStart,
        halfDayEnd: range.halfDayEnd,
      },
      {
        startDate: row.start_date,
        endDate: row.end_date,
        halfDayStart: row.half_day_start,
        halfDayEnd: row.half_day_end,
      },
    );
  });
}

async function availableHalfDays(
  ctx: RequestContext,
  employeeId: string,
  leaveTypeId: string,
  periodId: string,
): Promise<number> {
  const rows = (await ctx.sqlite
    .prepare(
      `SELECT quantity_half_days AS quantityHalfDays, entry_type AS entryType FROM balance_ledger
       WHERE employee_id = ? AND leave_type_id = ? AND period_id = ?`,
    )
    .all(employeeId, leaveTypeId, periodId)) as {
    quantityHalfDays: number;
    entryType: string;
  }[];
  return sumHalfDays(
    rows.map((r) => ({ quantityHalfDays: r.quantityHalfDays, entryType: 'OPENING' as const })),
  );
}
export async function previewLeave(
  ctx: RequestContext,
  input: {
    leaveTypeId: string;
    startDate: string;
    endDate: string;
    halfDayStart?: DayPortion;
    halfDayEnd?: DayPortion;
    employeeId?: string;
  },
) {
  const p = requirePrincipal(ctx);
  const employeeId = input.employeeId ?? p.employeeId;
  if (!employeeId)
    throw new DomainError('NO_EMPLOYEE', 'This account is not linked to an employee.');
  await authorizeAction(ctx, 'leave.request.create', employeeId);
  const days = classifyRequestDays({
    startDate: input.startDate,
    endDate: input.endDate,
    holidays: await holidaysForEmployee(ctx, employeeId),
    halfDayStart: input.halfDayStart ?? null,
    halfDayEnd: input.halfDayEnd ?? null,
  });
  const counted = totalCountedHalfDays(days);
  const periodId = await currentPeriodId(ctx);
  const available = await availableHalfDays(ctx, employeeId, input.leaveTypeId, periodId);
  const type = (await ctx.sqlite
    .prepare(`SELECT name FROM leave_type WHERE id = ?`)
    .get(input.leaveTypeId)) as
    | {
        name: string;
      }
    | undefined;
  const overlaps = (await ctx.sqlite
    .prepare(
      `SELECT e.first_name || ' ' || e.last_name AS name, r.start_date, r.end_date
       FROM leave_request r JOIN employee e ON e.id = r.employee_id
       WHERE r.status IN ('pending_approval','approved') AND r.employee_id != ?
         AND r.start_date <= ? AND r.end_date >= ?`,
    )
    .all(employeeId, input.endDate, input.startDate)) as {
    name: string;
    start_date: string;
    end_date: string;
  }[];
  const ownOverlap = await hasOwnOverlappingLeave(ctx, employeeId, {
    startDate: input.startDate,
    endDate: input.endDate,
    halfDayStart: input.halfDayStart ?? null,
    halfDayEnd: input.halfDayEnd ?? null,
  });
  return {
    workingDays: formatHalfDays(counted),
    countedHalfDays: counted,
    skipped: skippedSummary(days),
    days,
    available: formatHalfDays(available),
    after: formatHalfDays(available - counted),
    leaveTypeName: type?.name ?? '',
    ownOverlap,
    overlaps: overlaps.map((o) => ({
      name: o.name,
      when: `${formatDisplayDate(o.start_date)} – ${formatDisplayDate(o.end_date)}`,
    })),
    approver: await (async () => {
      const targetAccount = (await ctx.sqlite
        .prepare(`SELECT id FROM user_account WHERE employee_id = ?`)
        .get(employeeId)) as { id: string } | undefined;
      return describeRouteFor(ctx, employeeId, targetAccount?.id ?? p.userId);
    })(),
  };
}
/**
 * Plain-English description of who will decide a request, shown before it is submitted so
 * nobody has to guess where their leave went.
 */
async function describeRouteFor(
  ctx: RequestContext,
  employeeId: string,
  requesterUserId: string,
): Promise<string> {
  try {
    const kind = await requesterKindOf(ctx, employeeId);
    const routing = await resolveApprover(ctx, employeeId, requesterUserId, kind);
    const who = routing.approverEmployeeId
      ? ((await ctx.sqlite
          .prepare(`SELECT first_name || ' ' || last_name AS name FROM employee WHERE id = ?`)
          .get(routing.approverEmployeeId)) as { name: string } | undefined)
      : undefined;
    const role = describeApprover(routing.approverKind, routing.approverRole);
    const label = who?.name ? `${who.name} (${role.toLowerCase()})` : role;
    if (routing.selfApproved) {
      return `You (${role.toLowerCase()}) — recorded as a self-approval, because nobody is above you`;
    }
    if (routing.delegatedFromEmployeeId) {
      const from = (await ctx.sqlite
        .prepare(`SELECT first_name || ' ' || last_name AS name FROM employee WHERE id = ?`)
        .get(routing.delegatedFromEmployeeId)) as { name: string } | undefined;
      return `${who?.name ?? role} — covering for ${from?.name ?? 'your usual approver'}`;
    }
    if (routing.escalation) {
      return `${label} — escalated because ${describeEscalation(routing.escalation)}`;
    }
    return label;
  } catch {
    // Never let the preview fail because routing cannot be resolved; submitting will
    // report the real reason.
    return 'No approver available yet';
  }
}

/** Where this person sits in the chain: team lead, department head, HR, admin, or member. */
export async function requesterKindOf(
  ctx: RequestContext,
  employeeId: string,
): Promise<RequesterKind> {
  const roles = (
    (await ctx.sqlite
      .prepare(
        `SELECT r.code FROM user_role ur JOIN role r ON r.id = ur.role_id
           JOIN user_account ua ON ua.id = ur.user_account_id WHERE ua.employee_id = ?`,
      )
      .all(employeeId)) as { code: RoleCode }[]
  ).map((r) => r.code);
  const lead = (await ctx.sqlite
    .prepare(`SELECT id FROM team WHERE lead_employee_id = ? AND archived_at IS NULL LIMIT 1`)
    .get(employeeId)) as { id: string } | undefined;
  const head = (await ctx.sqlite
    .prepare(`SELECT id FROM department WHERE head_employee_id = ? AND archived_at IS NULL LIMIT 1`)
    .get(employeeId)) as { id: string } | undefined;
  return requesterKindFrom({
    roles: roles.length ? roles : ['employee'],
    leadsTeamId: lead?.id ?? null,
    headsDepartmentId: head?.id ?? null,
  });
}

export async function submitLeave(
  ctx: RequestContext,
  input: {
    leaveTypeId: string;
    startDate: string;
    endDate: string;
    halfDayStart?: DayPortion | null;
    halfDayEnd?: DayPortion | null;
    reason: string;
    employeeId?: string;
    attachmentId?: string | null;
    idempotencyKey?: string;
  },
) {
  const p = requirePrincipal(ctx);
  const employeeId = input.employeeId ?? p.employeeId;
  if (!employeeId)
    throw new DomainError('NO_EMPLOYEE', 'This account is not linked to an employee.');
  const onBehalf = Boolean(input.employeeId && input.employeeId !== p.employeeId);
  await authorizeAction(
    ctx,
    onBehalf ? 'leave.request.create' : 'leave.request.create',
    employeeId,
  );
  if (input.idempotencyKey) {
    const prior = (await ctx.sqlite
      .prepare(`SELECT response_json FROM idempotency_key WHERE scope = 'leave.submit' AND key = ?`)
      .get(input.idempotencyKey)) as
      | {
          response_json: string;
        }
      | undefined;
    if (prior?.response_json) return JSON.parse(prior.response_json);
  }
  const emp = (await ctx.sqlite.prepare(`SELECT * FROM employee WHERE id = ?`).get(employeeId)) as {
    status: string;
    joined_on: string;
    probation_end_on: string | null;
    first_name: string;
    last_name: string;
  };
  const policy = await currentPolicy(ctx, input.leaveTypeId);
  const days = classifyRequestDays({
    startDate: input.startDate,
    endDate: input.endDate,
    holidays: await holidaysForEmployee(ctx, employeeId),
    halfDayStart: input.halfDayStart ?? null,
    halfDayEnd: input.halfDayEnd ?? null,
  });
  const counted = totalCountedHalfDays(days);
  const periodId = await currentPeriodId(ctx);
  const available = await availableHalfDays(ctx, employeeId, input.leaveTypeId, periodId);
  validatePolicyAgainstRequest({
    rules: policy.rules,
    countedHalfDays: counted,
    startDate: input.startDate,
    today: ctx.today,
    joinedOn: emp.joined_on,
    probationEndOn: emp.probation_end_on,
    employeeStatus: emp.status,
    halfDayStart: input.halfDayStart ?? null,
    halfDayEnd: input.halfDayEnd ?? null,
    hasAttachment: Boolean(input.attachmentId),
    availableHalfDays: available,
  });
  if (
    await hasOwnOverlappingLeave(ctx, employeeId, {
      startDate: input.startDate,
      endDate: input.endDate,
      halfDayStart: input.halfDayStart ?? null,
      halfDayEnd: input.halfDayEnd ?? null,
    })
  ) {
    throw new DomainError('LEAVE_OVERLAP', 'These dates overlap an existing leave request.', {
      httpStatus: 409,
      details: [
        {
          path: 'startDate',
          message: 'Choose dates that do not overlap a pending or approved request.',
        },
      ],
    });
  }
  const roles = (
    (await ctx.sqlite
      .prepare(
        `SELECT r.code FROM user_role ur JOIN role r ON r.id = ur.role_id
       JOIN user_account ua ON ua.id = ur.user_account_id WHERE ua.employee_id = ?`,
      )
      .all(employeeId)) as {
      code: RoleCode;
    }[]
  ).map((r) => r.code);
  // Position in the org structure decides the chain, not only the account's role: a
  // team lead is an ordinary employee account that happens to lead a team.
  void roles;
  const empAccount = (await ctx.sqlite
    .prepare(`SELECT id FROM user_account WHERE employee_id = ?`)
    .get(employeeId)) as { id: string } | undefined;
  const requesterUserId = empAccount?.id ?? p.userId;
  const kind = await requesterKindOf(ctx, employeeId);
  const workflow = await pickWorkflow(ctx, kind);
  const routing = await resolveApprover(ctx, employeeId, requesterUserId, kind);
  const id = newId();
  await withTx(ctx.sqlite, async () => {
    await ctx.sqlite
      .prepare(
        `INSERT INTO leave_request (
           id, employee_id, leave_type_id, policy_version_id, start_date, end_date, half_day_start, half_day_end,
           total_half_days, reason, status, workflow_id, current_step_no, submitted_at, was_self_approved,
           escalation_reason, approver_kind, submitted_by, attachment_id, created_at, created_by, updated_at, updated_by
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_approval', ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        employeeId,
        input.leaveTypeId,
        policy.id,
        input.startDate,
        input.endDate,
        input.halfDayStart ?? null,
        input.halfDayEnd ?? null,
        counted,
        input.reason,
        workflow.id,
        ctx.now,
        routing.selfApproved ? 1 : 0,
        routing.escalation,
        routing.approverKind,
        p.userId,
        input.attachmentId ?? null,
        ctx.now,
        p.userId,
        ctx.now,
        p.userId,
      );
    const insertDay = ctx.sqlite
      .prepare(`INSERT INTO leave_request_day (id, leave_request_id, date, portion, is_counted, skip_reason)
       VALUES (?, ?, ?, ?, ?, ?)`);
    for (const d of days) {
      await insertDay.run(newId(), id, d.date, d.portion, d.isCounted ? 1 : 0, d.skipReason);
    }
    await ctx.sqlite
      .prepare(
        `INSERT INTO balance_ledger (id, employee_id, leave_type_id, period_id, entry_type, quantity_half_days, effective_on, source_type, source_id, created_by, created_at)
         VALUES (?, ?, ?, ?, 'PENDING_HOLD', ?, ?, 'leave_request', ?, ?, ?)`,
      )
      .run(
        newId(),
        employeeId,
        input.leaveTypeId,
        periodId,
        holdQuantity(counted),
        input.startDate,
        id,
        p.userId,
        ctx.now,
      );
    await ctx.sqlite
      .prepare(
        `INSERT INTO approval_step_instance (id, leave_request_id, step_no, approver_user_id, approver_employee_id, status, delegated_from)
         VALUES (?, ?, 1, ?, ?, 'pending', ?)`,
      )
      .run(
        newId(),
        id,
        routing.approverUserId,
        routing.approverEmployeeId,
        routing.delegatedFromEmployeeId,
      );
    if (onBehalf && empAccount) {
      await notify(
        ctx,
        empAccount.id,
        'leave.submitted_on_behalf',
        'Leave submitted on your behalf',
        `${p.email} recorded a leave request on your behalf for ${input.startDate} to ${input.endDate}.`,
        'leave_request',
        id,
      );
    }
    const submitTitle = onBehalf
      ? `Leave request submitted on behalf of ${emp.first_name} ${emp.last_name}`
      : 'Leave request awaiting a decision';
    const submitBody = onBehalf
      ? `${p.email} submitted a leave request on behalf of ${emp.first_name} ${emp.last_name}.`
      : `${emp.first_name} ${emp.last_name} submitted a request.`;
    await notify(
      ctx,
      routing.approverUserId,
      'leave.submitted',
      submitTitle,
      submitBody,
      'leave_request',
      id,
    );
    await queueEmail(ctx, routing.approverUserId, emp, input, counted, id);
    await audit(
      ctx,
      onBehalf ? 'leave.request.submitted_on_behalf' : 'leave.request.submitted',
      'leave_request',
      id,
      null,
      { id, onBehalf, submittedBy: p.userId, employeeId },
    );
    if (input.idempotencyKey) {
      await ctx.sqlite
        .prepare(
          `INSERT INTO idempotency_key (key, scope, request_hash, response_json, status, created_at, expires_at)
           VALUES (?, 'leave.submit', ?, ?, 'ok', ?, ?)`,
        )
        .run(
          input.idempotencyKey,
          id,
          JSON.stringify({ id }),
          ctx.now,
          new Date(Date.now() + 86400000).toISOString(),
        );
    }
  });
  return { id };
}
async function pickWorkflow(ctx: RequestContext, kind: string) {
  const rows = (await ctx.sqlite
    .prepare(`SELECT * FROM approval_workflow WHERE is_active = 1 ORDER BY priority`)
    .all()) as {
    id: string;
    match_json: string;
  }[];
  for (const w of rows) {
    const match = JSON.parse(w.match_json) as {
      requesterRoles?: string[];
    };
    if (match.requesterRoles?.includes(kind)) return w;
  }
  const fallback = rows[0];
  if (!fallback) throw new DomainError('NO_WORKFLOW', 'No approval workflow is configured.');
  return fallback;
}
/**
 * Walks the approval hierarchy for one requester and returns the first usable approver.
 *
 * Ordinary staff are decided by their team lead, so routine leave never reaches HR. A
 * team lead goes to their department head, a department head to HR, and HR to an
 * administrator. Each rung is skipped only for a real gap — nobody appointed, the
 * approver is the person asking, or their account is disabled or they are on leave — and
 * the reason is recorded on the request so the escalation is explainable.
 */
export async function resolveApprover(
  ctx: RequestContext,
  requesterEmployeeId: string,
  requesterUserId: string,
  requesterKind: RequesterKind,
): Promise<ResolvedApprover> {
  const teamLead = await candidatesFor(
    ctx,
    `SELECT ua.id AS "userId", ua.employee_id AS "employeeId", ua.is_disabled AS "isDisabled"
       FROM employee me
       JOIN team tm ON tm.id = me.team_id
       JOIN employee lead ON lead.id = tm.lead_employee_id
       JOIN user_account ua ON ua.employee_id = lead.id
      WHERE me.id = ? AND lead.status != 'exited'`,
    [requesterEmployeeId],
  );
  const departmentHead = await candidatesFor(
    ctx,
    `SELECT ua.id AS "userId", ua.employee_id AS "employeeId", ua.is_disabled AS "isDisabled"
       FROM employee me
       JOIN department d ON d.id = me.department_id
       JOIN employee head ON head.id = d.head_employee_id
       JOIN user_account ua ON ua.employee_id = head.id
      WHERE me.id = ? AND head.status != 'exited'`,
    [requesterEmployeeId],
  );
  const roles: Record<string, ApproverCandidate[]> = {};
  for (const role of roleRungsFor(requesterKind)) {
    roles[role] = await candidatesFor(
      ctx,
      `SELECT ua.id AS "userId", ua.employee_id AS "employeeId", ua.is_disabled AS "isDisabled"
         FROM user_account ua
         JOIN user_role ur ON ur.user_account_id = ua.id
         JOIN role r ON r.id = ur.role_id
        WHERE r.code = ?`,
      [role],
    );
  }

  // An administrator's named approver for this person, if one is set.
  const overrideRows = await candidatesFor(
    ctx,
    `SELECT ua.id AS "userId", ua.employee_id AS "employeeId", ua.is_disabled AS "isDisabled"
       FROM approval_override o
       JOIN employee a ON a.id = o.approver_employee_id
       JOIN user_account ua ON ua.employee_id = a.id
      WHERE o.employee_id = ? AND a.status != 'exited'`,
    [requesterEmployeeId],
  );

  // Cover that is active today, keyed by the approver who handed over.
  const coverRows = (await ctx.sqlite
    .prepare(
      `SELECT dl.approver_employee_id AS "fromEmployeeId", ua.id AS "userId",
              ua.employee_id AS "employeeId", ua.is_disabled AS "isDisabled"
         FROM approval_delegation dl
         JOIN employee d ON d.id = dl.delegate_employee_id
         JOIN user_account ua ON ua.employee_id = d.id
        WHERE dl.starts_on <= ? AND dl.ends_on >= ? AND d.status != 'exited'
        ORDER BY dl.created_at DESC`,
    )
    .all(ctx.today, ctx.today)) as {
    fromEmployeeId: string;
    userId: string;
    employeeId: string | null;
    isDisabled: number;
  }[];
  const delegations: Record<string, ApproverCandidate> = {};
  for (const row of coverRows) {
    // Most recent delegation wins if two overlap.
    if (delegations[row.fromEmployeeId]) continue;
    delegations[row.fromEmployeeId] = {
      userId: row.userId,
      employeeId: row.employeeId,
      isDisabled: Number(row.isDisabled) === 1,
      onLeave: await assignedOnLeave(ctx, row.employeeId),
    };
  }

  try {
    return resolveApproverChain({
      requesterUserId,
      requesterKind,
      candidatesByKind: { team_lead: teamLead, department_head: departmentHead, roles },
      override: overrideRows[0] ?? null,
      delegations,
    });
  } catch (err) {
    if (err instanceof NoApproverError) {
      throw new DomainError(
        'NO_APPROVER',
        `This request cannot be routed because ${describeEscalation(err.reason)}. Ask an administrator to appoint an approver.`,
        { httpStatus: 409 },
      );
    }
    throw err;
  }
}

/** Loads one rung of the ladder and marks who is currently away. */
async function candidatesFor(
  ctx: RequestContext,
  sql: string,
  params: string[],
): Promise<ApproverCandidate[]> {
  const rows = (await ctx.sqlite.prepare(sql).all(...params)) as {
    userId: string;
    employeeId: string | null;
    isDisabled: number;
  }[];
  const out: ApproverCandidate[] = [];
  for (const r of rows) {
    out.push({
      userId: r.userId,
      employeeId: r.employeeId,
      isDisabled: Number(r.isDisabled) === 1,
      onLeave: await assignedOnLeave(ctx, r.employeeId),
    });
  }
  return out;
}

async function assignedOnLeave(ctx: RequestContext, employeeId: string | null): Promise<boolean> {
  if (!employeeId) return false;
  const row = (await ctx.sqlite
    .prepare(
      `SELECT id FROM leave_request WHERE employee_id = ? AND status = 'approved' AND start_date <= ? AND end_date >= ?`,
    )
    .get(employeeId, ctx.today, ctx.today)) as
    | {
        id: string;
      }
    | undefined;
  return Boolean(row);
}
export async function decideLeave(
  ctx: RequestContext,
  input: {
    requestId: string;
    decision: 'approve' | 'reject';
    note?: string;
    reason?: string;
    expectedVersion: number;
  },
) {
  const p = requirePrincipal(ctx);
  const req = (await ctx.sqlite
    .prepare(`SELECT * FROM leave_request WHERE id = ?`)
    .get(input.requestId)) as LeaveRow | undefined;
  if (!req) throw new ForbiddenErrorSilent();
  const isSelf = p.employeeId === req.employee_id;

  // The person the request was routed to may decide it, whatever their role. This is what
  // lets a team lead — an ordinary employee account — approve their own team's leave
  // without being handed company-wide approval rights.
  const assigned = (await ctx.sqlite
    .prepare(
      `SELECT id FROM approval_step_instance
        WHERE leave_request_id = ? AND approver_user_id = ? AND status = 'pending'`,
    )
    .get(req.id, p.userId)) as { id: string } | undefined;
  const isAssignedApprover = Boolean(assigned);

  if (input.decision === 'approve' && isSelf) {
    await authorizeAction(ctx, 'leave.request.self_approve', req.employee_id);
  } else if (!isAssignedApprover) {
    // Not the assigned approver, so this is an HR or administrator override.
    await authorizeAction(
      ctx,
      input.decision === 'approve' ? 'leave.request.approve' : 'leave.request.reject',
      req.employee_id,
    );
  }

  // Nobody decides their own request. A lone administrator is the documented exception,
  // and it is recorded as a self-approval rather than passing as an ordinary one.
  if (isSelf && !p.roles.includes('admin')) {
    throw new DomainError(
      'LEAVE_SELF_FORBIDDEN',
      'You cannot decide your own leave request. It is routed to your approver.',
      { httpStatus: 403 },
    );
  }
  const action = input.decision === 'reject' ? 'reject' : 'approve_final';
  const next = applyTransition(req.status as 'pending_approval', action, 'approver');
  await withTx(ctx.sqlite, async () => {
    const bump = await ctx.sqlite
      .prepare(
        `UPDATE leave_request SET status = ?, decided_at = ?, was_self_approved = ?, version = version + 1, updated_at = ?, updated_by = ?
         WHERE id = ? AND version = ?`,
      )
      .run(
        next,
        ctx.now,
        isSelf && input.decision === 'approve' ? 1 : req.was_self_approved,
        ctx.now,
        p.userId,
        req.id,
        input.expectedVersion,
      );
    if (bump.changes !== 1) {
      throw new ConflictError(
        'LEAVE_CONFLICT',
        'This request was already decided by someone else.',
      );
    }
    const periodId = await currentPeriodId(ctx);
    const hold = (await ctx.sqlite
      .prepare(
        `SELECT id, quantity_half_days FROM balance_ledger WHERE source_id = ? AND entry_type = 'PENDING_HOLD' ORDER BY created_at DESC LIMIT 1`,
      )
      .get(req.id)) as
      | {
          id: string;
          quantity_half_days: number;
        }
      | undefined;
    if (hold) {
      await ctx.sqlite
        .prepare(
          `INSERT INTO balance_ledger (id, employee_id, leave_type_id, period_id, entry_type, quantity_half_days, effective_on, source_type, source_id, reverses_entry_id, created_by, created_at)
           VALUES (?, ?, ?, ?, 'HOLD_RELEASE', ?, ?, 'leave_request', ?, ?, ?, ?)`,
        )
        .run(
          newId(),
          req.employee_id,
          req.leave_type_id,
          periodId,
          releaseQuantity({ quantityHalfDays: hold.quantity_half_days, entryType: 'PENDING_HOLD' }),
          ctx.today,
          req.id,
          hold.id,
          p.userId,
          ctx.now,
        );
    }
    if (input.decision === 'approve') {
      await ctx.sqlite
        .prepare(
          `INSERT INTO balance_ledger (id, employee_id, leave_type_id, period_id, entry_type, quantity_half_days, effective_on, source_type, source_id, created_by, created_at)
           VALUES (?, ?, ?, ?, 'DEDUCTION', ?, ?, 'leave_request', ?, ?, ?)`,
        )
        .run(
          newId(),
          req.employee_id,
          req.leave_type_id,
          periodId,
          -Math.abs(req.total_half_days),
          req.start_date,
          req.id,
          p.userId,
          ctx.now,
        );
    }
    await ctx.sqlite
      .prepare(
        `UPDATE approval_step_instance SET status = ?, decided_at = ?, decision_note = ? WHERE leave_request_id = ? AND status = 'pending'`,
      )
      .run(
        input.decision === 'approve' ? 'approved' : 'rejected',
        ctx.now,
        input.note ?? input.reason ?? null,
        req.id,
      );
    const owner = (await ctx.sqlite
      .prepare(`SELECT id FROM user_account WHERE employee_id = ?`)
      .get(req.employee_id)) as
      | {
          id: string;
        }
      | undefined;
    if (owner) {
      await notify(
        ctx,
        owner.id,
        input.decision === 'approve' ? 'leave.approved' : 'leave.rejected',
        input.decision === 'approve' ? 'Leave approved' : 'Leave rejected',
        input.note ?? input.reason ?? 'A decision was recorded.',
        'leave_request',
        req.id,
      );
    }

    if (input.decision === 'approve') {
      const empDetails = (await ctx.sqlite
        .prepare(
          `SELECT e.first_name, e.last_name, e.department_id, d.head_employee_id, lt.name AS leave_type_name
           FROM employee e
           LEFT JOIN department d ON d.id = e.department_id
           LEFT JOIN leave_type lt ON lt.id = ?
           WHERE e.id = ?`,
        )
        .get(req.leave_type_id, req.employee_id)) as
        | {
            first_name: string;
            last_name: string;
            department_id: string | null;
            head_employee_id: string | null;
            leave_type_name: string | null;
          }
        | undefined;

      const approverKind = await requesterKindOf(ctx, p.employeeId ?? '');
      const recipientUserIds = new Set<string>();

      // 1. If approved by Team Lead or Department Head, include Department Head (if different from approver and employee)
      if (
        empDetails?.head_employee_id &&
        empDetails.head_employee_id !== p.employeeId &&
        empDetails.head_employee_id !== req.employee_id
      ) {
        const headAccount = (await ctx.sqlite
          .prepare(`SELECT id FROM user_account WHERE employee_id = ? AND is_disabled = 0`)
          .get(empDetails.head_employee_id)) as { id: string } | undefined;
        if (headAccount) {
          recipientUserIds.add(headAccount.id);
        }
      }

      // 2. If approved by Team Lead, Dept Head, or below, include active HR officers
      if (
        approverKind === 'team_lead' ||
        approverKind === 'department_head' ||
        approverKind === 'employee'
      ) {
        const hrAccounts = (await ctx.sqlite
          .prepare(
            `SELECT ua.id FROM user_account ua
             JOIN user_role ur ON ur.user_account_id = ua.id
             JOIN role r ON r.id = ur.role_id
             WHERE r.code = 'hr_officer' AND ua.is_disabled = 0`,
          )
          .all()) as { id: string }[];
        for (const hr of hrAccounts) {
          if (hr.id !== p.userId && hr.id !== owner?.id) {
            recipientUserIds.add(hr.id);
          }
        }
      }

      // 3. If approved by Dept Head, HR Officer, or Admin, include Administrators
      if (
        approverKind === 'department_head' ||
        approverKind === 'hr_officer' ||
        approverKind === 'admin'
      ) {
        const adminAccounts = (await ctx.sqlite
          .prepare(
            `SELECT ua.id FROM user_account ua
             JOIN user_role ur ON ur.user_account_id = ua.id
             JOIN role r ON r.id = ur.role_id
             WHERE r.code = 'admin' AND ua.is_disabled = 0`,
          )
          .all()) as { id: string }[];
        for (const adm of adminAccounts) {
          if (adm.id !== p.userId && adm.id !== owner?.id) {
            recipientUserIds.add(adm.id);
          }
        }
      }

      const empName = empDetails ? `${empDetails.first_name} ${empDetails.last_name}` : 'Employee';
      const leaveName = empDetails?.leave_type_name ?? 'Leave';
      const daysCount = (req.total_half_days / 2).toFixed(1).replace(/\.0$/, '');
      const infoTitle = `Leave Approved: ${empName}`;
      const infoBody = `${p.email} approved ${leaveName} for ${empName} (${req.start_date} to ${req.end_date}, ${daysCount} days).`;

      for (const recipientId of recipientUserIds) {
        await notify(
          ctx,
          recipientId,
          'leave.approved.informational',
          infoTitle,
          infoBody,
          'leave_request',
          req.id,
        );
      }
    }
    const auditAction =
      isSelf && input.decision === 'approve'
        ? 'leave.self_approved'
        : `leave.request.${input.decision}d`;
    await audit(
      ctx,
      auditAction,
      'leave_request',
      req.id,
      { status: req.status },
      { status: next },
    );
  });
  return { id: req.id, status: next };
}
class ForbiddenErrorSilent extends DomainError {
  constructor() {
    super('FORBIDDEN', 'You do not have permission to view this.', { httpStatus: 403 });
  }
}
export async function withdrawLeave(
  ctx: RequestContext,
  requestId: string,
  expectedVersion: number,
) {
  const p = requirePrincipal(ctx);
  const req = (await ctx.sqlite
    .prepare(`SELECT * FROM leave_request WHERE id = ?`)
    .get(requestId)) as LeaveRow | undefined;
  if (!req) throw new ForbiddenErrorSilent();
  await authorizeAction(ctx, 'leave.request.withdraw', req.employee_id);
  const next = applyTransition(req.status as 'pending_approval', 'withdraw', 'employee');
  await withTx(ctx.sqlite, async () => {
    const bump = await ctx.sqlite
      .prepare(
        `UPDATE leave_request SET status = ?, version = version + 1, updated_at = ?, updated_by = ? WHERE id = ? AND version = ?`,
      )
      .run(next, ctx.now, p.userId, req.id, expectedVersion);
    if (bump.changes !== 1)
      throw new ConflictError('LEAVE_CONFLICT', 'This request has already changed.');
    await releaseHold(ctx, req);
    await audit(
      ctx,
      'leave.request.withdrawn',
      'leave_request',
      req.id,
      { status: req.status },
      { status: next },
    );
  });
  return { id: req.id, status: next };
}
export async function requestCancellation(
  ctx: RequestContext,
  requestId: string,
  expectedVersion: number,
) {
  const p = requirePrincipal(ctx);
  const req = (await ctx.sqlite
    .prepare(`SELECT * FROM leave_request WHERE id = ?`)
    .get(requestId)) as LeaveRow | undefined;
  if (!req) throw new ForbiddenErrorSilent();
  await authorizeAction(ctx, 'leave.request.withdraw', req.employee_id);
  const next = applyTransition(req.status as 'approved', 'request_cancellation', 'employee');
  const bump = await ctx.sqlite
    .prepare(
      `UPDATE leave_request SET status = ?, version = version + 1, updated_at = ?, updated_by = ? WHERE id = ? AND version = ?`,
    )
    .run(next, ctx.now, p.userId, req.id, expectedVersion);
  if (bump.changes !== 1)
    throw new ConflictError('LEAVE_CONFLICT', 'This request has already changed.');
  await audit(
    ctx,
    'leave.cancellation.requested',
    'leave_request',
    req.id,
    { status: req.status },
    { status: next },
  );
  return { id: req.id, status: next };
}
export async function hrCancel(
  ctx: RequestContext,
  requestId: string,
  reason: string,
  expectedVersion: number,
) {
  const p = requirePrincipal(ctx);
  const req = (await ctx.sqlite
    .prepare(`SELECT * FROM leave_request WHERE id = ?`)
    .get(requestId)) as LeaveRow | undefined;
  if (!req) throw new ForbiddenErrorSilent();
  await authorizeAction(ctx, 'leave.request.cancel', req.employee_id);
  const next = applyTransition(req.status as 'approved', 'hr_cancel', 'hr');
  await withTx(ctx.sqlite, async () => {
    const bump = await ctx.sqlite
      .prepare(
        `UPDATE leave_request SET status = ?, version = version + 1, updated_at = ?, updated_by = ? WHERE id = ? AND version = ?`,
      )
      .run(next, ctx.now, p.userId, req.id, expectedVersion);
    if (bump.changes !== 1)
      throw new ConflictError('LEAVE_CONFLICT', 'This request has already changed.');
    await ctx.sqlite
      .prepare(
        `INSERT INTO balance_ledger (id, employee_id, leave_type_id, period_id, entry_type, quantity_half_days, effective_on, source_type, source_id, reason, created_by, created_at)
         VALUES (?, ?, ?, ?, 'CANCELLATION_CREDIT', ?, ?, 'leave_request', ?, ?, ?, ?)`,
      )
      .run(
        newId(),
        req.employee_id,
        req.leave_type_id,
        await currentPeriodId(ctx),
        Math.abs(req.total_half_days),
        ctx.today,
        req.id,
        reason,
        p.userId,
        ctx.now,
      );
    await audit(
      ctx,
      'leave.request.cancelled',
      'leave_request',
      req.id,
      { status: req.status },
      { status: next, reason },
    );
  });
  return { id: req.id, status: next };
}
async function releaseHold(ctx: RequestContext, req: LeaveRow) {
  const hold = (await ctx.sqlite
    .prepare(
      `SELECT id, quantity_half_days FROM balance_ledger WHERE source_id = ? AND entry_type = 'PENDING_HOLD' ORDER BY created_at DESC LIMIT 1`,
    )
    .get(req.id)) as
    | {
        id: string;
        quantity_half_days: number;
      }
    | undefined;
  if (!hold) return;
  await ctx.sqlite
    .prepare(
      `INSERT INTO balance_ledger (id, employee_id, leave_type_id, period_id, entry_type, quantity_half_days, effective_on, source_type, source_id, reverses_entry_id, created_by, created_at)
       VALUES (?, ?, ?, ?, 'HOLD_RELEASE', ?, ?, 'leave_request', ?, ?, ?, ?)`,
    )
    .run(
      newId(),
      req.employee_id,
      req.leave_type_id,
      await currentPeriodId(ctx),
      -hold.quantity_half_days,
      ctx.today,
      req.id,
      hold.id,
      ctx.principal!.userId,
      ctx.now,
    );
}
export async function adjustBalance(
  ctx: RequestContext,
  input: {
    employeeId: string;
    leaveTypeId: string;
    quantityHalfDays: number;
    reason: string;
  },
) {
  const p = requirePrincipal(ctx);
  await authorizeAction(ctx, 'leave.balance.adjust', input.employeeId);
  if (!input.reason.trim()) throw new DomainError('REASON_REQUIRED', 'A reason is required.');
  await ctx.sqlite
    .prepare(
      `INSERT INTO balance_ledger (id, employee_id, leave_type_id, period_id, entry_type, quantity_half_days, effective_on, source_type, reason, created_by, created_at)
       VALUES (?, ?, ?, ?, 'ADJUSTMENT', ?, ?, 'manual', ?, ?, ?)`,
    )
    .run(
      newId(),
      input.employeeId,
      input.leaveTypeId,
      await currentPeriodId(ctx),
      input.quantityHalfDays,
      ctx.today,
      input.reason,
      p.userId,
      ctx.now,
    );
  await audit(ctx, 'leave.balance.adjusted', 'employee', input.employeeId, null, input);
}
async function notify(
  ctx: RequestContext,
  userId: string,
  kind: string,
  title: string,
  body: string,
  entityType: string,
  entityId: string,
) {
  await ctx.sqlite
    .prepare(
      `INSERT INTO notification (id, recipient_user_id, kind, title, body, entity_type, entity_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(newId(), userId, kind, title, body, entityType, entityId, ctx.now);
}
async function queueEmail(
  ctx: RequestContext,
  approverUserId: string,
  emp: {
    first_name: string;
    last_name: string;
  },
  input: {
    startDate: string;
    endDate: string;
    leaveTypeId: string;
  },
  counted: number,
  requestId: string,
) {
  const user = (await ctx.sqlite
    .prepare(`SELECT email FROM user_account WHERE id = ?`)
    .get(approverUserId)) as
    | {
        email: string;
      }
    | undefined;
  const type = (await ctx.sqlite
    .prepare(`SELECT name FROM leave_type WHERE id = ?`)
    .get(input.leaveTypeId)) as
    | {
        name: string;
      }
    | undefined;
  const preview = previewLeaveEmail({
    to: user?.email ?? '',
    requesterName: `${emp.first_name} ${emp.last_name}`,
    leaveType: type?.name ?? '',
    dates: `${formatDisplayDate(input.startDate)} – ${formatDisplayDate(input.endDate)}`,
    workingDays: formatHalfDays(counted),
    link: `${ctx.config.publicUrl}/requests/${requestId}`,
  });
  await ctx.sqlite
    .prepare(
      `INSERT INTO outbox_message (id, kind, payload_json, status, next_attempt_at, created_at)
       VALUES (?, 'leave.submitted', ?, 'pending', ?, ?)`,
    )
    .run(
      newId(),
      JSON.stringify({
        to: preview.to,
        subject: preview.subject,
        text: `${preview.body}\n\nOpen: ${ctx.config.publicUrl}/requests/${requestId}\n(The link does not approve anything. You must sign in.)`,
      }),
      ctx.now,
      ctx.now,
    );
}
export async function recalculateLeaveRequestsForDate(
  ctx: RequestContext,
  date: string,
  _calendarId?: string,
) {
  const query = `SELECT r.* FROM leave_request r
     WHERE r.start_date <= ? AND r.end_date >= ?
       AND r.status IN ('pending_approval', 'approved', 'draft')`;

  const rows = (await ctx.sqlite.prepare(query).all(date, date)) as LeaveRow[];

  for (const req of rows) {
    const holidays = await holidaysForEmployee(ctx, req.employee_id);
    const days = classifyRequestDays({
      startDate: req.start_date,
      endDate: req.end_date,
      holidays,
      halfDayStart: req.half_day_start,
      halfDayEnd: req.half_day_end,
    });
    const counted = totalCountedHalfDays(days);

    const updateDayStmt = ctx.sqlite.prepare(
      `UPDATE leave_request_day
       SET portion = ?, is_counted = ?, skip_reason = ?
       WHERE leave_request_id = ? AND date = ?`,
    );
    for (const d of days) {
      await updateDayStmt.run(d.portion, d.isCounted ? 1 : 0, d.skipReason, req.id, d.date);
    }

    const prevCounted = req.total_half_days;
    if (counted !== prevCounted) {
      await ctx.sqlite
        .prepare(
          `UPDATE leave_request
           SET total_half_days = ?, updated_at = ?, updated_by = ?
           WHERE id = ?`,
        )
        .run(counted, ctx.now, ctx.principal?.userId ?? 'system', req.id);

      const periodId = await currentPeriodId(ctx);
      if (req.status === 'pending_approval') {
        const hold = (await ctx.sqlite
          .prepare(
            `SELECT id, quantity_half_days FROM balance_ledger WHERE source_id = ? AND entry_type = 'PENDING_HOLD' ORDER BY created_at DESC LIMIT 1`,
          )
          .get(req.id)) as { id: string; quantity_half_days: number } | undefined;
        if (hold && hold.quantity_half_days !== -counted) {
          await ctx.sqlite
            .prepare(
              `INSERT INTO balance_ledger (id, employee_id, leave_type_id, period_id, entry_type, quantity_half_days, effective_on, source_type, source_id, reverses_entry_id, created_by, created_at)
               VALUES (?, ?, ?, ?, 'HOLD_RELEASE', ?, ?, 'leave_request', ?, ?, ?, ?)`,
            )
            .run(
              newId(),
              req.employee_id,
              req.leave_type_id,
              periodId,
              -hold.quantity_half_days,
              ctx.today,
              req.id,
              hold.id,
              ctx.principal?.userId ?? 'system',
              ctx.now,
            );
          await ctx.sqlite
            .prepare(
              `INSERT INTO balance_ledger (id, employee_id, leave_type_id, period_id, entry_type, quantity_half_days, effective_on, source_type, source_id, created_by, created_at)
               VALUES (?, ?, ?, ?, 'PENDING_HOLD', ?, ?, 'leave_request', ?, ?, ?)`,
            )
            .run(
              newId(),
              req.employee_id,
              req.leave_type_id,
              periodId,
              -counted,
              req.start_date,
              req.id,
              ctx.principal?.userId ?? 'system',
              ctx.now,
            );
        }
      } else if (req.status === 'approved') {
        const diff = -(counted - prevCounted);
        if (diff !== 0) {
          await ctx.sqlite
            .prepare(
              `INSERT INTO balance_ledger (id, employee_id, leave_type_id, period_id, entry_type, quantity_half_days, effective_on, source_type, source_id, reason, created_by, created_at)
               VALUES (?, ?, ?, ?, 'ADJUSTMENT', ?, ?, 'leave_request', ?, 'Calendar working day recalculation', ?, ?)`,
            )
            .run(
              newId(),
              req.employee_id,
              req.leave_type_id,
              periodId,
              diff,
              ctx.today,
              req.id,
              ctx.principal?.userId ?? 'system',
              ctx.now,
            );
        }
      }

      await audit(
        ctx,
        'leave.request.recalculated',
        'leave_request',
        req.id,
        { total_half_days: prevCounted },
        { total_half_days: counted, reason: 'calendar_change', date },
      );
    }
  }
}

async function audit(
  ctx: RequestContext,
  action: string,
  entityType: string,
  entityId: string,
  before: unknown,
  after: unknown,
) {
  await ctx.sqlite
    .prepare(
      `INSERT INTO audit_event (id, occurred_at, actor_user_id, actor_label, action, entity_type, entity_id, before_json, after_json, request_id, ip, user_agent, result)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ok')`,
    )
    .run(
      newId(),
      ctx.now,
      ctx.principal?.userId ?? null,
      ctx.principal?.email ?? 'system',
      action,
      entityType,
      entityId,
      before ? JSON.stringify(before) : null,
      after ? JSON.stringify(after) : null,
      ctx.requestId,
      ctx.ip,
      ctx.userAgent,
    );
}
export {
  audit,
  notify,
  ForbiddenErrorSilent,
  holidaysForEmployee,
  currentPolicy,
  availableHalfDays,
};
