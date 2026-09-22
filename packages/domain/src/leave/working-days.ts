import { enumerateInclusiveDates, dayOfWeek } from '../dates.js';

export type HolidayKind = 'public' | 'optional' | 'declared_working';

export type Holiday = {
  date: string;
  kind: HolidayKind;
  name: string;
};

export type DayPortion = 'full' | 'am' | 'pm';

export type SkipReason = 'weekend' | 'public_holiday';

export type RequestDay = {
  date: string;
  portion: DayPortion;
  isCounted: boolean;
  skipReason: SkipReason | null;
  skipLabel: string | null;
};

export type WorkingDayOptions = {
  /** 0 = Sunday … 6 = Saturday. Default Sat+Sun. */
  weekendDays?: number[];
  /** Leave on a weekend is not counted. Default true. */
  excludeWeekends?: boolean;
  /** Leave on a public holiday is not counted. Default true. */
  excludeHolidays?: boolean;
};

function portionFor(
  date: string,
  start: string,
  end: string,
  halfDayStart: DayPortion | null,
  halfDayEnd: DayPortion | null,
): DayPortion {
  if (start === end) {
    if (halfDayStart === 'am' || halfDayStart === 'pm') return halfDayStart;
    if (halfDayEnd === 'am' || halfDayEnd === 'pm') return halfDayEnd;
    return 'full';
  }
  if (date === start && (halfDayStart === 'am' || halfDayStart === 'pm')) {
    return halfDayStart;
  }
  if (date === end && (halfDayEnd === 'am' || halfDayEnd === 'pm')) {
    return halfDayEnd;
  }
  return 'full';
}

/**
 * Optional/restricted holidays are stored and displayed but not auto-excluded (DW-40).
 * `declared_working` turns a weekend into a working day.
 */
export function classifyRequestDays(input: {
  startDate: string;
  endDate: string;
  holidays: Holiday[];
  halfDayStart?: DayPortion | null;
  halfDayEnd?: DayPortion | null;
  options?: WorkingDayOptions;
}): RequestDay[] {
  const weekendDays = input.options?.weekendDays ?? [0, 6];
  const excludeWeekends = input.options?.excludeWeekends ?? true;
  const excludeHolidays = input.options?.excludeHolidays ?? true;
  const byDate = new Map<string, Holiday[]>();
  for (const h of input.holidays) {
    const list = byDate.get(h.date) ?? [];
    list.push(h);
    byDate.set(h.date, list);
  }

  return enumerateInclusiveDates(input.startDate, input.endDate).map((date) => {
    const portion = portionFor(
      date,
      input.startDate,
      input.endDate,
      input.halfDayStart ?? null,
      input.halfDayEnd ?? null,
    );
    const marks = byDate.get(date) ?? [];
    const declaredWorking = marks.some((m) => m.kind === 'declared_working');
    const publicHoliday = marks.find((m) => m.kind === 'public');
    const weekend = weekendDays.includes(dayOfWeek(date));

    if (publicHoliday && !declaredWorking && excludeHolidays) {
      return {
        date,
        portion,
        isCounted: false,
        skipReason: 'public_holiday',
        skipLabel: publicHoliday.name,
      };
    }
    if (weekend && !declaredWorking && excludeWeekends) {
      return {
        date,
        portion,
        isCounted: false,
        skipReason: 'weekend',
        skipLabel: 'Weekend',
      };
    }
    return {
      date,
      portion,
      isCounted: true,
      skipReason: null,
      skipLabel: null,
    };
  });
}

/** 1 = 0.5 day. Full day = 2. */
export function halfDaysForPortion(portion: DayPortion): number {
  return portion === 'full' ? 2 : 1;
}

export function totalCountedHalfDays(days: RequestDay[]): number {
  let total = 0;
  for (const d of days) {
    if (d.isCounted) total += halfDaysForPortion(d.portion);
  }
  return total;
}

export function formatHalfDays(halfDays: number): string {
  const days = halfDays / 2;
  return Number.isInteger(days) ? String(days) : days.toFixed(1);
}

export function skippedSummary(days: RequestDay[]): string {
  const skipped = days.filter((d) => !d.isCounted);
  if (skipped.length === 0) return 'None';
  return skipped.map((d) => `${d.date.slice(8)} ${d.skipLabel ?? d.skipReason}`).join(', ');
}
