import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Button, ErrorState, Select, Skeleton } from '@sns/ui';
import { api, ApiError, can, type Me } from '../api.js';

type LeaveType = {
  id: string;
  code: string;
  name: string;
  isPaid: boolean;
  colour: string;
  archived: boolean;
  summary: string;
  requests: number;
  pending: number;
};
type Template = { code: string; name: string; isPaid: boolean; summary: string };
type Data = { types: LeaveType[]; templates: Template[]; colours: string[] };

const BLANK = '__blank__';

/**
 * Leave types — the kinds of leave people can apply for. How many days each gives, and how
 * they are counted, is set per type on Leave configuration.
 */
export function LeaveTypesPage({ me }: { me: Me }) {
  const qc = useQueryClient();
  const canEdit = can(me, 'leave.policy.manage');
  const q = useQuery({
    queryKey: ['admin-leave-types'],
    queryFn: () => api<Data>('/api/v1/admin/leave-types'),
  });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);

  async function run(path: string, method: string, body: unknown, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return false;
    setMsg(null);
    try {
      const r = await api<{ message?: string }>(path, { method, body: JSON.stringify(body) });
      setMsg({ ok: true, text: r?.message ?? 'Saved.' });
      await qc.invalidateQueries();
      return true;
    } catch (err) {
      setMsg({ ok: false, text: err instanceof ApiError ? err.message : 'Could not save.' });
      return false;
    }
  }

  if (q.isLoading) return <Skeleton rows={6} />;
  if (q.isError || !q.data)
    return (
      <ErrorState
        title="Could not load leave types"
        body={q.error instanceof Error ? q.error.message : 'Try again in a moment.'}
        onRetry={() => void q.refetch()}
      />
    );
  const { types, templates } = q.data;
  const active = types.filter((t) => !t.archived);
  const archived = types.filter((t) => t.archived);

  return (
    <div className="lt">
      <header>
        <h1>Leave types</h1>
        <p className="muted">
          The kinds of leave people can apply for. The framework this system follows describes a
          single type — <strong>Annual Leave</strong>, 2 days credited every month (24 a year), with
          weekends and government holidays not counted. Add others only if your company uses them.
        </p>
      </header>

      <section className="card lt-explain" aria-label="How leave types work">
        <div>
          <strong>1. The type</strong>
          <span>A name and a short code, set here. Paid or unpaid.</span>
        </div>
        <div>
          <strong>2. Its rules</strong>
          <span>
            Days a month or a year, carry forward, probation, notice — on{' '}
            <Link to="/settings">Leave configuration</Link>.
          </span>
        </div>
        <div>
          <strong>3. Each person</strong>
          <span>
            Their balance is credited automatically. Exceptions go on{' '}
            <Link to="/allowances">Leave allowances</Link>.
          </span>
        </div>
      </section>

      {msg ? (
        <div className={`flash ${msg.ok ? 'ok' : 'bad'}`} role="status">
          {msg.text}
          <button type="button" aria-label="Dismiss" onClick={() => setMsg(null)}>
            ×
          </button>
        </div>
      ) : null}

      <section className="card">
        <h2>In use ({active.length})</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Leave type</th>
                <th>Paid</th>
                <th>How days are given</th>
                <th className="num">Requests</th>
                {canEdit ? <th /> : null}
              </tr>
            </thead>
            <tbody>
              {active.map((t) => (
                <tr key={t.id}>
                  <td>
                    {editing?.id === t.id ? (
                      <input
                        className="input"
                        aria-label={`New name for ${t.name}`}
                        value={editing.name}
                        autoFocus
                        maxLength={60}
                        onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') setEditing(null);
                          if (e.key === 'Enter' && editing.name.trim().length >= 2) {
                            void run(`/api/v1/admin/leave-types/${t.id}`, 'PATCH', {
                              name: editing.name.trim(),
                            }).then((ok) => ok && setEditing(null));
                          }
                        }}
                      />
                    ) : (
                      <>
                        <span className={`lt-dot tone-${t.colour}`} aria-hidden />
                        <strong>{t.name}</strong> <span className="mono muted small">{t.code}</span>
                      </>
                    )}
                  </td>
                  <td>
                    {canEdit ? (
                      <label className="lt-paid">
                        <input
                          type="checkbox"
                          checked={t.isPaid}
                          onChange={(e) =>
                            void run(`/api/v1/admin/leave-types/${t.id}`, 'PATCH', {
                              isPaid: e.target.checked,
                            })
                          }
                        />
                        {t.isPaid ? 'Paid' : 'Unpaid'}
                      </label>
                    ) : t.isPaid ? (
                      'Paid'
                    ) : (
                      'Unpaid'
                    )}
                  </td>
                  <td className="small">
                    {t.summary}
                    <div>
                      <Link to="/settings" className="small">
                        Change the rules →
                      </Link>
                    </div>
                  </td>
                  <td className="num">
                    {t.requests}
                    {t.pending ? <div className="muted small">{t.pending} waiting</div> : null}
                  </td>
                  {canEdit ? (
                    <td className="lt-actions">
                      {editing?.id === t.id ? (
                        <>
                          <Button
                            size="sm"
                            variant="primary"
                            disabled={editing.name.trim().length < 2}
                            onClick={() =>
                              void run(`/api/v1/admin/leave-types/${t.id}`, 'PATCH', {
                                name: editing.name.trim(),
                              }).then((ok) => ok && setEditing(null))
                            }
                          >
                            Save
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                            Cancel
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button size="sm" onClick={() => setEditing({ id: t.id, name: t.name })}>
                            Rename
                          </Button>
                          <Button
                            size="sm"
                            variant="danger"
                            disabled={active.length <= 1}
                            title={
                              active.length <= 1
                                ? 'At least one leave type must stay available'
                                : undefined
                            }
                            onClick={() =>
                              void run(
                                `/api/v1/admin/leave-types/${t.id}/archived`,
                                'PUT',
                                { disabled: true },
                                `Archive ${t.name}? Nobody will be able to apply for it. Past leave and balances stay in every report, and you can restore it later.`,
                              )
                            }
                          >
                            Archive
                          </Button>
                        </>
                      )}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {canEdit ? <AddTypeCard templates={templates} existing={types} run={run} /> : null}

      {archived.length ? (
        <section className="card">
          <h2>Archived ({archived.length})</h2>
          <p className="muted small">Not offered to anyone. Their history is kept.</p>
          <ul className="lt-archived">
            {archived.map((t) => (
              <li key={t.id}>
                <span>
                  <strong>{t.name}</strong> <span className="mono muted small">{t.code}</span>
                  <span className="muted small"> · {t.requests} past requests</span>
                </span>
                {canEdit ? (
                  <Button
                    size="sm"
                    onClick={() =>
                      void run(`/api/v1/admin/leave-types/${t.id}/archived`, 'PUT', {
                        disabled: false,
                      })
                    }
                  >
                    Restore
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <style>{`
        .lt { display:flex; flex-direction:column; gap:16px; }
        .lt h1 { margin:0 0 4px; font-size:22px; }
        .lt h2 { margin:0 0 10px; font-size:15px; }
        .lt .muted { color:var(--text-secondary); }
        .lt .small { font-size:12.5px; }
        .lt .card { background:#fff; border:1px solid var(--border-subtle); border-radius:12px; padding:16px 18px; }
        .lt-explain { display:grid; grid-template-columns:repeat(3, 1fr); gap:12px; }
        .lt-explain > div { display:flex; flex-direction:column; gap:3px; font-size:13px; }
        .lt-explain span { color:var(--text-secondary); }
        @media (max-width: 760px) { .lt-explain { grid-template-columns:1fr; } }
        .lt .table-wrap { overflow-x:auto; }
        .lt table { width:100%; border-collapse:collapse; }
        .lt th { text-align:left; font-size:12px; color:var(--text-tertiary); font-weight:600; padding:6px 8px; }
        .lt td { padding:10px 8px; border-top:1px solid #f3f3ef; font-size:13.5px; vertical-align:top; }
        .lt .num { text-align:right; }
        .lt-actions { display:flex; gap:6px; justify-content:flex-end; }
        .lt-paid { display:inline-flex; gap:6px; align-items:center; font-size:13px; }
        .lt-dot { display:inline-block; width:9px; height:9px; border-radius:50%; margin-right:8px; background:#6366f1; }
        .lt-dot.tone-status-approved { background:#12b76a; }
        .lt-dot.tone-status-pending { background:#f79009; }
        .lt-dot.tone-status-neutral { background:#98a2b3; }
        .lt-dot.tone-status-rejected { background:#f04438; }
        .lt-templates { display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:8px; margin:10px 0; }
        .lt-template { text-align:left; background:#fff; border:1px solid var(--border-subtle); border-radius:10px; padding:10px 12px; cursor:pointer; font:inherit; display:flex; flex-direction:column; gap:3px; }
        .lt-template:hover:not(:disabled) { border-color:#a5b4fc; }
        .lt-template.is-on { border-color:#4f46e5; background:#eef2ff; }
        .lt-template:disabled { opacity:.5; cursor:not-allowed; }
        .lt-template span { font-size:12.5px; color:var(--text-secondary); }
        .lt-form { display:flex; flex-wrap:wrap; gap:10px; align-items:flex-end; }
        .lt-form label { display:flex; flex-direction:column; gap:4px; font-size:12.5px; color:var(--text-secondary); }
        .lt-archived { list-style:none; margin:0; padding:0; }
        .lt-archived li { display:flex; justify-content:space-between; align-items:center; gap:12px; padding:8px 0; border-top:1px solid #f3f3ef; }
        .lt .flash { display:flex; justify-content:space-between; gap:12px; padding:10px 14px; border-radius:10px; font-size:13.5px; }
        .lt .flash.ok { background:#ecfdf3; color:#05603a; }
        .lt .flash.bad { background:#fef3f2; color:#b42318; }
        .lt .flash button { background:none; border:0; cursor:pointer; font-size:16px; color:inherit; }
      `}</style>
    </div>
  );
}

function AddTypeCard({
  templates,
  existing,
  run,
}: {
  templates: Template[];
  existing: LeaveType[];
  run: (path: string, method: string, body: unknown) => Promise<boolean>;
}) {
  const taken = new Set(existing.map((t) => t.code));
  const firstFree = templates.find((t) => !taken.has(t.code));
  const [template, setTemplate] = useState<string>(firstFree?.code ?? BLANK);
  const chosen = templates.find((t) => t.code === template);
  const [name, setName] = useState(firstFree?.name ?? '');
  const [code, setCode] = useState(firstFree?.code ?? '');
  const [isPaid, setIsPaid] = useState(firstFree?.isPaid ?? true);

  function pick(t: Template | null) {
    setTemplate(t?.code ?? BLANK);
    setName(t?.name ?? '');
    setCode(t?.code ?? '');
    setIsPaid(t?.isPaid ?? true);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const ok = await run('/api/v1/admin/leave-types', 'POST', {
      name: name.trim(),
      code: code.trim().toUpperCase(),
      isPaid,
      template: template === BLANK ? null : template,
    });
    if (ok)
      pick(templates.find((t) => !taken.has(t.code) && t.code !== code.toUpperCase()) ?? null);
  }

  return (
    <section className="card">
      <h2>Add a leave type</h2>
      <p className="muted small" style={{ marginTop: 0 }}>
        Start from a common type, or from scratch. Everyone gets a balance straight away, and you
        can change the rules afterwards.
      </p>
      <div className="lt-templates" role="radiogroup" aria-label="Start from">
        {templates.map((t) => (
          <button
            key={t.code}
            type="button"
            role="radio"
            aria-checked={template === t.code}
            disabled={taken.has(t.code)}
            className={`lt-template${template === t.code ? ' is-on' : ''}`}
            onClick={() => pick(t)}
          >
            <strong>
              {t.name} {taken.has(t.code) ? '· added' : ''}
            </strong>
            <span>{t.summary}</span>
          </button>
        ))}
        <button
          type="button"
          role="radio"
          aria-checked={template === BLANK}
          className={`lt-template${template === BLANK ? ' is-on' : ''}`}
          onClick={() => pick(null)}
        >
          <strong>Something else</strong>
          <span>No days credited to start with. Set its rules on Leave configuration.</span>
        </button>
      </div>
      <form className="lt-form" onSubmit={(e) => void submit(e)}>
        <label>
          Name
          <input
            className="input"
            value={name}
            maxLength={60}
            placeholder="e.g. Maternity Leave"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          Code
          <input
            className="input mono"
            value={code}
            maxLength={8}
            style={{ width: 100 }}
            placeholder="ML"
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
          />
        </label>
        <label>
          Pay
          <Select
            size="sm"
            aria-label="Paid or unpaid"
            value={isPaid ? 'paid' : 'unpaid'}
            onChange={(v) => setIsPaid(v === 'paid')}
            options={[
              { value: 'paid', label: 'Paid' },
              { value: 'unpaid', label: 'Unpaid (deducted from pay)' },
            ]}
          />
        </label>
        <Button
          type="submit"
          variant="primary"
          disabled={name.trim().length < 2 || !/^[A-Z][A-Z0-9]{1,7}$/.test(code)}
        >
          Add {name.trim() || 'leave type'}
        </Button>
      </form>
      {chosen ? <p className="muted small">Starts with: {chosen.summary}</p> : null}
    </section>
  );
}
