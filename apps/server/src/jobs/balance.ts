import type { Db } from '@sns/database';
import { withTx } from '@sns/database';
import {
  capAccrual,
  completedServiceYears,
  monthCreditHalfDays,
  monthlyRateHalfDays,
  newId,
  parseRules,
  withCompanyEarnedLeave,
  periodBounds,
  planRollover,
  shouldAccrue,
  type LeavePolicyRules,
} from '@sns/domain';
import { nowIso, todayInTimeZone } from '../time.js';

type Company = {
  timezone: string;
  leave_year_start_month: number;
  leave_year_start_day: number;
};

type Employee = {
  id: string;
  status: string;
  joined_on: string;
  probation_end_on: string | null;
};

type LeaveTypeRow = { id: string; code: string };

/**
 * Reads the policy that is actually in force for a leave type, rather than the built-in
 * defaults. The accrual job used to call `defaultRulesForCode()`, so anything HR published
 * in Settings was ignored by every automatic balance movement.
 */
async function policyFor(
  sqlite: Db,
  leaveTypeId: string,
  onDate: string,
): Promise<LeavePolicyRules | null> {
  const row = (await sqlite
    .prepare(
      `SELECT v.rules_json, t.code FROM leave_policy_version v
         JOIN leave_type t ON t.id = v.leave_type_id
        WHERE v.leave_type_id = ? AND v.published_at IS NOT NULL AND v.effective_from <= ?
        ORDER BY v.version_no DESC LIMIT 1`,
    )
    .get(leaveTypeId, onDate)) as { rules_json: string; code: string } | undefined;
  if (!row) return null;
  try {
    return withCompanyEarnedLeave(parseRules(row.rules_json), row.code, row.rules_json);
  } catch {
    return null;
  }
}

/**
 * Credits one month of accrual to one person, exactly once. The amount follows the
 * policy: their staff category's rate (or the probation rate), the joining-month rule,
 * and the maximum-balance ceiling. Shared by the monthly job and by the catch-up a new
 * joiner gets, so the two can never disagree.
 */
