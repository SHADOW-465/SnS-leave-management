import { daysInMonth, formatIsoDate, parseIsoDate } from '../dates.js';

export type LeaveYearBoundary = {
  startMonth: number;
  startDay: number;
};

export function periodBounds(
  containingDate: string,
  boundary: LeaveYearBoundary,
): { startsOn: string; endsOn: string; label: string } {
  const d = parseIsoDate(containingDate);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const startedThisCalendarYear =
    month > boundary.startMonth || (month === boundary.startMonth && day >= boundary.startDay);
  const startYear = startedThisCalendarYear ? year : year - 1;
  const startsOn = clampDate(startYear, boundary.startMonth, boundary.startDay);
  const endYear = startYear + 1;
  const endExclusive = clampDate(endYear, boundary.startMonth, boundary.startDay);
  const ends = parseIsoDate(endExclusive);
  ends.setUTCDate(ends.getUTCDate() - 1);
  const endsOn = formatIsoDate(ends);
  return { startsOn, endsOn, label: `${startYear}–${endYear}` };
}

function clampDate(year: number, month: number, day: number): string {
  const max = daysInMonth(year, month - 1);
  const use = Math.min(day, max);
  const d = new Date(Date.UTC(year, month - 1, use));
  return formatIsoDate(d);
}
