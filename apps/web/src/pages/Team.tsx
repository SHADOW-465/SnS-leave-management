import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api.js';
import { initials } from '../format.js';
import { Users, UserCheck, CalendarDays, Clock } from 'lucide-react';

export function TeamPage({ weekendDays = [0, 6] }: { weekendDays?: number[] }) {
  const from = new Date().toISOString().slice(0, 10);
  const q = useQuery({
    queryKey: ['avail', from],
    queryFn: () =>
      api<{
        dates: string[];
        rows: {
          id: string;
          name: string;
          dept: string;
          cells: { kind: string; title: string }[];
        }[];
      }>(`/api/v1/availability?from=${from}&days=14`),
  });

  const parsedDates = useMemo(() => {
    if (!q.data?.dates) return [];
    return q.data.dates.map((d) => {
      const dateObj = new Date(d + 'T00:00:00Z');
      const dow = dateObj.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
      const dayNum = dateObj.getUTCDay();
      const isWeekend = weekendDays.includes(dayNum);
      const isToday = d === from;
      return {
        iso: d,
        dayOfMonth: d.slice(8),
        dow,
        isWeekend,
        isToday,
      };
    });
  }, [q.data?.dates, from, weekendDays]);

  const stats = useMemo(() => {
    if (!q.data?.rows || !parsedDates.length) {
      return { total: 0, inToday: 0, leaveToday: 0, pendingCount: 0 };
    }
    const total = q.data.rows.length;
    let inToday = 0;
    let leaveToday = 0;
    let pendingCount = 0;

    for (const row of q.data.rows) {
      // Cell 0 is today
      const todayCell = row.cells[0];
      if (todayCell) {
        if (todayCell.kind === 'approved') leaveToday++;
        else inToday++;
      }
      for (const c of row.cells) {
        if (c.kind === 'pending') pendingCount++;
      }
    }
    return { total, inToday, leaveToday, pendingCount };
  }, [q.data?.rows, parsedDates]);

  if (q.isPending) {
    return (
      <div className="page">
        <div className="avail-card">
          <p style={{ color: 'var(--text-secondary)' }}>Loading team availability…</p>
        </div>
      </div>
    );
  }

  if (!q.data?.rows.length) {
    return (
      <div className="page">
        <div className="avail-card">
          <p style={{ color: 'var(--text-secondary)' }}>No people are visible in your scope yet.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page" style={{ maxWidth: 1280 }}>
      {/* KPI Stats Grid */}
      <div className="avail-kpi-grid">
        <div className="avail-kpi-card">
          <div className="avail-kpi-icon" style={{ background: '#e0e7ff', color: '#4338ca' }}>
            <Users size={18} />
          </div>
          <div>
            <span className="avail-kpi-label">Team Members</span>
            <strong className="avail-kpi-val">{stats.total}</strong>
          </div>
        </div>

        <div className="avail-kpi-card">
          <div className="avail-kpi-icon" style={{ background: '#dcfce7', color: '#15803d' }}>
            <UserCheck size={18} />
          </div>
          <div>
            <span className="avail-kpi-label">In Office Today</span>
            <strong className="avail-kpi-val">{stats.inToday}</strong>
          </div>
        </div>

        <div className="avail-kpi-card">
          <div className="avail-kpi-icon" style={{ background: '#fee2e2', color: '#b91c1c' }}>
            <CalendarDays size={18} />
          </div>
          <div>
            <span className="avail-kpi-label">On Leave Today</span>
            <strong className="avail-kpi-val">{stats.leaveToday}</strong>
          </div>
        </div>

        <div className="avail-kpi-card">
          <div className="avail-kpi-icon" style={{ background: '#fef3c7', color: '#b45309' }}>
            <Clock size={18} />
          </div>
          <div>
            <span className="avail-kpi-label">Pending Requests</span>
            <strong className="avail-kpi-val">{stats.pendingCount}</strong>
          </div>
        </div>
      </div>

      {/* Main Grid Card */}
      <section className="avail-card">
        <div className="avail-card-header">
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>
              Next 14 days · Who is available
            </h2>
            <p className="note" style={{ margin: '4px 0 0', color: 'var(--text-secondary)' }}>
              Schedule range {q.data.dates[0]} to {q.data.dates.at(-1)}. Scroll horizontally on
              smaller screens.
            </p>
          </div>

          {/* Interactive Legend */}
          <div className="avail-legend">
            <div className="legend-item">
              <span className="legend-swatch swatch-in" />
              <span>In office</span>
            </div>
            <div className="legend-item">
              <span className="legend-swatch swatch-pending" />
              <span>Pending</span>
            </div>
            <div className="legend-item">
              <span className="legend-swatch swatch-approved" />
              <span>Approved leave</span>
            </div>
            <div className="legend-item">
              <span className="legend-swatch swatch-holiday" />
              <span>Holiday</span>
            </div>
            <div className="legend-item">
              <span className="legend-swatch swatch-weekend" />
              <span>Weekend</span>
            </div>
          </div>
        </div>

        <div className="avail-table-wrapper">
          <table className="avail-table">
            <caption className="sr-only">Team availability grid</caption>
            <thead>
              <tr>
                <th className="avail-th-person">Person</th>
                {parsedDates.map((d) => (
                  <th
                    key={d.iso}
                    className={`avail-th-date ${d.isWeekend ? 'is-weekend-col' : ''} ${
                      d.isToday ? 'is-today-col' : ''
                    }`}
                  >
                    <div className="th-dow">{d.dow}</div>
                    <div className="th-day">{d.dayOfMonth}</div>
                    {d.isToday ? <span className="today-badge">Today</span> : null}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {q.data.rows.map((row) => (
                <tr key={row.id} className="avail-tr">
                  <th scope="row" className="avail-td-person">
                    <div className="person-row">
                      <div className="person-avatar">{initials(row.name)}</div>
                      <div className="person-info">
                        <div className="person-name">{row.name}</div>
                        <span className="person-dept">{row.dept}</span>
                      </div>
                    </div>
                  </th>
                  {row.cells.map((c, i) => {
                    const d = parsedDates[i]!;
                    const cellClass = `grid-cell cell-${c.kind} ${
                      d.isWeekend && c.kind === 'in' ? 'cell-weekend' : ''
                    }`;
                    const label = `${row.name} · ${d.dow} ${d.dayOfMonth} (${d.iso}): ${c.title}`;
                    return (
                      <td
                        key={i}
                        className={`avail-td-cell ${d.isWeekend ? 'is-weekend-col' : ''}`}
                      >
                        <div className={cellClass} title={label} aria-label={label}>
                          {c.kind === 'approved' ? (
                            <span className="cell-indicator">Leave</span>
                          ) : c.kind === 'pending' ? (
                            <span className="cell-indicator">Pending</span>
                          ) : c.kind === 'holiday' ? (
                            <span className="cell-indicator">Holiday</span>
                          ) : null}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <style>{`
        .avail-kpi-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 14px;
          margin-bottom: 18px;
        }
        .avail-kpi-card {
          background: #ffffff;
          border: 1.5px solid #dcdcd4;
          border-radius: 12px;
          padding: 14px 16px;
          display: flex;
          align-items: center;
          gap: 14px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.04);
        }
        .avail-kpi-icon {
          width: 40px;
          height: 40px;
          border-radius: 10px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .avail-kpi-label {
          display: block;
          font-size: 12px;
          font-weight: 500;
          color: var(--text-secondary);
        }
        .avail-kpi-val {
          font-size: 20px;
          font-weight: 700;
          color: var(--text-primary);
          line-height: 1.2;
        }
        .avail-card {
          background: #ffffff;
          border: 1.5px solid #dcdcd4;
          border-radius: 14px;
          padding: 20px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.05);
        }
        .avail-card-header {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          margin-bottom: 18px;
          padding-bottom: 16px;
          border-bottom: 1.5px solid #e5e5df;
        }
        .avail-legend {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 14px;
          font-size: 12.5px;
          font-weight: 500;
          color: var(--text-secondary);
        }
        .legend-item {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .legend-swatch {
          width: 14px;
          height: 14px;
          border-radius: 4px;
          display: inline-block;
        }
        .swatch-in {
          background: #ffffff;
          border: 1.5px solid #94a3b8;
        }
        .swatch-pending {
          background: #fef3c7;
          border: 1.5px solid #d97706;
        }
        .swatch-approved {
          background: #e0e7ff;
          border: 1.5px solid #4f46e5;
        }
        .swatch-holiday {
          background: #fee2e2;
          border: 1.5px solid #dc2626;
        }
        .swatch-weekend {
          background: #f1f5f9;
          border: 1.5px dashed #94a3b8;
        }
        .avail-table-wrapper {
          overflow-x: auto;
          border: 1.5px solid #dcdcd4;
          border-radius: 10px;
          background: #ffffff;
        }
        .avail-table {
          width: 100%;
          min-width: 820px;
          border-collapse: separate;
          border-spacing: 0;
          font-size: 13px;
        }
        .avail-th-person {
          position: sticky;
          left: 0;
          background: #fbfbfa;
          z-index: 3;
          text-align: left;
          padding: 12px 16px;
          font-size: 12.5px;
          font-weight: 700;
          color: var(--text-primary);
          border-bottom: 2px solid #cbd5e1;
          border-right: 2px solid #cbd5e1;
          min-width: 180px;
          width: 180px;
        }
        .avail-th-date {
          padding: 8px 4px;
          text-align: center;
          border-bottom: 2px solid #cbd5e1;
          border-right: 1px solid #e2e8f0;
          background: #f8fafc;
          min-width: 44px;
        }
        .avail-th-date.is-weekend-col {
          background: #f1f5f9;
        }
        .avail-th-date.is-today-col {
          background: #eff6ff;
          border-bottom-color: #3b82f6;
        }
        .th-dow {
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          color: var(--text-secondary);
          letter-spacing: 0.04em;
        }
        .th-day {
          font-family: var(--font-mono);
          font-size: 13px;
          font-weight: 700;
          color: var(--text-primary);
          margin-top: 2px;
        }
        .today-badge {
          display: inline-block;
          font-size: 9px;
          font-weight: 700;
          text-transform: uppercase;
          padding: 1px 4px;
          border-radius: 3px;
          background: #2563eb;
          color: #ffffff;
          margin-top: 3px;
        }
        .avail-tr {
          transition: background 0.1s ease;
        }
        .avail-tr:hover {
          background: #f8fafc;
        }
        .avail-tr:hover .avail-td-person {
          background: #f8fafc;
        }
        .avail-td-person {
          position: sticky;
          left: 0;
          background: #ffffff;
          z-index: 2;
          padding: 10px 16px;
          text-align: left;
          border-bottom: 1px solid #e2e8f0;
          border-right: 2px solid #cbd5e1;
        }
        .person-row {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .person-avatar {
          width: 32px;
          height: 32px;
          border-radius: 8px;
          background: #e0e7ff;
          color: #4338ca;
          font-weight: 700;
          font-size: 11.5px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .person-name {
          font-weight: 600;
          color: var(--text-primary);
          font-size: 13.5px;
          line-height: 1.2;
          white-space: nowrap;
        }
        .person-dept {
          font-size: 11px;
          color: var(--text-secondary);
          font-weight: 500;
          display: inline-block;
          margin-top: 2px;
        }
        .avail-td-cell {
          padding: 5px 4px;
          text-align: center;
          border-bottom: 1px solid #e2e8f0;
          border-right: 1px solid #e2e8f0;
        }
        .avail-td-cell.is-weekend-col {
          background: rgba(241, 245, 249, 0.6);
        }
        .grid-cell {
          height: 32px;
          border-radius: 6px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: default;
          transition: transform 0.12s ease, box-shadow 0.12s ease, border-color 0.12s ease;
        }
        .grid-cell:hover {
          transform: translateY(-1px) scale(1.03);
          z-index: 1;
        }
        .cell-in {
          background: #ffffff;
          border: 1.5px solid #94a3b8;
        }
        .cell-in:hover {
          border-color: #475569;
          box-shadow: 0 2px 5px rgba(0,0,0,0.08);
          background: #f8fafc;
        }
        .cell-weekend {
          background: #f1f5f9;
          border: 1.5px dashed #94a3b8;
        }
        .cell-weekend:hover {
          border-color: #64748b;
        }
        .cell-approved {
          background: #e0e7ff;
          border: 1.5px solid #4f46e5;
          color: #3730a3;
          font-weight: 600;
        }
        .cell-approved:hover {
          border-color: #3730a3;
          box-shadow: 0 2px 8px rgba(79, 70, 229, 0.35);
        }
        .cell-pending {
          background: #fef3c7;
          border: 1.5px solid #d97706;
          color: #92400e;
          font-weight: 600;
        }
        .cell-pending:hover {
          border-color: #b45309;
          box-shadow: 0 2px 8px rgba(217, 119, 6, 0.35);
        }
        .cell-holiday {
          background: #fee2e2;
          border: 1.5px solid #dc2626;
          color: #991b1b;
          font-weight: 600;
        }
        .cell-holiday:hover {
          border-color: #991b1b;
          box-shadow: 0 2px 8px rgba(220, 38, 38, 0.35);
        }
        .cell-indicator {
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.03em;
          padding: 0 4px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      `}</style>
    </div>
  );
}
