import * as XLSX from 'xlsx';

export type HolidayRow = {
  date: string;
  name: string;
  kind: 'public' | 'optional' | 'declared_working';
};

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Reads a date the way HR types it: 2026-01-26, 26/01/2026, 26-01-2026, 26-Jan-2026,
 * 26 January 2026, or a real Excel date cell. Day-first, as in India.
 */
export function parseHolidayDate(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    // Excel dates carry no time zone; read the calendar date back without shifting it.
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  const text = String(value ?? '').trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (m) return valid(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text);
  if (m) return valid(Number(m[3]), Number(m[2]), Number(m[1]));
  m = /^(\d{1,2})[\s/.-]+([A-Za-z]{3,9})[\s/.,-]+(\d{4})$/.exec(text);
  if (m) {
    const month = MONTHS.indexOf(m[2]!.slice(0, 3).toLowerCase()) + 1;
    return month ? valid(Number(m[3]), month, Number(m[1])) : null;
  }
  return null;
}

function valid(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

function kindOf(value: unknown): HolidayRow['kind'] {
  const t = String(value ?? '')
    .trim()
    .toLowerCase();
  if (t.startsWith('opt') || t.startsWith('restrict')) return 'optional';
  if (t.includes('work')) return 'declared_working';
  return 'public';
}

/**
 * Turns an uploaded spreadsheet (Excel or CSV) into holiday rows. The first row is the
 * header; it needs a date column and a name column ("Holiday", "Name", "Occasion"), and may
 * have a type column. A "Day" column like the government list has is ignored.
 */
export function readHolidaySheet(buffer: Buffer): { rows: HolidayRow[]; problems: string[] } {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0] ?? ''];
  if (!sheet) return { rows: [], problems: ['The file has no sheets.'] };
  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    blankrows: false,
  });
  const headerIndex = grid.findIndex((r) => r.some((c) => /date/i.test(String(c ?? ''))));
  if (headerIndex < 0) {
    return { rows: [], problems: ['No header row with a "Date" column was found.'] };
  }
  const header = grid[headerIndex]!.map((c) =>
    String(c ?? '')
      .trim()
      .toLowerCase(),
  );
  const col = (...names: string[]) => header.findIndex((h) => names.some((n) => h.includes(n)));
  const dateCol = col('date');
  const nameCol = col('holiday', 'name', 'occasion', 'festival', 'description');
  const kindCol = col('kind', 'type', 'category');
  if (nameCol < 0) {
    return { rows: [], problems: ['No "Holiday" or "Name" column was found.'] };
  }
  const rows: HolidayRow[] = [];
  const problems: string[] = [];
  grid.slice(headerIndex + 1).forEach((r, i) => {
    const line = headerIndex + i + 2;
    const rawName = String(r[nameCol] ?? '').trim();
    if (!rawName && (r[dateCol] === undefined || r[dateCol] === '')) return;
    const date = parseHolidayDate(r[dateCol]);
    if (!date) {
      problems.push(`Row ${line}: "${String(r[dateCol] ?? '')}" is not a date.`);
      return;
    }
    if (rawName.length < 2) {
      problems.push(`Row ${line}: the holiday needs a name.`);
      return;
    }
    rows.push({
      date,
      name: rawName.slice(0, 120),
      kind: kindCol >= 0 ? kindOf(r[kindCol]) : 'public',
    });
  });
  return { rows, problems };
}

/**
 * Holidays that fall on the same date every year. Festivals that follow the lunar calendar
 * (Pongal, Deepavali, Ramzan…) move each year and must come from the official notification,
 * so they are deliberately not guessed here.
 */
export function standardHolidays(year: number): HolidayRow[] {
  return [
    ['01-01', "New Year's Day"],
    ['01-26', 'Republic Day'],
    ['04-14', 'Tamil New Year / Dr. Ambedkar Jayanti'],
    ['05-01', 'May Day'],
    ['08-15', 'Independence Day'],
    ['10-02', 'Gandhi Jayanti'],
    ['12-25', 'Christmas'],
  ].map(([md, name]) => ({ date: `${year}-${md}`, name: name!, kind: 'public' as const }));
}
