import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Button, EmptyState, ErrorState, Select, Skeleton } from '@sns/ui';
import { api, ApiError, can, type Me } from '../api.js';

type Entry = {
  id: string;
  date: string;
  leaveTypeId: string;
  leaveType: string;
  kind: string;
  label: string;
  days: number;
  balanceAfter: number;
  reference: string | null;
  requestId: string | null;
  reason: string | null;
  by: string | null;
};
type Summary = {
  leaveTypeId: string;
  leaveType: string;
  opening: number;
  earned: number;
  manualCredit: number;
  manualDeduction: number;
  used: number;
  pending: number;
  closing: number;
};
type Data = {
  employee: { id: string; code: string; name: string; department: string };
  periods: { id: string; label: string }[];
  periodId: string;
  entries: Entry[];
  summary: Summary[];
};
type Employee = { id: string; employee_code: string; first_name: string; last_name: string };

const n = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1));
const signed = (x: number) => (x > 0 ? `+${n(x)}` : n(x));

/**
 * Leave transactions: every credit, approval, cancellation and adjustment for one person,
 * with the balance after each — the record the balance is calculated from.
 */
export function TransactionsPage({ me }: { me: Me }) {
  const qc = useQueryClient();
  // Managers see their reports' registers, HR and admin everyone's; others only their own.
  const seesEveryone = me.permissions.some(
    (x) => x.startsWith('leave.balance.read:') && !x.endsWith(':self'),
  );
  const canAdjust = can(me, 'leave.balance.adjust');
  const [employeeId, setEmployeeId] = useState(me.employeeId ?? '');
  const [periodId, setPeriodId] = useState('');
  const [typeId, setTypeId] = useState('');

  const people = useQuery({
    queryKey: ['employees-lite'],
    queryFn: () => api<Employee[]>('/api/v1/employees'),
    enabled: seesEveryone,
  });
  const q = useQuery({
    queryKey: ['ledger', employeeId, periodId, typeId],
    queryFn: () =>
      api<Data>(
        `/api/v1/ledger?${new URLSearchParams({
          ...(employeeId ? { employeeId } : {}),
          ...(periodId ? { periodId } : {}),
          ...(typeId ? { leaveTypeId: typeId } : {}),
        }).toString()}`,
      ),
    enabled: Boolean(employeeId),
  });
  const types = useQuery({
    queryKey: ['leave-types'],
    queryFn: () => api<{ id: string; name: string }[]>('/api/v1/leave-types'),
  });

  return (
    <div className="tx">
      <header>
        <h1>Leave transactions</h1>
        <p className="muted">
          Every change to a leave balance — monthly credits, approved leave, cancellations and
          manual adjustments — with the balance after each. Balances are always calculated from this
          record; nobody edits a balance directly.
        </p>
      </header>

      <section className="card toolbar">
        {seesEveryone ? (
          <Select
            size="sm"
            aria-label="Employee"
            placeholder="Choose an employee"
            value={employeeId}
            onChange={setEmployeeId}
            options={(people.data ?? []).map((e) => ({
              value: e.id,
              label: `${e.first_name} ${e.last_name} · ${e.employee_code}`,
            }))}
          />
        ) : null}
        <Select
          size="sm"
          aria-label="Leave type"
          value={typeId}
          onChange={setTypeId}
          options={[
            { value: '', label: 'All leave types' },
            ...(types.data ?? []).map((t) => ({ value: t.id, label: t.name })),
          ]}
        />
        {q.data?.periods.length ? (
          <Select
            size="sm"
            aria-label="Leave year"
            value={periodId || q.data.periodId}
            onChange={setPeriodId}
            options={q.data.periods.map((p) => ({ value: p.id, label: p.label }))}
          />
        ) : null}
      </section>

      {!employeeId ? (
        <EmptyState title="Choose an employee" body="Their leave transactions will appear here." />
      ) : q.isLoading ? (
        <Skeleton rows={8} />
      ) : q.isError || !q.data ? (
        <ErrorState
          title="Could not load transactions"
          body={q.error instanceof Error ? q.error.message : 'Try again in a moment.'}
          onRetry={() => void q.refetch()}
        />
      ) : (
        <>
          <section className="card">
            <h2>
              {q.data.employee.name}{' '}
              <span className="muted small">
                {q.data.employee.code} · {q.data.employee.department}
              </span>
            </h2>
            {q.data.summary.length ? (
              <div className="table-wrap">
                <table className="summary">
                  <thead>
                    <tr>
                      <th>Leave type</th>
                      <th>Opening</th>
                      <th>Earned</th>
                      <th>Manual credit</th>
                      <th>Manual deduction</th>
                      <th>Used</th>
                      <th>Closing</th>
                      <th>Pending approval</th>
                    </tr>
                  </thead>
                  <tbody>
                    {q.data.summary.map((s) => (
                      <tr key={s.leaveTypeId}>
                        <td>
                          <strong>{s.leaveType}</strong>
                        </td>
                        <td>{n(s.opening)}</td>
                        <td>{n(s.earned)}</td>
                        <td>{n(s.manualCredit)}</td>
                        <td>{n(s.manualDeduction)}</td>
                        <td>{n(s.used)}</td>
                        <td>
                          <strong>{n(s.closing)}</strong>
                        </td>
                        <td className="muted">{s.pending ? n(s.pending) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="muted small">
                  Closing = opening + earned + manual credit − manual deduction − used. Pending
                  requests do not reduce it until they are approved.
                </p>
              </div>
            ) : (
              <p className="muted">No transactions in this leave year.</p>
            )}
          </section>

          {canAdjust ? (
            <AdjustCard
              employeeId={q.data.employee.id}
              employeeName={q.data.employee.name}
              types={types.data ?? []}
              onDone={() => void qc.invalidateQueries()}
            />
          ) : null}

          <section className="card">
            <h2>History</h2>
            {q.data.entries.length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>What happened</th>
                      <th>Leave type</th>
                      <th className="num">Days</th>
                      <th className="num">Balance after</th>
                      <th>By</th>
                    </tr>
                  </thead>
                  <tbody>
                    {q.data.entries.map((e) => (
                      <tr key={e.id}>
                        <td className="mono">{e.date}</td>
                        <td>
                          {e.label}
                          {e.reference ? (
                            <div className="muted small">
                              {e.requestId ? (
                                <Link to={`/requests/${e.requestId}`}>{e.reference}</Link>
                              ) : (
                                e.reference
                              )}
                            </div>
                          ) : null}
                          {e.reason && !e.reason.startsWith('Monthly accrual') ? (
                            <div className="muted small">{e.reason}</div>
                          ) : null}
                        </td>
                        <td className="small">{e.leaveType}</td>
                        <td className={`num ${e.days < 0 ? 'neg' : 'pos'}`}>{signed(e.days)}</td>
                        <td className="num">
                          <strong>{n(e.balanceAfter)}</strong>
                        </td>
                        <td className="muted small">{e.by ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted">Nothing recorded yet.</p>
            )}
          </section>
        </>
      )}
      <style>{`
        .tx { display:flex; flex-direction:column; gap:16px; }
        .tx h1 { margin:0 0 4px; font-size:22px; }
        .tx h2 { margin:0 0 10px; font-size:15px; }
        .tx .muted { color:var(--text-secondary); }
        .tx .small { font-size:12.5px; }
        .tx .card { background:#fff; border:1px solid var(--border-subtle); border-radius:12px; padding:16px 18px; }
        .tx .toolbar { display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
        .tx .table-wrap { overflow-x:auto; }
        .tx table { width:100%; border-collapse:collapse; }
        .tx th { text-align:left; font-size:12px; color:var(--text-tertiary); font-weight:600; padding:6px 8px; white-space:nowrap; }
        .tx td { padding:9px 8px; border-top:1px solid #f3f3ef; font-size:13.5px; vertical-align:top; }
        .tx .num { text-align:right; font-variant-numeric:tabular-nums; }
        .tx .pos { color:#05603a; }
        .tx .neg { color:#b42318; }
        .tx .adjust { display:flex; flex-wrap:wrap; gap:8px; align-items:flex-end; }
        .tx .adjust label { display:flex; flex-direction:column; gap:4px; font-size:12.5px; color:var(--text-secondary); }
        .tx .adjust .grow { flex:1; min-width:220px; }
      `}</style>
    </div>
  );
}

function AdjustCard({
  employeeId,
  employeeName,
  types,
  onDone,
}: {
  employeeId: string;
  employeeName: string;
  types: { id: string; name: string }[];
  onDone: () => void;
}) {
  const [typeId, setTypeId] = useState('');
  const [direction, setDirection] = useState<'credit' | 'deduct'>('credit');
  const [days, setDays] = useState('');
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const half = Math.round(Number(days) * 2);
  const valid = typeId && half > 0 && half / 2 === Number(days) && reason.trim().length >= 3;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    try {
      await api('/api/v1/balances/adjust', {
        method: 'POST',
        body: JSON.stringify({
          employeeId,
          leaveTypeId: typeId,
          quantityHalfDays: direction === 'credit' ? half : -half,
          reason: reason.trim(),
        }),
      });
      setMsg({
        ok: true,
        text: `${direction === 'credit' ? 'Credited' : 'Deducted'} ${days} day(s) ${direction === 'credit' ? 'to' : 'from'} ${employeeName}.`,
      });
      setDays('');
      setReason('');
      onDone();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof ApiError ? err.message : 'Could not save.' });
    }
  }

  return (
    <section className="card">
      <h2>Manual adjustment</h2>
      <p className="muted small" style={{ marginTop: 0 }}>
        For a correction the system cannot know about — for example a day worked on a holiday. It is
        recorded with your name and reason and cannot be edited afterwards.
      </p>
      <form className="adjust" onSubmit={(e) => void submit(e)}>
        <label>
          Leave type
          <Select
            size="sm"
            aria-label="Leave type"
            placeholder="Choose…"
            value={typeId}
            onChange={setTypeId}
            options={types.map((t) => ({ value: t.id, label: t.name }))}
          />
        </label>
        <label>
          Change
          <Select
            size="sm"
            aria-label="Credit or deduct"
            value={direction}
            onChange={(v) => setDirection(v as 'credit' | 'deduct')}
            options={[
              { value: 'credit', label: 'Credit (add days)' },
              { value: 'deduct', label: 'Deduct (remove days)' },
            ]}
          />
        </label>
        <label>
          Days
          <input
            className="input"
            type="number"
            min={0.5}
            max={60}
            step={0.5}
            value={days}
            onChange={(e) => setDays(e.target.value)}
            style={{ width: 90 }}
          />
        </label>
        <label className="grow">
          Reason
          <input
            className="input"
            value={reason}
            maxLength={300}
            placeholder="Worked on Republic Day for the print run"
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        <Button type="submit" variant="primary" disabled={!valid}>
          Record adjustment
        </Button>
      </form>
      {msg ? (
        <p role="status" className={msg.ok ? 'form-ok' : 'form-error'}>
          {msg.text}
        </p>
      ) : null}
    </section>
  );
}
