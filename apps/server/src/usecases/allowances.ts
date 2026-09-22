/**
 * Leave allowances per person, and the holiday calendar in bulk.
 *
 * An allowance is never stored as a number to overwrite: setting one writes an ADJUSTMENT
 * to the ledger for the difference, so the balance history still explains itself.
 */
import { withTx } from '@sns/database';
import { DomainError, newId } from '@sns/domain';
import { authorizeAction, requirePrincipal, type RequestContext } from '../ctx.js';
import {
  audit,
  recalculateLeaveRequestsForDate,
  recalculateUpcomingRequests,
  weekendDaysFor,
} from './leave.js';
import { currentPeriodId } from './setup.js';

const GRANT_TYPES = `('OPENING','ACCRUAL','ENTITLEMENT_GRANT','CARRY_FORWARD','MIGRATION_OPENING','ADJUSTMENT')`;
const TAKEN_TYPES = `('DEDUCTION','ENCASHMENT','EXPIRY')`;

export async function listAllowances(ctx: RequestContext) {
  requirePrincipal(ctx);
  await authorizeAction(ctx, 'leave.balance.read', null);
  const periodId = await currentPeriodId(ctx);
  const types = (await ctx.sqlite
    .prepare(`SELECT id, name, code FROM leave_type ORDER BY name`)
    .all()) as { id: string; name: string; code: string }[];
  const people = (await ctx.sqlite
    .prepare(
      `SELECT e.id, e.first_name || ' ' || e.last_name AS name, e.employee_code AS code,
              d.name AS "departmentName", t.name AS "teamName", e.joined_on AS "joinedOn"
         FROM employee e
         JOIN department d ON d.id = e.department_id
         LEFT JOIN team t ON t.id = e.team_id
        WHERE e.status != 'exited'
        ORDER BY d.name, e.first_name, e.last_name`,
    )
    .all()) as {
    id: string;
    name: string;
    code: string;
    departmentName: string;
    teamName: string | null;
    joinedOn: string;
  }[];
  const sums = (await ctx.sqlite
    .prepare(
      `SELECT employee_id AS "employeeId", leave_type_id AS "leaveTypeId",
              SUM(CASE WHEN entry_type IN ${GRANT_TYPES} THEN quantity_half_days ELSE 0 END) AS granted,
              SUM(CASE WHEN entry_type IN ${TAKEN_TYPES} THEN -quantity_half_days ELSE 0 END) AS taken,
              SUM(CASE WHEN entry_type = 'PENDING_HOLD' THEN -quantity_half_days ELSE 0 END) AS pending,
              SUM(quantity_half_days) AS available
         FROM balance_ledger WHERE period_id = ?
        GROUP BY employee_id, leave_type_id`,
    )
    .all(periodId)) as {
    employeeId: string;
    leaveTypeId: string;
    granted: number;
    taken: number;
    pending: number;
    available: number;
  }[];
  const key = (e: string, t: string) => `${e}:${t}`;
  const byKey = new Map(sums.map((s) => [key(s.employeeId, s.leaveTypeId), s]));
  return {
    types,
    people: people.map((p) => ({
      ...p,
      balances: Object.fromEntries(
        types.map((t) => {
          const s = byKey.get(key(p.id, t.id));
          return [
            t.id,
            {
              allowance: Number(s?.granted ?? 0),
              taken: Number(s?.taken ?? 0),
              pending: Math.max(0, Number(s?.pending ?? 0)),
              available: Number(s?.available ?? 0),
            },
          ];
        }),
      ),
    })),
  };
}

/**
 * Sets the yearly allowance for one leave type across one or more people. Nobody's
 * allowance can drop below what they have already taken or have waiting for approval —
 * those people are reported back and left untouched, and everyone else is updated.
 */