export async function creditMonth(
  sqlite: Db,
  input: {
    employeeId: string;
    leaveTypeId: string;
    periodId: string;
    month: string;
    rules: LeavePolicyRules;
    actor: string;
    now: string;
    effectiveOn: string;
  },
): Promise<number | null> {
  const already = (await sqlite
    .prepare(
      `SELECT id FROM accrual_run WHERE employee_id = ? AND leave_type_id = ? AND accrual_month = ?`,
    )
    .get(input.employeeId, input.leaveTypeId, input.month)) as { id: string } | undefined;
  if (already) return null;
  const emp = (await sqlite
    .prepare(
      `SELECT e.joined_on AS "joinedOn", e.status, e.probation_end_on AS "probationEndOn",
              e.hire_background AS "hireBackground", et.code AS "categoryCode"
         FROM employee e LEFT JOIN employment_type et ON et.id = e.employment_type_id
        WHERE e.id = ?`,
    )
    .get(input.employeeId)) as
    | {
        joinedOn: string;
        status: string;
        probationEndOn: string | null;
        hireBackground: string | null;
        categoryCode: string | null;
      }
    | undefined;
  if (!emp) return null;
  const monthEnd = `${input.month}-31`;
  const monthStart = `${input.month}-01`;
  const onProbation =
    emp.status === 'probation' || Boolean(emp.probationEndOn && emp.probationEndOn > monthStart);
  let quantity = monthCreditHalfDays({
    rateHalfDays: monthlyRateHalfDays(input.rules, {
      categoryCode: emp.categoryCode,
      onProbation,
      yearsOfService: completedServiceYears(emp.joinedOn, monthStart),
      fresher: emp.hireBackground === 'fresher',
    }),
    joinMonthAccrual: input.rules.joinMonthAccrual,
    joinedOn: emp.joinedOn,
    monthIso: input.month,
  });
  if (emp.joinedOn > monthEnd) quantity = 0;
  if (quantity > 0 && input.rules.maxBalanceHalfDays > 0) {
    const bal = (await sqlite
      .prepare(
        `SELECT COALESCE(SUM(quantity_half_days), 0) AS n FROM balance_ledger
          WHERE employee_id = ? AND leave_type_id = ? AND period_id = ?`,
      )
      .get(input.employeeId, input.leaveTypeId, input.periodId)) as { n: number };
    quantity = capAccrual(Number(bal.n), quantity, input.rules.maxBalanceHalfDays);
  }
  await withTx(sqlite, async () => {
    if (quantity > 0) {
      await sqlite
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
          input.effectiveOn,
          `Monthly accrual for ${input.month}`,
          input.actor,
          input.now,
        );
    }
    await sqlite
      .prepare(
        `INSERT INTO accrual_run (id, period_id, employee_id, leave_type_id, accrual_month, ran_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(newId(), input.periodId, input.employeeId, input.leaveTypeId, input.month, input.now);
    await sqlite
      .prepare(
        `INSERT INTO audit_event (id, occurred_at, actor_user_id, actor_label, action, entity_type, entity_id, after_json, request_id, result)
         VALUES (?, ?, NULL, 'system', 'leave.accrual.credited', 'employee', ?, ?, 'job', 'ok')`,
      )
      .run(
        newId(),
        input.now,
        input.employeeId,
        JSON.stringify({
          month: input.month,
          leaveTypeId: input.leaveTypeId,
          quantityHalfDays: quantity,
        }),
      );
  });
  return quantity;
}

async function currentCompany(sqlite: Db): Promise<Company | undefined> {
  return (await sqlite.prepare(`SELECT * FROM company WHERE id = 'company'`).get()) as
    Company | undefined;
}

/** Finds, or creates, the leave period containing `today`. */
async function periodFor(
  sqlite: Db,
  company: Company,
  today: string,
): Promise<{ id: string; startsOn: string; endsOn: string; label: string }> {
  const bounds = periodBounds(today, {
    startMonth: company.leave_year_start_month,
    startDay: company.leave_year_start_day,
  });
  const existing = (await sqlite
    .prepare(`SELECT id FROM leave_period WHERE starts_on = ? AND ends_on = ?`)
    .get(bounds.startsOn, bounds.endsOn)) as { id: string } | undefined;
  if (existing) {
    return {
      id: existing.id,
      startsOn: bounds.startsOn,
      endsOn: bounds.endsOn,
      label: bounds.label,
    };
  }
  const id = newId();
  await sqlite
    .prepare(`INSERT INTO leave_period (id, label, starts_on, ends_on) VALUES (?, ?, ?, ?)`)
    .run(id, bounds.label, bounds.startsOn, bounds.endsOn);
  return { id, startsOn: bounds.startsOn, endsOn: bounds.endsOn, label: bounds.label };
}

async function balanceIn(
  sqlite: Db,
  employeeId: string,
  leaveTypeId: string,
  periodId: string,
): Promise<number> {
  const row = (await sqlite
    .prepare(
      `SELECT COALESCE(SUM(quantity_half_days), 0) AS n FROM balance_ledger
        WHERE employee_id = ? AND leave_type_id = ? AND period_id = ?`,
    )
    .get(employeeId, leaveTypeId, periodId)) as { n: number };
  return Number(row.n);
}

/**
 * Opens the current leave period for everyone who has not been opened into it yet:
 * grants the new year's entitlement, carries unused days forward under the policy cap,
 * and records anything above the cap as expired.
 *
 * Without this the whole company's balance read zero on the first day of a new leave
 * year, because balances are scoped to a period and the new period had no entries.
 *
 * Idempotent: `period_rollover_run` holds one row per employee, leave type, and period,
 * so repeated runs — including several server restarts on 1 January — cannot double-grant.
 */
export async function openCurrentPeriod(sqlite: Db): Promise<{ opened: number }> {
  const company = await currentCompany(sqlite);
  if (!company) return { opened: 0 };
  const today = todayInTimeZone(company.timezone);
  const now = nowIso();
  const period = await periodFor(sqlite, company, today);

  const previous = (await sqlite
    .prepare(`SELECT id FROM leave_period WHERE ends_on < ? ORDER BY ends_on DESC LIMIT 1`)
    .get(period.startsOn)) as { id: string } | undefined;

  const employees = (await sqlite
    .prepare(
      `SELECT id, status, joined_on, probation_end_on FROM employee WHERE status != 'exited'`,
    )
    .all()) as Employee[];
  const types = (await sqlite
    .prepare(`SELECT id, code FROM leave_type WHERE archived_at IS NULL`)
    .all()) as LeaveTypeRow[];

  let opened = 0;
  for (const employee of employees) {
    for (const type of types) {
      const already = (await sqlite
        .prepare(
          `SELECT id FROM period_rollover_run
            WHERE period_id = ? AND employee_id = ? AND leave_type_id = ?`,
        )
        .get(period.id, employee.id, type.id)) as { id: string } | undefined;
      if (already) continue;

      const rules = await policyFor(sqlite, type.id, today);
      if (!rules) continue;

      const closing = previous ? await balanceIn(sqlite, employee.id, type.id, previous.id) : 0;
      const plan = planRollover({
        rules,
        closingBalanceHalfDays: closing,
        joinedOn: employee.joined_on,
        periodStartsOn: period.startsOn,
        employeeStatus: employee.status,
      });

      await withTx(sqlite, async () => {
        const write = async (
          entryType: string,
          quantity: number,
          reason: string,
          expiresOn: string | null,
        ) => {
          if (quantity === 0) return;
          await sqlite
            .prepare(
              `INSERT INTO balance_ledger (id, employee_id, leave_type_id, period_id, entry_type, quantity_half_days, effective_on, source_type, reason, expires_on, created_by, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, 'job_run', ?, ?, 'system', ?)`,
            )
            .run(
              newId(),
              employee.id,
              type.id,
              period.id,
              entryType,
              quantity,
              period.startsOn,
              reason,
              expiresOn,
              now,
            );
        };

        await write(
          'ENTITLEMENT_GRANT',
          plan.grantHalfDays,
          `Entitlement for ${period.label}`,
          null,
        );
        await write(
          'CARRY_FORWARD',
          plan.carriedHalfDays,
          `Carried forward into ${period.label}`,
          plan.carryExpiresOn,
        );
        // The truncated remainder is written against the *closing* period so the old year
        // still reconciles to zero, rather than vanishing without a record.
        if (plan.expiredHalfDays > 0 && previous) {
          await sqlite
            .prepare(
              `INSERT INTO balance_ledger (id, employee_id, leave_type_id, period_id, entry_type, quantity_half_days, effective_on, source_type, reason, created_by, created_at)
               VALUES (?, ?, ?, ?, 'EXPIRY', ?, ?, 'job_run', ?, 'system', ?)`,
            )
            .run(
              newId(),
              employee.id,
              type.id,
              previous.id,
              -plan.expiredHalfDays,
              period.startsOn,
              `Above the carry-forward cap when ${period.label} opened`,
              now,
            );
        }
        await sqlite
          .prepare(
            `INSERT INTO period_rollover_run (id, period_id, employee_id, leave_type_id, ran_at)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .run(newId(), period.id, employee.id, type.id, now);
        await sqlite
          .prepare(
            `INSERT INTO audit_event (id, occurred_at, actor_user_id, actor_label, action, entity_type, entity_id, after_json, request_id, result)
             VALUES (?, ?, NULL, 'system', 'leave.period.opened', 'employee', ?, ?, 'job', 'ok')`,
          )
          .run(newId(), now, employee.id, JSON.stringify({ period: period.label, ...plan }));
      });
      opened += 1;
    }
  }
  return { opened };
}

