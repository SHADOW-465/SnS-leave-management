import { DomainError, formatHalfDays, monthlyRateHalfDays } from '@sns/domain';
import { authorizeAction, graphFor, requirePrincipal, type RequestContext } from './ctx.js';
import {
  availableHalfDays,
  currentPolicy,
  describeRouteFor,
  holidaysForEmployee,
} from './usecases/leave.js';
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
const CREDIT_TYPES = `('OPENING','ACCRUAL','ENTITLEMENT_GRANT','CARRY_FORWARD','MIGRATION_OPENING','ADJUSTMENT')`;
const USED_TYPES = `('DEDUCTION','ENCASHMENT','EXPIRY')`;
const PENDING_TYPES = `('PENDING_HOLD','HOLD_RELEASE')`;

export async function myHome(ctx: RequestContext) {
  const p = requirePrincipal(ctx);
  if (!p.employeeId)
    return {
      employee: null,
      period: null,
      balances: [],
      requests: [],
      monthly: [],
      upcomingApproved: [],
      holidays: [],
      probation: null,
    };
  await authorizeAction(ctx, 'leave.balance.read', p.employeeId);
  const types = (await ctx.sqlite.prepare(`SELECT id, name, code FROM leave_type`).all()) as {
    id: string;
    name: string;
    code: string;
  }[];
  const periodId = await currentPeriodId(ctx);
  const period = (await ctx.sqlite
    .prepare(`SELECT id, label, starts_on, ends_on FROM leave_period WHERE id = ?`)
    .get(periodId)) as
    { id: string; label: string; starts_on: string; ends_on: string } | undefined;
  const who = (await ctx.sqlite
    .prepare(
      `SELECT et.code AS "categoryCode", e.status, e.probation_end_on AS "probationEndOn"
         FROM employee e LEFT JOIN employment_type et ON et.id = e.employment_type_id
        WHERE e.id = ?`,
    )
    .get(p.employeeId)) as
    { categoryCode: string | null; status: string; probationEndOn: string | null } | undefined;
  const onProbation =
    who?.status === 'probation' || Boolean(who?.probationEndOn && who.probationEndOn > ctx.today);
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
           AND entry_type IN ${CREDIT_TYPES}`,
      )
      .get(p.employeeId, t.id, periodId)) as { n: number };
    // Taken is read from the ledger itself, not inferred as entitlement minus
    // remaining — adjustments and carry-forward make that subtraction wrong.
    const used = (await ctx.sqlite
      .prepare(
        `SELECT COALESCE(SUM(-quantity_half_days), 0) AS n FROM balance_ledger
         WHERE employee_id = ? AND leave_type_id = ? AND period_id = ?
           AND entry_type IN ${USED_TYPES}`,
      )
      .get(p.employeeId, t.id, periodId)) as { n: number };
    const pending = (await ctx.sqlite
      .prepare(
        `SELECT COALESCE(SUM(-quantity_half_days), 0) AS n FROM balance_ledger
         WHERE employee_id = ? AND leave_type_id = ? AND period_id = ?
           AND entry_type IN ${PENDING_TYPES}`,
      )
      .get(p.employeeId, t.id, periodId)) as { n: number };
    // Display available is earned minus approved use. Pending is shown separately
    // and only reduces the number after the manager approves (functional framework §4/§6).
    // The apply check still uses the ledger sum, which includes PENDING_HOLD.
    const displayAvailable = granted.n - used.n;
    // A type with no entitlement and nothing taken (typically unpaid leave) has no
    // balance to report. It stays available on the apply form; it just does not earn
    // a card that reads "0 / 0".
    if (granted.n <= 0 && used.n <= 0 && pending.n <= 0) continue;
    const pct = granted.n > 0 ? Math.min(100, Math.round((used.n / granted.n) * 100)) : 0;
    const pendingNote = pending.n > 0 ? ` · ${formatHalfDays(pending.n)} pending approval` : '';
    balances.push({
      id: t.id,
      name: t.name,
      code: t.code,
      left: formatHalfDays(displayAvailable),
      total: formatHalfDays(granted.n),
      // A monthly type's year is twelve of this person's months (their staff category or
      // probation rate); a granted type's is what they were granted.
      eligibility: formatHalfDays(
        rules.accrualMethod === 'monthly'
          ? monthlyRateHalfDays(rules, {
              categoryCode: who?.categoryCode ?? null,
              onProbation,
            }) * 12
          : granted.n > 0
            ? granted.n
            : rules.entitlementHalfDays,
      ),
      taken: formatHalfDays(used.n),
      pending: formatHalfDays(pending.n),
      earnedHalfDays: granted.n,
      usedHalfDays: used.n,
      pendingHalfDays: pending.n,
      unlimited: granted.n <= 0 && rules.negativeBalanceAllowed,
      note:
        granted.n <= 0 && rules.negativeBalanceAllowed
          ? `${formatHalfDays(used.n)} taken · no entitlement, deducted from pay`
          : `${formatHalfDays(used.n)} taken of ${formatHalfDays(granted.n)}${pendingNote}`,
      pct: `${pct}%`,
      aria: `${t.name}: ${formatHalfDays(displayAvailable)} of ${formatHalfDays(granted.n)} available, ${formatHalfDays(pending.n)} pending`,
    });
  }
  const emp = (await ctx.sqlite
    .prepare(
      `SELECT e.employee_code, e.first_name, e.last_name, e.probation_end_on, e.status, e.joined_on,
              d.name AS department_name,
              m.first_name || ' ' || m.last_name AS manager_name
       FROM employee e
       JOIN department d ON d.id = e.department_id
       LEFT JOIN employee m ON m.id = e.manager_employee_id
       WHERE e.id = ?`,
    )
    .get(p.employeeId)) as {
    employee_code: string;
    first_name: string;
    last_name: string;
    probation_end_on: string | null;
    status: string;
    joined_on: string;
    department_name: string;
    manager_name: string | null;
  };
  const requests = await listRequests(ctx, { mine: true });
  const monthly = await monthlySummaryFor(ctx, p.employeeId, periodId, period, balances);
  const upcomingApproved = requests.filter((r) => {
    const row = r as Record<string, unknown>;
    return row.status === 'approved' && String(row.end_date) >= ctx.today;
  });
  const holidays = (await ctx.sqlite
    .prepare(
      `SELECT h.date, h.name, h.kind
       FROM holiday h
       JOIN holiday_calendar c ON c.id = h.holiday_calendar_id
       JOIN location loc ON loc.holiday_calendar_id = c.id
       JOIN employee e ON e.location_id = loc.id
       WHERE e.id = ? AND h.date >= ? AND h.kind IN ('public','optional')
       ORDER BY h.date
       LIMIT 12`,
    )
    .all(p.employeeId, ctx.today)) as { date: string; name: string; kind: string }[];
  return {
    employee: {
      name: `${emp.first_name} ${emp.last_name}`,
      code: emp.employee_code,
      department: emp.department_name,
      manager: emp.manager_name,
      // Who decides their leave today — the manager, or whoever stands in when the
      // manager is away or not set. The same code routes real requests.
      leaveGoesTo: await describeRouteFor(ctx, p.employeeId, p.userId),
      year: period?.label ?? ctx.today.slice(0, 4),
    },
    period: period
      ? { id: period.id, label: period.label, startsOn: period.starts_on, endsOn: period.ends_on }
      : null,
    balances,
    requests,
    monthly,
    upcomingApproved,
    holidays,
    probation:
      emp.status === 'probation' || (emp.probation_end_on && emp.probation_end_on > ctx.today)
        ? {
            title: 'On probation',
            body: `Probation ends ${emp.probation_end_on ?? 'when HR records an end date'}. Some leave types are restricted until then.`,
          }
        : null,
  };
}

async function monthlySummaryFor(
  ctx: RequestContext,
  employeeId: string,
  periodId: string,
  period: { starts_on: string; ends_on: string } | undefined,
  balances: { id: string; code: string; earnedHalfDays: number }[],
) {
  if (!period) return [];
  const focus =
    balances.find((b) => b.code === 'EL') ??
    balances.find((b) => b.earnedHalfDays > 0) ??
    balances[0];
  if (!focus) return [];
  const entries = (await ctx.sqlite
    .prepare(
      `SELECT entry_type, quantity_half_days, effective_on
       FROM balance_ledger
       WHERE employee_id = ? AND leave_type_id = ? AND period_id = ?
       ORDER BY effective_on, created_at`,
    )
    .all(employeeId, focus.id, periodId)) as {
    entry_type: string;
    quantity_half_days: number;
    effective_on: string;
  }[];
  const months: {
    ym: string;
    label: string;
    earned: number;
    used: number;
    balance: number;
  }[] = [];
  const start = period.starts_on.slice(0, 7);
  const endCap = ctx.today < period.ends_on ? ctx.today : period.ends_on;
  const end = endCap.slice(0, 7);
  let running = 0;
  let y = Number(start.slice(0, 4));
  let m = Number(start.slice(5, 7));
  const endY = Number(end.slice(0, 4));
  const endM = Number(end.slice(5, 7));
  while (y < endY || (y === endY && m <= endM)) {
    const ym = `${y}-${String(m).padStart(2, '0')}`;
    let earned = 0;
    let used = 0;
    for (const e of entries) {
      if (e.effective_on.slice(0, 7) !== ym) continue;
      if (
        [
          'OPENING',
          'ACCRUAL',
          'ENTITLEMENT_GRANT',
          'CARRY_FORWARD',
          'MIGRATION_OPENING',
          'ADJUSTMENT',
        ].includes(e.entry_type)
      ) {
        earned += e.quantity_half_days;
      } else if (['DEDUCTION', 'ENCASHMENT', 'EXPIRY'].includes(e.entry_type)) {
        used += -e.quantity_half_days;
      }
    }
    running += earned - used;
    const label = new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-GB', {
      month: 'long',
      timeZone: 'UTC',
    });
    months.push({
      ym,
      label,
      earned: earned / 2,
      used: used / 2,
      balance: running / 2,
    });
    m += 1;
    if (m === 13) {
      m = 1;
      y += 1;
    }
  }
  return months;
}
export async function listRequests(
  ctx: RequestContext,
  opts: {
    /** @deprecated use view: 'mine' */
    mine?: boolean;
    /**
     * `mine` — the caller's own requests.
     * `approvals` — requests the caller decides: those routed to them, plus everyone else's
     *   for HR and administrators, who can override. Never includes the caller's own.
     * `all` — everything the caller may see.
     */
    view?: 'mine' | 'approvals' | 'all';
    status?: string;
    search?: string;
  },
) {
  const p = requirePrincipal(ctx);
  await authorizeAction(ctx, 'leave.request.read', p.employeeId);
  const view = opts.view ?? (opts.mine ? 'mine' : 'all');
  const graph = await graphFor(ctx.sqlite, p.employeeId);
  const rows = (await ctx.sqlite
    .prepare(
      `SELECT r.*, t.name AS type_name, e.first_name || ' ' || e.last_name AS employee_name,
              d.name AS dept,
              (SELECT ae.first_name || ' ' || ae.last_name FROM approval_step_instance s
                 JOIN employee ae ON ae.id = s.approver_employee_id
                WHERE s.leave_request_id = r.id AND s.status = 'pending'
                ORDER BY s.step_no LIMIT 1) AS waiting_on,
              (SELECT s.approver_user_id FROM approval_step_instance s
                WHERE s.leave_request_id = r.id AND s.status = 'pending'
                ORDER BY s.step_no LIMIT 1) AS pending_approver_user_id
       FROM leave_request r
       JOIN leave_type t ON t.id = r.leave_type_id
       JOIN employee e ON e.id = r.employee_id
       JOIN department d ON d.id = e.department_id
       ORDER BY r.created_at DESC`,
    )
    .all()) as Record<string, unknown>[];
  const canCompany = p.permissions.includes('leave.request.read:company');
  const canOverride = p.permissions.includes('leave.request.approve:company');
  const isAdmin = p.roles.includes('admin');
  // Requests routed to this person, so a team lead's approvals are populated by the
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

  const out = [];
  for (const r of rows) {
    const empId = String(r.employee_id);
    const own = empId === p.employeeId;
    const assigned = assignedToMe.has(String(r.id));

    if (view === 'mine' && !own) continue;
    if (view === 'approvals' && (own || !(assigned || canOverride))) continue;
    if (view === 'all' && !canCompany && !own && !graph.recursiveReports.has(empId) && !assigned) {
      continue;
    }
    if (opts.status && opts.status !== 'all' && r.status !== opts.status) continue;
    if (opts.search) {
      const needle = opts.search.toLowerCase();
      const blob = `${r.employee_name} ${r.type_name} ${r.reason}`.toLowerCase();
      if (!blob.includes(needle)) continue;
    }

    const pendingWithMe = r.pending_approver_user_id === p.userId;
    out.push({
      ...r,
      // Who the request is waiting on, so nobody has to ask where their leave went.
      waiting_on: r.status === 'pending_approval' ? (r.waiting_on ?? null) : null,
      // Whether *this* person can approve or reject it from the list.
      can_decide:
        r.status === 'pending_approval' && (pendingWithMe || canOverride) && (!own || isAdmin),
      // True when it was routed to them, as opposed to visible through an HR override.
      routed_to_me: pendingWithMe,
    });
  }
  return out;
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
const ENTRY_LABEL: Record<string, string> = {
  OPENING: 'Opening balance',
  MIGRATION_OPENING: 'Opening balance (imported)',
  ACCRUAL: 'Monthly credit',
  ENTITLEMENT_GRANT: 'Yearly entitlement',
  CARRY_FORWARD: 'Carried forward',
  DEDUCTION: 'Leave taken',
  CANCELLATION_CREDIT: 'Leave cancelled — days returned',
  ENCASHMENT: 'Encashed',
  EXPIRY: 'Expired',
};

/**
 * Every movement on someone's leave balance for a leave year, oldest first, with the
 * balance after each one — the "leave transactions" register. Holds for requests still
 * awaiting a decision are left out: the balance only moves once a request is approved.
 */
export async function leaveTransactions(
  ctx: RequestContext,
  opts: { employeeId?: string; leaveTypeId?: string; periodId?: string },
) {
  const p = requirePrincipal(ctx);
  const employeeId = opts.employeeId || p.employeeId;
  if (!employeeId) {
    throw new DomainError('NO_EMPLOYEE', 'Choose an employee.', { httpStatus: 400 });
  }
  await authorizeAction(ctx, 'leave.balance.read', employeeId);
  const periods = (await ctx.sqlite
    .prepare(
      `SELECT id, label, starts_on AS "startsOn", ends_on AS "endsOn" FROM leave_period ORDER BY starts_on DESC`,
    )
    .all()) as { id: string; label: string; startsOn: string; endsOn: string }[];
  const periodId = opts.periodId || (await currentPeriodId(ctx));
  const employee = (await ctx.sqlite
    .prepare(
      `SELECT e.id, e.employee_code AS code, e.first_name || ' ' || e.last_name AS name,
              d.name AS department
         FROM employee e JOIN department d ON d.id = e.department_id WHERE e.id = ?`,
    )
    .get(employeeId)) as { id: string; code: string; name: string; department: string } | undefined;
  if (!employee) throw new DomainError('NOT_FOUND', 'Employee not found.', { httpStatus: 404 });
  const rows = (await ctx.sqlite
    .prepare(
      `SELECT l.id, l.leave_type_id AS "leaveTypeId", t.name AS "leaveType", l.entry_type AS "entryType",
              l.quantity_half_days AS q, l.effective_on AS "effectiveOn", l.created_at AS "createdAt",
              l.source_type AS "sourceType", l.source_id AS "sourceId", l.reason,
              r.start_date AS "reqStart", r.end_date AS "reqEnd",
              COALESCE(ue.first_name || ' ' || ue.last_name, ua.email, l.created_by) AS "by"
         FROM balance_ledger l
         JOIN leave_type t ON t.id = l.leave_type_id
         LEFT JOIN leave_request r ON r.id = l.source_id AND l.source_type = 'leave_request'
         LEFT JOIN user_account ua ON ua.id = l.created_by
         LEFT JOIN employee ue ON ue.id = ua.employee_id
        WHERE l.employee_id = ? AND l.period_id = ?
          AND l.entry_type NOT IN ('PENDING_HOLD', 'HOLD_RELEASE')
          ${opts.leaveTypeId ? 'AND l.leave_type_id = ?' : ''}
        ORDER BY l.effective_on, l.created_at`,
    )
    .all(...[employeeId, periodId, ...(opts.leaveTypeId ? [opts.leaveTypeId] : [])])) as {
    id: string;
    leaveTypeId: string;
    leaveType: string;
    entryType: string;
    q: number;
    effectiveOn: string;
    createdAt: string;
    sourceType: string | null;
    sourceId: string | null;
    reason: string | null;
    reqStart: string | null;
    reqEnd: string | null;
    by: string | null;
  }[];
  const running = new Map<string, number>();
  const entries = rows.map((r) => {
    const q = Number(r.q);
    const after = (running.get(r.leaveTypeId) ?? 0) + q;
    running.set(r.leaveTypeId, after);
    const label =
      r.entryType === 'ADJUSTMENT'
        ? r.sourceType === 'leave_request'
          ? 'Recounted after a calendar change'
          : q >= 0
            ? 'Manual credit'
            : 'Manual deduction'
        : (ENTRY_LABEL[r.entryType] ?? r.entryType);
    return {
      id: r.id,
      date: r.effectiveOn,
      recordedAt: r.createdAt,
      leaveTypeId: r.leaveTypeId,
      leaveType: r.leaveType,
      kind: r.entryType,
      label,
      days: q / 2,
      balanceAfter: after / 2,
      reference: r.reqStart
        ? r.reqStart === r.reqEnd
          ? `Leave on ${r.reqStart}`
          : `Leave ${r.reqStart} to ${r.reqEnd}`
        : null,
      requestId: r.sourceType === 'leave_request' ? r.sourceId : null,
      reason: r.reason,
      by: r.by === 'system' ? 'Automatic' : r.by,
    };
  });
  const pending = (await ctx.sqlite
    .prepare(
      `SELECT l.leave_type_id AS "leaveTypeId", COALESCE(SUM(-l.quantity_half_days), 0) AS n
         FROM balance_ledger l
        WHERE l.employee_id = ? AND l.period_id = ? AND l.entry_type IN ('PENDING_HOLD', 'HOLD_RELEASE')
        GROUP BY l.leave_type_id`,
    )
    .all(employeeId, periodId)) as { leaveTypeId: string; n: number }[];
  const pendingBy = new Map(pending.map((x) => [x.leaveTypeId, Number(x.n) / 2]));
  const summary = [...new Set(entries.map((e) => e.leaveTypeId))].map((id) => {
    const mine = entries.filter((e) => e.leaveTypeId === id);
    const sum = (kinds: string[]) =>
      mine.filter((e) => kinds.includes(e.kind)).reduce((a, e) => a + e.days, 0);
    const manual = mine.filter((e) => e.kind === 'ADJUSTMENT');
    return {
      leaveTypeId: id,
      leaveType: mine[0]!.leaveType,
      opening: sum(['OPENING', 'MIGRATION_OPENING', 'CARRY_FORWARD']),
      earned: sum(['ACCRUAL', 'ENTITLEMENT_GRANT']),
      manualCredit: manual.filter((e) => e.days > 0).reduce((a, e) => a + e.days, 0),
      manualDeduction: -manual.filter((e) => e.days < 0).reduce((a, e) => a + e.days, 0),
      used: -sum(['DEDUCTION', 'ENCASHMENT', 'EXPIRY']) - sum(['CANCELLATION_CREDIT']),
      pending: pendingBy.get(id) ?? 0,
      closing: (running.get(id) ?? 0) / 2,
    };
  });
  return {
    employee,
    periods,
    periodId,
    entries: entries.reverse(),
    summary,
  };
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
export async function reports(ctx: RequestContext, opts?: { year?: number; month?: number }) {
  requirePrincipal(ctx);
  await authorizeAction(ctx, 'report.leave.view', null);
  const periodId = await currentPeriodId(ctx);
  const period = (await ctx.sqlite
    .prepare(`SELECT id, label, starts_on, ends_on FROM leave_period WHERE id = ?`)
    .get(periodId)) as
    { id: string; label: string; starts_on: string; ends_on: string } | undefined;

  const byMonthRaw = (await ctx.sqlite
    .prepare(
      `SELECT substr(start_date, 1, 7) AS ym,
              COALESCE(SUM(total_half_days), 0) AS half,
              COUNT(*) AS req_count,
              COUNT(DISTINCT employee_id) AS emp_count
       FROM leave_request
       WHERE status = 'approved'
       GROUP BY substr(start_date, 1, 7)
       ORDER BY 1`,
    )
    .all()) as {
    ym: string;
    half: number;
    req_count: number;
    emp_count: number;
  }[];

  const byMonth = byMonthRaw.map((m) => ({
    ym: m.ym,
    label: m.ym.slice(5),
    days: (Number(m.half) || 0) / 2,
    half: Number(m.half) || 0,
    requestCount: Number(m.req_count) || 0,
    employeeCount: Number(m.emp_count) || 0,
  }));

  const pendingAge = (await ctx.sqlite
    .prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(total_half_days), 0) AS half
       FROM leave_request WHERE status = 'pending_approval'`,
    )
    .get()) as { n: number; half: number };

  const rejectedStat = (await ctx.sqlite
    .prepare(`SELECT COUNT(*) AS n FROM leave_request WHERE status = 'rejected'`)
    .get()) as { n: number };

  const selfApprovedStat = (await ctx.sqlite
    .prepare(`SELECT COUNT(*) AS n FROM leave_request WHERE was_self_approved = 1`)
    .get()) as { n: number };

  const activeHeadcount = (await ctx.sqlite
    .prepare(`SELECT COUNT(*) AS n FROM employee WHERE status != 'exited'`)
    .get()) as { n: number };

  const totalApprovedHalf = byMonth.reduce((a, b) => a + b.half, 0);
  const totalApprovedDays = totalApprovedHalf / 2;
  const totalApprovedRequests = byMonth.reduce((a, b) => a + b.requestCount, 0);
  const avgDaysPerEmp =
    activeHeadcount.n > 0 ? (totalApprovedDays / activeHeadcount.n).toFixed(1) : '0.0';

  const departmentsRaw = (await ctx.sqlite
    .prepare(
      `SELECT d.id, d.code, d.name,
              COUNT(DISTINCT CASE WHEN e.status != 'exited' THEN e.id ELSE NULL END) AS head_count,
              COALESCE(SUM(CASE WHEN r.status = 'approved' THEN r.total_half_days ELSE 0 END), 0) AS half,
              COUNT(DISTINCT CASE WHEN r.status = 'approved' THEN r.id ELSE NULL END) AS req_count
       FROM department d
       LEFT JOIN employee e ON e.department_id = d.id
       LEFT JOIN leave_request r ON r.employee_id = e.id
       GROUP BY d.id, d.code, d.name
       ORDER BY d.name`,
    )
    .all()) as {
    id: string;
    code: string;
    name: string;
    head_count: number;
    half: number;
    req_count: number;
  }[];

  const byDepartment = departmentsRaw.map((d) => {
    const days = (Number(d.half) || 0) / 2;
    const hc = Number(d.head_count) || 0;
    return {
      id: d.id,
      code: d.code,
      name: d.name,
      headcount: hc,
      totalDaysTaken: days,
      avgDaysPerEmployee: hc > 0 ? (days / hc).toFixed(1) : '0.0',
      requestCount: Number(d.req_count) || 0,
    };
  });

  const leaveTypesRaw = (await ctx.sqlite
    .prepare(
      `SELECT t.id, t.code, t.name, t.colour_token,
              COALESCE(SUM(CASE WHEN r.status = 'approved' THEN r.total_half_days ELSE 0 END), 0) AS half,
              COUNT(DISTINCT CASE WHEN r.status = 'approved' THEN r.id ELSE NULL END) AS req_count,
              COUNT(DISTINCT CASE WHEN r.status = 'approved' THEN r.employee_id ELSE NULL END) AS emp_count
       FROM leave_type t
       LEFT JOIN leave_request r ON r.leave_type_id = t.id
       GROUP BY t.id, t.code, t.name, t.colour_token
       ORDER BY t.name`,
    )
    .all()) as {
    id: string;
    code: string;
    name: string;
    colour_token: string;
    half: number;
    req_count: number;
    emp_count: number;
  }[];

  const byLeaveType = leaveTypesRaw.map((t) => {
    const days = (Number(t.half) || 0) / 2;
    const pct = totalApprovedDays > 0 ? Math.round((days / totalApprovedDays) * 100) : 0;
    return {
      id: t.id,
      code: t.code,
      name: t.name,
      colourToken: t.colour_token,
      totalDaysTaken: days,
      percentOfTotal: pct,
      requestCount: Number(t.req_count) || 0,
      employeeCount: Number(t.emp_count) || 0,
    };
  });

  const sortedTypes = [...byLeaveType].sort((a, b) => b.totalDaysTaken - a.totalDaysTaken);
  const firstType = sortedTypes[0];
  const mostUsedLeaveType = firstType && firstType.totalDaysTaken > 0 ? firstType.name : 'None';

  const employeesRaw = (await ctx.sqlite
    .prepare(
      `SELECT e.id, e.employee_code, e.first_name, e.last_name, e.work_email, e.status, e.joined_on,
              d.id AS dept_id,
              d.name AS dept_name,
              tm.name AS team_name
       FROM employee e
       JOIN department d ON d.id = e.department_id
       LEFT JOIN team tm ON tm.id = e.team_id
       ORDER BY e.first_name, e.last_name`,
    )
    .all()) as {
    id: string;
    employee_code: string;
    first_name: string;
    last_name: string;
    work_email: string;
    status: string;
    joined_on: string;
    dept_id: string;
    dept_name: string;
    team_name: string | null;
  }[];

  const ledgersRaw = (await ctx.sqlite
    .prepare(
      `SELECT employee_id, leave_type_id, entry_type, quantity_half_days
       FROM balance_ledger
       WHERE period_id = ?`,
    )
    .all(periodId)) as {
    employee_id: string;
    leave_type_id: string;
    entry_type: string;
    quantity_half_days: number;
  }[];

  const pendingByEmpRaw = (await ctx.sqlite
    .prepare(
      `SELECT employee_id, COALESCE(SUM(total_half_days), 0) AS half
       FROM leave_request
       WHERE status = 'pending_approval'
       GROUP BY employee_id`,
    )
    .all()) as { employee_id: string; half: number }[];

  const pendingByEmpMap = new Map<string, number>();
  for (const p of pendingByEmpRaw) {
    pendingByEmpMap.set(p.employee_id, Number(p.half) || 0);
  }

  const empLedgerMap = new Map<
    string,
    {
      granted: number;
      used: number;
      total: number;
    }
  >();
  for (const l of ledgersRaw) {
    let rec = empLedgerMap.get(l.employee_id);
    if (!rec) {
      rec = { granted: 0, used: 0, total: 0 };
      empLedgerMap.set(l.employee_id, rec);
    }
    const q = Number(l.quantity_half_days) || 0;
    if (
      [
        'OPENING',
        'ACCRUAL',
        'ENTITLEMENT_GRANT',
        'CARRY_FORWARD',
        'MIGRATION_OPENING',
        'ADJUSTMENT',
      ].includes(l.entry_type)
    ) {
      rec.granted += q;
    } else if (['DEDUCTION', 'ENCASHMENT', 'EXPIRY'].includes(l.entry_type)) {
      rec.used += -q;
    }
    rec.total += q;
  }

  const employeeSummaries = employeesRaw.map((e) => {
    const rec = empLedgerMap.get(e.id);
    const grantedDays = (rec?.granted ?? 0) / 2;
    const takenDays = (rec?.used ?? 0) / 2;
    const remainingDays = (rec?.total ?? 0) / 2;
    const pendingDays = (pendingByEmpMap.get(e.id) ?? 0) / 2;

    return {
      id: e.id,
      code: e.employee_code,
      name: `${e.first_name} ${e.last_name}`,
      departmentId: e.dept_id,
      departmentName: e.dept_name,
      teamName: e.team_name ?? '—',
      status: e.status,
      joinedOn: e.joined_on,
      entitlementDays: grantedDays,
      takenDays,
      remainingDays,
      pendingDays,
    };
  });

  return {
    period: period
      ? {
          id: period.id,
          label: period.label,
          startsOn: period.starts_on,
          endsOn: period.ends_on,
        }
      : null,
    cards: [
      {
        label: 'Approved days (this data)',
        value: formatHalfDays(totalApprovedHalf),
        note: 'Sum of approved requests',
      },
      { label: 'Pending', value: String(pendingAge.n), note: 'Awaiting HR or Admin' },
      {
        label: 'Self-approvals',
        value: String(selfApprovedStat.n),
        note: 'Standing report (DW-32)',
      },
    ],
    summary: {
      totalApprovedDays,
      totalApprovedRequests,
      pendingCount: pendingAge.n,
      pendingDays: (Number(pendingAge.half) || 0) / 2,
      activeEmployeesCount: activeHeadcount.n,
      avgDaysPerEmployee: avgDaysPerEmp,
      selfApprovalsCount: selfApprovedStat.n,
      rejectedCount: rejectedStat.n,
      mostUsedLeaveType,
    },
    byMonth,
    byDepartment,
    byLeaveType,
    employeeSummaries,
    payroll: await monthlyPayroll(ctx, employeesRaw, opts),
  };
}

