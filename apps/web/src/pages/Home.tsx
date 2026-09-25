import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, EmptyState, ErrorState, Skeleton, StatusPill } from '@sns/ui';
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

type AwayRow = {
  id: string;
  employeeId: string;
  name: string;
  department: string;
  startDate: string;
  endDate: string;
  approvedBy: string | null;
  pay: 'earned' | 'loss_of_pay' | 'mixed';
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
  monthly: {
    ym: string;
    label: string;
    earned: number;
    used: number;
    balance: number;
    lossOfPay?: number;
  }[];
  upcomingApproved: HomeRequest[];
  holidays: { date: string; name: string; kind: string }[];
  lossOfPay?: { approved: number; pending: number };
  permission?: { usedHours: number; limitHours: number };
  awayToday?: AwayRow[];
  awaySoon?: AwayRow[];
  probation: { title: string; body: string } | null;
};

export function HomePage({ me }: { me: Me }) {
  if (can(me, 'leave.request.approve') || can(me, 'system.health.read')) {
    return <AdminHome />;
  }
  return <EmpHome me={me} />;
}

function EmpHome({ me }: { me: Me }) {
  const qc = useQueryClient();
  const [permHours, setPermHours] = useState<1 | 2>(1);
  const [permDate, setPermDate] = useState('');
  const [permReason, setPermReason] = useState('');
  const [permNote, setPermNote] = useState<string | null>(null);
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
  const headline =
    data.balances.find((b) => b.code === 'AL') ??
    data.balances.find((b) => b.code === 'EL') ??
    data.balances[0]!;
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

      {me.approvesLeave ||
      can(me, 'leave.request.read:company') ||
      can(me, 'team.availability.read:company') ||
      (data.awayToday?.length ?? 0) + (data.awaySoon?.length ?? 0) > 0 ? (
        <WhoIsAway today={data.awayToday ?? []} soon={data.awaySoon ?? []} />
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
        <div className="card">
          <p className="muted">Loss of pay</p>
          <p className="big">{formatDays(data.lossOfPay?.approved ?? 0)}</p>
          <p className="note">
            {(data.lossOfPay?.pending ?? 0) > 0
              ? `${formatDays(data.lossOfPay?.pending ?? 0)} more waiting on a decision`
              : 'Days not covered by earned leave'}
          </p>
        </div>
      </section>

      <section className="card" aria-label="Permission this month">
        <h2 style={{ margin: '0 0 6px', fontSize: 15 }}>Permission</h2>
        <p className="note">
          {formatDays(data.permission?.usedHours ?? 0)} of {data.permission?.limitHours ?? 2} hours
          used this month. You can take 1 hour or 2 hours at a time.
        </p>
        <form
          style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end' }}
          onSubmit={(e) => {
            e.preventDefault();
            setPermNote(null);
            void api<{ remainingHours: number }>('/api/v1/permissions', {
              method: 'POST',
              body: JSON.stringify({ onDate: permDate, hours: permHours, reason: permReason }),
            })
              .then(async (r) => {
                setPermNote(`Submitted. ${r.remainingHours} hour(s) left this month.`);
                setPermReason('');
                await qc.invalidateQueries({ queryKey: ['home'] });
              })
              .catch((err: unknown) =>
                setPermNote(err instanceof Error ? err.message : 'Could not submit permission.'),
              );
          }}
        >
          <label>
            Date
            <input
              className="input"
              type="date"
              required
              value={permDate}
              onChange={(e) => setPermDate(e.target.value)}
            />
          </label>
          <label>
            Hours
            <select
              className="input"
              value={permHours}
              onChange={(e) => setPermHours(Number(e.target.value) === 2 ? 2 : 1)}
            >
              <option value={1}>1 hour</option>
              <option value={2}>2 hours</option>
            </select>
          </label>
          <label>
            Reason
            <input
              className="input"
              required
              minLength={3}
              value={permReason}
              onChange={(e) => setPermReason(e.target.value)}
            />
          </label>
          <Button variant="primary" type="submit">
            Ask for permission
          </Button>
        </form>
        {permNote ? <p className="note">{permNote}</p> : null}
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
                  <th>Leave taken</th>
                  <th>Loss of pay</th>
                  <th>Balance</th>
                </tr>
              </thead>
              <tbody>
                {data.monthly.map((row) => (
                  <tr key={row.ym}>
                    <td>{row.label}</td>
                    <td className="mono">{formatDays(row.earned)}</td>
                    <td className="mono">{formatDays(row.used)}</td>
                    <td className="mono">{formatDays(row.lossOfPay ?? 0)}</td>
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

function PayTag({ pay }: { pay: AwayRow['pay'] }) {
  if (pay === 'mixed') {
    return (
      <>
        <PayTag pay="earned" />
        <PayTag pay="loss_of_pay" />
      </>
    );
  }
  const lop = pay === 'loss_of_pay';
  return (
    <span
      style={{
        fontSize: 10.5,
        fontWeight: 650,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        padding: '2px 7px',
        borderRadius: 999,
        background: lop ? '#fff1f2' : '#ecfdf5',
        color: lop ? '#be123c' : '#047857',
      }}
    >
      {lop ? 'Loss of pay' : 'Earned leave'}
    </span>
  );
}

function WhoIsAway({ today, soon }: { today: AwayRow[]; soon: AwayRow[] }) {
  function row(o: AwayRow) {
    return (
      <li
        key={o.id}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          padding: '10px 0',
          borderBottom: '1px solid var(--border-subtle, #f1f5f9)',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 8,
            alignItems: 'baseline',
          }}
        >
          <strong>{o.name}</strong>
          <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <PayTag pay={o.pay} />
          </span>
        </div>
        <span className="note" style={{ margin: 0 }}>
          {formatRange(o.startDate, o.endDate)}
          {o.department ? ` · ${o.department}` : ''}
        </span>
        <span className="note" style={{ margin: 0 }}>
          {o.approvedBy ? `Approved by ${o.approvedBy}` : 'Approved'}
        </span>
      </li>
    );
  }
  return (
    <section className="card" aria-label="Who is out">
      <h2 style={{ margin: '0 0 4px', fontSize: 14.5 }}>Who is out</h2>
      <p className="note" style={{ margin: '0 0 12px' }}>
        Whether they are in today, who signed the leave, and if it is earned leave or loss of pay.
      </p>
      <h3
        style={{
          margin: '0 0 4px',
          fontSize: 12,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          color: 'var(--text-tertiary)',
        }}
      >
        Today
      </h3>
      {today.length === 0 ? (
        <p className="note">Everyone is in today.</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>{today.map(row)}</ul>
      )}
      <h3
        style={{
          margin: '14px 0 4px',
          fontSize: 12,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          color: 'var(--text-tertiary)',
        }}
      >
        Next 7 days
      </h3>
      {soon.length === 0 ? (
        <p className="note">Nobody else is booked.</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>{soon.map(row)}</ul>
      )}
    </section>
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
        outToday: AwayRow[];
        upcomingAway: AwayRow[];
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
            <Link to="/approvals">Open queue</Link>
          </div>
          {d.pendingRows.length === 0 ? (
            <p className="note" style={{ padding: 18 }}>
              Nothing is waiting for your decision.
            </p>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 8 }}>
              {d.pendingRows.map((r) => (
                <li key={r.id} style={{ margin: '2px 0' }}>
                  <Link
                    to={`/approvals/${r.id}`}
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
          <WhoIsAway today={d.outToday} soon={d.upcomingAway} />
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
