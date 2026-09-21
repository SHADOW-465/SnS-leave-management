const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string): boolean {
  return ISO.test(value);
}

export function parseIsoDate(iso: string): Date {
  if (!ISO.test(iso)) {
    throw new Error(`Invalid calendar date: ${iso}`);
  }
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10));
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    throw new Error(`Invalid calendar date: ${iso}`);
  }
  return d;
}

export function formatIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(iso: string, n: number): string {
  const d = parseIsoDate(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return formatIsoDate(d);
}

export function dayOfWeek(iso: string): number {
  return parseIsoDate(iso).getUTCDay();
}

export function compareIsoDate(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

export function enumerateInclusiveDates(start: string, end: string): string[] {
  if (compareIsoDate(end, start) < 0) {
    throw new Error('endDate must be on or after startDate');
  }
  const out: string[] = [];
  let cursor = start;
  while (compareIsoDate(cursor, end) <= 0) {
    out.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return out;
}

export function formatDisplayDate(iso: string): string {
  const d = parseIsoDate(iso);
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

export function monthIndex(iso: string): { year: number; month: number } {
  return { year: Number(iso.slice(0, 4)), month: Number(iso.slice(5, 7)) - 1 };
}

/** Inclusive calendar months as `YYYY-MM`, from the month of `fromIso` through the month of `toIso`. */
export function monthsInclusive(fromIso: string, toIso: string): string[] {
  if (compareIsoDate(toIso, fromIso) < 0) return [];
  const out: string[] = [];
  let year = Number(fromIso.slice(0, 4));
  let month = Number(fromIso.slice(5, 7));
  const endYear = Number(toIso.slice(0, 4));
  const endMonth = Number(toIso.slice(5, 7));
  while (year < endYear || (year === endYear && month <= endMonth)) {
    out.push(`${year}-${String(month).padStart(2, '0')}`);
    month += 1;
    if (month === 13) {
      month = 1;
      year += 1;
    }
  }
  return out;
}