export async function setAllowances(
  ctx: RequestContext,
  input: { employeeIds: string[]; leaveTypeId: string; allowanceHalfDays: number; reason: string },
) {
  const p = requirePrincipal(ctx);
  const ids = [...new Set(input.employeeIds)];
  for (const id of ids) await authorizeAction(ctx, 'leave.balance.adjust', id);
  const type = (await ctx.sqlite
    .prepare(`SELECT id, name FROM leave_type WHERE id = ?`)
    .get(input.leaveTypeId)) as { id: string; name: string } | undefined;
  if (!type) throw new DomainError('NOT_FOUND', 'Leave type not found.', { httpStatus: 404 });
  const periodId = await currentPeriodId(ctx);

  const changed: string[] = [];
  const unchanged: string[] = [];
  const blocked: { name: string; reason: string }[] = [];
  await withTx(ctx.sqlite, async () => {
    for (const id of ids) {
      const row = (await ctx.sqlite
        .prepare(
          `SELECT e.first_name || ' ' || e.last_name AS name, e.status,
                  (SELECT COALESCE(SUM(quantity_half_days), 0) FROM balance_ledger
                    WHERE employee_id = e.id AND leave_type_id = ? AND period_id = ?
                      AND entry_type IN ${GRANT_TYPES}) AS granted,
                  (SELECT COALESCE(SUM(quantity_half_days), 0) FROM balance_ledger
                    WHERE employee_id = e.id AND leave_type_id = ? AND period_id = ?) AS available
             FROM employee e WHERE e.id = ?`,
        )
        .get(input.leaveTypeId, periodId, input.leaveTypeId, periodId, id)) as
        { name: string; status: string; granted: number; available: number } | undefined;
      if (!row) {
        blocked.push({ name: id, reason: 'Employee not found.' });
        continue;
      }
      if (row.status === 'exited') {
        blocked.push({ name: row.name, reason: 'Has left the company.' });
        continue;
      }
      const granted = Number(row.granted);
      const committed = granted - Number(row.available); // taken + waiting for approval
      if (input.allowanceHalfDays < committed) {
        blocked.push({
          name: row.name,
          reason: `Has already taken or requested ${committed / 2} days of ${type.name}, so the allowance cannot go below that.`,
        });
        continue;
      }
      const delta = input.allowanceHalfDays - granted;
      if (delta === 0) {
        unchanged.push(row.name);
        continue;
      }
      await ctx.sqlite
        .prepare(
          `INSERT INTO balance_ledger (id, employee_id, leave_type_id, period_id, entry_type, quantity_half_days, effective_on, source_type, reason, created_by, created_at)
           VALUES (?, ?, ?, ?, 'ADJUSTMENT', ?, ?, 'manual', ?, ?, ?)`,
        )
        .run(newId(), id, type.id, periodId, delta, ctx.today, input.reason, p.userId, ctx.now);
      await audit(
        ctx,
        'leave.allowance.set',
        'employee',
        id,
        { allowanceHalfDays: granted },
        {
          leaveTypeId: type.id,
          allowanceHalfDays: input.allowanceHalfDays,
          reason: input.reason,
        },
      );
      changed.push(row.name);
    }
  });
  const days = input.allowanceHalfDays / 2;
  return {
    changed: changed.length,
    unchanged: unchanged.length,
    blocked,
    message:
      changed.length === 0 && blocked.length === 0
        ? `Nothing to change — already ${days} days of ${type.name}.`
        : `${type.name} set to ${days} days for ${changed.length} ${changed.length === 1 ? 'person' : 'people'}.` +
          (blocked.length ? ` ${blocked.length} could not be changed.` : ''),
  };
}

// ---------------------------------------------------------------------------------------
// Holiday calendar
// ---------------------------------------------------------------------------------------

type Kind = 'public' | 'optional' | 'declared_working';
const DEFAULT_NAME: Record<Kind, string> = {
  public: 'Holiday',
  optional: 'Optional holiday',
  declared_working: 'Working day',
};

/**
 * Marks many days at once — or returns them to normal when `kind` is null. Days where the
 * change would mean nothing (a weekday "declared working", clearing an ordinary day) are
 * skipped and reported, not stored. Leave already booked over the days is recounted.
 */
export async function applyHolidays(
  ctx: RequestContext,
  input: { dates: string[]; kind: Kind | null; name?: string; calendarId?: string },
) {
  requirePrincipal(ctx);
  await authorizeAction(ctx, 'holiday.calendar.manage', null);
  const cal = (await ctx.sqlite
    .prepare(
      input.calendarId
        ? `SELECT id FROM holiday_calendar WHERE id = ?`
        : `SELECT id FROM holiday_calendar ORDER BY year DESC LIMIT 1`,
    )
    .get(...(input.calendarId ? [input.calendarId] : []))) as { id: string } | undefined;
  if (!cal) {
    throw new DomainError('NO_CALENDAR', 'No holiday calendar exists yet.', { httpStatus: 400 });
  }
  const name = input.name?.trim() || (input.kind ? DEFAULT_NAME[input.kind] : '');
  if (input.kind && name.length < 2) {
    throw new DomainError('NAME_REQUIRED', 'Give the days a name of at least two characters.', {
      httpStatus: 400,
    });
  }
  const dates = [...new Set(input.dates)].filter((d) => !Number.isNaN(Date.parse(d))).sort();
  const weekend = await weekendDaysFor(ctx);
  const isWeekend = (iso: string) => weekend.includes(new Date(`${iso}T00:00:00Z`).getUTCDay());

  const changed: string[] = [];
  const skipped: { date: string; reason: string }[] = [];
  await withTx(ctx.sqlite, async () => {
    for (const date of dates) {
      const before = (await ctx.sqlite
        .prepare(`SELECT name, kind FROM holiday WHERE holiday_calendar_id = ? AND date = ?`)
        .get(cal.id, date)) as { name: string; kind: Kind } | undefined;

      if (input.kind === null) {
        if (!before) {
          skipped.push({ date, reason: 'Already a normal day.' });
          continue;
        }
        await ctx.sqlite
          .prepare(`DELETE FROM holiday WHERE holiday_calendar_id = ? AND date = ?`)
          .run(cal.id, date);
        await audit(ctx, 'holiday.removed', 'holiday', date, before, null);
      } else {
        if (input.kind === 'declared_working' && !isWeekend(date)) {
          // A weekday is already a working day; declaring it one would only hide a holiday.
          if (!before) {
            skipped.push({ date, reason: 'Already a working day.' });
            continue;
          }
          await ctx.sqlite
            .prepare(`DELETE FROM holiday WHERE holiday_calendar_id = ? AND date = ?`)
            .run(cal.id, date);
          await audit(ctx, 'holiday.removed', 'holiday', date, before, null);
          await recalculateLeaveRequestsForDate(ctx, date, cal.id);
          changed.push(date);
          continue;
        }
        if (before && before.kind === input.kind && before.name === name) {
          skipped.push({ date, reason: 'Already set.' });
          continue;
        }
        await ctx.sqlite
          .prepare(
            `INSERT INTO holiday (id, holiday_calendar_id, date, name, kind)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT (holiday_calendar_id, date)
             DO UPDATE SET name = excluded.name, kind = excluded.kind`,
          )
          .run(newId(), cal.id, date, name, input.kind);
        await audit(
          ctx,
          before ? 'holiday.updated' : 'holiday.created',
          'holiday',
          date,
          before ?? null,
          {
            name,
            kind: input.kind,
          },
        );
      }
      await recalculateLeaveRequestsForDate(ctx, date, cal.id);
      changed.push(date);
    }
  });
  const label =
    input.kind === null
      ? 'returned to normal'
      : input.kind === 'declared_working'
        ? 'made working days'
        : `marked as ${input.kind === 'public' ? 'holidays' : 'optional holidays'}`;
  return {
    changed,
    skipped,
    message:
      changed.length === 0
        ? 'Nothing changed — every selected day was already like that.'
        : `${changed.length} ${changed.length === 1 ? 'day' : 'days'} ${label}.` +
          (skipped.length ? ` ${skipped.length} skipped.` : ''),
  };
}

