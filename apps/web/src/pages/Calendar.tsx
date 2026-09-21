import { useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, ErrorState, Select, Skeleton } from '@sns/ui';
import { api, ApiError, can, type Me } from '../api.js';

type Holiday = { date: string; name: string; kind: HolidayKind };
type HolidayKind = 'public' | 'optional' | 'declared_working';
type CalendarData = { holidays: Holiday[]; calendarId: string | null };
type BulkResult = {
  changed: string[];
  skipped: { date: string; reason: string }[];
  message: string;
};

const KIND_LABEL: Record<HolidayKind, string> = {
  public: 'Public holiday',
  optional: 'Optional holiday',
  declared_working: 'Working day',
};
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DOW_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const NTH = [
  { value: 'every', label: 'Every' },
  { value: '1', label: '1st' },
  { value: '2', label: '2nd' },
  { value: '3', label: '3rd' },
  { value: '4', label: '4th' },
  { value: '5', label: '5th' },
  { value: 'last', label: 'Last' },
];

export function CalendarPage({ me }: { me: Me }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [picked, setPicked] = useState<string[]>([]);
  const [anchor, setAnchor] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [nth, setNth] = useState('2');
  const [dow, setDow] = useState('5'); // Saturday, Monday-first index
  const [multi, setMulti] = useState(false);
  const [span, setSpan] = useState<'month' | 'rest' | 'year'>('year');
  const qc = useQueryClient();
  const gridRef = useRef<HTMLDivElement>(null);

  const q = useQuery({
    queryKey: ['cal', year, month],
    queryFn: () => api<CalendarData>(`/api/v1/calendar?year=${year}&month=${month}`),
  });
  const canEdit = can(me, 'holiday.calendar.manage');
  const weeks = useMemo(() => buildWeeks(year, month), [year, month]);
  const monthLabel = new Date(Date.UTC(year, month - 1, 1)).toLocaleString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const byDate = useMemo(() => new Map((q.data?.holidays ?? []).map((h) => [h.date, h])), [q.data]);
  const pickedSet = useMemo(() => new Set(picked), [picked]);
  const monthKey = `${year}-${String(month).padStart(2, '0')}`;
  const monthHolidays = (q.data?.holidays ?? [])
    .filter((h) => h.date.startsWith(monthKey))
    .sort((a, b) => a.date.localeCompare(b.date));
  const single = picked.length === 1 ? picked[0]! : null;
  const singleHoliday = single ? byDate.get(single) : undefined;

  function select(dates: string[], mode: 'replace' | 'add' | 'toggle') {
    setError(null);
    setStatus(null);
    setPicked((prev) => {
      if (mode === 'replace') return [...new Set(dates)].sort();
      const set = new Set(prev);
      if (mode === 'add') dates.forEach((d) => set.add(d));
      else dates.forEach((d) => (set.has(d) ? set.delete(d) : set.add(d)));
      return [...set].sort();
    });
    // A single day's existing name is the natural starting point for editing it.
    if (dates.length === 1 && mode === 'replace') setName(byDate.get(dates[0]!)?.name ?? '');
  }

  // A plain click edits one day. Shift-click adds a range, Ctrl/Cmd-click or
  // "Select several" toggles days in and out, so viewing one day stays one click.
  function onDayClick(date: string, e: React.MouseEvent) {
    if (canEdit && e.shiftKey && anchor) {
      setMulti(true);
      select(rangeBetween(anchor, date), 'add');
    } else if (canEdit && (multi || e.ctrlKey || e.metaKey)) {
      setMulti(true);
      select([date], 'toggle');
    } else {
      select([date], 'replace');
    }
    setAnchor(date);
  }

  function quickPick() {
    const months =
      span === 'month'
        ? [month]
        : span === 'rest'
          ? Array.from({ length: 12 - month + 1 }, (_, i) => month + i)
          : Array.from({ length: 12 }, (_, i) => i + 1);
    const wd = (Number(dow) + 1) % 7; // Monday-first index → getUTCDay
    const dates: string[] = [];
    for (const m of months) {
      const all = daysOfMonth(year, m).filter((d) => new Date(`${d}T00:00:00Z`).getUTCDay() === wd);
      if (nth === 'every') dates.push(...all);
      else if (nth === 'last') dates.push(all[all.length - 1]!);
      else if (all[Number(nth) - 1]) dates.push(all[Number(nth) - 1]!);
    }
    setMulti(true);
    select(dates, 'add');
  }

  async function apply(kind: HolidayKind | null) {
    if (!picked.length) return;
    const trimmed = name.trim();
    if ((kind === 'public' || kind === 'optional') && trimmed.length < 2) {
      setError('Give these days a name, for example "Second Saturday" or "Republic Day".');
      return;
    }
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const r = await api<BulkResult>('/api/v1/holidays/bulk', {
        method: 'POST',
        body: JSON.stringify({
          dates: picked,
          kind,
          ...(trimmed ? { name: trimmed } : {}),
          ...(q.data?.calendarId ? { calendarId: q.data.calendarId } : {}),
        }),
      });
      // Working-day counts, requests, balances and availability all follow the calendar.
      await qc.invalidateQueries();
      const skippedNote = r.skipped.length ? ` Skipped: ${summariseSkips(r.skipped)}.` : '';
      setStatus(r.message.replace(/ \d+ skipped\.$/, '') + skippedNote);
      if (r.changed.length) {
        setPicked([]);
        setMulti(false);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save these days.');
    } finally {
      setBusy(false);
    }
  }

  function shiftMonth(dir: number) {
    const d = new Date(Date.UTC(year, month - 1 + dir, 1));
    setYear(d.getUTCFullYear());
    setMonth(d.getUTCMonth() + 1);
  }

  // Arrow keys move focus between days; Enter or Space picks, as a date grid should.
  function onGridKeyDown(e: React.KeyboardEvent) {
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 7, ArrowUp: -7 }[e.key] ?? 0;
    const current = (document.activeElement as HTMLElement | null)?.dataset.date;
    if (!step || !current) return;
    e.preventDefault();
    const next = addDays(current, step);
    if (!next.startsWith(monthKey)) {
      const [y, m] = next.split('-').map(Number) as [number, number];
      setYear(y);
      setMonth(m);
    }
    requestAnimationFrame(() => {
      gridRef.current?.querySelector<HTMLButtonElement>(`[data-date="${next}"]`)?.focus();
    });
  }

  if (q.isError) {
    return (
      <ErrorState
        title="Could not load the calendar"
        body="Check that the Leave OS server is running, then try again."
        onRetry={() => void q.refetch()}
      />
    );
  }

  const summary = describeSelection(picked, byDate);

  return (
    <div className="cal-layout">
      <section className="card card-flush">
        <div className="cal-head">
          <h2>{monthLabel}</h2>
          <div className="cal-nav">
            <Button size="sm" aria-label="Previous month" onClick={() => shiftMonth(-1)}>
              ←
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setYear(now.getFullYear());
                setMonth(now.getMonth() + 1);
              }}
            >
              Today
            </Button>
            <Button size="sm" aria-label="Next month" onClick={() => shiftMonth(1)}>
              →
            </Button>
          </div>
        </div>
        {canEdit ? (
          <p className="note cal-hint">
            Click a day to edit it. Turn on <strong>Select several</strong>, Shift-click for a
            range, or click a weekday heading to pick every one in the month.
          </p>
        ) : null}
        <p className="sr-only" role="status">
          Showing {monthLabel}
        </p>
        {q.isPending ? (
          <Skeleton />
        ) : (
          <div
            ref={gridRef}
            role="grid"
            aria-label={`Calendar for ${monthLabel}`}
            aria-multiselectable={canEdit}
            className="cal-grid"
            onKeyDown={onGridKeyDown}
          >
            {DOW.map((d, i) =>
              canEdit ? (
                <button
                  key={d}
                  type="button"
                  role="columnheader"
                  className="cal-dow cal-dow-btn"
                  title={`Select every ${DOW_LONG[i]} in ${monthLabel}`}
                  onClick={() => {
                    setMulti(true);
                    const wd = (i + 1) % 7;
                    select(
                      daysOfMonth(year, month).filter(
                        (x) => new Date(`${x}T00:00:00Z`).getUTCDay() === wd,
                      ),
                      'toggle',
                    );
                  }}
                >
                  {d}
                </button>
              ) : (
                <div key={d} role="columnheader" className="cal-dow">
                  {d}
                </div>
              ),
            )}
            {weeks.flat().map((cell, i) =>
              cell === null ? (
                <div key={`pad-${i}`} aria-hidden className="cal-pad" />
              ) : (
                <button
                  key={cell}
                  type="button"
                  role="gridcell"
                  data-date={cell}
                  aria-selected={pickedSet.has(cell)}
                  aria-label={dayAriaLabel(cell, byDate.get(cell), isWeekend(cell))}
                  tabIndex={
                    pickedSet.has(cell) || (!picked.length && cell.endsWith('-01')) ? 0 : -1
                  }
                  onClick={(e) => onDayClick(cell, e)}
                  className={cellClass(
                    byDate.get(cell)?.kind,
                    isWeekend(cell),
                    pickedSet.has(cell),
                  )}
                >
                  <span className="cal-num">{Number(cell.slice(8))}</span>
                  {byDate.get(cell) ? (
                    <span className="cal-tag">{byDate.get(cell)!.name}</span>
                  ) : null}
                </button>
              ),
            )}
          </div>
        )}
        <ul className="cal-legend">
          <li>
            <span className="swatch is-public" aria-hidden /> Public holiday — not a working day
          </li>
          <li>
            <span className="swatch is-optional" aria-hidden /> Optional holiday — still a working
            day
          </li>
          <li>
            <span className="swatch is-working" aria-hidden /> Weekend made a working day
          </li>
        </ul>
      </section>

      <aside className="card">
        {canEdit ? (
          <>
            <div className="cal-mode">
              <label>
                <input
                  type="checkbox"
                  checked={multi}
                  onChange={(e) => {
                    setMulti(e.target.checked);
                    if (!e.target.checked && picked.length > 1) setPicked(picked.slice(0, 1));
                  }}
                />{' '}
                Select several days
              </label>
            </div>

            <p className="kicker" style={{ marginTop: 14 }}>
              Quick select
            </p>
            <div className="cal-quick">
              <Select size="sm" aria-label="Which" value={nth} options={NTH} onChange={setNth} />
              <Select
                size="sm"
                aria-label="Weekday"
                value={dow}
                options={DOW_LONG.map((d, i) => ({ value: String(i), label: d }))}
                onChange={setDow}
              />
              <Select
                size="sm"
                aria-label="Over"
                value={span}
                options={[
                  { value: 'month', label: `in ${monthLabel}` },
                  { value: 'rest', label: `from ${monthLabel.split(' ')[0]} to December` },
                  { value: 'year', label: `of every month in ${year}` },
                ]}
                onChange={(v) => setSpan(v as typeof span)}
              />
              <Button size="sm" onClick={quickPick}>
                Add to selection
              </Button>
            </div>
          </>
        ) : null}

        <p className="kicker" style={{ marginTop: 18 }}>
          {picked.length > 1 ? `${picked.length} days selected` : 'Selected day'}
        </p>
        {picked.length === 0 ? (
          <p className="cal-selected">Pick a date</p>
        ) : single ? (
          <>
            <p className="cal-selected">{formatDate(single)}</p>
            <p className="note" style={{ marginTop: 0 }}>
              {singleHoliday
                ? `Currently ${KIND_LABEL[singleHoliday.kind].toLowerCase()}: ${singleHoliday.name}`
                : isWeekend(single)
                  ? 'Currently a weekend — not a working day.'
                  : 'Currently a normal working day.'}
            </p>
          </>
        ) : (
          <>
            <div className="cal-chips">
              {picked.slice(0, 12).map((d) => (
                <button
                  key={d}
                  type="button"
                  className="cal-chip"
                  title="Remove from selection"
                  onClick={() => select([d], 'toggle')}
                >
                  {shortDate(d)} ×
                </button>
              ))}
              {picked.length > 12 ? <span className="note">+{picked.length - 12} more</span> : null}
            </div>
            <p className="note">{summary}</p>
          </>
        )}

        {canEdit && picked.length ? (
          <div className="cal-editor">
            <label className="field-row">
              <span className="field-label">Name</span>
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={picked.length > 1 ? 'Second Saturday' : 'Republic Day'}
                maxLength={120}
              />
            </label>
            {error ? (
              <p role="alert" className="form-error">
                {error}
              </p>
            ) : null}
            <Button variant="primary" disabled={busy} onClick={() => void apply('public')}>
              Mark as holiday
            </Button>
            <Button disabled={busy} onClick={() => void apply('optional')}>
              Mark as optional holiday
            </Button>
            <Button
              disabled={busy || !picked.some((d) => isWeekend(d) || byDate.has(d))}
              title="Only weekends or existing holidays can change"
              onClick={() => void apply('declared_working')}
            >
              Make working day{picked.length > 1 ? 's' : ''}
            </Button>
            <Button
              variant="danger"
              disabled={busy || !picked.some((d) => byDate.has(d))}
              onClick={() => void apply(null)}
            >
              Back to normal
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setPicked([]);
                setMulti(false);
              }}
            >
              Clear selection
            </Button>
          </div>
        ) : !canEdit && picked.length ? (
          <p className="note">You can view the calendar. Changing it needs holiday permission.</p>
        ) : null}
        {status ? (
          <p role="status" className="form-ok">
            {status}
          </p>
        ) : null}

        <p className="kicker" style={{ marginTop: 22 }}>
          {monthLabel}
        </p>
        {monthHolidays.length === 0 ? (
          <p className="note">
            Nothing set this month.{' '}
            {canEdit ? 'Select dates to add holidays.' : 'Weekends are still non-working.'}
          </p>
        ) : (
          <ul className="cal-list">
            {monthHolidays.map((h) => (
              <li key={h.date}>
                <button
                  type="button"
                  className="cal-list-btn"
                  onClick={() => select([h.date], 'replace')}
                >
                  <span className="mono cal-list-day">{h.date.slice(8)}</span>
                  <span>
                    <strong>{h.name}</strong>
                    <span className="note cal-list-kind">{KIND_LABEL[h.kind]}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}

function describeSelection(dates: string[], byDate: Map<string, Holiday>): string {
  if (dates.length < 2) return '';
  let weekend = 0;
  let holiday = 0;
  let working = 0;
  for (const d of dates) {
    const h = byDate.get(d);
    if (h?.kind === 'public' || h?.kind === 'optional') holiday++;
    else if (h?.kind === 'declared_working' || !isWeekend(d)) working++;
    else weekend++;
  }
  return [
    working && `${working} working`,
    weekend && `${weekend} weekend`,
    holiday && `${holiday} already holidays`,
  ]
    .filter(Boolean)
    .join(' · ');
}

function summariseSkips(skips: { date: string; reason: string }[]): string {
  const by = new Map<string, number>();
  for (const s of skips) by.set(s.reason, (by.get(s.reason) ?? 0) + 1);
  return [...by].map(([r, n]) => `${n} — ${r.replace(/\.$/, '').toLowerCase()}`).join('; ');
}

function cellClass(kind: HolidayKind | undefined, weekend: boolean, selected: boolean): string {
  const parts = ['cal-day'];
  if (kind === 'public') parts.push('is-public');
  else if (kind === 'optional') parts.push('is-optional');
  else if (kind === 'declared_working') parts.push('is-working');
  else if (weekend) parts.push('is-weekend');
  if (selected) parts.push('is-selected');
  return parts.join(' ');
}

function dayAriaLabel(date: string, holiday: Holiday | undefined, weekend: boolean): string {
  const base = formatDate(date);
  if (holiday) return `${base}, ${KIND_LABEL[holiday.kind]}: ${holiday.name}`;
  if (weekend) return `${base}, weekend`;
  return `${base}, working day`;
}

function formatDate(iso: string): string {
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function shortDate(iso: string): string {
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function rangeBetween(a: string, b: string): string[] {
  const [from, to] = a <= b ? [a, b] : [b, a];
  const out: string[] = [];
  // ponytail: capped at a year so a stray shift-click cannot select thousands of days
  for (let d = from; d <= to && out.length < 366; d = addDays(d, 1)) out.push(d);
  return out;
}

function daysOfMonth(year: number, month: number): string[] {
  const dim = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Array.from(
    { length: dim },
    (_, i) => `${year}-${String(month).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`,
  );
}

function buildWeeks(year: number, month: number): (string | null)[][] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const startPad = (first.getUTCDay() + 6) % 7; // weeks start Monday
  const cells: (string | null)[] = [
    ...(Array(startPad).fill(null) as null[]),
    ...daysOfMonth(year, month),
  ];
  while (cells.length % 7) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

function isWeekend(iso: string): boolean {
  const day = new Date(iso + 'T00:00:00Z').getUTCDay();
  return day === 0 || day === 6;
}
