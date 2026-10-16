import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, EmptyState, ErrorState, Skeleton } from '@sns/ui';
import { api, ApiError, can, type Me } from '../api.js';

type Device = {
  id: string;
  status: 'pending' | 'approved' | 'revoked';
  userAccountId: string | null;
  userEmail: string | null;
  userName: string | null;
  label: string | null;
  lanIp: string | null;
  lastSeenAt: string | null;
  lastLoginAt: string | null;
  createdAt: string;
};

type Settings = { enabled: boolean; requireApproval: boolean; ipMatch: boolean };

type Payload = { devices: Device[]; settings: Settings };

const FILTERS = ['pending', 'approved', 'revoked', 'all'] as const;

export function DevicesPage({ me }: { me: Me }) {
  const allowed = can(me, 'workstation.manage');
  const qc = useQueryClient();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('pending');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [rebind, setRebind] = useState<{ id: string; userId: string } | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const online = typeof navigator === 'undefined' ? true : navigator.onLine;

  const q = useQuery({
    queryKey: ['devices'],
    queryFn: () => api<Payload>('/api/v1/admin/devices'),
    enabled: allowed,
  });

  async function run(path: string, body: unknown, okText: string) {
    setMsg(null);
    setSettingsError(null);
    try {
      await api(path, { method: 'POST', body: JSON.stringify(body) });
      setMsg({ ok: true, text: okText });
      setRebind(null);
      await qc.invalidateQueries({ queryKey: ['devices'] });
    } catch (err) {
      setMsg({
        ok: false,
        text: err instanceof ApiError ? err.message : 'Could not update that browser.',
      });
    }
  }

  async function saveSettings(next: Settings) {
    setSettingsError(null);
    setMsg(null);
    try {
      await api('/api/v1/settings/device-binding', {
        method: 'PUT',
        body: JSON.stringify(next),
      });
      setMsg({ ok: true, text: 'Device settings saved.' });
      await qc.invalidateQueries({ queryKey: ['devices'] });
    } catch (err) {
      setSettingsError(err instanceof ApiError ? err.message : 'Could not save settings.');
    }
  }

  if (!allowed) {
    return (
      <ErrorState
        title="You do not have permission to view browsers"
        body="Ask an administrator to approve browsers and change device binding."
      />
    );
  }
  if (!online) {
    return (
      <ErrorState
        title="This browser is offline"
        body="Reconnect to the office network, then try again."
        onRetry={() => void q.refetch()}
      />
    );
  }
  if (q.isPending) return <Skeleton rows={6} />;
  if (q.isError || !q.data) {
    const err = q.error;
    const network = err instanceof ApiError && err.code === 'NETWORK';
    return (
      <ErrorState
        title={network ? 'Cannot reach the Leave OS server' : 'Could not load browsers'}
        body={
          network
            ? 'The office computer may be off, asleep, or disconnected from the network.'
            : err instanceof Error
              ? err.message
              : 'Try again in a moment.'
        }
        requestId={err instanceof ApiError ? err.requestId : undefined}
        onRetry={() => void q.refetch()}
      />
    );
  }

  const { devices, settings } = q.data;
  const shown = filter === 'all' ? devices : devices.filter((d) => d.status === filter);
  const stale = q.isFetching && q.isError;

  return (
    <div className="page-stack">
      <header>
        <h1>Browsers</h1>
        <p className="muted">
          Each browser gets a signed cookie. Approve it to bind it to one person. A different person
          cannot sign in on a bound browser, and that person cannot sign in on someone else's.
        </p>
      </header>
      {stale ? (
        <p className="muted" role="status">
          Showing the last list. A refresh failed — try again.
        </p>
      ) : null}
      {msg ? (
        <p role="status" className={msg.ok ? 'muted' : 'error'}>
          {msg.text}
        </p>
      ) : null}

      <section className="card" aria-label="Device binding settings">
        <h2>Settings</h2>
        {settingsError ? (
          <p className="error" role="alert">
            {settingsError}
          </p>
        ) : null}
        <label>
          <input
            type="checkbox"
            checked={settings.enabled}
            onChange={(e) => void saveSettings({ ...settings, enabled: e.target.checked })}
          />{' '}
          Binding enabled
        </label>
        <label>
          <input
            type="checkbox"
            checked={settings.requireApproval}
            onChange={(e) => void saveSettings({ ...settings, requireApproval: e.target.checked })}
          />{' '}
          Require approval before a new browser is bound
        </label>
        <label>
          <input
            type="checkbox"
            checked={settings.ipMatch}
            onChange={(e) => void saveSettings({ ...settings, ipMatch: e.target.checked })}
          />{' '}
          Also require the recorded LAN address
        </label>
      </section>

      <div
        role="tablist"
        aria-label="Filter browsers"
        style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}
      >
        {FILTERS.map((f) => (
          <Button
            key={f}
            size="sm"
            variant={filter === f ? 'primary' : 'secondary'}
            onClick={() => setFilter(f)}
          >
            {f}
          </Button>
        ))}
      </div>

      {devices.length === 0 ? (
        <EmptyState
          title="No browsers yet"
          body="A browser appears here the first time someone signs in from it."
        />
      ) : shown.length === 0 ? (
        <EmptyState
          title={`No ${filter} browsers`}
          body="Clear the filter to see every browser that has signed in."
          action={<Button onClick={() => setFilter('all')}>Show all</Button>}
        />
      ) : (
        <div className="card card-flush" style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Person</th>
                <th>Status</th>
                <th>LAN address</th>
                <th>Last sign-in</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((d) => (
                <tr key={d.id}>
                  <td>
                    {d.userName || d.userEmail || 'Unknown'}
                    <div className="muted">{d.userEmail}</div>
                  </td>
                  <td>{d.status}</td>
                  <td>{d.lanIp || '—'}</td>
                  <td>{d.lastLoginAt || d.lastSeenAt || d.createdAt}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {d.status !== 'approved' ? (
                        <Button
                          size="sm"
                          onClick={() =>
                            void run(`/api/v1/admin/devices/${d.id}/approve`, {}, 'Approved.')
                          }
                        >
                          Approve
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          onClick={() =>
                            void run(`/api/v1/admin/devices/${d.id}/revoke`, {}, 'Revoked.')
                          }
                        >
                          Revoke
                        </Button>
                      )}
                      <Button
                        size="sm"
                        onClick={() => setRebind({ id: d.id, userId: d.userAccountId ?? '' })}
                      >
                        Rebind
                      </Button>
                    </div>
                    {rebind?.id === d.id ? (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (!rebind.userId.trim()) {
                            setMsg({
                              ok: false,
                              text: 'Enter the account id to bind this browser to.',
                            });
                            return;
                          }
                          void run(
                            `/api/v1/admin/devices/${d.id}/rebind`,
                            { userId: rebind.userId.trim() },
                            'Rebound.',
                          );
                        }}
                        style={{ marginTop: 8 }}
                      >
                        <label>
                          Account id
                          <input
                            value={rebind.userId}
                            onChange={(e) => setRebind({ id: d.id, userId: e.target.value })}
                            aria-invalid={msg?.ok === false}
                          />
                        </label>
                        <Button type="submit" size="sm">
                          Save binding
                        </Button>
                      </form>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
