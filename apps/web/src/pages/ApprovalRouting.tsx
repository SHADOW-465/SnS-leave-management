import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, ErrorState, Select, Skeleton } from '@sns/ui';
import { api } from '../api.js';

type Person = {
  employeeId: string;
  name: string;
  code: string;
  jobTitle: string | null;
  teamName: string | null;
  departmentId: string;
  departmentName: string;
  hasAccount: boolean;
  position: string;
  reportingManager: { employeeId: string; name: string; since: string } | null;
  route: {
    approverName: string;
    approverRole: string;
    escalation: string | null;
    coveringFor: string | null;
    selfApproved: boolean;
  } | null;
  problem: string | null;
};
type MapData = {
  people: Person[];
  teams: {
    id: string;
    name: string;
    departmentName: string;
    leadEmployeeId: string | null;
    memberCount: number;
  }[];
  departments: { id: string; name: string; headEmployeeId: string | null; memberCount: number }[];
  delegations: {
    id: string;
    approverName: string;
    delegateName: string;
    startsOn: string;
    endsOn: string;
    note: string | null;
    active: boolean;
  }[];
  warnings: { level: 'problem' | 'notice'; text: string }[];
  candidates: { id: string; name: string; team: string | null }[];
};
type History = {
  effectiveFrom: string;
  effectiveTo: string | null;
  managerName: string | null;
  reason: string | null;
}[];

const NONE = '__none__';
const today = () => new Date().toISOString().slice(0, 10);
type Tab = 'managers' | 'fallback' | 'cover';

