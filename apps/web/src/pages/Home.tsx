import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { EmptyState, ErrorState, Skeleton, StatusPill } from '@sns/ui';
import { api, can, type Me } from '../api.js';
import { daysLabel, formatRange, initials } from '../format.js';

export function HomePage({ me }: { me: Me }) {
  if (can(me, 'leave.request.approve') || can(me, 'system.health.read')) {
    return <AdminHome />;
  }
  return <EmpHome />;
}

function EmpHome() {
  const q = useQuery({
    queryKey: ['home'],
    queryFn: () =>
      api<{
        balances: {
          id: string;
          name: string;
          left: string;
          total: string;
          taken: string;
          unlimited: boolean;
          note: string;
          pct: string;
          aria: string;
        }[];
        requests: {
          id: string;
          type_name: string;
          start_date: string;
          end_date: string;
          total_half_days: number;
          status: string;
        }[];
        probation: { title: string; body: string } | null;
      }>('/api/v1/home'),
  });
  if (q.isPending) return <Skeleton />;
  if (q.isError) {
    return (
      <ErrorState
        title="Could not load your overview"
        body="Check that the Leave OS server is running on the office computer, then try again."
        onRetry={() => void q.refetch()}
      />
    );
  }
  const data = q.data;
  if (!data.balances.length) {
    return (
      <EmptyState
        title="No leave types yet"
        body="Your balances appear here once HR has set up leave types and entitlement."
        action={<Link to="/apply">Apply for leave</Link>}
      />
    );
  }
  return (
    <div className="page">
      <section aria-label="Leave balances" className="kpi-grid">
        {data.balances.map((b) => (
          <div key={b.id} className="card">
            <p className="muted">{b.name}</p>
            <p className="big">
              {b.unlimited ? b.taken : b.left}
              {b.unlimited ? null : <span className="dim"> / {b.total}</span>}
            </p>
            {b.unlimited ? null : (
              <div role="img" aria-label={b.aria} className="bar">
                <span style={{ width: b.pct }} />
              </div>
            )}
            <p className="note">{b.note}</p>
          </div>
        ))}
      </section>
      {data.probation ? (
        <section className="banner banner-warn">
          <div>
            <strong>{data.probation.title}</strong>
            <p className="note" style={{ margin: '4px 0 0', color: 'inherit' }}>
              {data.probation.body}
            </p>
          </div>
        </section>
      ) : null}
      <section className="card card-flush">
        <div className="card-head">
          <h2>My requests</h2>
          <Link to="/requests">See all</Link>
        </div>
        <RequestTable rows={data.requests} />
      </section>
    </div>
  );
}

function AdminHome() {
  const q = useQuery({
    queryKey: ['dash'],
    queryFn: () =>
      api<{
        kpis: { label: string; value: string; delta: string; deltaColor: string }[];
        pendingRows: {
          id: string;
          employee_name: string;
          type_name: string;
          start_date: string;
          end_date: string;
          total_half_days: number;
          status: string;
        }[];
        deptStats: { name: string; days: string; pct: string; aria: string }[];
        outToday: { name: string; type: string }[];
      }>('/api/v1/dashboard'),
  });
  if (q.isPending) return <Skeleton />;
  if (q.isError) {
    return (
      <ErrorState
        title="Could not load the dashboard"
        body="The office computer may be off or the server may have stopped."
        onRetry={() => void q.refetch()}
      />
    );
  }
  const d = q.data;
  return (
    <div className="page">
      <section className="kpi-grid" aria-label="Key numbers">
        {d.kpis.map((k) => (
          <div key={k.label} className="card">
            <p className="muted">{k.label}</p>
            <p className="big">{k.value}</p>
            <p className="note">{k.delta}</p>
          </div>
        ))}
      </section>
      <div className="split">
        <div className="card card-flush">
          <div className="card-head">
            <h2>Needs your decision</h2>
            <Link to="/requests">Open queue</Link>
          </div>
          {d.pendingRows.length === 0 ? (
            <p className="note" style={{ padding: 18 }}>
              The queue is clear. New requests from employees and managers land here for HR.
            </p>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 8 }}>
              {d.pendingRows.map((r) => (
                <li key={r.id} style={{ margin: '2px 0' }}>
                  <Link
                    to={`/requests/${r.id}`}
                    style={{
                      padding: 12,
                      display: 'flex',
                      gap: 12,
                      alignItems: 'center',
                      borderRadius: 9,
                      textDecoration: 'none',
                      color: 'inherit',
                      transition: 'background 0.12s ease',
                    }}
                    className="row-clickable"
                  >
                    <span
                      className="mark"
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: '50%',
                        background: 'var(--accent-subtle-bg)',
                        color: 'var(--accent-hover)',
                        fontSize: 11.5,
                      }}
                    >
                      {initials(r.employee_name)}
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <strong style={{ color: 'var(--text-primary)' }}>
                        {r.employee_name} · {r.type_name}
                      </strong>
                      <span className="note" style={{ display: 'block', margin: 0 }}>
                        {formatRange(r.start_date, r.end_date)} · {daysLabel(r.total_half_days)}{' '}
                        days
                      </span>
                    </span>
                    <StatusPill status={r.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="page-stack">
          <div className="card">
            <h2 style={{ margin: '0 0 14px', fontSize: 14.5 }}>Leave by department</h2>
            {d.deptStats.map((s) => (
              <div key={s.name} style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <strong>{s.name}</strong>
                  <span className="mono note" style={{ margin: 0 }}>
                    {s.days}d
                  </span>
                </div>
                <div role="img" aria-label={s.aria} className="bar" style={{ marginTop: 5 }}>
                  <span style={{ width: s.pct }} />
                </div>
              </div>
            ))}
          </div>
          <div className="card">
            <h2 style={{ margin: '0 0 12px', fontSize: 14.5 }}>Out today</h2>
            {d.outToday.length === 0 ? <p className="note">Nobody is out today.</p> : null}
            {d.outToday.map((o) => (
              <p
                key={o.name}
                style={{ display: 'flex', justifyContent: 'space-between', margin: '0 0 8px' }}
              >
                <strong>{o.name}</strong>
                <span className="note" style={{ margin: 0 }}>
                  {o.type}
                </span>
              </p>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function RequestTable({
  rows,
}: {
  rows: {
    id: string;
    type_name: string;
    start_date: string;
    end_date: string;
    total_half_days: number;
    status: string;
  }[];
}) {
  const navigate = useNavigate();
  if (!rows.length) {
    return (
      <p className="note" style={{ padding: 18 }}>
        No requests yet. Apply when you need time away.
      </p>
    );
  }
  return (
    <table className="data">
      <caption className="sr-only">Leave requests</caption>
      <thead>
        <tr>
          <th>Type</th>
          <th>Dates</th>
          <th>Days</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr
            key={r.id}
            className="row-clickable"
            tabIndex={0}
            role="button"
            aria-label={`View details for ${r.type_name} request`}
            onClick={() => void navigate(`/requests/${r.id}`)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                void navigate(`/requests/${r.id}`);
              }
            }}
          >
            <td>
              <strong>{r.type_name}</strong>
            </td>
            <td>{formatRange(r.start_date, r.end_date)}</td>
            <td className="mono">{daysLabel(r.total_half_days)}</td>
            <td>
              <StatusPill status={r.status} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
