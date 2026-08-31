import type { Db } from '@sns/database';
import {
  newId,
  monthlyAccrualHalfDays,
  shouldAccrue,
  defaultRulesForCode,
  periodBounds,
} from '@sns/domain';
import { drainOutbox } from './email.js';
import { nowIso, todayInTimeZone } from './time.js';
export async function runJobsTick(sqlite: Db): Promise<void> {
  await drainOutbox(sqlite);
  await sweepSessions(sqlite);
  await healthProbe(sqlite);
  await maybeAccrue(sqlite);
}

export function startJobs(
  sqlite: Db,
  opts: { timers?: boolean } = {},
): {
  stop: () => void;
} {
  if (opts.timers === false) {
    runSafe(() => runJobsTick(sqlite));
    return { stop() {} };
  }
  const timers: NodeJS.Timeout[] = [];
  timers.push(setInterval(() => runSafe(() => drainOutbox(sqlite)), 60000));
  timers.push(setInterval(() => runSafe(() => sweepSessions(sqlite)), 60 * 60000));
  timers.push(setInterval(() => runSafe(() => healthProbe(sqlite)), 5 * 60000));
  timers.push(setInterval(() => runSafe(() => maybeAccrue(sqlite)), 12 * 60 * 60000));
  return {
    stop() {
      for (const t of timers) clearInterval(t);
    },
  };
}
function runSafe(fn: () => void | Promise<void>) {
  try {
    const r = fn();
    if (r && typeof (r as Promise<void>).then === 'function') {
      void (r as Promise<void>).catch(() => undefined);
    }
  } catch {
    // jobs never take down the process
  }
}
async function sweepSessions(sqlite: Db) {
  await sqlite
    .prepare(
      `UPDATE session SET revoked_at = ?, revoked_reason = 'expired' WHERE expires_at < ? AND revoked_at IS NULL`,
    )
    .run(nowIso(), nowIso());
}
async function healthProbe(sqlite: Db) {
  if (sqlite.dialect === 'sqlite') {
    await sqlite.exec('PRAGMA wal_checkpoint(PASSIVE)');
  } else {
    await sqlite.prepare('SELECT 1 AS n').get();
  }
}
async function maybeAccrue(sqlite: Db) {
  const company = (await sqlite.prepare(`SELECT * FROM company WHERE id = 'company'`).get()) as
    | {
        timezone: string;
        leave_year_start_month: number;
        leave_year_start_day: number;
      }
    | undefined;
  if (!company) return;
  const today = todayInTimeZone(company.timezone);
  const day = Number(today.slice(8, 10));
  if (day !== 1) return;
  const bounds = periodBounds(today, {
    startMonth: company.leave_year_start_month,
    startDay: company.leave_year_start_day,
  });
  let period = (await sqlite
    .prepare(`SELECT id FROM leave_period WHERE starts_on = ? AND ends_on = ?`)
    .get(bounds.startsOn, bounds.endsOn)) as
    | {
        id: string;
      }
    | undefined;
  if (!period) {
    const id = newId();
    await sqlite
      .prepare(`INSERT INTO leave_period (id, label, starts_on, ends_on) VALUES (?, ?, ?, ?)`)
      .run(id, bounds.label, bounds.startsOn, bounds.endsOn);
    period = { id };
  }
  const employees = (await sqlite
    .prepare(`SELECT id, status, probation_end_on FROM employee WHERE status != 'exited'`)
    .all()) as {
    id: string;
    status: string;
    probation_end_on: string | null;
  }[];
  const types = (await sqlite.prepare(`SELECT id, code FROM leave_type`).all()) as {
    id: string;
    code: string;
  }[];
  const now = nowIso();
  for (const e of employees) {
    for (const t of types) {
      const rules = defaultRulesForCode(t.code);
      const onProbation = Boolean(e.probation_end_on && e.probation_end_on > today);
      if (!shouldAccrue({ rules, employeeStatus: e.status, onProbation })) continue;
      if (rules.accrualMethod !== 'monthly') continue;
      const qty = monthlyAccrualHalfDays(rules.entitlementHalfDays);
      await sqlite
        .prepare(
          `INSERT INTO balance_ledger (id, employee_id, leave_type_id, period_id, entry_type, quantity_half_days, effective_on, source_type, reason, created_by, created_at)
           VALUES (?, ?, ?, ?, 'ACCRUAL', ?, ?, 'job_run', 'Monthly accrual', 'system', ?)`,
        )
        .run(newId(), e.id, t.id, period.id, qty, today, now);
    }
  }
}
