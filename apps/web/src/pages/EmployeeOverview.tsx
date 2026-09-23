import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ErrorState, Skeleton, StatusPill } from '@sns/ui';
import { api } from '../api.js';

type Overview = {
  person: {
    id: string;
    name: string;
    code: string;
    department: string;
    team: string | null;
    jobTitle: string | null;
    manager: string | null;
    status: string;
    joinedOn: string;
    email: string;
  };
  year: string;
  leaveType: string;
  earned: { granted: number; taken: number; pending: number; available: number };
  lossOfPay: { approved: number; pending: number };
  permission: { usedHours: number; limitHours: number };
  monthly: { label: string; earned: number; taken: number; lossOfPay: number; balance: number }[];
  recent: {
    id: string;
    startDate: string;
    endDate: string;
    days: number;
    lossOfPay: number;
    status: string;
    typeName: string;
  }[];
};

const n = (days: number) => {
  if (!Number.isFinite(days)) return '0';
  const rounded = Math.round(days * 2) / 2;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
};

const when = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
};

const range = (start: string, end: string) =>
  start === end ? when(start) : `${when(start)} – ${when(end)}`;

export function EmployeeOverview({
  employeeId,
  onClose,
}: {
  employeeId: string;
  onClose: () => void;
}) {
  const q = useQuery({
    queryKey: ['leave-overview', employeeId],
    queryFn: () => api<Overview>(`/api/v1/employees/${employeeId}/leave-overview`),
  });

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const person = q.data?.person;

  return (
    <div className="ov-overlay" onClick={onClose}>
      <div
        className="ov"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ov-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="ov-head">
          <div>
            <h2 id="ov-title">{person?.name ?? 'Leave overview'}</h2>
            {person ? (
              <p className="ov-sub">
                {person.code}
                {person.jobTitle ? ` · ${person.jobTitle}` : ''}
                {' · '}
                {person.department}
                {person.team ? ` · ${person.team}` : ''}
              </p>
            ) : null}
          </div>
          <button type="button" className="ov-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>

        {q.isLoading ? (
          <div className="ov-body">
            <Skeleton rows={6} />
          </div>
        ) : q.isError || !q.data ? (
          <div className="ov-body">
            <ErrorState
              title="Could not load this leave overview"
              body={q.error instanceof Error ? q.error.message : 'Try again in a moment.'}
              onRetry={() => void q.refetch()}
            />
          </div>
        ) : (
          <div className="ov-body">
            <dl className="ov-id">
              <div>
                <dt>Reports to</dt>
                <dd>{q.data.person.manager ?? 'Not set'}</dd>
              </div>
              <div>
                <dt>Joined</dt>
                <dd>{when(q.data.person.joinedOn)}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>
                  <StatusPill status={q.data.person.status} />
                </dd>
              </div>
              <div>
                <dt>Leave year</dt>
                <dd>{q.data.year}</dd>
              </div>
            </dl>

            <section>
              <h3>{q.data.leaveType}</h3>
              <div className="ov-stats">
                <Stat label="Earned" value={`${n(q.data.earned.granted)} days`} />
                <Stat label="Taken" value={`${n(q.data.earned.taken)} days`} />
                <Stat label="Waiting" value={`${n(q.data.earned.pending)} days`} />
                <Stat label="Left" value={`${n(q.data.earned.available)} days`} />
              </div>
            </section>

            <div className="ov-pair">
              <section>
                <h3>Loss of pay</h3>
                <p className="ov-figure">{n(q.data.lossOfPay.approved)} days</p>
                <p className="ov-note">
                  Approved this year
                  {q.data.lossOfPay.pending > 0
                    ? ` · ${n(q.data.lossOfPay.pending)} days still waiting`
                    : ''}
                </p>
              </section>
              <section>
                <h3>Permission this month</h3>
                <p className="ov-figure">
                  {n(q.data.permission.usedHours)} of {q.data.permission.limitHours} hours
                </p>
                <p className="ov-note">Short absence, separate from earned leave</p>
              </section>
            </div>

            <section>
              <h3>Month by month</h3>
              {q.data.monthly.length === 0 ? (
                <p className="ov-note">Nothing credited yet this leave year.</p>
              ) : (
                <div className="ov-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Month</th>
                        <th>Earned</th>
                        <th>Taken</th>
                        <th>Loss of pay</th>
                        <th>Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {q.data.monthly.map((m) => (
                        <tr key={m.label}>
                          <td>{m.label}</td>
                          <td>{n(m.earned)}</td>
                          <td>{n(m.taken)}</td>
                          <td>{n(m.lossOfPay)}</td>
                          <td>{n(m.balance)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section>
              <h3>Recent earned leave</h3>
              {q.data.recent.length === 0 ? (
                <p className="ov-note">No earned leave requests yet.</p>
              ) : (
                <div className="ov-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Dates</th>
                        <th>Days</th>
                        <th>Loss of pay</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {q.data.recent.map((r) => (
                        <tr key={r.id}>
                          <td>{range(r.startDate, r.endDate)}</td>
                          <td>{n(r.days)}</td>
                          <td>{r.lossOfPay > 0 ? n(r.lossOfPay) : '—'}</td>
                          <td>
                            <StatusPill status={r.status} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        )}
      </div>
      <style>{`
        .ov-overlay { position:fixed; inset:0; z-index:9999; background:rgba(15,23,42,.45); display:flex; align-items:center; justify-content:center; padding:16px; }
        .ov { background:#fff; width:min(720px, 100%); max-height:min(90vh, 860px); overflow:auto; border-radius:18px; border:1px solid var(--border-subtle, #e7e5e4); box-shadow:0 24px 50px rgba(15,23,42,.18); }
        .ov-head { display:flex; justify-content:space-between; gap:12px; align-items:flex-start; padding:18px 20px 12px; position:sticky; top:0; background:#fff; border-bottom:1px solid var(--border-subtle, #f0eeeb); }
        .ov-head h2 { margin:0; font-size:18px; }
        .ov-sub { margin:4px 0 0; color:var(--text-secondary, #57534e); font-size:13px; }
        .ov-close { background:none; border:0; font-size:22px; line-height:1; cursor:pointer; color:inherit; padding:0 4px; }
        .ov-body { padding:16px 20px 22px; display:flex; flex-direction:column; gap:18px; }
        .ov-id { display:grid; grid-template-columns:repeat(4, 1fr); gap:10px; margin:0; }
        .ov-id div { background:#fafaf9; border-radius:10px; padding:8px 10px; }
        .ov-id dt { margin:0; font-size:11px; letter-spacing:.04em; text-transform:uppercase; color:var(--text-tertiary, #78716c); }
        .ov-id dd { margin:3px 0 0; font-size:13.5px; }
        .ov h3 { margin:0 0 8px; font-size:13px; font-weight:650; }
        .ov-stats { display:grid; grid-template-columns:repeat(4, 1fr); gap:8px; }
        .ov-stat { border:1px solid var(--border-subtle, #e7e5e4); border-radius:10px; padding:10px 12px; display:flex; flex-direction:column; gap:2px; }
        .ov-stat span { font-size:11px; text-transform:uppercase; letter-spacing:.04em; color:var(--text-tertiary, #78716c); }
        .ov-stat strong { font-size:16px; }
        .ov-pair { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
        .ov-pair section { border:1px solid var(--border-subtle, #e7e5e4); border-radius:12px; padding:12px 14px; }
        .ov-figure { margin:0; font-size:18px; font-weight:700; }
        .ov-note { margin:4px 0 0; color:var(--text-secondary, #57534e); font-size:12.5px; }
        .ov-scroll { overflow-x:auto; }
        .ov table { width:100%; border-collapse:collapse; font-size:13px; }
        .ov th { text-align:left; font-size:11px; letter-spacing:.04em; text-transform:uppercase; color:var(--text-tertiary, #78716c); font-weight:600; padding:6px 8px; }
        .ov td { padding:7px 8px; border-top:1px solid #f3f3ef; vertical-align:middle; }
        @media (max-width: 640px) {
          .ov-id, .ov-stats, .ov-pair { grid-template-columns:1fr 1fr; }
          .ov-overlay { padding:8px; align-items:flex-end; }
          .ov { max-height:92vh; border-radius:16px 16px 0 0; }
        }
      `}</style>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="ov-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