export function ApprovalRoutingPage() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['approval-map'],
    queryFn: () => api<MapData>('/api/v1/admin/approval-map'),
  });
  const [tab, setTab] = useState<Tab>('managers');
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null);

  async function run(path: string, method: string, body?: unknown): Promise<boolean> {
    try {
      const r = await api<{ message?: string; failed?: { reason: string }[] }>(path, {
        method,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const failed = r?.failed ?? [];
      setFlash({
        ok: failed.length === 0,
        text: [r?.message ?? 'Saved.', ...failed.map((f) => f.reason)].join(' '),
      });
      await qc.invalidateQueries();
      return failed.length === 0;
    } catch (e) {
      setFlash({ ok: false, text: e instanceof Error ? e.message : 'Could not save.' });
      return false;
    }
  }

  if (q.isLoading) return <Skeleton rows={8} />;
  if (q.isError || !q.data)
    return (
      <ErrorState
        title="Could not load reporting managers"
        body={q.error instanceof Error ? q.error.message : 'Try again in a moment.'}
        onRetry={() => void q.refetch()}
      />
    );
  const d = q.data;

  return (
    <div className="rm">
      <header>
        <h1>Reporting managers</h1>
        <p className="muted">
          Choose who approves each person’s leave. Old requests stay with the manager they were sent
          to; new requests go to the new manager from the date you choose.
        </p>
      </header>

      <section className="card rm-flow" aria-label="How leave is routed">
        <p className="rm-flow-title">Where a leave request goes</p>
        <ol>
          <li className="is-main">
            <strong>Reporting manager</strong>
            <span>Set below. Decides first.</span>
          </li>
          <li>
            <strong>Team lead</strong>
            <span>If no manager is set, or they are away</span>
          </li>
          <li>
            <strong>Department head</strong>
            <span>If there is no team lead</span>
          </li>
          <li>
            <strong>HR, then Administrator</strong>
            <span>Last resort</span>
          </li>
        </ol>
        <p className="muted small">
          Someone on approved leave today is skipped automatically, unless you arrange cover for
          them. Nobody ever approves their own leave.
        </p>
      </section>

      {flash ? (
        <div className={`flash ${flash.ok ? 'ok' : 'bad'}`} role="status">
          {flash.text}
          <button type="button" aria-label="Dismiss" onClick={() => setFlash(null)}>
            ×
          </button>
        </div>
      ) : null}

      {d.warnings.length ? (
        <section className="card rm-warn">
          <h2>Needs attention</h2>
          <ul>
            {d.warnings.map((w, i) => (
              <li key={i} className={w.level}>
                {w.text}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="rm-tabs" role="tablist">
        {(
          [
            ['managers', `Reporting managers (${d.people.length})`],
            ['fallback', 'Department heads & team leads'],
            [
              'cover',
              `Cover while away${d.delegations.length ? ` (${d.delegations.length})` : ''}`,
            ],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={tab === key ? 'is-on' : ''}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'managers' ? <ManagersTab d={d} run={run} /> : null}
      {tab === 'fallback' ? <FallbackTab d={d} run={run} /> : null}
      {tab === 'cover' ? <CoverTab d={d} run={run} /> : null}

      <style>{`
        .rm { display:flex; flex-direction:column; gap:16px; }
        .rm h1 { margin:0 0 4px; font-size:22px; }
        .rm h2 { margin:0 0 6px; font-size:15px; }
        .rm .muted { color:var(--text-secondary); }
        .rm .small { font-size:12.5px; }
        .rm .card { background:#fff; border:1px solid var(--border-subtle); border-radius:12px; padding:16px 18px; }
        .rm-flow-title { margin:0 0 10px; font-weight:600; font-size:13.5px; }
        .rm-flow ol { list-style:none; margin:0 0 10px; padding:0; display:grid; grid-template-columns:repeat(4, 1fr); gap:8px; counter-reset:step; }
        .rm-flow li { position:relative; border:1px solid var(--border-subtle); border-radius:10px; padding:10px 12px 10px 38px; font-size:13px; display:flex; flex-direction:column; gap:2px; counter-increment:step; }
        .rm-flow li::before { content:counter(step); position:absolute; left:10px; top:10px; width:20px; height:20px; border-radius:50%; background:#f1f1ee; font-size:11.5px; font-weight:600; display:grid; place-items:center; }
        .rm-flow li.is-main { background:#eef2ff; border-color:#c7d2fe; }
        .rm-flow li.is-main::before { background:#4f46e5; color:#fff; }
        .rm-flow li span { color:var(--text-secondary); font-size:12px; }
        @media (max-width: 760px) { .rm-flow ol { grid-template-columns:1fr 1fr; } }
        .rm-warn ul { margin:0; padding-left:18px; }
        .rm-warn li { margin:4px 0; font-size:13.5px; }
        .rm-warn .problem, .rm .problem-text { color:#b42318; }
        .rm-warn .notice, .rm .notice-text { color:#8a6116; }
        .rm-tabs { display:flex; gap:4px; border-bottom:1px solid var(--border-subtle); flex-wrap:wrap; }
        .rm-tabs button { background:none; border:0; border-bottom:2px solid transparent; padding:8px 12px; font:inherit; font-size:13.5px; color:var(--text-secondary); cursor:pointer; }
        .rm-tabs button.is-on { color:var(--text-primary); border-bottom-color:#4f46e5; font-weight:600; }
        .rm .flash { display:flex; justify-content:space-between; gap:12px; padding:10px 14px; border-radius:10px; font-size:13.5px; }
        .rm .flash.ok { background:#ecfdf3; color:#05603a; }
        .rm .flash.bad { background:#fef3f2; color:#b42318; }
        .rm .flash button { background:none; border:0; cursor:pointer; font-size:16px; color:inherit; }
        .rm .toolbar { display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin-bottom:10px; }
        .rm .toolbar .input { flex:1; min-width:180px; }
        .rm .bulk { display:flex; flex-wrap:wrap; gap:8px; align-items:center; background:#eef2ff; border-radius:10px; padding:10px 12px; margin-bottom:10px; font-size:13.5px; }
        .rm .table-wrap { overflow-x:auto; }
        .rm table { width:100%; border-collapse:collapse; }
        .rm th { text-align:left; font-size:12px; color:var(--text-tertiary); font-weight:600; padding:6px 8px; white-space:nowrap; }
        .rm td { padding:10px 8px; border-top:1px solid #f3f3ef; vertical-align:top; font-size:13.5px; }
        .rm tr.on td { background:#f7f7ff; }
        .rm .badge { display:inline-block; border-radius:999px; padding:1px 8px; font-size:11.5px; background:#f1f1ee; color:var(--text-secondary); margin-top:3px; }
        .rm .badge.main { background:#ecfdf3; color:#05603a; }
        .rm .badge.warn { background:#fffaeb; color:#8a6116; }
        .rm .linkish { background:none; border:0; padding:0; color:#4f46e5; cursor:pointer; font:inherit; font-size:12.5px; }
        .rm .history { margin:6px 0 0; padding:8px 10px; background:#fafaf8; border-radius:8px; list-style:none; font-size:12.5px; }
        .rm .history li { padding:2px 0; }
        .rm .row { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:9px 0; border-top:1px solid #f3f3ef; }
        .rm .grid2 { display:grid; grid-template-columns:repeat(auto-fit,minmax(320px,1fr)); gap:16px; }
        .rm .delform { display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin:10px 0; }
        .rm .dels { list-style:none; margin:0; padding:0; }
        .rm .dels li { display:flex; justify-content:space-between; align-items:center; gap:12px; padding:8px 0; border-top:1px solid #f3f3ef; font-size:13.5px; }
      `}</style>
    </div>
  );
}

type Run = (path: string, method: string, body?: unknown) => Promise<boolean>;

function ManagersTab({ d, run }: { d: MapData; run: Run }) {
  const [filter, setFilter] = useState('');
  const [dept, setDept] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [bulkManager, setBulkManager] = useState('');
  const [bulkFrom, setBulkFrom] = useState(today());
  const [openHistory, setOpenHistory] = useState<string | null>(null);

  const people = useMemo(() => {
    const n = filter.toLowerCase();
    return d.people.filter(
      (p) =>
        (!dept || p.departmentId === dept) &&
        `${p.name} ${p.code} ${p.jobTitle ?? ''} ${p.teamName ?? ''} ${p.departmentName} ${p.reportingManager?.name ?? ''}`
          .toLowerCase()
          .includes(n),
    );
  }, [d.people, filter, dept]);

  const managerOptions = (exclude?: string) => [
    { value: NONE, label: 'Not set' },
    ...d.candidates.filter((c) => c.id !== exclude).map((c) => ({ value: c.id, label: c.name })),
  ];
  const allShown = people.length > 0 && people.every((p) => picked.has(p.employeeId));

  async function assign(ids: string[], manager: string, from: string) {
    const ok = await run('/api/v1/admin/reporting-managers', 'PUT', {
      employeeIds: ids,
      managerEmployeeId: manager === NONE ? null : manager,
      effectiveFrom: from,
    });
    if (ok) setPicked(new Set());
  }

  return (
    <section className="card">
      <div className="toolbar">
        <input
          className="input"
          placeholder="Search name, ID, designation, team or manager"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <Select
          size="sm"
          aria-label="Department"
          value={dept}
          onChange={setDept}
          options={[
            { value: '', label: 'All departments' },
            ...d.departments.map((x) => ({ value: x.id, label: x.name })),
          ]}
        />
      </div>

      {picked.size ? (
        <div className="bulk">
          <strong>{picked.size} selected</strong>
          <span>Reporting manager</span>
          <Select
            size="sm"
            aria-label="New reporting manager"
            placeholder="Choose…"
            value={bulkManager}
            onChange={setBulkManager}
            options={managerOptions()}
          />
          <span>from</span>
          <input
            className="input"
            type="date"
            aria-label="Effective from"
            max={today()}
            value={bulkFrom}
            onChange={(e) => setBulkFrom(e.target.value)}
          />
          <Button
            size="sm"
            variant="primary"
            disabled={!bulkManager || !bulkFrom}
            onClick={() => void assign([...picked], bulkManager, bulkFrom)}
          >
            Assign
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>
            Cancel
          </Button>
        </div>
      ) : (
        <p className="muted small" style={{ margin: '0 0 8px' }}>
          Change one person with their dropdown (takes effect today), or tick several to assign a
          manager to all of them — with an earlier date if the change already happened.
        </p>
      )}

      <div className="table-wrap">
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
                    for (const p of people) {
                      if (allShown) next.delete(p.employeeId);
                      else next.add(p.employeeId);
                    }
                    setPicked(next);
                  }}
                />
              </th>
              <th>Employee</th>
              <th>Department</th>
              <th>Reporting manager</th>
              <th>Leave goes to today</th>
            </tr>
          </thead>
          <tbody>
            {people.map((p) => (
              <tr key={p.employeeId} className={picked.has(p.employeeId) ? 'on' : ''}>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`Select ${p.name}`}
                    checked={picked.has(p.employeeId)}
                    onChange={() => {
                      const next = new Set(picked);
                      if (next.has(p.employeeId)) next.delete(p.employeeId);
                      else next.add(p.employeeId);
                      setPicked(next);
                    }}
                  />
                </td>
                <td>
                  <strong>{p.name}</strong>
                  <div className="muted small">
                    {[p.jobTitle, p.code].filter(Boolean).join(' · ')}
                  </div>
                </td>
                <td className="small">
                  {p.departmentName}
                  <div className="muted">{p.teamName ?? 'No team'}</div>
                </td>
                <td>
                  <Select
                    size="sm"
                    aria-label={`Reporting manager for ${p.name}`}
                    value={p.reportingManager?.employeeId ?? NONE}
                    options={managerOptions(p.employeeId)}
                    onChange={(v) => void assign([p.employeeId], v, today())}
                  />
                  <div className="muted small" style={{ marginTop: 3 }}>
                    {p.reportingManager ? `Since ${p.reportingManager.since} · ` : ''}
                    <button
                      type="button"
                      className="linkish"
                      onClick={() =>
                        setOpenHistory(openHistory === p.employeeId ? null : p.employeeId)
                      }
                    >
                      {openHistory === p.employeeId ? 'Hide history' : 'History'}
                    </button>
                  </div>
                  {openHistory === p.employeeId ? <HistoryList employeeId={p.employeeId} /> : null}
                </td>
                <td>
                  {p.route ? (
                    <>
                      <strong>{p.route.approverName}</strong>
                      <div>
                        <RouteBadge p={p} />
                      </div>
                    </>
                  ) : (
                    <span className="problem-text small">{p.problem}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {people.length === 0 ? <p className="muted small">Nobody matches.</p> : null}
      </div>
    </section>
  );
}

function RouteBadge({ p }: { p: Person }) {
  const r = p.route!;
  if (r.selfApproved) return <span className="badge warn">Recorded as self-approval</span>;
  if (r.coveringFor) return <span className="badge warn">Covering for {r.coveringFor}</span>;
  if (r.escalation)
    return (
      <span className="badge warn">
        {r.approverRole} — {r.escalation}
      </span>
    );
  if (r.approverRole === 'Reporting manager')
    return <span className="badge main">Reporting manager</span>;
  return (
    <span className="badge">
      {r.approverRole}
      {p.reportingManager ? '' : ' — no manager set'}
    </span>
  );
}

function HistoryList({ employeeId }: { employeeId: string }) {
  const q = useQuery({
    queryKey: ['manager-history', employeeId],
    queryFn: () => api<History>(`/api/v1/employees/${employeeId}/manager-history`),
  });
  if (q.isLoading) return <p className="muted small">Loading…</p>;
  if (!q.data?.length) return <p className="muted small">No changes recorded yet.</p>;
  return (
    <ul className="history">
      {q.data.map((h, i) => (
        <li key={i}>
          <strong>{h.managerName ?? 'No manager'}</strong> — {h.effectiveFrom} to{' '}
          {h.effectiveTo ?? 'now'}
        </li>
      ))}
    </ul>
  );
}

function FallbackTab({ d, run }: { d: MapData; run: Run }) {
  const pick = [
    { value: NONE, label: 'Nobody' },
    ...d.candidates.map((c) => ({ value: c.id, label: c.name })),
  ];
  return (
    <div className="grid2">
      <section className="card">
        <h2>Department heads</h2>
        <p className="muted small">
          Approve when someone has no reporting manager and no team lead, or both are away.
        </p>
        {d.departments.map((dep) => (
          <div className="row" key={dep.id}>
            <div>
              <strong>{dep.name}</strong>
              <div className="muted small">{dep.memberCount} people</div>
            </div>
            <Select
              size="sm"
              aria-label={`Head of ${dep.name}`}
              value={dep.headEmployeeId ?? NONE}
              options={pick}
              onChange={(v) =>
                void run(`/api/v1/admin/departments/${dep.id}/head`, 'PUT', {
                  employeeId: v === NONE ? null : v,
                })
              }
            />
          </div>
        ))}
      </section>
      <section className="card">
        <h2>Team leads</h2>
        <p className="muted small">
          Approve for team members who have no reporting manager, or whose manager is away.
        </p>
        {d.teams.map((t) => (
          <div className="row" key={t.id}>
            <div>
              <strong>{t.name}</strong>
              <div className="muted small">
                {t.departmentName} · {t.memberCount} people
              </div>
            </div>
            <Select
              size="sm"
              aria-label={`Team lead for ${t.name}`}
              value={t.leadEmployeeId ?? NONE}
              options={pick}
              onChange={(v) =>
                void run(`/api/v1/admin/teams/${t.id}/lead`, 'PUT', {
                  employeeId: v === NONE ? null : v,
                })
              }
            />
          </div>
        ))}
      </section>
    </div>
  );
}

function CoverTab({ d, run }: { d: MapData; run: Run }) {
  const [del, setDel] = useState({
    approverEmployeeId: '',
    delegateEmployeeId: '',
    startsOn: '',
    endsOn: '',
  });
  return (
    <section className="card">
      <h2>Cover while someone is away</h2>
      <p className="muted small">
        Between these dates, requests that would go to the approver go to their cover instead.
        Requests already waiting stay where they are — reassign them from the request if needed.
      </p>
      <form
        className="delform"
        onSubmit={(e) => {
          e.preventDefault();
          void run('/api/v1/admin/delegations', 'POST', del).then((ok) => {
            if (ok)
              setDel({ approverEmployeeId: '', delegateEmployeeId: '', startsOn: '', endsOn: '' });
          });
        }}
      >
        <Select
          size="sm"
          aria-label="Approver who is away"
          placeholder="Who is away"
          value={del.approverEmployeeId}
          options={d.candidates.map((c) => ({ value: c.id, label: c.name }))}
          onChange={(v) => setDel({ ...del, approverEmployeeId: v })}
        />
        <Select
          size="sm"
          aria-label="Covered by"
          placeholder="Covered by"
          value={del.delegateEmployeeId}
          options={d.candidates
            .filter((c) => c.id !== del.approverEmployeeId)
            .map((c) => ({ value: c.id, label: c.name }))}
          onChange={(v) => setDel({ ...del, delegateEmployeeId: v })}
        />
        <input
          className="input"
          type="date"
          aria-label="From"
          required
          value={del.startsOn}
          onChange={(e) =>
            setDel({
              ...del,
              startsOn: e.target.value,
              endsOn: del.endsOn && del.endsOn < e.target.value ? e.target.value : del.endsOn,
            })
          }
        />
        <input
          className="input"
          type="date"
          aria-label="Until"
          required
          min={del.startsOn}
          value={del.endsOn}
          onChange={(e) => setDel({ ...del, endsOn: e.target.value })}
        />
        <Button
          type="submit"
          variant="primary"
          size="sm"
          disabled={
            !del.approverEmployeeId || !del.delegateEmployeeId || !del.startsOn || !del.endsOn
          }
        >
          Add cover
        </Button>
      </form>
      {d.delegations.length ? (
        <ul className="dels">
          {d.delegations.map((x) => (
            <li key={x.id}>
              <span>
                <strong>{x.delegateName}</strong> covers for <strong>{x.approverName}</strong>
                <span className="muted small">
                  {' '}
                  · {x.startsOn} to {x.endsOn}
                  {x.active ? ' · active now' : ''}
                </span>
              </span>
              <Button
                size="sm"
                onClick={() => void run(`/api/v1/admin/delegations/${x.id}`, 'DELETE')}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">No cover arranged.</p>
      )}
    </section>
  );
}
