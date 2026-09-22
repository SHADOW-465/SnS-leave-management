import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { EmptyState, ErrorState, Skeleton, StatusPill } from '@sns/ui';
import { api, can, type Me } from '../api.js';
import { dayCount, daysLabel, formatRange, initials } from '../format.js';

type HomeBalance = {
  id: string;
  name: string;
  code: string;
  left: string;
  total: string;
  eligibility: string;
  taken: string;
  pending: string;
  unlimited: boolean;
  note: string;
  pct: string;
  aria: string;
};

type HomeRequest = {
  id: string;
  type_name: string;
  start_date: string;
  end_date: string;
  total_half_days: number;
  status: string;
  employee_name?: string;
};

type HomeData = {
  employee: {
    name: string;
    code: string;
    department: string;
    manager: string | null;
    leaveGoesTo: string;
    year: string;
  } | null;
  period: { label: string } | null;
  balances: HomeBalance[];
  requests: HomeRequest[];
  monthly: { ym: string; label: string; earned: number; used: number; balance: number }[];
  upcomingApproved: HomeRequest[];
  holidays: { date: string; name: string; kind: string }[];
  probation: { title: string; body: string } | null;
};

export function HomePage({ me }: { me: Me }) {
  if (can(me, 'leave.request.approve') || can(me, 'system.health.read')) {
    return <AdminHome />;
  }
  return <EmpHome me={me} />;
}

function EmpHome({ me }: { me: Me }) {
  const q = useQuery({
    queryKey: ['home'],
    queryFn: () => api<HomeData>('/api/v1/home'),
  });
  const approvals = useQuery({
    queryKey: ['home-approvals'],
    queryFn: () =>
      api<HomeRequest[]>('/api/v1/leave-requests?view=approvals&status=pending_approval'),
    enabled: me.approvesLeave,
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
  const headline = data.balances.find((b) => b.code === 'EL') ?? data.balances[0]!;
  const pendingApprovals = approvals.data ?? [];
  return (
    <div className="page">
      {data.employee ? (
        <section className="card emp-identity" aria-label="Your details">
          <div>
            <p className="kicker" style={{ margin: 0 }}>
              Welcome
            </p>
            <h2 className="emp-hello">{data.employee.name}</h2>
          </div>
          <dl className="emp-meta">
            <div>
              <dt>Employee ID</dt>
              <dd>{data.employee.code}</dd>
            </div>
            <div>
              <dt>Department</dt>
              <dd>{data.employee.department}</dd>
            </div>
            <div>
              <dt>Reporting manager</dt>
              <dd>
                {data.employee.manager ?? 'Not assigned'}
                {!data.employee.manager ||
                !data.employee.leaveGoesTo.startsWith(data.employee.manager) ? (
                  <span className="emp-route">Your leave goes to {data.employee.leaveGoesTo}</span>
                ) : null}
              </dd>
            </div>
            <div>
              <dt>Leave year</dt>
              <dd>{data.employee.year}</dd>
            </div>
          </dl>
        </section>
      ) : null}

      {me.approvesLeave ? (
        <section className="card card-flush" aria-label="Pending leave requests">
          <div className="card-head">
            <h2>Pending leave requests</h2>
            <Link to="/approvals">Open queue</Link>
          </div>
          {approvals.isPending ? (
            <p className="note" style={{ padding: 18 }}>
              Loading requests waiting for you…
            </p>
          ) : pendingApprovals.length === 0 ? (
            <p className="note" style={{ padding: 18 }}>
              Nothing waiting for your decision.
            </p>
          ) : (
            <ul className="pending-list">
              {pendingApprovals.slice(0, 6).map((r) => (
                <li key={r.id}>
                  <Link to={`/approvals/${r.id}`} className="pending-row">
                    <strong>
                      {r.employee_name ?? 'Employee'} · {r.type_name}
                    </strong>
                    <span className="note">
                      {formatRange(r.start_date, r.end_date)} · {dayCount(r.total_half_days)}
                    </span>
                    <StatusPill status={r.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      <section aria-label="Leave this year" className="kpi-grid emp-stats">
        <div className="card">
          <p className="muted">Yearly eligibility</p>
          <p className="big">{headline.eligibility}</p>
          <p className="note">{headline.name}</p>
        </div>
        <div className="card">
          <p className="muted">Earned</p>
          <p className="big">{headline.total}</p>
          <p className="note">Credited this leave year</p>
        </div>
        <div className="card">
          <p className="muted">Used</p>
          <p className="big">{headline.taken}</p>
          <p className="note">After approval only</p>
        </div>
        <div className="card">
          <p className="muted">Pending</p>
          <p className="big">{headline.pending}</p>
          <p className="note">Waiting on a decision</p>
        </div>
        <div className="card emp-available">
          <p className="muted">Available balance</p>
          <p className="big">{headline.left}</p>
          <p className="note">Does not drop until leave is approved</p>
        </div>
      </section>

      <p className="emp-cta">
        <Link to="/apply" className="btn-primary-link">
          Apply for leave
        </Link>
      </p>

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

      {data.monthly.length ? (
        <section className="card card-flush">
          <div className="card-head">
            <h2>Leave summary</h2>
            <span className="note" style={{ margin: 0 }}>
              {headline.name} · month by month
            </span>
          </div>
          <div className="table-wrap">
            <table className="data">
              <caption className="sr-only">Monthly earned, used and closing balance</caption>
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Earned</th>
                  <th>Used</th>
                  <th>Balance</th>
                </tr>
              </thead>
              <tbody>
                {data.monthly.map((row) => (
                  <tr key={row.ym}>
                    <td>{row.label}</td>
                    <td className="mono">{formatDays(row.earned)}</td>
                    <td className="mono">{formatDays(row.used)}</td>
                    <td className="mono">{formatDays(row.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <div className="split">
        <section className="card card-flush">
          <div className="card-head">
            <h2>My requests</h2>
            <Link to="/requests">See all</Link>
          </div>
          <RequestTable rows={data.requests} />
        </section>
        <div className="page-stack">
          <section className="card">
            <h2 style={{ margin: '0 0 12px', fontSize: 14.5 }}>Upcoming approved leave</h2>
            {data.upcomingApproved.length === 0 ? (
              <p className="note">No approved leave coming up.</p>
            ) : (
              <ul className="plain-list">
                {data.upcomingApproved.map((r) => (
                  <li key={r.id}>
                    <Link to={`/requests/${r.id}`}>
                      <strong>{r.type_name}</strong>
                      <span className="note">
                        {formatRange(r.start_date, r.end_date)} · {dayCount(r.total_half_days)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="card">
            <h2 style={{ margin: '0 0 12px', fontSize: 14.5 }}>Government holidays</h2>
            {data.holidays.length === 0 ? (
              <p className="note">
                None listed yet. HR adds them on the <Link to="/calendar">holiday calendar</Link>.
              </p>
            ) : (
              <ul className="plain-list">
                {data.holidays.map((h) => (
                  <li key={h.date}>
                    <strong>{h.name}</strong>
                    <span className="note">{formatRange(h.date, h.date)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function formatDays(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
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
                        {formatRange(r.start_date, r.end_date)} · {dayCount(r.total_half_days)}
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
