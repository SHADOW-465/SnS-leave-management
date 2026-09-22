import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, ErrorState, Select, Skeleton } from '@sns/ui';
import { api, type Me } from '../api.js';
import { formatRelativeTime } from '../format.js';

type User = {
  id: string;
  email: string;
  employeeId: string | null;
  employeeCode: string | null;
  firstName: string | null;
  lastName: string | null;
  name: string | null;
  status: string | null;
  employeeVersion: number | null;
  departmentName: string | null;
  teamName: string | null;
  isDisabled: boolean;
  lastLoginAt: string | null;
  activeSessions: number;
  workstationIp: string | null;
  workstationSeenAt: string | null;
  roles: string[];
};
type Org = {
  locations: { id: string; name: string }[];
  departments: { id: string; name: string }[];
  jobTitles: { id: string; name: string }[];
  employmentTypes: { id: string; name: string }[];
};
type Data = {
  users: User[];
  nextEmployeeCode: string;
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
type NewAccount = {
  firstName: string;
  lastName: string;
  workEmail: string;
  employeeCode: string;
  departmentId: string;
  jobTitleId: string;
  employmentTypeId: string;
  locationId: string;
  joinedOn: string;
  roles: string[];
};
type EditDraft = {
  id: string;
  employeeId: string | null;
  firstName: string;
  lastName: string;
  email: string;
  employeeCode: string;
  employeeVersion: number | null;
  roles: string[];
  originalRoles: string[];
};

function todayLocal(): string {
  const d = new Date();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

export function UsersPage({ me }: { me: Me }) {
  const actorIsAdmin = me.roles.includes('admin');
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['admin-users'],
    queryFn: () => api<Data>('/api/v1/admin/users'),
  });
  const org = useQuery({
    queryKey: ['org'],
    queryFn: () => api<Org>('/api/v1/org'),
  });
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null);
  const [filter, setFilter] = useState('');
  const [editing, setEditing] = useState<EditDraft | null>(null);
  const [adding, setAdding] = useState<NewAccount | null>(null);
  const [removing, setRemoving] = useState<{ user: User; reason: string } | null>(null);
  const [creating, setCreating] = useState<{
    employeeId: string;
    email: string;
    roles: string[];
  } | null>(null);
  const [issued, setIssued] = useState<Issued | null>(null);

  function startAdd() {
    const directory = org.data;
    setEditing(null);
    setAdding({
      firstName: '',
      lastName: '',
      workEmail: '',
      employeeCode: q.data?.nextEmployeeCode ?? '',
      departmentId: directory?.departments[0]?.id ?? '',
      jobTitleId: directory?.jobTitles[0]?.id ?? '',
      employmentTypeId: directory?.employmentTypes[0]?.id ?? '',
      locationId: directory?.locations[0]?.id ?? '',
      joinedOn: todayLocal(),
      roles: ['employee'],
    });
  }

  async function addAccount() {
    if (!adding) return;
    try {
      const r = await api<{ temporaryPassword: string | null }>('/api/v1/employees', {
        method: 'POST',
        body: JSON.stringify({
          employeeCode: adding.employeeCode.trim(),
          firstName: adding.firstName.trim(),
          lastName: adding.lastName.trim(),
          workEmail: adding.workEmail.trim(),
          joinedOn: adding.joinedOn,
          locationId: adding.locationId,
          departmentId: adding.departmentId,
          jobTitleId: adding.jobTitleId,
          employmentTypeId: adding.employmentTypeId,
          createAccount: true,
          roles: adding.roles,
        }),
      });
      if (r.temporaryPassword) {
        setIssued({
          name: `${adding.firstName.trim()} ${adding.lastName.trim()}`,
          login: adding.workEmail.trim(),
          employeeCode: adding.employeeCode.trim(),
          password: r.temporaryPassword,
        });
      }
      setFlash({
        ok: true,
        text: `${adding.firstName.trim()} ${adding.lastName.trim()} can sign in. Give them the temporary password.`,
      });
      setAdding(null);
      await qc.invalidateQueries();
    } catch (e) {
      setFlash({ ok: false, text: e instanceof Error ? e.message : 'Could not add the account.' });
    }
  }

  async function saveEdit() {
    if (!editing) return;
    try {
      await api(`/api/v1/admin/users/${editing.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          firstName: editing.firstName.trim() || undefined,
          lastName: editing.lastName.trim() || undefined,
          email: editing.email.trim(),
          employeeCode: editing.employeeCode.trim() || undefined,
          ...(editing.employeeVersion != null ? { expectedVersion: editing.employeeVersion } : {}),
        }),
      });
      const rolesChanged =
        editing.roles.length !== editing.originalRoles.length ||
        editing.roles.some((r) => !editing.originalRoles.includes(r));
      const mayEditRoles = actorIsAdmin || !editing.originalRoles.includes('admin');
      if (rolesChanged && mayEditRoles) {
        await api(`/api/v1/admin/users/${editing.id}/roles`, {
          method: 'PUT',
          body: JSON.stringify({ roles: editing.roles }),
        });
      }
      setFlash({ ok: true, text: 'Account updated.' });
      setEditing(null);
      await qc.invalidateQueries();
    } catch (e) {
      setFlash({ ok: false, text: e instanceof Error ? e.message : 'Could not save.' });
    }
  }

  async function removeAccount() {
    if (!removing) return;
    const u = removing.user;
    try {
      if (u.employeeId && u.employeeVersion != null && u.status !== 'exited') {
        await api(`/api/v1/employees/${u.employeeId}/deactivate`, {
          method: 'POST',
          body: JSON.stringify({
            reason: removing.reason.trim(),
            exitedOn: todayLocal(),
            expectedVersion: u.employeeVersion,
          }),
        });
        setFlash({
          ok: true,
          text: `${u.name ?? u.email} is marked as left and cannot sign in. Their leave history is kept.`,
        });
      } else if (u.status === 'exited' && u.employeeId && u.employeeVersion != null) {
        await api(`/api/v1/employees/${u.employeeId}/reactivate`, {
          method: 'POST',
          body: JSON.stringify({ expectedVersion: u.employeeVersion }),
        });
        setFlash({ ok: true, text: `${u.name ?? u.email} can sign in again.` });
      } else {
        await api(`/api/v1/admin/users/${u.id}/disabled`, {
          method: 'PUT',
          body: JSON.stringify({ disabled: !u.isDisabled }),
        });
        setFlash({
          ok: true,
          text: u.isDisabled ? 'Account enabled.' : 'Account disabled and signed out.',
        });
      }
      setRemoving(null);
      await qc.invalidateQueries();
    } catch (e) {
      setFlash({
        ok: false,
        text: e instanceof Error ? e.message : 'Could not update the account.',
      });
    }
  }

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
        <div className="title-row">
          <div>
            <h1>Users &amp; access</h1>
            <p className="muted">
              Add an employee and their sign-in, edit the account, or remove it. Removing marks them
              as left and turns the sign-in off. Leave history is kept. Only HR and administrators
              can do this. Only an administrator can grant the administrator role. People sign in
              with their work email or their employee ID.
            </p>
          </div>
          {adding ? null : (
            <Button variant="primary" onClick={startAdd}>
              Add account
            </Button>
          )}
        </div>
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

      {adding ? (
        <section className="card">
          <h2>Add account</h2>
          <p className="muted small">
            This creates the employee and a sign-in. They choose their own password at first
            sign-in.
          </p>
          {org.isError ? (
            <p className="bad-text">Could not load departments. Reload and try again.</p>
          ) : (
            <div className="create">
              <div className="grid">
                <label className="small">
                  First name
                  <input
                    className="input"
                    value={adding.firstName}
                    onChange={(e) => setAdding({ ...adding, firstName: e.target.value })}
                  />
                </label>
                <label className="small">
                  Last name
                  <input
                    className="input"
                    value={adding.lastName}
                    onChange={(e) => setAdding({ ...adding, lastName: e.target.value })}
                  />
                </label>
                <label className="small">
                  Work email
                  <input
                    className="input"
                    type="email"
                    value={adding.workEmail}
                    onChange={(e) => setAdding({ ...adding, workEmail: e.target.value })}
                  />
                </label>
                <label className="small">
                  Employee ID
                  <input
                    className="input"
                    value={adding.employeeCode}
                    onChange={(e) => setAdding({ ...adding, employeeCode: e.target.value })}
                  />
                </label>
                <label className="small">
                  Department
                  <Select
                    fullWidth
                    aria-label="Department"
                    value={adding.departmentId}
                    options={(org.data?.departments ?? []).map((d) => ({
                      value: d.id,
                      label: d.name,
                    }))}
                    onChange={(departmentId) => setAdding({ ...adding, departmentId })}
                  />
                </label>
                <label className="small">
                  Job title
                  <Select
                    fullWidth
                    aria-label="Job title"
                    value={adding.jobTitleId}
                    options={(org.data?.jobTitles ?? []).map((d) => ({
                      value: d.id,
                      label: d.name,
                    }))}
                    onChange={(jobTitleId) => setAdding({ ...adding, jobTitleId })}
                  />
                </label>
                <label className="small">
                  Employment type
                  <Select
                    fullWidth
                    aria-label="Employment type"
                    value={adding.employmentTypeId}
                    options={(org.data?.employmentTypes ?? []).map((d) => ({
                      value: d.id,
                      label: d.name,
                    }))}
                    onChange={(employmentTypeId) => setAdding({ ...adding, employmentTypeId })}
                  />
                </label>
                <label className="small">
                  Location
                  <Select
                    fullWidth
                    aria-label="Location"
                    value={adding.locationId}
                    options={(org.data?.locations ?? []).map((d) => ({
                      value: d.id,
                      label: d.name,
                    }))}
                    onChange={(locationId) => setAdding({ ...adding, locationId })}
                  />
                </label>
                <label className="small">
                  Joined on
                  <input
                    className="input"
                    type="date"
                    value={adding.joinedOn}
                    onChange={(e) => setAdding({ ...adding, joinedOn: e.target.value })}
                  />
                </label>
              </div>
              <div className="roles">
                {roles.map((r) => (
                  <label key={r.code}>
                    <input
                      type="checkbox"
                      disabled={r.code === 'admin' && !actorIsAdmin}
                      checked={adding.roles.includes(r.code)}
                      onChange={(e) =>
                        setAdding({
                          ...adding,
                          roles: e.target.checked
                            ? [...adding.roles, r.code]
                            : adding.roles.filter((x) => x !== r.code),
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
                  disabled={
                    !adding.firstName.trim() ||
                    !adding.lastName.trim() ||
                    !adding.workEmail.includes('@') ||
                    adding.employeeCode.trim().length < 2 ||
                    !adding.departmentId ||
                    !adding.jobTitleId ||
                    !adding.employmentTypeId ||
                    !adding.locationId ||
                    !adding.roles.length
                  }
                  onClick={() => void addAccount()}
                >
                  Create account
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setAdding(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </section>
      ) : null}

      {editing ? (
        <section className="card">
          <h2>Edit {editing.firstName || editing.email}</h2>
          <div className="create">
            {editing.employeeId ? (
              <div className="grid">
                <label className="small">
                  First name
                  <input
                    className="input"
                    value={editing.firstName}
                    onChange={(e) => setEditing({ ...editing, firstName: e.target.value })}
                  />
                </label>
                <label className="small">
                  Last name
                  <input
                    className="input"
                    value={editing.lastName}
                    onChange={(e) => setEditing({ ...editing, lastName: e.target.value })}
                  />
                </label>
                <label className="small">
                  Work email
                  <input
                    className="input"
                    type="email"
                    value={editing.email}
                    onChange={(e) => setEditing({ ...editing, email: e.target.value })}
                  />
                </label>
                <label className="small">
                  Employee ID
                  <input
                    className="input"
                    value={editing.employeeCode}
                    onChange={(e) => setEditing({ ...editing, employeeCode: e.target.value })}
                  />
                </label>
              </div>
            ) : (
              <label className="small">
                Sign-in email
                <input
                  className="input"
                  type="email"
                  value={editing.email}
                  onChange={(e) => setEditing({ ...editing, email: e.target.value })}
                />
              </label>
            )}
            {actorIsAdmin || !editing.originalRoles.includes('admin') ? (
              <div className="roles">
                {roles.map((r) => (
                  <label key={r.code}>
                    <input
                      type="checkbox"
                      disabled={r.code === 'admin' && !actorIsAdmin}
                      checked={editing.roles.includes(r.code)}
                      onChange={(e) =>
                        setEditing({
                          ...editing,
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
              </div>
            ) : (
              <p className="muted small">
                Only an administrator can change an administrator’s roles.
              </p>
            )}
            <div className="actions">
              <Button
                size="sm"
                variant="primary"
                disabled={!editing.roles.length || !editing.email.includes('@')}
                onClick={() => void saveEdit()}
              >
                Save
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                Cancel
              </Button>
            </div>
          </div>
        </section>
      ) : null}

      {removing ? (
        <section className="card">
          <h2>
            {removing.user.status === 'exited' ? 'Restore' : 'Remove'}{' '}
            {removing.user.name ?? removing.user.email}
          </h2>
          {removing.user.status === 'exited' ? (
            <p className="muted small">They can sign in again. Their old leave history stays.</p>
          ) : (
            <>
              <p className="muted small">
                They are marked as left and cannot sign in. The account and leave history are kept.
              </p>
              <label className="small">
                Reason
                <input
                  className="input"
                  value={removing.reason}
                  onChange={(e) => setRemoving({ ...removing, reason: e.target.value })}
                />
              </label>
            </>
          )}
          <div className="actions">
            <Button
              size="sm"
              variant="primary"
              disabled={removing.user.status !== 'exited' && removing.reason.trim().length < 3}
              onClick={() => void removeAccount()}
            >
              {removing.user.status === 'exited' ? 'Restore access' : 'Remove account'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setRemoving(null)}>
              Cancel
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
                                disabled={r.code === 'admin' && !actorIsAdmin}
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
            {shown.length === 0 ? (
              <tr>
                <td colSpan={4} className="muted">
                  No accounts match that search.
                </td>
              </tr>
            ) : null}
            {shown.map((u) => {
              const self = u.id === me.id;
              const left = u.status === 'exited';
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
                    <div className="chips">
                      {u.roles.map((r) => (
                        <span key={r} className="chip">
                          {roles.find((x) => x.code === r)?.name ?? r}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="small">
                    {left ? (
                      <strong>Left</strong>
                    ) : u.isDisabled ? (
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
                      <Button
                        size="sm"
                        onClick={() => {
                          setAdding(null);
                          setRemoving(null);
                          setEditing({
                            id: u.id,
                            employeeId: u.employeeId,
                            firstName: u.firstName ?? '',
                            lastName: u.lastName ?? '',
                            email: u.email,
                            employeeCode: u.employeeCode ?? '',
                            employeeVersion: u.employeeVersion,
                            roles: [...u.roles],
                            originalRoles: [...u.roles],
                          });
                        }}
                      >
                        Edit
                      </Button>
                      {!self ? (
                        <Button
                          size="sm"
                          onClick={() => {
                            setAdding(null);
                            setEditing(null);
                            setRemoving({ user: u, reason: '' });
                          }}
                        >
                          {left ? 'Restore' : 'Remove'}
                        </Button>
                      ) : null}
                      {!self && !left ? (
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
                                : `Disable ${u.name ?? u.email}? They will be signed out and cannot sign in until re-enabled. Their record stays.`,
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
        .users .title-row { display:flex; justify-content:space-between; gap:16px; align-items:flex-start; flex-wrap:wrap; }
        .users .grid { display:grid; grid-template-columns:1fr 1fr; gap:8px 12px; }
        @media (max-width: 640px) { .users .grid { grid-template-columns:1fr; } }
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
