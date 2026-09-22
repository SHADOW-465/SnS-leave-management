import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, ErrorState, Skeleton } from '@sns/ui';
import { api, type Me } from '../api.js';
import { formatRelativeTime } from '../format.js';

type User = {
  id: string;
  email: string;
  employeeCode: string | null;
  name: string | null;
  departmentName: string | null;
  teamName: string | null;
  isDisabled: boolean;
  lastLoginAt: string | null;
  activeSessions: number;
  workstationIp: string | null;
  workstationSeenAt: string | null;
  roles: string[];
};
type Data = {
  users: User[];
  roles: { code: string; name: string; description: string }[];
  withoutAccount: {
    employeeId: string;
    code: string;
    name: string;
    email: string;
    departmentName: string;
  }[];
};
/** Shown once, straight after a login is created or a password is reset. */
type Issued = { name: string; login: string; employeeCode: string | null; password: string };

export function UsersPage({ me }: { me: Me }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['admin-users'],
    queryFn: () => api<Data>('/api/v1/admin/users'),
  });
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null);
  const [filter, setFilter] = useState('');
  const [editing, setEditing] = useState<{ id: string; roles: string[] } | null>(null);
  const [creating, setCreating] = useState<{
    employeeId: string;
    email: string;
    roles: string[];
  } | null>(null);
  const [issued, setIssued] = useState<Issued | null>(null);

  async function createLogin() {
    if (!creating) return;
    try {
      const r = await api<{
        email: string;
        employeeCode: string;
        temporaryPassword: string;
        message: string;
      }>('/api/v1/admin/users', { method: 'POST', body: JSON.stringify(creating) });
      const person = q.data?.withoutAccount.find((w) => w.employeeId === creating.employeeId);
      setIssued({
        name: person?.name ?? r.email,
        login: r.email,
        employeeCode: r.employeeCode,
        password: r.temporaryPassword,
      });
      setFlash({ ok: true, text: r.message });
      setCreating(null);
      await qc.invalidateQueries();
    } catch (e) {
      setFlash({ ok: false, text: e instanceof Error ? e.message : 'Could not create the login.' });
    }
  }

  async function resetPassword(u: User) {
    if (
      !window.confirm(
        `Reset the password for ${u.name ?? u.email}? They will be signed out and must choose a new password.`,
      )
    )
      return;
    try {
      const r = await api<{ temporaryPassword: string }>(
        `/api/v1/accounts/${u.id}/reset-password`,
        {
          method: 'POST',
          body: JSON.stringify({}),
        },
      );
      setIssued({
        name: u.name ?? u.email,
        login: u.email,
        employeeCode: u.employeeCode,
        password: r.temporaryPassword,
      });
      await qc.invalidateQueries();
    } catch (e) {
      setFlash({
        ok: false,
        text: e instanceof Error ? e.message : 'Could not reset the password.',
      });
    }
  }

  async function run(
    path: string,
    method: string,
    body: unknown,
    ok: string,
    confirmText?: string,
  ) {
    if (confirmText && !window.confirm(confirmText)) return;
    try {
      await api(path, { method, body: JSON.stringify(body) });
      setFlash({ ok: true, text: ok });
      setEditing(null);
      await qc.invalidateQueries();
    } catch (e) {
      setFlash({ ok: false, text: e instanceof Error ? e.message : 'Could not save.' });
    }
  }

  if (q.isLoading) return <Skeleton rows={8} />;
  if (q.isError || !q.data)
    return (
      <ErrorState
        title="Could not load users"
        body={q.error instanceof Error ? q.error.message : 'Try again in a moment.'}
        onRetry={() => void q.refetch()}
      />
    );
  const { users, roles, withoutAccount } = q.data;
  const needle = filter.toLowerCase();
  const shown = users.filter((u) =>
    `${u.name ?? ''} ${u.email} ${u.employeeCode ?? ''} ${u.roles.join(' ')} ${u.departmentName ?? ''}`
      .toLowerCase()
      .includes(needle),
  );

  return (
    <div className="users">
      <header>
        <h1>Users &amp; access</h1>
        <p className="muted">
          Create sign-ins, decide what each person can see and manage, and lock or unlock access.
          People sign in with their work email or their employee ID. Who approves whose leave is set
          on Reporting managers.
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
      {issued ? (
        <section className="card issued" role="status">
          <h2>Give these details to {issued.name}</h2>
          <dl>
            <dt>Sign in with</dt>
            <dd className="mono">
              {issued.login}
              {issued.employeeCode ? ` or ${issued.employeeCode}` : ''}
            </dd>
            <dt>Temporary password</dt>
            <dd className="mono">{issued.password}</dd>
          </dl>
          <p className="muted small">
            Shown only once. They must choose their own password when they first sign in.
          </p>
          <div className="actions">
            <Button
              size="sm"
              onClick={() =>
                void navigator.clipboard?.writeText(
                  `Sign in: ${issued.login}${issued.employeeCode ? ` (or ${issued.employeeCode})` : ''}\nTemporary password: ${issued.password}`,
                )
              }
            >
              Copy
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setIssued(null)}>
              Done
            </Button>
          </div>
        </section>
      ) : null}

      {withoutAccount.length ? (
        <section className="card">
          <h2>People without a sign-in ({withoutAccount.length})</h2>
          <p className="muted small">
            They cannot apply for leave or approve anything until they have one.
          </p>
          <table>
            <tbody>
              {withoutAccount.map((w) => (
                <tr key={w.employeeId}>
                  <td>
                    <strong>{w.name}</strong>
                    <div className="muted small">
                      {w.code} · {w.departmentName}
                    </div>
                  </td>
                  <td>
                    {creating?.employeeId === w.employeeId ? (
                      <div className="create">
                        <label className="small">
                          Sign-in email
                          <input
                            className="input"
                            type="email"
                            value={creating.email}
                            onChange={(e) => setCreating({ ...creating, email: e.target.value })}
                          />
                        </label>
                        <div className="roles">
                          {roles.map((r) => (
                            <label key={r.code}>
                              <input
                                type="checkbox"
                                checked={creating.roles.includes(r.code)}
                                onChange={(e) =>
                                  setCreating({
                                    ...creating,
                                    roles: e.target.checked
                                      ? [...creating.roles, r.code]
                                      : creating.roles.filter((x) => x !== r.code),
                                  })
                                }
                              />
                              <span>
                                <strong>{r.name}</strong>
                                <span className="muted small"> — {r.description}</span>
                              </span>
                            </label>
                          ))}
                        </div>
                        <div className="actions">
                          <Button
                            size="sm"
                            variant="primary"
                            disabled={!creating.roles.length || !creating.email.includes('@')}
                            onClick={() => void createLogin()}
                          >
                            Create sign-in
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setCreating(null)}>
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        onClick={() =>
                          setCreating({
                            employeeId: w.employeeId,
                            email: w.email,
                            roles: ['employee'],
                          })
                        }
                      >
                        Create sign-in
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      <section className="card">
        <input
          className="input"
          placeholder="Search by name, email, employee ID or role"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <table>
          <thead>
            <tr>
              <th>Person</th>
              <th>Roles</th>
              <th>Access</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.map((u) => {
              const self = u.id === me.id;
              const isEditing = editing?.id === u.id;
              return (
                <tr key={u.id} className={u.isDisabled ? 'off' : ''}>
                  <td>
                    <strong>{u.name ?? u.email}</strong>
                    {self ? <span className="muted small"> (you)</span> : null}
                    <div className="muted small">
                      {u.email}
                      {u.employeeCode ? ` · ${u.employeeCode}` : ''}
                    </div>
                    <div className="muted small">
                      {[u.departmentName, u.teamName].filter(Boolean).join(' · ')}
                    </div>
                  </td>
                  <td>
                    {isEditing ? (
                      <div className="roles">
                        {roles.map((r) => (
                          <label key={r.code}>
                            <input
                              type="checkbox"
                              checked={editing.roles.includes(r.code)}
                              onChange={(e) =>
                                setEditing({
                                  id: u.id,
                                  roles: e.target.checked
                                    ? [...editing.roles, r.code]
                                    : editing.roles.filter((x) => x !== r.code),
                                })
                              }
                            />
                            <span>
                              <strong>{r.name}</strong>
                              <span className="muted small"> — {r.description}</span>
                            </span>
                          </label>
                        ))}
                        <div className="actions">
                          <Button
                            size="sm"
                            variant="primary"
                            disabled={!editing.roles.length}
                            onClick={() =>
                              void run(
                                `/api/v1/admin/users/${u.id}/roles`,
                                'PUT',
                                { roles: editing.roles },
                                'Roles updated. They apply at their next page load.',
                              )
                            }
                          >
                            Save roles
                          </Button>
                          <Button size="sm" onClick={() => setEditing(null)}>
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="chips">
                        {u.roles.map((r) => (
                          <span key={r} className="chip">
                            {roles.find((x) => x.code === r)?.name ?? r}
                          </span>
                        ))}
                        <button
                          type="button"
                          className="link"
                          onClick={() => setEditing({ id: u.id, roles: u.roles })}
                        >
                          Change
                        </button>
                      </div>
                    )}
                  </td>
                  <td className="small">
                    {u.isDisabled ? (
                      <strong className="bad-text">Disabled</strong>
                    ) : (
                      <span>Active</span>
                    )}
                    <div className="muted">
                      {u.lastLoginAt
                        ? `Last signed in ${formatRelativeTime(u.lastLoginAt)}`
                        : 'Never signed in'}
                      {u.activeSessions
                        ? ` · ${u.activeSessions} open session${u.activeSessions > 1 ? 's' : ''}`
                        : ''}
                    </div>
                    {u.workstationIp ? (
                      <div className="muted">Bound to workstation {u.workstationIp}</div>
                    ) : null}
                  </td>
                  <td>
                    <div className="actions">
                      {!self ? (
                        <Button
                          size="sm"
                          onClick={() =>
                            void run(
                              `/api/v1/admin/users/${u.id}/disabled`,
                              'PUT',
                              { disabled: !u.isDisabled },
                              u.isDisabled
                                ? 'Account enabled.'
                                : 'Account disabled and signed out.',
                              u.isDisabled
                                ? undefined
                                : `Disable ${u.name ?? u.email}? They will be signed out and cannot sign in until re-enabled.`,
                            )
                          }
                        >
                          {u.isDisabled ? 'Enable' : 'Disable'}
                        </Button>
                      ) : null}
                      {u.activeSessions ? (
                        <Button
                          size="sm"
                          onClick={() =>
                            void run(
                              `/api/v1/admin/users/${u.id}/sign-out-everywhere`,
                              'POST',
                              {},
                              'Signed out of other sessions.',
                            )
                          }
                        >
                          Sign out everywhere
                        </Button>
                      ) : null}
                      {!self ? (
                        <Button size="sm" onClick={() => void resetPassword(u)}>
                          Reset password
                        </Button>
                      ) : null}
                      {u.workstationIp ? (
                        <Button
                          size="sm"
                          onClick={() =>
                            void run(
                              `/api/v1/admin/users/${u.id}/release-workstation`,
                              'POST',
                              {},
                              'Workstation released. They can sign in from a new computer.',
                            )
                          }
                        >
                          Release workstation
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
      <style>{`
        .users { display:flex; flex-direction:column; gap:16px; }
        .users h1 { margin:0 0 4px; font-size:22px; }
        .users .muted { color:var(--text-secondary); }
        .users .small { font-size:12.5px; }
        .users h2 { margin:0 0 6px; font-size:15px; }
        .users .issued { border-color:#abefc6; background:#f6fef9; }
        .users .issued dl { display:grid; grid-template-columns:auto 1fr; gap:4px 12px; margin:8px 0; font-size:13.5px; }
        .users .issued dt { color:var(--text-secondary); }
        .users .issued dd { margin:0; font-weight:600; }
        .users .create { display:flex; flex-direction:column; gap:8px; max-width:460px; }
        .users .create label.small { display:flex; flex-direction:column; gap:4px; }
        .users .card { background:#fff; border:1px solid var(--border-subtle); border-radius:12px; padding:16px 18px; overflow-x:auto; }
        .users table { width:100%; border-collapse:collapse; margin-top:10px; }
        .users th { text-align:left; font-size:12px; color:var(--text-tertiary); font-weight:600; padding:6px 8px; }
        .users td { padding:10px 8px; border-top:1px solid #f3f3ef; vertical-align:top; }
        .users tr.off td { opacity:.65; }
        .users .chips { display:flex; flex-wrap:wrap; gap:6px; align-items:center; }
        .users .chip { background:#f1f1ee; border-radius:999px; padding:2px 9px; font-size:12px; }
        .users .link { background:none; border:0; color:var(--accent,#4f46e5); cursor:pointer; font-size:12.5px; }
        .users .roles { display:flex; flex-direction:column; gap:6px; max-width:420px; }
        .users .roles label { display:flex; gap:8px; align-items:flex-start; font-size:13px; }
        .users .actions { display:flex; flex-wrap:wrap; gap:6px; }
        .users .bad-text { color:#b42318; }
        .users .flash { display:flex; justify-content:space-between; padding:10px 14px; border-radius:10px; font-size:13.5px; }
        .users .flash.ok { background:#ecfdf3; color:#05603a; }
        .users .flash.bad { background:#fef3f2; color:#b42318; }
        .users .flash button { background:none; border:0; cursor:pointer; font-size:16px; color:inherit; }
      `}</style>
    </div>
  );
}