async function monthlyPayroll(
  ctx: RequestContext,
  employees: {
    id: string;
    employee_code: string;
    first_name: string;
    last_name: string;
    dept_name: string;
    status: string;
  }[],
  opts?: { year?: number; month?: number },
) {
  const year = opts?.year ?? Number(ctx.today.slice(0, 4));
  const month = opts?.month ?? Number(ctx.today.slice(5, 7));
  const ym = `${year}-${String(month).padStart(2, '0')}`;
  const monthStart = `${ym}-01`;
  const nextMonth =
    month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const label = new Date(Date.UTC(year, month - 1, 1)).toLocaleString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  const entries = (await ctx.sqlite
    .prepare(
      `SELECT employee_id, entry_type, quantity_half_days, effective_on
       FROM balance_ledger`,
    )
    .all()) as {
    employee_id: string;
    entry_type: string;
    quantity_half_days: number;
    effective_on: string;
  }[];

  const pendingByEmp = (await ctx.sqlite
    .prepare(
      `SELECT employee_id, COALESCE(SUM(total_half_days), 0) AS half
       FROM leave_request
       WHERE status = 'pending_approval'
       GROUP BY employee_id`,
    )
    .all()) as { employee_id: string; half: number }[];
  const pendingMap = new Map(pendingByEmp.map((p) => [p.employee_id, Number(p.half) || 0]));

  const isCredit = (t: string) =>
    [
      'OPENING',
      'ACCRUAL',
      'ENTITLEMENT_GRANT',
      'CARRY_FORWARD',
      'MIGRATION_OPENING',
      'ADJUSTMENT',
    ].includes(t);
  const isUsed = (t: string) => ['DEDUCTION', 'ENCASHMENT', 'EXPIRY'].includes(t);

  const rows = employees
    .filter((e) => e.status !== 'exited')
    .map((e) => {
      let openingHalf = 0;
      let earnedHalf = 0;
      let usedHalf = 0;
      for (const row of entries) {
        if (row.employee_id !== e.id) continue;
        if (isCredit(row.entry_type) || isUsed(row.entry_type)) {
          if (row.effective_on < monthStart) openingHalf += row.quantity_half_days;
        }
        if (row.effective_on >= monthStart && row.effective_on < nextMonth) {
          if (isCredit(row.entry_type)) earnedHalf += row.quantity_half_days;
          else if (isUsed(row.entry_type)) usedHalf += -row.quantity_half_days;
        }
      }
      const pendingHalf = pendingMap.get(e.id) ?? 0;
      const closingHalf = openingHalf + earnedHalf - usedHalf;
      return {
        employeeId: e.id,
        employeeCode: e.employee_code,
        name: `${e.first_name} ${e.last_name}`,
        department: e.dept_name,
        opening: openingHalf / 2,
        earned: earnedHalf / 2,
        used: usedHalf / 2,
        pending: pendingHalf / 2,
        closing: closingHalf / 2,
      };
    });

  return { year, month, ym, label, rows };
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

/**
 * The annual leave report: for one leave year and leave type, each person's opening
 * balance, what they earned, manual changes, what they used (and in which month), what is
 * still waiting for approval, and where they closed. Monthly use comes from the counted
 * days themselves, so leave from 28 September to 3 October lands in both months.
 */
export async function annualReport(
  ctx: RequestContext,
  opts: { periodId?: string; leaveTypeId?: string },
) {
  requirePrincipal(ctx);
  await authorizeAction(ctx, 'report.leave.view', null);
  const periods = (await ctx.sqlite
    .prepare(
      `SELECT id, label, starts_on AS "startsOn", ends_on AS "endsOn" FROM leave_period ORDER BY starts_on DESC`,
    )
    .all()) as { id: string; label: string; startsOn: string; endsOn: string }[];
  const periodId = opts.periodId || (await currentPeriodId(ctx));
  const period = periods.find((x) => x.id === periodId);
  if (!period) throw new DomainError('NOT_FOUND', 'Leave year not found.', { httpStatus: 404 });
  const leaveTypes = (await ctx.sqlite
    .prepare(`SELECT id, code, name FROM leave_type WHERE archived_at IS NULL ORDER BY name`)
    .all()) as { id: string; code: string; name: string }[];
  const leaveType =
    leaveTypes.find((t) => t.id === opts.leaveTypeId) ??
    leaveTypes.find((t) => t.code === 'EL') ??
    leaveTypes[0];
  if (!leaveType) {
    return {
      periods,
      periodId,
      leaveTypes,
      leaveTypeId: null,
      months: [],
      rows: [],
      label: period.label,
    };
  }
  const months: { ym: string; label: string }[] = [];
  for (let d = period.startsOn.slice(0, 7); d <= period.endsOn.slice(0, 7);) {
    const [y, m] = d.split('-').map(Number) as [number, number];
    months.push({
      ym: d,
      label: new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-GB', {
        month: 'short',
        timeZone: 'UTC',
      }),
    });
    d = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  }
  const people = (await ctx.sqlite
    .prepare(
      `SELECT e.id, e.employee_code AS code, e.first_name || ' ' || e.last_name AS name,
              d.name AS department
         FROM employee e JOIN department d ON d.id = e.department_id
        WHERE e.status != 'exited' OR e.exited_on >= ?
        ORDER BY d.name, e.first_name, e.last_name`,
    )
    .all(period.startsOn)) as { id: string; code: string; name: string; department: string }[];
  const ledgerRows = (await ctx.sqlite
    .prepare(
      `SELECT employee_id AS "employeeId", entry_type AS "entryType", COALESCE(SUM(quantity_half_days), 0) AS n
         FROM balance_ledger WHERE period_id = ? AND leave_type_id = ?
        GROUP BY employee_id, entry_type`,
    )
    .all(periodId, leaveType.id)) as { employeeId: string; entryType: string; n: number }[];
  const used = (await ctx.sqlite
    .prepare(
      `SELECT r.employee_id AS "employeeId", SUBSTR(d.date, 1, 7) AS ym,
              SUM(CASE WHEN d.portion = 'full' THEN 2 ELSE 1 END) AS n
         FROM leave_request r JOIN leave_request_day d ON d.leave_request_id = r.id
        WHERE r.leave_type_id = ? AND r.status = 'approved' AND d.is_counted = 1
          AND d.date >= ? AND d.date <= ?
        GROUP BY r.employee_id, SUBSTR(d.date, 1, 7)`,
    )
    .all(leaveType.id, period.startsOn, period.endsOn)) as {
    employeeId: string;
    ym: string;
    n: number;
  }[];
  const sum = (id: string, kinds: string[]) =>
    ledgerRows
      .filter((r) => r.employeeId === id && kinds.includes(r.entryType))
      .reduce((a, r) => a + Number(r.n), 0) / 2;
  const rows = people.map((person) => {
    const monthly = months.map(
      (m) =>
        used
          .filter((u) => u.employeeId === person.id && u.ym === m.ym)
          .reduce((a, u) => a + Number(u.n), 0) / 2,
    );
    const opening = sum(person.id, ['OPENING', 'MIGRATION_OPENING', 'CARRY_FORWARD']);
    const earned = sum(person.id, ['ACCRUAL', 'ENTITLEMENT_GRANT']);
    const adjusted = sum(person.id, ['ADJUSTMENT']);
    const usedTotal = -sum(person.id, ['DEDUCTION', 'ENCASHMENT', 'EXPIRY', 'CANCELLATION_CREDIT']);
    const pending = -sum(person.id, ['PENDING_HOLD', 'HOLD_RELEASE']);
    return {
      employeeId: person.id,
      code: person.code,
      name: person.name,
      department: person.department,
      opening,
      earned,
      adjusted,
      used: usedTotal,
      pending,
      closing: opening + earned + adjusted - usedTotal,
      monthly,
    };
  });
  return {
    periods,
    periodId,
    label: `${leaveType.name} — ${period.label}`,
    leaveTypes,
    leaveTypeId: leaveType.id,
    months: months.map((m) => m.label),
    rows,
  };
}

