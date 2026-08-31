import { withTx } from '@sns/database';
import {
  ConflictError,
  DomainError,
  applyTransition,
  classifyRequestDays,
  formatDisplayDate,
  formatHalfDays,
  holdQuantity,
  newId,
  releaseQuantity,
  requesterKindFromRoles,
  resolveEscalation,
  shouldSelfApprove,
  skippedSummary,
  sumHalfDays,
  totalCountedHalfDays,
  validatePolicyAgainstRequest,
  type DayPortion,
  type Holiday,
  type LeavePolicyRules,
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
  return {
    workingDays: formatHalfDays(counted),
    countedHalfDays: counted,
    skipped: skippedSummary(days),
    days,
    available: formatHalfDays(available),
    after: formatHalfDays(available - counted),
    leaveTypeName: type?.name ?? '',
    overlaps: overlaps.map((o) => ({
      name: o.name,
      when: `${formatDisplayDate(o.start_date)} – ${formatDisplayDate(o.end_date)}`,
    })),
    approver: 'HR Officer',
  };
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
  const kind = requesterKindFromRoles(roles.length ? roles : ['employee']);
  const workflow = await pickWorkflow(ctx, kind);
  const routing = await resolveApprover(ctx, kind, p.userId);
  const id = newId();
  await withTx(ctx.sqlite, async () => {
    await ctx.sqlite
      .prepare(
        `INSERT INTO leave_request (
           id, employee_id, leave_type_id, policy_version_id, start_date, end_date, half_day_start, half_day_end,
           total_half_days, reason, status, workflow_id, current_step_no, submitted_at, was_self_approved,
           escalation_reason, submitted_by, attachment_id, created_at, created_by, updated_at, updated_by
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_approval', ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        `INSERT INTO approval_step_instance (id, leave_request_id, step_no, approver_user_id, approver_employee_id, status)
         VALUES (?, ?, 1, ?, ?, 'pending')`,
      )
      .run(newId(), id, routing.approverUserId, routing.approverEmployeeId);
    await notify(
      ctx,
      routing.approverUserId,
      'leave.submitted',
      'Leave request awaiting a decision',
      `${emp.first_name} ${emp.last_name} submitted a request.`,
      'leave_request',
      id,
    );
    await queueEmail(ctx, routing.approverUserId, emp, input, counted, id);
    await audit(ctx, 'leave.request.submitted', 'leave_request', id, null, { id, onBehalf });
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
async function resolveApprover(
  ctx: RequestContext,
  kind: ReturnType<typeof requesterKindFromRoles>,
  requesterUserId: string,
) {
  const wantRole = kind === 'hr_officer' || kind === 'admin' ? 'admin' : 'hr_officer';
  const candidates = (await ctx.sqlite
    .prepare(
      `SELECT ua.id AS userId, ua.employee_id AS employeeId, ua.is_disabled
       FROM user_account ua
       JOIN user_role ur ON ur.user_account_id = ua.id
       JOIN role r ON r.id = ur.role_id
       WHERE r.code = ?`,
    )
    .all(wantRole)) as {
    userId: string;
    employeeId: string | null;
    is_disabled: number;
  }[];
  const active = candidates.filter((c) => c.is_disabled === 0);
  const escalation = resolveEscalation({
    hasActiveHr: wantRole !== 'hr_officer' || active.length > 0,
    allHrDisabled: wantRole === 'hr_officer' && candidates.length > 0 && active.length === 0,
    assignedHrOnLeave: await assignedOnLeave(ctx, active[0]?.employeeId ?? null),
    slaElapsed: false,
  });
  let pool = active;
  if (escalation && wantRole === 'hr_officer') {
    pool = (await ctx.sqlite
      .prepare(
        `SELECT ua.id AS userId, ua.employee_id AS employeeId, ua.is_disabled
         FROM user_account ua JOIN user_role ur ON ur.user_account_id = ua.id
         JOIN role r ON r.id = ur.role_id WHERE r.code = 'admin' AND ua.is_disabled = 0`,
      )
      .all()) as typeof active;
  }
  const decision = shouldSelfApprove({
    requesterUserId,
    candidateApproverUserIds: pool.map((c) => c.userId),
    requesterIsAdmin: kind === 'admin',
  });
  const chosen = pool.find((c) => c.userId === decision.approverUserId) ?? pool[0];
  if (!chosen) throw new DomainError('NO_APPROVER', 'No approver is available.');
  return {
    approverUserId: chosen.userId,
    approverEmployeeId: chosen.employeeId,
    selfApproved: decision.selfApproved,
    escalation,
  };
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
  if (input.decision === 'approve' && isSelf) {
    await authorizeAction(ctx, 'leave.request.self_approve', req.employee_id);
  } else if (input.decision === 'approve') {
    await authorizeAction(ctx, 'leave.request.approve', req.employee_id);
  } else {
    await authorizeAction(ctx, 'leave.request.reject', req.employee_id);
  }
  if (
    p.roles.includes('manager') &&
    !p.roles.includes('hr_officer') &&
    !p.roles.includes('admin')
  ) {
    throw new ForbiddenErrorSilent();
  }
  if (isSelf && p.roles.includes('hr_officer') && !p.roles.includes('admin')) {
    throw new DomainError('LEAVE_SELF_FORBIDDEN', 'HR requests are decided by an administrator.', {
      httpStatus: 403,
    });
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
export { audit, ForbiddenErrorSilent, holidaysForEmployee, currentPolicy, availableHalfDays };
