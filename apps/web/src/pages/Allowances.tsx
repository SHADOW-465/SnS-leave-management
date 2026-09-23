import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, ErrorState, Select, Skeleton } from '@sns/ui';
import { api } from '../api.js';
import { EmployeeOverview } from './EmployeeOverview.js';

type Bal = { allowance: number; taken: number; pending: number; available: number };
type Data = {
  types: { id: string; name: string; code: string }[];
  people: {
    id: string;
    name: string;
    code: string;
    departmentName: string;
    teamName: string | null;
    balances: Record<string, Bal>;
  }[];
};
type Result = { message: string; blocked: { name: string; reason: string }[] };

const d = (half: number) => String(half / 2);

function visibleAllowanceTypes(types: Data['types']) {
  const annual = types.filter((t) => t.code === 'AL');
  if (annual.length > 0) return annual;
  const earned = types.filter((t) => t.code === 'EL');
  if (earned.length > 0) return earned;
  const rest = types.filter(
    (t) => !['CL', 'SL', 'LOP'].includes(t.code) && !/casual|sick|loss of pay|unpaid/i.test(t.name),
  );
  return rest.length > 0 ? rest : types;
}

export function AllowancesPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['allowances'], queryFn: () => api<Data>('/api/v1/allowances') });
  const [filter, setFilter] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [typeId, setTypeId] = useState('');
  const [days, setDays] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    ok: boolean;
    text: string;
    blocked?: Result['blocked'];
  } | null>(null);
  const [overviewId, setOverviewId] = useState<string | null>(null);

  const shown = useMemo(() => {
    const n = filter.toLowerCase();
    return (q.data?.people ?? []).filter((p) =>
      `${p.name} ${p.code} ${p.departmentName} ${p.teamName ?? ''}`.toLowerCase().includes(n),
    );
  }, [q.data, filter]);

  if (q.isLoading) return <Skeleton rows={8} />;
  if (q.isError || !q.data)
    return (
      <ErrorState
        title="Could not load allowances"
        body={q.error instanceof Error ? q.error.message : 'Try again in a moment.'}
        onRetry={() => void q.refetch()}
      />
    );
  const types = visibleAllowanceTypes(q.data.types);
  const activeType = typeId || types[0]?.id || '';
  const allShown = shown.length > 0 && shown.every((p) => picked.has(p.id));
  const half = Math.round(Number(days) * 2);
  const daysValid =
    days !== '' &&
    Number.isFinite(Number(days)) &&
    Number(days) >= 0 &&
    Number(days) <= 365 &&
    Number(days) * 2 === half;

  function toggle(id: string) {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  }

  async function apply() {
    setBusy(true);
    setResult(null);
    try {
      const r = await api<Result>('/api/v1/allowances', {
        method: 'PUT',
        body: JSON.stringify({
          employeeIds: [...picked],
          leaveTypeId: activeType,
          allowanceHalfDays: half,
          reason: reason.trim() || 'Allowance set by administrator',
        }),
      });
      setResult({ ok: r.blocked.length === 0, text: r.message, blocked: r.blocked });
      setPicked(new Set());
      await qc.invalidateQueries();
    } catch (e) {
      setResult({ ok: false, text: e instanceof Error ? e.message : 'Could not save.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="allow">
      <header>
        <h1>Leave allowances</h1>
        <p className="muted">
          How many days each person gets this leave year. Pick people, choose a leave type and a
          number of days. The yearly default for new starters is set in Leave configuration.
        </p>
      </header>

      <section className="card bar">
        <Select
          size="sm"
          aria-label="Leave type"
          value={activeType}
          options={types.map((t) => ({ value: t.id, label: t.name }))}
          onChange={setTypeId}
        />
        <label className="inline">
          <input
            className="input num"
            type="number"
            min={0}
            max={365}
            step={0.5}
            inputMode="decimal"
            placeholder="Days"
            aria-label="Days a year"
            value={days}
            onChange={(e) => setDays(e.target.value)}
          />
          <span className="muted small">days a year</span>
        </label>
        <input
          className="input grow"
          placeholder="Reason (shown in the balance history)"
          aria-label="Reason"
          maxLength={300}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <Button
          variant="primary"
          size="sm"
          disabled={busy || !picked.size || !daysValid}
          onClick={() => void apply()}
        >
          {busy
            ? 'Saving…'
            : `Set for ${picked.size || 'selected'} ${picked.size === 1 ? 'person' : 'people'}`}
        </Button>
        {days !== '' && !daysValid ? (
          <p className="bad-text small">Use whole or half days between 0 and 365.</p>
        ) : null}
      </section>

      {result ? (
        <div className={`flash ${result.ok ? 'ok' : 'bad'}`} role="status">
          <div>
            {result.text}
            {result.blocked?.length ? (
              <ul>
                {result.blocked.map((b) => (
                  <li key={b.name}>
                    <strong>{b.name}</strong>: {b.reason}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <button type="button" aria-label="Dismiss" onClick={() => setResult(null)}>
            ×
          </button>
        </div>
      ) : null}

      <section className="card">
        <input
          className="input"
          placeholder="Filter by name, department or team"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <table>
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  aria-label="Select everyone shown"
                  checked={allShown}
                  onChange={() => {
                    const next = new Set(picked);
                    for (const p of shown) {
                      if (allShown) next.delete(p.id);
                      else next.add(p.id);
                    }
                    setPicked(next);
                  }}
                />
              </th>
              <th>Person</th>
              {types.map((t) => (
                <th key={t.id} className={t.id === activeType ? 'hl' : ''}>
                  {t.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((p) => (
              <tr key={p.id} className={picked.has(p.id) ? 'on' : ''}>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`Select ${p.name}`}
                    checked={picked.has(p.id)}
                    onChange={() => toggle(p.id)}
                  />
                </td>
                <td>
                  <button type="button" className="who" onClick={() => setOverviewId(p.id)}>
                    <strong>{p.name}</strong>
                    <div className="muted small">
                      {p.departmentName}
                      {p.teamName ? ` · ${p.teamName}` : ''}
                    </div>
                  </button>
                </td>
                {types.map((t) => {
                  const b = p.balances[t.id]!;
                  return (
                    <td key={t.id} className={t.id === activeType ? 'hl' : ''}>
                      <button
                        type="button"
                        className="cell"
                        title="Edit this allowance"
                        onClick={() => {
                          setPicked(new Set([p.id]));
                          setTypeId(t.id);
                          setDays(d(b.allowance));
                        }}
                      >
                        <span className="cell-k">Allowance</span>
                        <strong>{d(b.allowance)}</strong>
                        <span className="muted small">{d(b.available)} left</span>
                        {b.pending ? (
                          <span className="muted small">{d(b.pending)} pending</span>
                        ) : null}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {overviewId ? (
        <EmployeeOverview employeeId={overviewId} onClose={() => setOverviewId(null)} />
      ) : null}
      <style>{`
        .allow { display:flex; flex-direction:column; gap:16px; }
        .allow h1 { margin:0 0 4px; font-size:22px; }
        .allow .muted { color:var(--text-secondary); }
        .allow .small { font-size:12.5px; }
        .allow .card { background:#fff; border:1px solid var(--border-subtle); border-radius:12px; padding:16px 18px; overflow-x:auto; }
        .allow .bar { display:flex; flex-wrap:wrap; gap:10px; align-items:center; position:sticky; top:0; z-index:2; }
        .allow .inline { display:flex; gap:6px; align-items:center; }
        .allow .num { width:90px; }
        .allow .grow { flex:1; min-width:200px; }
        .allow table { width:100%; border-collapse:collapse; margin-top:10px; }
        .allow th { text-align:left; font-size:12px; color:var(--text-tertiary); font-weight:600; padding:6px 8px; white-space:nowrap; }
        .allow td { padding:8px; border-top:1px solid #f3f3ef; vertical-align:middle; }
        .allow .hl { background:#f7f7ff; }
        .allow tr.on td { background:#eef2ff; }
        .allow .who { background:none; border:0; padding:0; font:inherit; color:inherit; text-align:left; cursor:pointer; }
        .allow .who:hover strong { text-decoration:underline; }
        .allow .cell { background:none; border:0; padding:4px 6px; border-radius:6px; cursor:pointer; text-align:left; font:inherit; display:flex; flex-direction:column; align-items:flex-start; gap:1px; min-width:88px; line-height:1.25; white-space:normal; }
        .allow .cell-k { font-size:10.5px; letter-spacing:.04em; text-transform:uppercase; color:var(--text-tertiary); }
        .allow .cell:hover { background:#eef0f7; }
        .allow .bad-text { color:#b42318; margin:0; width:100%; }
        .allow .flash { display:flex; justify-content:space-between; gap:12px; padding:10px 14px; border-radius:10px; font-size:13.5px; }
        .allow .flash ul { margin:6px 0 0; padding-left:18px; }
        .allow .flash.ok { background:#ecfdf3; color:#05603a; }
        .allow .flash.bad { background:#fef3f2; color:#b42318; }
        .allow .flash button { background:none; border:0; cursor:pointer; font-size:16px; color:inherit; align-self:flex-start; }
      `}</style>
    </div>
  );
}