export async function importHolidays(
  ctx: RequestContext,
  input: {
    rows: { date: string; name: string; kind: 'public' | 'optional' | 'declared_working' }[];
    calendarId?: string;
  },
) {
  const groups = new Map<
    string,
    { kind: 'public' | 'optional' | 'declared_working'; name: string; dates: string[] }
  >();
  for (const row of input.rows) {
    const key = `${row.kind}|${row.name}`;
    const g = groups.get(key);
    if (g) g.dates.push(row.date);
    else groups.set(key, { kind: row.kind, name: row.name, dates: [row.date] });
  }
  const changed: string[] = [];
  const skipped: { date: string; reason: string }[] = [];
  for (const g of groups.values()) {
    const result = await applyHolidays(ctx, {
      dates: g.dates,
      kind: g.kind,
      name: g.name,
      calendarId: input.calendarId,
    });
    changed.push(...result.changed);
    skipped.push(...result.skipped);
  }
  return {
    changed: [...new Set(changed)].sort(),
    skipped,
    message:
      changed.length === 0
        ? 'Nothing imported — every row was already on the calendar.'
        : `${changed.length} ${changed.length === 1 ? 'holiday' : 'holidays'} imported.` +
          (skipped.length ? ` ${skipped.length} skipped.` : ''),
  };
}

// ---------------------------------------------------------------------------------------
// Working week
// ---------------------------------------------------------------------------------------

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export async function workWeek(ctx: RequestContext) {
  requirePrincipal(ctx);
  return { weekendDays: await weekendDaysFor(ctx) };
}

/**
 * Sets which days are the weekend. Leave already requested for dates still to come is
 * recounted straight away, so nobody is charged for a day that is no longer a working day.
 */
export async function setWorkWeek(ctx: RequestContext, weekendDays: number[]) {
  const p = requirePrincipal(ctx);
  await authorizeAction(ctx, 'leave.policy.manage', null);
  const days = [...new Set(weekendDays)].filter((d) => d >= 0 && d <= 6).sort();
  if (days.length > 3) {
    throw new DomainError('TOO_MANY_WEEKEND_DAYS', 'A weekend can be at most three days.', {
      httpStatus: 400,
    });
  }
  const before = await weekendDaysFor(ctx);
  await withTx(ctx.sqlite, async () => {
    const exists = await ctx.sqlite
      .prepare(`SELECT key FROM app_setting WHERE key = 'calendar.weekend_days'`)
      .get();
    await ctx.sqlite
      .prepare(
        exists
          ? `UPDATE app_setting SET value_json = ?, updated_by = ?, updated_at = ? WHERE key = 'calendar.weekend_days'`
          : `INSERT INTO app_setting (value_json, updated_by, updated_at, key) VALUES (?, ?, ?, 'calendar.weekend_days')`,
      )
      .run(JSON.stringify(days), p.userId, ctx.now);
    await audit(
      ctx,
      'calendar.work_week.changed',
      'company',
      'company',
      { weekendDays: before },
      {
        weekendDays: days,
      },
    );
    await recalculateUpcomingRequests(ctx, 'work_week_change');
  });
  return {
    weekendDays: days,
    message: days.length
      ? `Weekend is now ${[...days]
          .sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
          .map((d) => DAY_NAMES[d])
          .join(' and ')}. Upcoming leave has been recounted.`
      : 'Every day is now a working day. Upcoming leave has been recounted.',
  };
}