/** The signed-in person's own record, as shown on their Profile page. */
export async function myProfile(ctx: RequestContext) {
  const p = requirePrincipal(ctx);
  if (!p.employeeId) return { employee: null, email: p.email, roles: p.roles };
  const e = (await ctx.sqlite
    .prepare(
      `SELECT e.id, e.employee_code AS code, e.first_name || ' ' || e.last_name AS name,
              e.work_email AS "workEmail", e.joined_on AS "joinedOn", e.status,
              e.probation_end_on AS "probationEndOn",
              d.name AS department, t.name AS team, j.name AS designation,
              et.name AS category, l.name AS location, c.phone,
              m.first_name || ' ' || m.last_name AS "reportingManager"
         FROM employee e
         JOIN department d ON d.id = e.department_id
         LEFT JOIN team t ON t.id = e.team_id
         LEFT JOIN job_title j ON j.id = e.job_title_id
         LEFT JOIN employment_type et ON et.id = e.employment_type_id
         LEFT JOIN location l ON l.id = e.location_id
         LEFT JOIN employee_contact c ON c.employee_id = e.id
         LEFT JOIN employee m ON m.id = e.manager_employee_id
        WHERE e.id = ?`,
    )
    .get(p.employeeId)) as Record<string, string | null>;
  return {
    employee: { ...e, leaveGoesTo: await describeRouteFor(ctx, p.employeeId, p.userId) },
    email: p.email,
    roles: p.roles,
  };
}