/**
 * Credits monthly accrual, once per employee, leave type, and calendar month.
 *
 * Two bugs are fixed here. It reads the published policy instead of the built-in
 * defaults, so HR's settings actually take effect; and `accrual_run` makes it idempotent,
 * where before it ran on a twelve-hour timer and credited twice on the first of the month.
 */
export async function runMonthlyAccrual(sqlite: Db): Promise<{ credited: number }> {
  const company = await currentCompany(sqlite);
  if (!company) return { credited: 0 };
  const today = todayInTimeZone(company.timezone);
  const month = today.slice(0, 7);
  const now = nowIso();
  const period = await periodFor(sqlite, company, today);

  const employees = (await sqlite
    .prepare(
      `SELECT id, status, joined_on, probation_end_on FROM employee WHERE status != 'exited'`,
    )
    .all()) as Employee[];
  const types = (await sqlite
    .prepare(`SELECT id, code FROM leave_type WHERE archived_at IS NULL`)
    .all()) as LeaveTypeRow[];

  let credited = 0;
  for (const employee of employees) {
    for (const type of types) {
      const rules = await policyFor(sqlite, type.id, today);
      if (!rules || rules.accrualMethod !== 'monthly') continue;
      const onProbation = Boolean(employee.probation_end_on && employee.probation_end_on > today);
      if (!shouldAccrue({ rules, employeeStatus: employee.status, onProbation })) continue;
      // Someone who has not joined yet accrues nothing.
      if (employee.joined_on > today) continue;

      const credit = await creditMonth(sqlite, {
        employeeId: employee.id,
        leaveTypeId: type.id,
        periodId: period.id,
        month,
        rules,
        actor: 'system',
        now,
        effectiveOn: today,
      });
      if (credit === null) continue;
      credited += 1;
    }
  }
  return { credited };
}

