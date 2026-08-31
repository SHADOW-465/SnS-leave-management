import { useQuery } from '@tanstack/react-query';
import { api } from '../api.js';

export function ReportsPage() {
  const q = useQuery({
    queryKey: ['reports'],
    queryFn: () =>
      api<{
        cards: { label: string; value: string; note: string }[];
        byMonth: { label: string; days: number; half: number }[];
      }>('/api/v1/reports'),
  });
  if (q.isPending) return <p>Loading reports…</p>;
  const max = Math.max(1, ...(q.data?.byMonth.map((m) => m.days) ?? [1]));
  return (
    <div>
      <section className="cards">
        {(q.data?.cards ?? []).map((c) => (
          <div key={c.label} className="card">
            <p className="muted">{c.label}</p>
            <p className="big">{c.value}</p>
            <p className="note">{c.note}</p>
          </div>
        ))}
      </section>
      <section className="card" style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <h2>Leave days taken by month</h2>
          <a href="/api/v1/reports/export.csv">Export CSV</a>
        </div>
        <div className="chart" role="img" aria-hidden="true">
          {(q.data?.byMonth ?? []).map((b) => (
            <div key={b.label} className="col">
              <div className="bar" style={{ height: `${(b.days / max) * 180}px` }} />
              <span className="mono">{b.label}</span>
            </div>
          ))}
        </div>
        <table>
          <caption>Equivalent data for the chart above</caption>
          <thead>
            <tr>
              <th>Month</th>
              <th>Days</th>
            </tr>
          </thead>
          <tbody>
            {(q.data?.byMonth ?? []).map((b) => (
              <tr key={b.label}>
                <td>{b.label}</td>
                <td>{b.days}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <style>{`
        .cards { display:grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap:12px; }
        .card { background:#fff; border:1px solid var(--border-subtle); border-radius:12px; padding:16px 18px; }
        .muted { color:var(--text-secondary); font-size:13px; font-weight:600; }
        .big { font-size:26px; font-weight:600; margin:0; }
        .chart { display:flex; align-items:flex-end; gap:10px; height:210px; margin:18px 0; }
        .col { flex:1; display:flex; flex-direction:column; justify-content:flex-end; gap:8px; height:100%; }
        .bar { background:var(--accent-default); border-radius:6px 6px 0 0; }
        .mono { font-family:var(--font-mono); font-size:11px; text-align:center; color:var(--text-tertiary); }
        table { width:100%; border-collapse:collapse; }
        th, td { text-align:left; padding:8px 0; border-bottom:1px solid var(--border-subtle); }
        @media (max-width: 768px) { .cards { grid-template-columns:1fr; } .chart { display:none; } }
      `}</style>
    </div>
  );
}
