export function trimCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

export function parseFlexibleDate(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Excel serial date (days since 1899-12-30).
    const epoch = Date.UTC(1899, 11, 30);
    const ms = epoch + Math.round(value) * 86400000;
    return new Date(ms).toISOString().slice(0, 10);
  }
  const s = trimCell(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const dmY = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmY) {
    const a = Number(dmY[1]);
    const b = Number(dmY[2]);
    const y = Number(dmY[3]);
    // Prefer DD/MM/YYYY when a > 12; otherwise treat as DD/MM if b <= 12.
    if (a > 12 && b <= 12) {
      return iso(y, b, a);
    }
    if (b > 12 && a <= 12) {
      return iso(y, a, b);
    }
    return iso(y, b, a);
  }
  return null;
}

function iso(y: number, m: number, d: number): string {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    return '';
  }
  return dt.toISOString().slice(0, 10);
}

export function parseNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return value;
  const s = trimCell(value).replace(/,/g, '');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Prefix = so spreadsheet clients do not execute formulas. */
export function csvSafe(value: string): string {
  if (/^[=+\-@]/.test(value) || value.startsWith('\t')) {
    return `'${value}`;
  }
  return value;
}

export function blankVsZero(value: unknown): 'blank' | 'zero' | 'value' {
  if (value === null || value === undefined || trimCell(value) === '') return 'blank';
  const n = parseNumber(value);
  if (n === 0) return 'zero';
  return 'value';
}