/** Lapses carried-forward days once their expiry date has passed. */
export async function expireCarriedDays(sqlite: Db): Promise<{ expired: number }> {
  const company = await currentCompany(sqlite);
  if (!company) return { expired: 0 };
  const today = todayInTimeZone(company.timezone);
  const now = nowIso();

  const due = (await sqlite
    .prepare(
      `SELECT id, employee_id, leave_type_id, period_id, quantity_half_days
         FROM balance_ledger
        WHERE entry_type = 'CARRY_FORWARD' AND expires_on IS NOT NULL AND expires_on <= ?
          AND id NOT IN (SELECT reverses_entry_id FROM balance_ledger WHERE reverses_entry_id IS NOT NULL)`,
    )
    .all(today)) as {
    id: string;
    employee_id: string;
    leave_type_id: string;
    period_id: string;
    quantity_half_days: number;
  }[];

  let expired = 0;
  for (const entry of due) {
    // Only lapse what is still unused: if the balance has already been spent below the
    // carried amount, expiring the full amount would push it negative.
    const balance = await balanceIn(
      sqlite,
      entry.employee_id,
      entry.leave_type_id,
      entry.period_id,
    );
    const lapse = Math.min(entry.quantity_half_days, Math.max(0, balance));
    if (lapse <= 0) continue;
    await withTx(sqlite, async () => {
      await sqlite
        .prepare(
          `INSERT INTO balance_ledger (id, employee_id, leave_type_id, period_id, entry_type, quantity_half_days, effective_on, source_type, reason, reverses_entry_id, created_by, created_at)
           VALUES (?, ?, ?, ?, 'EXPIRY', ?, ?, 'job_run', 'Carried-forward days lapsed', ?, 'system', ?)`,
        )
        .run(
          newId(),
          entry.employee_id,
          entry.leave_type_id,
          entry.period_id,
          -lapse,
          today,
          entry.id,
          now,
        );
      await sqlite
        .prepare(
          `INSERT INTO audit_event (id, occurred_at, actor_user_id, actor_label, action, entity_type, entity_id, after_json, request_id, result)
           VALUES (?, ?, NULL, 'system', 'leave.carryforward.expired', 'employee', ?, ?, 'job', 'ok')`,
        )
        .run(newId(), now, entry.employee_id, JSON.stringify({ lapsedHalfDays: lapse }));
    });
    expired += 1;
  }
  return { expired };
}
