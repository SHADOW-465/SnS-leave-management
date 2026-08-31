import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, ErrorState, Skeleton } from '@sns/ui';
import { api, ApiError, can, type Me } from '../api.js';

type Holiday = { date: string; name: string; kind: HolidayKind };
type HolidayKind = 'public' | 'optional' | 'declared_working';
type CalendarData = { holidays: Holiday[]; calendarId: string | null };

const KIND_LABEL: Record<HolidayKind, string> = {
  public: 'Public holiday',
  optional: 'Optional holiday',
  declared_working: 'Working day',
};

export function CalendarPage({ me }: { me: Me }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [selected, setSelected] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
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
  const holidayFor = (date: string) => q.data?.holidays.find((h) => h.date === date);
  const selectedHoliday = selected ? holidayFor(selected) : undefined;

  // Selecting a *different* day loads that day's name so editing does not silently
  // blank it. Deliberately keyed on `selected` alone: re-running when the saved name
  // changes would wipe the confirmation message the moment a save succeeded.
  useEffect(() => {
    setName(selected ? (q.data?.holidays.find((h) => h.date === selected)?.name ?? '') : '');
    setError(null);
    setStatus(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  const monthHolidays = (q.data?.holidays ?? [])
    .filter((h) => h.date.startsWith(`${year}-${String(month).padStart(2, '0')}`))
    .sort((a, b) => a.date.localeCompare(b.date));

  async function mark(kind: HolidayKind) {
    if (!selected) return;
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setError('Give this day a name of at least two characters, for example "Republic Day".');
      return;
    }
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      await api('/api/v1/holidays', {
        method: 'POST',
        body: JSON.stringify({
          date: selected,
          name: trimmed,
          kind,
          ...(q.data?.calendarId ? { calendarId: q.data.calendarId } : {}),
        }),
      });
      await qc.invalidateQueries({ queryKey: ['cal'] });
      // Working-day counts, requests, dashboard, and availability change with the calendar.
      await qc.invalidateQueries({ queryKey: ['home'] });
      await qc.invalidateQueries({ queryKey: ['reqs'] });
      await qc.invalidateQueries({ queryKey: ['req'] });
      await qc.invalidateQueries({ queryKey: ['dash'] });
      await qc.invalidateQueries({ queryKey: ['availability'] });
      setStatus(`${formatDate(selected)} saved as ${KIND_LABEL[kind].toLowerCase()}.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save this day.');
    } finally {
      setBusy(false);
    }
  }

  async function clearDay() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const query = new URLSearchParams({ date: selected });
      if (q.data?.calendarId) query.set('calendarId', q.data.calendarId);
      await api(`/api/v1/holidays?${query.toString()}`, { method: 'DELETE' });
      await qc.invalidateQueries({ queryKey: ['cal'] });
      await qc.invalidateQueries({ queryKey: ['home'] });
      await qc.invalidateQueries({ queryKey: ['reqs'] });
      await qc.invalidateQueries({ queryKey: ['req'] });
      await qc.invalidateQueries({ queryKey: ['dash'] });
      await qc.invalidateQueries({ queryKey: ['availability'] });
      setStatus(`${formatDate(selected)} is back to a normal day.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not clear this day.');
    } finally {
      setBusy(false);
    }
  }

  function shiftMonth(dir: number) {
    const d = new Date(Date.UTC(year, month - 1 + dir, 1));
    setYear(d.getUTCFullYear());
    setMonth(d.getUTCMonth() + 1);
  }

  // Arrow keys move between days, as a date grid should.
  function onGridKeyDown(e: React.KeyboardEvent) {
    const step =
      e.key === 'ArrowRight'
        ? 1
        : e.key === 'ArrowLeft'
          ? -1
          : e.key === 'ArrowDown'
            ? 7
            : e.key === 'ArrowUp'
              ? -7
              : 0;
    if (!step || !selected) return;
    e.preventDefault();
    const next = addDays(selected, step);
    setSelected(next);
    if (!next.startsWith(`${year}-${String(month).padStart(2, '0')}`)) {
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
            className="cal-grid"
            onKeyDown={onGridKeyDown}
          >
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
              <div key={d} role="columnheader" className="cal-dow">
                {d}
              </div>
            ))}
            {weeks.flat().map((cell, i) =>
              cell === null ? (
                <div key={`pad-${i}`} aria-hidden className="cal-pad" />
              ) : (
                <button
                  key={cell}
                  type="button"
                  role="gridcell"
                  data-date={cell}
                  aria-selected={selected === cell}
                  aria-label={dayAriaLabel(cell, holidayFor(cell), isWeekend(cell))}
                  tabIndex={selected === cell || (!selected && cell.endsWith('-01')) ? 0 : -1}
                  onClick={() => setSelected(cell)}
                  className={cellClass(holidayFor(cell)?.kind, isWeekend(cell), selected === cell)}
                >
                  <span className="cal-num">{Number(cell.slice(8))}</span>
                  {holidayFor(cell) ? (
                    <span className="cal-tag">{holidayFor(cell)!.name}</span>
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
            <span className="swatch is-optional" aria-hidden /> Optional holiday — still counts as a
            working day
          </li>
          <li>
            <span className="swatch is-working" aria-hidden /> Working day declared on a weekend
          </li>
        </ul>
      </section>

      <aside className="card">
        <p className="kicker">Selected day</p>
        <p className="cal-selected">{selected ? formatDate(selected) : 'Pick a date'}</p>
        {selected ? (
          <p className="note" style={{ marginTop: 0 }}>
            {selectedHoliday
              ? `Currently ${KIND_LABEL[selectedHoliday.kind].toLowerCase()}: ${selectedHoliday.name}`
              : isWeekend(selected)
                ? 'Currently a weekend — not a working day.'
                : 'Currently a normal working day.'}
          </p>
        ) : null}

        {canEdit && selected ? (
          <div className="cal-editor">
            <label className="field-row">
              <span className="field-label">Name</span>
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Republic Day"
                maxLength={120}
              />
            </label>
            {error ? (
              <p role="alert" className="form-error">
                {error}
              </p>
            ) : null}
            {status ? (
              <p role="status" className="form-ok">
                {status}
              </p>
            ) : null}
            <Button variant="primary" disabled={busy} onClick={() => void mark('public')}>
              Public holiday
            </Button>
            <Button disabled={busy} onClick={() => void mark('optional')}>
              Optional holiday
            </Button>
            <Button disabled={busy} onClick={() => void mark('declared_working')}>
              Declare a working day
            </Button>
            {selectedHoliday ? (
              <Button variant="danger" disabled={busy} onClick={() => void clearDay()}>
                Clear this day
              </Button>
            ) : null}
          </div>
        ) : selected ? (
          <p className="note">You can view the calendar. Changing it needs holiday permission.</p>
        ) : null}

        <p className="kicker" style={{ marginTop: 22 }}>
          {monthLabel}
        </p>
        {monthHolidays.length === 0 ? (
          <p className="note">
            Nothing set this month.{' '}
            {canEdit ? 'Select a date to add a holiday.' : 'Weekends are still non-working.'}
          </p>
        ) : (
          <ul className="cal-list">
            {monthHolidays.map((h) => (
              <li key={h.date}>
                <button type="button" className="cal-list-btn" onClick={() => setSelected(h.date)}>
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

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function buildWeeks(year: number, month: number): (string | null)[][] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const startPad = (first.getUTCDay() + 6) % 7; // weeks start Monday
  const dim = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells: (string | null)[] = [...(Array(startPad).fill(null) as null[])];
  for (let d = 1; d <= dim; d++) {
    cells.push(`${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  }
  while (cells.length % 7) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

function isWeekend(iso: string): boolean {
  const day = new Date(iso + 'T00:00:00Z').getUTCDay();
  return day === 0 || day === 6;
}
