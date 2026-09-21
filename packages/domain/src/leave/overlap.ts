import type { DayPortion } from './working-days.js';

export type LeaveRange = {
  startDate: string;
  endDate: string;
  halfDayStart?: DayPortion | null;
  halfDayEnd?: DayPortion | null;
};

function portion(range: LeaveRange): DayPortion {
  if (range.startDate !== range.endDate) return 'full';
  if (range.halfDayStart === 'am' || range.halfDayStart === 'pm') return range.halfDayStart;
  if (range.halfDayEnd === 'am' || range.halfDayEnd === 'pm') return range.halfDayEnd;
  return 'full';
}

/** True when two requests occupy the same working time and cannot both stand. */
export function leaveRangesOverlap(a: LeaveRange, b: LeaveRange): boolean {
  if (a.endDate < b.startDate || b.endDate < a.startDate) return false;
  const sameSingleDay =
    a.startDate === a.endDate && b.startDate === b.endDate && a.startDate === b.startDate;
  if (!sameSingleDay) return true;
  const pa = portion(a);
  const pb = portion(b);
  if (pa === 'full' || pb === 'full') return true;
  return pa === pb;
}
