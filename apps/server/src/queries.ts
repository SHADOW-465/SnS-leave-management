import { formatHalfDays } from '@sns/domain';
import { authorizeAction, graphFor, requirePrincipal, type RequestContext } from './ctx.js';
import { availableHalfDays, currentPolicy, holidaysForEmployee } from './usecases/leave.js';
import { currentPeriodId } from './usecases/setup.js';
export async function dashboard(ctx: RequestContext) {
  requirePrincipal(ctx);
  // Company-wide counts and the names of who is out. Previously this ran with no
  // permission check at all, so any employee could read headcount, department leave
  // statistics, and the pending queue by calling the endpoint directly.
  await authorizeAction(ctx, 'leave.request.read', null);
  const pending = (await ctx.sqlite
    .prepare(`SELECT COUNT(*) AS n FROM leave_request WHERE status = 'pending_approval'`)
    .get()) as {
    n: number;
  };
  const outToday = (await ctx.sqlite
    .prepare(
      `SELECT e.first_name || ' ' || e.last_name AS name, t.name AS type
       FROM leave_request r JOIN employee e ON e.id = r.employee_id
       JOIN leave_type t ON t.id = r.leave_type_id
       WHERE r.status = 'approved' AND r.start_date <= ? AND r.end_date >= ?`,
    )
    .all(ctx.today, ctx.today)) as {
    name: string;
    type: string;
  }[];
  const deptStats = (await ctx.sqlite
    .prepare(
      `SELECT d.name, COALESCE(SUM(CASE WHEN r.status = 'approved' THEN r.total_half_days ELSE 0 END), 0) AS half
       FROM department d
       LEFT JOIN employee e ON e.department_id = d.id
       LEFT JOIN leave_request r ON r.employee_id = e.id
       GROUP BY d.id, d.name`,
    )
    .all()) as {
    name: string;
    half: number;
  }[];
  const max = Math.max(1, ...deptStats.map((d) => d.half));
  const weekEnd = addDays(ctx.today, 7);
  const upcoming = (await ctx.sqlite
    .prepare(
      `SELECT COUNT(*) AS n FROM leave_request
       WHERE status = 'approved' AND start_date > ? AND start_date <= ?`,
    )
    .get(ctx.today, weekEnd)) as { n: number };
  const oldestPending = (await ctx.sqlite
    .prepare(
      `SELECT submitted_at FROM leave_request
       WHERE status = 'pending_approval' AND submitted_at IS NOT NULL
       ORDER BY submitted_at LIMIT 1`,
    )
    .get()) as { submitted_at: string } | undefined;
  const headcount = (await ctx.sqlite
    .prepare(`SELECT COUNT(*) AS n FROM employee WHERE status != 'exited'`)
    .get()) as { n: number };
  // Four figures an approver can act on. Anything that cannot change a decision
  // does not belong on this row.
  const kpis = [
    {
      label: 'Awaiting decision',
      value: String(pending.n),
      delta:
        pending.n === 0
          ? 'Queue is clear'
          : oldestPending
            ? `Oldest waiting ${daysWaiting(oldestPending.submitted_at, ctx.now)}`
            : 'Needs a decision',
      deltaColor: pending.n === 0 ? '#5c5c66' : '#8a6116',
    },
    {
      label: 'Out today',
      value: String(outToday.length),
      delta:
        outToday.length === 0
          ? 'Everyone is in'
          : outToday
              .slice(0, 2)
              .map((o) => o.name)
              .join(', ') + (outToday.length > 2 ? ` +${outToday.length - 2}` : ''),
      deltaColor: '#5c5c66',
    },
    {
      label: 'Starting leave in 7 days',
      value: String(upcoming.n),
      delta: upcoming.n === 0 ? 'Nothing booked' : 'Approved and upcoming',
      deltaColor: '#5c5c66',
    },
    {
      label: 'Active employees',
      value: String(headcount.n),
      delta: 'Excludes people who have left',
      deltaColor: '#5c5c66',
    },
  ];
  return {
    kpis,
    pendingRows: (await queue(ctx, { status: 'pending_approval', search: '' })).slice(0, 8),
    deptStats: deptStats.map((d) => ({
      name: d.name,
      days: formatHalfDays(d.half),
      pct: `${Math.round((d.half / max) * 100)}%`,
      aria: `${d.name}: ${formatHalfDays(d.half)} days`,
    })),
    outToday,
  };
}
function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function daysWaiting(submittedAt: string, now: string): string {
  const days = Math.floor((Date.parse(now) - Date.parse(submittedAt)) / (24 * 60 * 60 * 1000));
  if (days <= 0) return 'since today';
  return days === 1 ? '1 day' : `${days} days`;
}
export async function myHome(ctx: RequestContext) {
  const p = requirePrincipal(ctx);
  if (!p.employeeId) return { balances: [], requests: [], probation: null };
  await authorizeAction(ctx, 'leave.balance.read', p.employeeId);
  const types = (await ctx.sqlite.prepare(`SELECT id, name, code FROM leave_type`).all()) as {
    id: string;
    name: string;
    code: string;
  }[];
  const periodId = await currentPeriodId(ctx);
  const balances = [];
  for (const t of types) {
    let rules;
    try {
      rules = (await currentPolicy(ctx, t.id)).rules;
    } catch {
      continue; // no published policy for this type yet — nothing to show a balance for
    }
    const granted = (await ctx.sqlite
      .prepare(
        `SELECT COALESCE(SUM(quantity_half_days), 0) AS n FROM balance_ledger
         WHERE employee_id = ? AND leave_type_id = ? AND period_id = ?
           AND entry_type IN ('OPENING','ACCRUAL','ENTITLEMENT_GRANT','CARRY_FORWARD','MIGRATION_OPENING','ADJUSTMENT')`,
      )
      .get(p.employeeId, t.id, periodId)) as { n: number };
    // Taken is read from the ledger itself, not inferred as entitlement minus
    // remaining — adjustments and carry-forward make that subtraction wrong.
    const used = (await ctx.sqlite
      .prepare(
        `SELECT COALESCE(SUM(-quantity_half_days), 0) AS n FROM balance_ledger
         WHERE employee_id = ? AND leave_type_id = ? AND period_id = ?
           AND entry_type IN ('DEDUCTION','ENCASHMENT','EXPIRY')`,
      )
      .get(p.employeeId, t.id, periodId)) as { n: number };
    const avail = await availableHalfDays(ctx, p.employeeId, t.id, periodId);
    // A type with no entitlement and nothing taken (typically unpaid leave) has no
    // balance to report. It stays available on the apply form; it just does not earn
    // a card that reads "0 / 0".
    if (granted.n <= 0 && used.n <= 0) continue;
    const pct = granted.n > 0 ? Math.min(100, Math.round((used.n / granted.n) * 100)) : 0;
    balances.push({
      id: t.id,
      name: t.name,
      code: t.code,
      left: formatHalfDays(avail),
      total: formatHalfDays(granted.n),
      taken: formatHalfDays(used.n),
      unlimited: granted.n <= 0 && rules.negativeBalanceAllowed,
      note:
        granted.n <= 0 && rules.negativeBalanceAllowed
          ? `${formatHalfDays(used.n)} taken · no entitlement, deducted from pay`
          : `${formatHalfDays(used.n)} taken of ${formatHalfDays(granted.n)}`,
      pct: `${pct}%`,
      aria: `${t.name}: ${formatHalfDays(avail)} of ${formatHalfDays(granted.n)} remaining`,
    });
  }
  const emp = (await ctx.sqlite
    .prepare(`SELECT * FROM employee WHERE id = ?`)
    .get(p.employeeId)) as {
    probation_end_on: string | null;
    status: string;
    joined_on: string;
  };
  const requests = await listRequests(ctx, { mine: true });
  return {
    balances,
    requests,
    probation:
      emp.status === 'probation' || (emp.probation_end_on && emp.probation_end_on > ctx.today)
        ? {
            title: 'On probation',
            body: `Probation ends ${emp.probation_end_on ?? 'when HR records an end date'}. Some leave types are restricted until then.`,
          }
        : null,
  };
}
export async function listRequests(
  ctx: RequestContext,
  opts: {
    mine?: boolean;
    status?: string;
    search?: string;
  },
) {
  const p = requirePrincipal(ctx);
  await authorizeAction(ctx, 'leave.request.read', p.employeeId);
  const graph = await graphFor(ctx.sqlite, p.employeeId);
  const rows = (await ctx.sqlite
    .prepare(
      `SELECT r.*, t.name AS type_name, e.first_name || ' ' || e.last_name AS employee_name, d.name AS dept
       FROM leave_request r
       JOIN leave_type t ON t.id = r.leave_type_id
       JOIN employee e ON e.id = r.employee_id
       JOIN department d ON d.id = e.department_id
       ORDER BY r.created_at DESC`,
    )
    .all()) as Record<string, unknown>[];
  const canCompany = p.permissions.includes('leave.request.read:company');
  // Requests routed to this person, so a team lead's approvals queue is populated by the
  // hierarchy rather than by company-wide read rights they should not have.
  const assignedToMe = new Set(
    (
      (await ctx.sqlite
        .prepare(
          `SELECT leave_request_id AS id FROM approval_step_instance WHERE approver_user_id = ?`,
        )
        .all(p.userId)) as { id: string }[]
    ).map((r) => r.id),
  );
  return rows.filter((r) => {
    const empId = String(r.employee_id);
    if (opts.mine) return empId === p.employeeId;
    if (
      !canCompany &&
      empId !== p.employeeId &&
      !graph.recursiveReports.has(empId) &&
      !assignedToMe.has(String(r.id))
    ) {
      return false;
    }
    if (opts.status && opts.status !== 'all' && r.status !== opts.status) return false;
    if (opts.search) {
      const s = opts.search.toLowerCase();
      const blob = `${r.employee_name} ${r.type_name} ${r.reason}`.toLowerCase();
      if (!blob.includes(s)) return false;
    }
    return true;
  });
}
export async function queue(
  ctx: RequestContext,
  opts: {
    status: string;
    search: string;
  },
) {
  return listRequests(ctx, opts);
}
/** True when this request was routed to this user and is still awaiting their decision. */
async function isAssignedApprover(
  ctx: RequestContext,
  requestId: string,
  userId: string,
): Promise<boolean> {
  const row = (await ctx.sqlite
    .prepare(
      `SELECT id FROM approval_step_instance
        WHERE leave_request_id = ? AND approver_user_id = ?`,
    )
    .get(requestId, userId)) as { id: string } | undefined;
  return Boolean(row);
}

