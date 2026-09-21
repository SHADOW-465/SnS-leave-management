import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, ErrorState, Select, Skeleton } from '@sns/ui';
import { api } from '../api.js';

type Person = {
  employeeId: string;
  name: string;
  code: string;
  teamName: string | null;
  departmentName: string;
  hasAccount: boolean;
  position: string;
  override: { approverEmployeeId: string; approverName: string; note: string | null } | null;
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

const NONE = '__none__';

export function ApprovalRoutingPage() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['approval-map'],
    queryFn: () => api<MapData>('/api/v1/admin/approval-map'),
  });
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null);
  const [filter, setFilter] = useState('');
  const [del, setDel] = useState({
    approverEmployeeId: '',
    delegateEmployeeId: '',
    startsOn: '',
    endsOn: '',
  });

  async function run(path: string, method: string, body?: unknown) {
    try {
      const r = await api<{ message?: string }>(path, {
        method,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      setFlash({ ok: true, text: r?.message ?? 'Saved.' });
      await qc.invalidateQueries();
    } catch (e) {
      setFlash({ ok: false, text: e instanceof Error ? e.message : 'Could not save.' });
    }
  }

  if (q.isLoading) return <Skeleton rows={8} />;
  if (q.isError || !q.data)
    return (
      <ErrorState
        title="Could not load approval routing"
        body={q.error instanceof Error ? q.error.message : 'Try again in a moment.'}
        onRetry={() => void q.refetch()}
      />
    );
  const d = q.data;
  const pick = [
    { value: NONE, label: 'Nobody' },
    ...d.candidates.map((c) => ({ value: c.id, label: c.name })),
  ];
  const needle = filter.toLowerCase();
  const people = d.people.filter((p) =>
    `${p.name} ${p.code} ${p.teamName ?? ''} ${p.departmentName}`.toLowerCase().includes(needle),
  );

  return (
    <div className="routing">
      <header>
        <h1>Approval routing</h1>
        <p className="muted">
          Decide who approves leave for whom. Leave goes to the team lead, then the department head,
          then HR. An assigned approver below replaces that chain for one person.
        </p>
      </header>

      {flash ? (
        <div className={`flash ${flash.ok ? 'ok' : 'bad'}`} role="status">
          {flash.text}
          <button type="button" aria-label="Dismiss" onClick={() => setFlash(null)}>
            ×
          </button>
        </div>
      ) : null}

      {d.warnings.length ? (
        <section className="card">
          <h2>Needs attention</h2>
          <ul className="warn">
            {d.warnings.map((w, i) => (
              <li key={i} className={w.level}>
                {w.text}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="grid2">
        <section className="card">
          <h2>Team leads</h2>
          <p className="muted small">First approver for everyone in the team.</p>
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
        <section className="card">
          <h2>Department heads</h2>
          <p className="muted small">Approve for team leads, and when a team has no lead.</p>
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
      </div>

      <section className="card">
        <div className="head">
          <h2>Who approves each person</h2>
          <input
            className="input"
            placeholder="Search people, teams, departments"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        <table>
          <thead>
            <tr>
              <th>Person</th>
              <th>Team</th>
              <th>Leave goes to</th>
              <th>Assigned approver</th>
            </tr>
          </thead>
          <tbody>
            {people.map((p) => (
              <tr key={p.employeeId}>
                <td>
                  <strong>{p.name}</strong>
                  <div className="muted small">
                    {p.position} · {p.code}
                  </div>
                </td>
                <td className="small">
                  {p.teamName ?? '—'}
                  <div className="muted">{p.departmentName}</div>
                </td>
                <td className="small">
                  {p.route ? (
                    <>
                      <strong>{p.route.approverName}</strong>
                      <div className="muted">
                        {p.route.approverRole}
                        {p.route.coveringFor ? ` — covering for ${p.route.coveringFor}` : ''}
                      </div>
                      {p.route.escalation ? (
                        <div className="notice-text">{p.route.escalation}</div>
                      ) : null}
                    </>
                  ) : (
                    <span className="problem-text">{p.problem}</span>
                  )}
                </td>
                <td>
                  <Select
                    size="sm"
                    aria-label={`Assigned approver for ${p.name}`}
                    value={p.override?.approverEmployeeId ?? NONE}
                    options={[
                      { value: NONE, label: 'Follow the hierarchy' },
                      ...d.candidates
                        .filter((c) => c.id !== p.employeeId)
                        .map((c) => ({ value: c.id, label: c.name })),
                    ]}
                    onChange={(v) =>
                      void run(`/api/v1/admin/overrides/${p.employeeId}`, 'PUT', {
                        approverEmployeeId: v === NONE ? null : v,
                      })
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h2>Cover while someone is away</h2>
        <p className="muted small">
          Between these dates, anything that would go to the approver goes to their cover instead.
          Requests already waiting stay where they are — reassign them from the request if needed.
        </p>
        <form
          className="delform"
          onSubmit={(e) => {
            e.preventDefault();
            void run('/api/v1/admin/delegations', 'POST', del).then(() =>
              setDel({ approverEmployeeId: '', delegateEmployeeId: '', startsOn: '', endsOn: '' }),
            );
          }}
        >
          <Select
            size="sm"
            aria-label="Approver who is away"
            placeholder="Approver who is away"
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

      <style>{`
        .routing { display:flex; flex-direction:column; gap:16px; }
        .routing h1 { margin:0 0 4px; font-size:22px; }
        .routing h2 { margin:0 0 6px; font-size:15px; }
        .routing .muted { color:var(--text-secondary); }
        .routing .small { font-size:12.5px; }
        .routing .card { background:#fff; border:1px solid var(--border-subtle); border-radius:12px; padding:16px 18px; overflow-x:auto; }
        .routing .grid2 { display:grid; grid-template-columns:repeat(auto-fit,minmax(320px,1fr)); gap:16px; }
        .routing .row { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:8px 0; border-top:1px solid #f3f3ef; }
        .routing .head { display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom:8px; }
        .routing table { width:100%; border-collapse:collapse; }
        .routing th { text-align:left; font-size:12px; color:var(--text-tertiary); font-weight:600; padding:6px 8px; }
        .routing td { padding:10px 8px; border-top:1px solid #f3f3ef; vertical-align:top; }
        .routing .warn { margin:0; padding-left:18px; }
        .routing .warn li { margin:4px 0; font-size:13.5px; }
        .routing .warn .problem, .routing .problem-text { color:#b42318; }
        .routing .warn .notice, .routing .notice-text { color:#8a6116; font-size:12.5px; }
        .routing .flash { display:flex; justify-content:space-between; padding:10px 14px; border-radius:10px; font-size:13.5px; }
        .routing .flash.ok { background:#ecfdf3; color:#05603a; }
        .routing .flash.bad { background:#fef3f2; color:#b42318; }
        .routing .flash button { background:none; border:0; cursor:pointer; font-size:16px; color:inherit; }
        .routing .delform { display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin:10px 0; }
        .routing .dels { list-style:none; margin:0; padding:0; }
        .routing .dels li { display:flex; justify-content:space-between; align-items:center; gap:12px; padding:8px 0; border-top:1px solid #f3f3ef; font-size:13.5px; }
      `}</style>
    </div>
  );
}
