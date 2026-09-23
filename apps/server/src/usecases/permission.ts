import { DomainError, newId } from '@sns/domain';
import { authorizeAction, requirePrincipal, type RequestContext } from '../ctx.js';
import { requesterKindOf, resolveApprover } from './leave.js';

const MONTHLY_HOURS = 2;

function monthBounds(iso: string): { start: string; end: string } {
  const month = Number(iso.slice(5, 7));
  const year = Number(iso.slice(0, 4));
  const start = `${iso.slice(0, 7)}-01`;
  const end =
    month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;
  return { start, end };
}

async function notify(
  ctx: RequestContext,
  userId: string,
  kind: string,
  title: string,
  body: string,
  entityId: string,
) {
  await ctx.sqlite
    .prepare(
      `INSERT INTO notification (id, recipient_user_id, kind, title, body, entity_type, entity_id, created_at)
       VALUES (?, ?, ?, ?, ?, 'permission_request', ?, ?)`,
    )
    .run(newId(), userId, kind, title, body, entityId, ctx.now);
}

/** A short absence of 1 or 2 hours. Two hours are allowed each calendar month. */
export async function submitPermission(
  ctx: RequestContext,
  input: { onDate: string; hours: 1 | 2; reason: string },
) {
  const p = requirePrincipal(ctx);
  if (!p.employeeId) {
    throw new DomainError('NO_EMPLOYEE', 'This account is not linked to an employee.', {
      httpStatus: 409,
    });
  }
  await authorizeAction(ctx, 'leave.request.create', p.employeeId);
  if (input.hours !== 1 && input.hours !== 2) {
    throw new DomainError('PERMISSION_HOURS', 'Permission is 1 hour or 2 hours.', {
      httpStatus: 400,
    });
  }
  const { start, end } = monthBounds(input.onDate);
  const used = (await ctx.sqlite
    .prepare(
      `SELECT COALESCE(SUM(hours), 0) AS hours FROM permission_request
        WHERE employee_id = ? AND status IN ('pending_approval', 'approved')
          AND on_date >= ? AND on_date < ?`,
    )
    .get(p.employeeId, start, end)) as { hours: number };
  const left = MONTHLY_HOURS - Number(used.hours);
  if (input.hours > left) {
    throw new DomainError(
      'PERMISSION_LIMIT',
      left <= 0
        ? 'The 2 hours of permission for this month are already used.'
        : `Only ${left} hour${left === 1 ? '' : 's'} of permission left this month.`,
      { httpStatus: 409 },
    );
  }
  const kind = await requesterKindOf(ctx, p.employeeId);
  const routing = await resolveApprover(ctx, p.employeeId, p.userId, kind);
  const id = newId();
  await ctx.sqlite
    .prepare(
      `INSERT INTO permission_request (
         id, employee_id, on_date, hours, reason, status, approver_employee_id, created_at, created_by
       ) VALUES (?, ?, ?, ?, ?, 'pending_approval', ?, ?, ?)`,
    )
    .run(
      id,
      p.employeeId,
      input.onDate,
      input.hours,
      input.reason,
      routing.approverEmployeeId,
      ctx.now,
      p.userId,
    );
  const label = `${input.hours} hour${input.hours === 1 ? '' : 's'} on ${input.onDate}`;
  await notify(
    ctx,
    p.userId,
    'permission.submitted',
    'Permission submitted',
    `Your permission for ${label} is with your approver. ${left - input.hours} hour(s) remain this month.`,
    id,
  );
  if (routing.approverUserId && routing.approverUserId !== p.userId) {
    await notify(
      ctx,
      routing.approverUserId,
      'permission.submitted',
      'Permission to decide',
      `${p.email} asked for ${label}. ${input.reason}`,
      id,
    );
  }
  return { id, hours: input.hours, remainingHours: left - input.hours };
}

export async function decidePermission(
  ctx: RequestContext,
  id: string,
  decision: 'approve' | 'reject',
  note?: string,
) {
  const p = requirePrincipal(ctx);
  const row = (await ctx.sqlite
    .prepare(
      `SELECT id, employee_id AS "employeeId", on_date AS "onDate", hours, status,
              approver_employee_id AS "approverEmployeeId"
         FROM permission_request WHERE id = ?`,
    )
    .get(id)) as
    | {
        id: string;
        employeeId: string;
        onDate: string;
        hours: number;
        status: string;
        approverEmployeeId: string | null;
      }
    | undefined;
  if (!row)
    throw new DomainError('NOT_FOUND', 'Permission request not found.', { httpStatus: 404 });
  if (row.status !== 'pending_approval') {
    throw new DomainError('CONFLICT', 'This permission has already been decided.', {
      httpStatus: 409,
    });
  }
  const assigned = row.approverEmployeeId != null && row.approverEmployeeId === p.employeeId;
  if (!assigned) {
    await authorizeAction(
      ctx,
      decision === 'approve' ? 'leave.request.approve' : 'leave.request.reject',
      row.employeeId,
    );
  }
  await ctx.sqlite
    .prepare(
      `UPDATE permission_request SET status = ?, decided_at = ?, decision_note = ? WHERE id = ?`,
    )
    .run(decision === 'approve' ? 'approved' : 'rejected', ctx.now, note ?? null, id);
  const owner = (await ctx.sqlite
    .prepare(`SELECT id FROM user_account WHERE employee_id = ?`)
    .get(row.employeeId)) as { id: string } | undefined;
  if (owner) {
    const label = `${row.hours} hour${row.hours === 1 ? '' : 's'} on ${row.onDate}`;
    await notify(
      ctx,
      owner.id,
      decision === 'approve' ? 'permission.approved' : 'permission.rejected',
      decision === 'approve' ? 'Permission approved' : 'Permission rejected',
      decision === 'approve'
        ? `Your permission for ${label} has been approved.`
        : `Your permission for ${label} has been rejected.${note ? ` Reason: ${note}` : ''}`,
      id,
    );
  }
  return { id, status: decision === 'approve' ? 'approved' : 'rejected' };
}