export async function requestDetail(ctx: RequestContext, id: string) {
  const p = requirePrincipal(ctx);
  const r = (await ctx.sqlite
    .prepare(
      `SELECT r.*, t.name AS type_name, e.first_name || ' ' || e.last_name AS employee_name,
              e.department_id, d.name AS dept, m.first_name || ' ' || m.last_name AS manager_name,
              att.original_name AS attachment_name, att.size_bytes AS attachment_size, att.mime_type AS attachment_mime_type
       FROM leave_request r
       JOIN leave_type t ON t.id = r.leave_type_id
       JOIN employee e ON e.id = r.employee_id
       JOIN department d ON d.id = e.department_id
       LEFT JOIN employee m ON m.id = e.manager_employee_id
       LEFT JOIN attachment att ON att.id = r.attachment_id
       WHERE r.id = ?`,
    )
    .get(id)) as Record<string, unknown> | undefined;
  if (!r) {
    await authorizeAction(ctx, 'leave.request.read', p.employeeId);
    throw Object.assign(new Error('forbidden'), { httpStatus: 403 });
  }
  const empId = String(r.employee_id);
  // Whoever the request was routed to must be able to read it, or a team lead could be
  // asked to decide something they are not allowed to open.
  if (!(await isAssignedApprover(ctx, id, p.userId))) {
    await authorizeAction(ctx, 'leave.request.read', empId);
  }
  const trail = await ctx.sqlite
    .prepare(
      `SELECT s.*, ua.email, ae.first_name || ' ' || ae.last_name AS approver_name
       FROM approval_step_instance s
       LEFT JOIN user_account ua ON ua.id = s.approver_user_id
       LEFT JOIN employee ae ON ae.id = s.approver_employee_id
       WHERE s.leave_request_id = ? ORDER BY s.step_no`,
    )
    .all(id);
  const days = await ctx.sqlite
    .prepare(`SELECT * FROM leave_request_day WHERE leave_request_id = ? ORDER BY date`)
    .all(id);
  // A team lead is an ordinary employee account, so the decision controls have to follow
  // the routing rather than a company-wide permission. Nobody decides their own request.
  const isOwn = p.employeeId === String(r.employee_id);
  const canAct =
    r.status === 'pending_approval' &&
    (!isOwn || p.roles.includes('admin')) &&
    ((await isAssignedApprover(ctx, id, p.userId)) ||
      p.permissions.includes('leave.request.approve:company') ||
      (isOwn && p.permissions.includes('leave.request.self_approve:self')));

  // Calculate prior leave history and balance context for the employee
  const periodId = await currentPeriodId(ctx);
  const types = (await ctx.sqlite.prepare(`SELECT id, name, code FROM leave_type`).all()) as {
    id: string;
    name: string;
    code: string;
  }[];

  let totalTakenHalfDaysThisPeriod = 0;
  let requestedTypeTakenHalfDays = 0;
  let requestedTypeGrantedHalfDays = 0;
  let requestedTypeAvailableHalfDays = 0;

  const balances: Array<{
    id: string;
    name: string;
    code: string;
    left: string;
    total: string;
    taken: string;
    isCurrentType: boolean;
  }> = [];

  for (const t of types) {
    const granted = (await ctx.sqlite
      .prepare(
        `SELECT COALESCE(SUM(quantity_half_days), 0) AS n FROM balance_ledger
         WHERE employee_id = ? AND leave_type_id = ? AND period_id = ?
           AND entry_type IN ('OPENING','ACCRUAL','ENTITLEMENT_GRANT','CARRY_FORWARD','MIGRATION_OPENING','ADJUSTMENT')`,
      )
      .get(empId, t.id, periodId)) as { n: number };
    const used = (await ctx.sqlite
      .prepare(
        `SELECT COALESCE(SUM(-quantity_half_days), 0) AS n FROM balance_ledger
         WHERE employee_id = ? AND leave_type_id = ? AND period_id = ?
           AND entry_type IN ('DEDUCTION','ENCASHMENT','EXPIRY')`,
      )
      .get(empId, t.id, periodId)) as { n: number };

    totalTakenHalfDaysThisPeriod += used.n;
    const avail = await availableHalfDays(ctx, empId, t.id, periodId);

    if (t.id === r.leave_type_id) {
      requestedTypeTakenHalfDays = used.n;
      requestedTypeGrantedHalfDays = granted.n;
      requestedTypeAvailableHalfDays = avail;
    }

    if (granted.n > 0 || used.n > 0 || t.id === r.leave_type_id) {
      balances.push({
        id: t.id,
        name: t.name,
        code: t.code,
        left: formatHalfDays(avail),
        total: formatHalfDays(granted.n),
        taken: formatHalfDays(used.n),
        isCurrentType: t.id === r.leave_type_id,
      });
    }
  }

  const pastRequests = (await ctx.sqlite
    .prepare(
      `SELECT r.id, r.start_date, r.end_date, r.total_half_days, r.status, r.created_at,
              t.name AS type_name, r.reason
       FROM leave_request r
       JOIN leave_type t ON t.id = r.leave_type_id
       WHERE r.employee_id = ? AND r.id != ?
       ORDER BY r.start_date DESC
       LIMIT 6`,
    )
    .all(empId, id)) as Array<{
    id: string;
    start_date: string;
    end_date: string;
    total_half_days: number;
    status: string;
    type_name: string;
    reason: string;
  }>;

  const currentReqHalfDays = Number(r.total_half_days ?? 0);
  const remainingAfterApproval = requestedTypeAvailableHalfDays - currentReqHalfDays;

  const leave_history = {
    total_taken_days: formatHalfDays(totalTakenHalfDaysThisPeriod),
    requested_type_taken_days: formatHalfDays(requestedTypeTakenHalfDays),
    requested_type_total_days: formatHalfDays(requestedTypeGrantedHalfDays),
    requested_type_remaining_days: formatHalfDays(requestedTypeAvailableHalfDays),
    projected_remaining_days: formatHalfDays(remainingAfterApproval),
    balances,
    past_requests: pastRequests.map((p) => ({
      id: p.id,
      start_date: p.start_date,
      end_date: p.end_date,
      days_count: formatHalfDays(p.total_half_days),
      status: p.status,
      type_name: p.type_name,
      reason: p.reason,
    })),
  };

  return { ...r, trail, days, canAct, leave_history };
}
export async function ledger(ctx: RequestContext, employeeId: string, leaveTypeId: string) {
  await authorizeAction(ctx, 'leave.balance.read', employeeId);
  return await ctx.sqlite
    .prepare(
      `SELECT * FROM balance_ledger WHERE employee_id = ? AND leave_type_id = ? ORDER BY created_at`,
    )
    .all(employeeId, leaveTypeId);
}
export async function calendarMonth(ctx: RequestContext, year: number, month: number) {
  requirePrincipal(ctx);
  await authorizeAction(ctx, 'holiday.calendar.read', null);
  const cal = (await ctx.sqlite
    .prepare(`SELECT id FROM holiday_calendar ORDER BY year DESC LIMIT 1`)
    .get()) as
    | {
        id: string;
      }
    | undefined;
  const holidays = cal
    ? ((await ctx.sqlite
        .prepare(`SELECT * FROM holiday WHERE holiday_calendar_id = ?`)
        .all(cal.id)) as {
        date: string;
        name: string;
        kind: string;
      }[])
    : [];
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const leave = (await ctx.sqlite
    .prepare(
      `SELECT r.start_date, r.end_date, r.status FROM leave_request r WHERE r.status IN ('approved','pending_approval') AND r.end_date >= ? AND r.start_date <= ?`,
    )
    .all(start, `${year}-${String(month).padStart(2, '0')}-31`)) as {
    start_date: string;
    end_date: string;
    status: string;
  }[];
  return { holidays, leave, calendarId: cal?.id ?? null };
}
export async function availability(ctx: RequestContext, from: string, days: number) {
  const p = requirePrincipal(ctx);
  await authorizeAction(ctx, 'team.availability.read', p.employeeId);
  const graph = await graphFor(ctx.sqlite, p.employeeId);
  const people = (await ctx.sqlite
    .prepare(
      `SELECT e.id, e.first_name || ' ' || e.last_name AS name, d.name AS dept
       FROM employee e JOIN department d ON d.id = e.department_id
       WHERE e.status != 'exited' ORDER BY e.first_name`,
    )
    .all()) as {
    id: string;
    name: string;
    dept: string;
  }[];
  const canCompany = p.permissions.includes('team.availability.read:company');
  const scoped = canCompany
    ? people
    : people.filter(
        (x) =>
          x.id === p.employeeId ||
          graph.recursiveReports.has(x.id) ||
          (p.teamId && graph.employees.find((e) => e.id === x.id)?.teamId === p.teamId),
      );
  const dates: string[] = [];
  const start = new Date(from + 'T00:00:00Z');
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    dates.push(d.toISOString().slice(0, 10));
  }
  const reqs = (await ctx.sqlite
    .prepare(
      `SELECT employee_id, start_date, end_date, status FROM leave_request WHERE status IN ('approved','pending_approval')`,
    )
    .all()) as {
    employee_id: string;
    start_date: string;
    end_date: string;
    status: string;
  }[];
  const hol = await holidaysForEmployee(ctx, scoped[0]?.id ?? p.employeeId ?? '');
  return {
    dates,
    rows: scoped.map((person) => ({
      ...person,
      cells: dates.map((date) => {
        const hit = reqs.find(
          (r) => r.employee_id === person.id && r.start_date <= date && r.end_date >= date,
        );
        const h = hol.find((x) => x.date === date && x.kind === 'public');
        if (h) return { kind: 'holiday', title: h.name };
        if (hit)
          return { kind: hit.status === 'approved' ? 'approved' : 'pending', title: hit.status };
        return { kind: 'in', title: 'In' };
      }),
    })),
  };
}
export async function reports(ctx: RequestContext) {
  requirePrincipal(ctx);
  await authorizeAction(ctx, 'report.leave.view', null);
  const byMonth = (await ctx.sqlite
    .prepare(
      `SELECT substr(start_date, 1, 7) AS ym, SUM(total_half_days) AS half
       FROM leave_request WHERE status = 'approved' GROUP BY substr(start_date, 1, 7) ORDER BY 1`,
    )
    .all()) as {
    ym: string;
    half: number;
  }[];
  const pendingAge = (await ctx.sqlite
    .prepare(`SELECT COUNT(*) AS n FROM leave_request WHERE status = 'pending_approval'`)
    .get()) as {
    n: number;
  };
  return {
    cards: [
      {
        label: 'Approved days (this data)',
        value: formatHalfDays(byMonth.reduce((a, b) => a + b.half, 0)),
        note: 'Sum of approved requests',
      },
      { label: 'Pending', value: String(pendingAge.n), note: 'Awaiting HR or Admin' },
      {
        label: 'Self-approvals',
        value: String(
          (
            (await ctx.sqlite
              .prepare(`SELECT COUNT(*) AS n FROM leave_request WHERE was_self_approved = 1`)
              .get()) as {
              n: number;
            }
          ).n,
        ),
        note: 'Standing report (DW-32)',
      },
    ],
    byMonth: byMonth.map((m) => ({ label: m.ym.slice(5), days: m.half / 2, half: m.half })),
  };
}
export async function auditLog(ctx: RequestContext, q?: string) {
  requirePrincipal(ctx);
  await authorizeAction(ctx, 'audit.read', null);
  const rows = (await ctx.sqlite
    .prepare(`SELECT * FROM audit_event ORDER BY occurred_at DESC LIMIT 200`)
    .all()) as Record<string, unknown>[];
  if (!q) return rows;
  const s = q.toLowerCase();
  return rows.filter((r) =>
    `${r.action} ${r.actor_label} ${r.entity_type}`.toLowerCase().includes(s),
  );
}
export async function notifications(ctx: RequestContext) {
  const p = requirePrincipal(ctx);
  return await ctx.sqlite
    .prepare(
      `SELECT * FROM notification WHERE recipient_user_id = ? ORDER BY created_at DESC LIMIT 50`,
    )
    .all(p.userId);
}
export async function markNotificationsRead(ctx: RequestContext, notificationId?: string) {
  const p = requirePrincipal(ctx);
  if (notificationId) {
    await ctx.sqlite
      .prepare(
        `UPDATE notification SET read_at = ? WHERE id = ? AND recipient_user_id = ? AND read_at IS NULL`,
      )
      .run(ctx.now, notificationId, p.userId);
  } else {
    await ctx.sqlite
      .prepare(
        `UPDATE notification SET read_at = ? WHERE recipient_user_id = ? AND read_at IS NULL`,
      )
      .run(ctx.now, p.userId);
  }
}
export async function leaveTypes(ctx: RequestContext) {
  requirePrincipal(ctx);
  return await ctx.sqlite.prepare(`SELECT * FROM leave_type WHERE archived_at IS NULL`).all();
}
export async function policies(ctx: RequestContext) {
  requirePrincipal(ctx);
  await authorizeAction(ctx, 'leave.policy.read', null);
  return await ctx.sqlite
    .prepare(
      `SELECT v.*, t.code, t.name FROM leave_policy_version v JOIN leave_type t ON t.id = v.leave_type_id
       ORDER BY t.code, v.version_no DESC`,
    )
    .all();
}
