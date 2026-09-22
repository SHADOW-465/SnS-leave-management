import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Paperclip, X } from 'lucide-react';
import { Button, EmptyState, ErrorState, Select, Skeleton, StatusPill } from '@sns/ui';
import { api, ApiError, can, type Me } from '../api.js';
import {
  dayCount,
  daysLabel,
  formatDate,
  formatDateTime,
  formatFileSize,
  formatRange,
  initials,
} from '../format.js';

type DayRow = {
  id: string;
  date: string;
  portion: 'full' | 'am' | 'pm';
  is_counted: number;
  skip_reason: string | null;
};

type TrailRow = {
  id: string;
  step_no: number;
  status: string;
  approver_employee_id?: string | null;
  approver_user_id?: string | null;
  approver_name?: string | null;
  email?: string | null;
  decided_at?: string | null;
  decision_note?: string | null;
};

type Row = {
  can_decide?: boolean;
  waiting_on?: string | null;
  id: string;
  employee_name: string;
  type_name: string;
  start_date: string;
  end_date: string;
  half_day_start?: 'full' | 'am' | 'pm' | null;
  half_day_end?: 'full' | 'am' | 'pm' | null;
  total_half_days: number;
  status: string;
  version: number;
  dept: string;
  reason: string;
  employee_id: string;
  was_self_approved: number;
};

type BalanceSummary = {
  id: string;
  name: string;
  code: string;
  left: string;
  total: string;
  taken: string;
  isCurrentType: boolean;
};

type PastRequestRow = {
  id: string;
  start_date: string;
  end_date: string;
  days_count: string;
  status: string;
  type_name: string;
  reason: string;
};

type LeaveHistory = {
  total_taken_days: string;
  requested_type_taken_days: string;
  requested_type_total_days: string;
  requested_type_remaining_days: string;
  projected_remaining_days: string;
  balances: BalanceSummary[];
  past_requests: PastRequestRow[];
};

type DetailData = Row & {
  manager_name?: string | null;
  attachment_id?: string | null;
  attachment_name?: string | null;
  attachment_size?: number | null;
  attachment_mime_type?: string | null;
  submitted_at?: string | null;
  created_at?: string | null;
  decided_at?: string | null;
  canAct: boolean;
  trail: TrailRow[];
  days: DayRow[];
  leave_history?: LeaveHistory | null;
};

export function QueuePage({ me }: { me: Me }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [rejecting, setRejecting] = useState<Row | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const qc = useQueryClient();
  const base = useLocation().pathname.startsWith('/approvals') ? '/approvals' : '/requests';
  const mine = base === '/requests';

  const q = useQuery({
    queryKey: ['reqs', status, search, base],
    queryFn: () =>
      api<Row[]>(
        `/api/v1/leave-requests?view=${mine ? 'mine' : 'approvals'}&status=${status}&search=${encodeURIComponent(search)}`,
      ),
  });

  const detail = useQuery({
    queryKey: ['req', id],
    queryFn: () => api<DetailData>(`/api/v1/leave-requests/${id}`),
    enabled: Boolean(id),
  });

  const canDecideDetail = Boolean(q.data?.find((r) => r.id === id)?.can_decide);

  useEffect(() => {
    if (!id && !rejecting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (rejecting) {
          setRejecting(null);
        } else if (id) {
          void navigate(base);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [id, rejecting, navigate, base]);

  async function approve(row: { id: string; version: number }) {
    await api(`/api/v1/leave-requests/${row.id}/approve`, {
      method: 'POST',
      body: JSON.stringify({ expectedVersion: row.version }),
    });
    await qc.invalidateQueries();
  }

  async function reject() {
    if (!rejecting || rejectReason.trim().length < 3) return;
    await api(`/api/v1/leave-requests/${rejecting.id}/reject`, {
      method: 'POST',
      body: JSON.stringify({
        expectedVersion: rejecting.version,
        reason: rejectReason.trim(),
      }),
    });
    setRejecting(null);
    setRejectReason('');
    await qc.invalidateQueries();
  }

  async function withdraw(row: { id: string; version: number }) {
    await api(`/api/v1/leave-requests/${row.id}/withdraw`, {
      method: 'POST',
      body: JSON.stringify({ expectedVersion: row.version }),
    });
    await qc.invalidateQueries();
  }

  if (q.isPending) return <Skeleton rows={6} />;
  if (q.isError) {
    return (
      <ErrorState
        title="Could not load requests"
        body="Retry when the server is reachable."
        onRetry={() => void q.refetch()}
      />
    );
  }

  return (
    <div className="page">
      <div className="toolbar">
        <label className="sr-only" htmlFor="q-search">
          Search requests
        </label>
        <input
          id="q-search"
          className="input"
          type="search"
          placeholder="Search person, type or reason"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ minWidth: 260, height: 36, width: 'auto' }}
        />
        {(
          [
            ['all', 'All'],
            ['pending_approval', 'Pending'],
            ['approved', 'Approved'],
            ['rejected', 'Rejected'],
          ] as const
        ).map(([s, label]) => (
          <button
            key={s}
            type="button"
            className="chip"
            aria-pressed={status === s}
            onClick={() => setStatus(s)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="card card-flush">
        {!q.data?.length ? (
          <EmptyState
            title={search ? `No results for “${search}”` : 'No requests yet'}
            body={
              search
                ? 'Clear the search to see everything you can access.'
                : mine
                  ? 'When you submit leave, it will appear here with its status.'
                  : 'Requests waiting for your decision appear here.'
            }
            action={
              search ? <Button onClick={() => setSearch('')}>Clear search</Button> : undefined
            }
          />
        ) : (
          <table className="data">
            <caption className="sr-only">Leave requests</caption>
            <thead>
              <tr>
                <th>Employee</th>
                <th>Type</th>
                <th>Dates</th>
                <th>Days</th>
                <th>Status</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {q.data.map((r) => (
                <tr
                  key={r.id}
                  className="row-clickable"
                  tabIndex={0}
                  role="button"
                  aria-label={`View details for ${r.employee_name} ${r.type_name}`}
                  onClick={() => void navigate(`${base}/${r.id}`)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      void navigate(`${base}/${r.id}`);
                    }
                  }}
                >
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span
                        className="mark"
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: '50%',
                          background: 'var(--surface-selected)',
                          color: 'var(--accent-default)',
                          fontSize: 11,
                          fontWeight: 700,
                        }}
                      >
                        {initials(r.employee_name)}
                      </span>
                      <div>
                        <strong style={{ display: 'block', color: 'var(--text-primary)' }}>
                          {r.employee_name}
                        </strong>
                        <div className="note" style={{ margin: 0 }}>
                          {r.dept}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td>{r.type_name}</td>
                  <td>{formatRange(r.start_date, r.end_date)}</td>
                  <td className="mono">{daysLabel(r.total_half_days)}</td>
                  <td>
                    <StatusPill status={r.status} />
                    {r.waiting_on ? (
                      <div className="muted" style={{ fontSize: 12 }}>
                        Waiting for {r.waiting_on}
                      </div>
                    ) : null}
                    {r.was_self_approved ? (
                      <div className="note" style={{ margin: '4px 0 0' }}>
                        Self-approved
                      </div>
                    ) : null}
                  </td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {r.can_decide ? (
                      <>
                        <Button
                          variant="success"
                          size="sm"
                          aria-label={`Approve ${r.employee_name}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            void approve(r);
                          }}
                          style={{ marginRight: 6 }}
                        >
                          Approve
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          aria-label={`Reject ${r.employee_name}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setRejecting(r);
                            setRejectReason('');
                          }}
                        >
                          Reject
                        </Button>
                      </>
                    ) : null}
                    {mine && r.status === 'pending_approval' ? (
                      <Button
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          void withdraw(r);
                        }}
                      >
                        Withdraw
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {id ? (
        <div className="floating-window-overlay">
          <button
            type="button"
            className="floating-window-scrim"
            aria-label="Close request details"
            onClick={() => void navigate(base)}
          />
          <div
            className="floating-window-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="req-title"
          >
            {detail.isPending ? (
              <Skeleton rows={7} />
            ) : detail.isError || !detail.data ? (
              <ErrorState
                title="Could not load request preview"
                body="The request may have been removed or you may not have permission to view it."
                onRetry={() => void detail.refetch()}
              />
            ) : (
              <>
                <div className="drawer-header">
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    <span
                      className="mark"
                      style={{
                        width: 42,
                        height: 42,
                        borderRadius: '50%',
                        background: 'var(--surface-selected)',
                        color: 'var(--accent-default)',
                        fontSize: 15,
                        fontWeight: 700,
                      }}
                    >
                      {initials(detail.data.employee_name)}
                    </span>
                    <div>
                      <h2
                        id="req-title"
                        style={{
                          margin: 0,
                          fontSize: 17,
                          fontWeight: 600,
                          color: 'var(--text-primary)',
                        }}
                      >
                        {detail.data.employee_name}
                      </h2>
                      <p className="note" style={{ margin: '2px 0 0' }}>
                        {detail.data.dept}
                        {detail.data.manager_name
                          ? ` · Reports to ${detail.data.manager_name}`
                          : ''}
                      </p>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <StatusPill status={detail.data.status} />
                    <button
                      type="button"
                      className="icon-btn"
                      style={{ width: 32, height: 32, borderRadius: 6 }}
                      aria-label="Close preview"
                      onClick={() => void navigate(base)}
                    >
                      <X size={16} aria-hidden strokeWidth={2} />
                    </button>
                  </div>
                </div>

                {detail.data.was_self_approved ? (
                  <div className="banner banner-warn">
                    <p style={{ margin: 0, fontSize: 13 }}>
                      <strong>Self-approval record:</strong> This request was self-approved by an
                      administrator.
                    </p>
                  </div>
                ) : null}

                <div className="drawer-top-grid">
                  <div className="drawer-section">
                    <p className="drawer-section-title">Request Summary</p>
                    <dl className="drawer-key-val">
                      <dt>Leave Type</dt>
                      <dd>{detail.data.type_name}</dd>

                      <dt>Date Range</dt>
                      <dd>{formatRange(detail.data.start_date, detail.data.end_date)}</dd>

                      <dt>Working Days</dt>
                      <dd className="mono">{dayCount(detail.data.total_half_days)} counted</dd>

                      <dt>Filed on</dt>
                      <dd>{formatDateTime(detail.data.submitted_at || detail.data.created_at)}</dd>

                      {detail.data.decided_at ? (
                        <>
                          <dt>Decided on</dt>
                          <dd>{formatDateTime(detail.data.decided_at)}</dd>
                        </>
                      ) : null}
                    </dl>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <div className="drawer-section">
                      <p className="drawer-section-title">Reason for Leave</p>
                      <div
                        style={{
                          background: 'var(--surface-raised)',
                          border: '1px solid var(--border-subtle)',
                          borderRadius: 'var(--radius-md)',
                          padding: '14px 16px',
                          minHeight: 88,
                        }}
                      >
                        <p
                          style={{
                            margin: 0,
                            fontSize: 13.5,
                            lineHeight: 1.55,
                            whiteSpace: 'pre-wrap',
                            color: 'var(--text-primary)',
                          }}
                        >
                          {detail.data.reason || 'No reason provided.'}
                        </p>
                      </div>
                    </div>

                    {detail.data.attachment_id ? (
                      <div className="drawer-section">
                        <p className="drawer-section-title">Supporting Document</p>
                        <a
                          href={`/api/v1/attachments/${detail.data.attachment_id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="attachment-card"
                          download
                        >
                          <Paperclip
                            size={18}
                            strokeWidth={1.75}
                            color="var(--accent-default)"
                            aria-hidden
                          />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <strong
                              style={{
                                display: 'block',
                                fontSize: 13,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {detail.data.attachment_name || 'Attached document'}
                            </strong>
                            {detail.data.attachment_size ? (
                              <span className="note" style={{ margin: 0 }}>
                                {formatFileSize(detail.data.attachment_size)}
                              </span>
                            ) : null}
                          </div>
                          <Download size={16} strokeWidth={1.75} aria-hidden />
                        </a>
                      </div>
                    ) : null}
                  </div>
                </div>

                {detail.data.leave_history ? (
                  <div className="drawer-section">
                    <p className="drawer-section-title">Employee Leave History & Balance Context</p>
                    <div className="leave-history-panel">
                      <div className="history-stats-grid">
                        <div className="history-stat-card">
                          <span className="history-stat-label">Total Leave Taken</span>
                          <span className="history-stat-val">
                            {detail.data.leave_history.total_taken_days} days
                          </span>
                          <span className="history-stat-sub">Across all types (YTD)</span>
                        </div>
                        <div className="history-stat-card highlight">
                          <span className="history-stat-label">{detail.data.type_name} Taken</span>
                          <span className="history-stat-val">
                            {detail.data.leave_history.requested_type_taken_days} days
                          </span>
                          <span className="history-stat-sub">
                            of {detail.data.leave_history.requested_type_total_days} days total
                            granted
                          </span>
                        </div>
                        <div className="history-stat-card">
                          <span className="history-stat-label">Remaining Balance</span>
                          <span className="history-stat-val">
                            {detail.data.leave_history.requested_type_remaining_days} days
                          </span>
                          <span
                            className="history-stat-sub"
                            style={{
                              color:
                                Number(detail.data.leave_history.projected_remaining_days) < 0
                                  ? 'var(--status-rejected-fg)'
                                  : 'var(--text-secondary)',
                            }}
                          >
                            {Number(detail.data.leave_history.projected_remaining_days) < 0
                              ? 'Exceeds balance if approved'
                              : `${detail.data.leave_history.projected_remaining_days} days after this request`}
                          </span>
                        </div>
                      </div>

                      {detail.data.leave_history.balances.length > 0 ? (
                        <div>
                          <span
                            className="history-stat-label"
                            style={{ display: 'block', marginBottom: 8 }}
                          >
                            All Leave Type Balances
                          </span>
                          <ul className="balance-chips-list">
                            {detail.data.leave_history.balances.map((b) => (
                              <li
                                key={b.id}
                                className={`balance-chip ${b.isCurrentType ? 'is-active' : ''}`}
                              >
                                <span>{b.name}:</span>
                                <strong>{b.taken} taken</strong>
                                <span className="note" style={{ margin: 0 }}>
                                  ({b.left} left)
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}

                      {detail.data.leave_history.past_requests &&
                      detail.data.leave_history.past_requests.length > 0 ? (
                        <div>
                          <span
                            className="history-stat-label"
                            style={{ display: 'block', marginBottom: 8 }}
                          >
                            Prior Leave Records ({detail.data.leave_history.past_requests.length})
                          </span>
                          <table className="past-requests-table">
                            <thead>
                              <tr>
                                <th>Date Range</th>
                                <th>Type</th>
                                <th>Days</th>
                                <th>Status</th>
                              </tr>
                            </thead>
                            <tbody>
                              {detail.data.leave_history.past_requests.map((pr) => (
                                <tr key={pr.id}>
                                  <td>
                                    <strong>{formatRange(pr.start_date, pr.end_date)}</strong>
                                  </td>
                                  <td>{pr.type_name}</td>
                                  <td className="mono">{pr.days_count}d</td>
                                  <td>
                                    <StatusPill status={pr.status} />
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <p className="note" style={{ margin: 0, fontStyle: 'italic' }}>
                          No prior leave records found for this employee.
                        </p>
                      )}
                    </div>
                  </div>
                ) : null}

                {detail.data.days && detail.data.days.length > 0 ? (
                  <div className="drawer-section">
                    <p className="drawer-section-title">
                      Schedule Breakdown ({detail.data.days.length}{' '}
                      {detail.data.days.length === 1 ? 'day' : 'days'})
                    </p>
                    <ul className="day-breakdown-list">
                      {detail.data.days.map((d) => (
                        <li key={d.id || d.date} className="day-item">
                          <div>
                            <strong>{formatDate(d.date)}</strong>
                            {d.skip_reason ? (
                              <span
                                className="note"
                                style={{
                                  display: 'block',
                                  margin: '2px 0 0',
                                  color: 'var(--text-tertiary)',
                                }}
                              >
                                {d.skip_reason}
                              </span>
                            ) : null}
                          </div>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                            <span className="day-badge">
                              {d.portion === 'full' ? 'Full day' : d.portion.toUpperCase()}
                            </span>
                            <span
                              style={{
                                fontSize: 12,
                                fontWeight: 600,
                                color: d.is_counted
                                  ? 'var(--status-approved-fg)'
                                  : 'var(--text-muted)',
                              }}
                            >
                              {d.is_counted ? 'Counted' : 'Skipped'}
                            </span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <div className="drawer-section">
                  <p className="drawer-section-title">Approval Workflow & Trail</p>
                  <div className="trail-timeline">
                    <div className="trail-step">
                      <span className="trail-dot is-submitted" aria-hidden />
                      <div>
                        <strong style={{ fontSize: 13.5, display: 'block' }}>
                          Filed by {detail.data.employee_name}
                        </strong>
                        <span className="note" style={{ margin: '2px 0 0', display: 'block' }}>
                          {formatDateTime(detail.data.submitted_at || detail.data.created_at)}
                        </span>
                      </div>
                    </div>

                    {(detail.data.trail ?? []).map((t, idx) => {
                      const isApproved = t.status === 'approved';
                      const isRejected = t.status === 'rejected';
                      const isPending = t.status === 'pending';
                      const dotClass = isApproved
                        ? 'is-approved'
                        : isRejected
                          ? 'is-rejected'
                          : isPending
                            ? 'is-pending'
                            : '';
                      return (
                        <div key={t.id || idx} className="trail-step">
                          <span className={`trail-dot ${dotClass}`} aria-hidden />
                          <div>
                            <div
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'baseline',
                              }}
                            >
                              <strong style={{ fontSize: 13.5 }}>
                                {t.approver_name || t.email || `Review Step ${t.step_no}`}
                              </strong>
                              <StatusPill status={t.status} />
                            </div>
                            {t.decided_at ? (
                              <span
                                className="note"
                                style={{ margin: '2px 0 0', display: 'block' }}
                              >
                                Decided {formatDateTime(t.decided_at)}
                              </span>
                            ) : (
                              <span
                                className="note"
                                style={{ margin: '2px 0 0', display: 'block' }}
                              >
                                Awaiting review
                              </span>
                            )}
                            {t.decision_note ? (
                              <div
                                style={{
                                  marginTop: 6,
                                  padding: '8px 10px',
                                  background: isRejected
                                    ? 'var(--status-rejected-bg)'
                                    : 'var(--surface-raised)',
                                  borderRadius: 6,
                                  fontSize: 12.5,
                                  color: isRejected
                                    ? 'var(--status-rejected-fg)'
                                    : 'var(--text-primary)',
                                }}
                              >
                                <em>Note: {t.decision_note}</em>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {detail.data.status === 'pending_approval' && can(me, 'approval.routing.manage') ? (
                  <ReassignBox requestId={detail.data.id} />
                ) : null}

                <div className="drawer-actions">
                  {canDecideDetail && detail.data.status === 'pending_approval' ? (
                    <>
                      <Button
                        variant="success"
                        style={{ flex: 1 }}
                        onClick={() => void approve(detail.data!)}
                      >
                        Approve request
                      </Button>
                      <Button
                        variant="danger"
                        style={{ flex: 1 }}
                        onClick={() => {
                          setRejecting(detail.data!);
                          setRejectReason('');
                        }}
                      >
                        Reject request
                      </Button>
                    </>
                  ) : null}

                  {mine && detail.data.status === 'pending_approval' ? (
                    <Button style={{ flex: 1 }} onClick={() => void withdraw(detail.data!)}>
                      Withdraw request
                    </Button>
                  ) : null}

                  <Button onClick={() => void navigate(base)}>Close</Button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}

      {rejecting ? (
        <div className="floating-window-overlay">
          <button
            type="button"
            className="floating-window-scrim"
            aria-label="Cancel rejection"
            onClick={() => setRejecting(null)}
          />
          <div
            className="floating-window-card floating-window-card-sm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="rej-title"
          >
            <h2 id="rej-title" style={{ margin: 0, fontSize: 18 }}>
              Reject {rejecting.employee_name}’s request
            </h2>
            <p className="note">
              A reason is required. It is stored on the request and in the audit log.
            </p>
            <div className="field">
              <label htmlFor="rej-reason">Reason</label>
              <textarea
                id="rej-reason"
                className="textarea"
                rows={3}
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                required
                minLength={3}
                placeholder="Explain why this request is being rejected..."
              />
            </div>
            <div className="toolbar">
              <Button
                variant="danger"
                onClick={() => void reject()}
                disabled={rejectReason.trim().length < 3}
              >
                Reject request
              </Button>
              <Button onClick={() => setRejecting(null)}>Keep pending</Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Administrator only: send a request that is stuck — the approver is away or has left —
 * to someone else. The new approver is notified; the change is on the request's trail.
 */
function ReassignBox({ requestId }: { requestId: string }) {
  const qc = useQueryClient();
  const [to, setTo] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const people = useQuery({
    queryKey: ['approval-candidates'],
    queryFn: () =>
      api<{ candidates: { id: string; name: string }[] }>('/api/v1/admin/approval-map'),
  });
  async function send() {
    setMsg(null);
    try {
      const r = await api<{ message?: string }>(`/api/v1/leave-requests/${requestId}/reassign`, {
        method: 'POST',
        body: JSON.stringify({ approverEmployeeId: to }),
      });
      setMsg({ ok: true, text: r?.message ?? 'Sent to the new approver.' });
      setTo('');
      await qc.invalidateQueries();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof ApiError ? err.message : 'Could not reassign.' });
    }
  }
  return (
    <div className="reassign-box">
      <p className="kicker" style={{ margin: 0 }}>
        Stuck? Send it to someone else
      </p>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <Select
          size="sm"
          aria-label="New approver"
          placeholder="Choose an approver"
          value={to}
          onChange={setTo}
          options={(people.data?.candidates ?? []).map((c) => ({ value: c.id, label: c.name }))}
        />
        <Button size="sm" disabled={!to} onClick={() => void send()}>
          Reassign
        </Button>
      </div>
      {msg ? (
        <p role="status" className={msg.ok ? 'form-ok' : 'form-error'} style={{ margin: 0 }}>
          {msg.text}
        </p>
      ) : null}
    </div>
  );
}
