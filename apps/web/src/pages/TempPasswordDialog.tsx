import { useState } from 'react';
import { Button } from '@sns/ui';
import { api } from '../api.js';

/** What the dialog reports back once the password is set. Shown once, never stored. */
export type TempPasswordResult = { password: string; username: string | null; created: boolean };

const MIN = 12;

function generate(): string {
  // Unambiguous characters; 16 of them from the browser's secure random source.
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789@#%+=';
  const bytes = new Uint32Array(16);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += chars[b % chars.length];
  return out;
}

/**
 * Lets an administrator or HR type (or generate) a temporary password for someone. The
 * server replaces whatever password they had, signs them out everywhere, and makes them
 * choose a new one at next sign-in. With `employeeId` and no account, the server creates
 * the sign-in (username = employee code).
 */
export function TempPasswordDialog({
  name,
  accountId,
  employeeId,
  onClose,
  onDone,
}: {
  name: string;
  accountId?: string | null;
  employeeId?: string | null;
  onClose: () => void;
  onDone: (r: TempPasswordResult) => void;
}) {
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const problem =
    pw.length === 0
      ? 'Type a temporary password or press Generate.'
      : pw.length < MIN
        ? `At least ${MIN} characters (${pw.length} so far).`
        : pw.trim() !== pw
          ? 'It cannot start or end with a space.'
          : confirm !== pw
            ? 'The two passwords do not match.'
            : null;

  async function save() {
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const url = accountId
        ? `/api/v1/accounts/${accountId}/reset-password`
        : `/api/v1/employees/${employeeId}/temporary-password`;
      const r = await api<{ username?: string; created?: boolean }>(url, {
        method: 'POST',
        body: JSON.stringify({ temporaryPassword: pw }),
      });
      onDone({ password: pw, username: r.username ?? null, created: Boolean(r.created) });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not set the password.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="curved-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Set a temporary password for ${name}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h3 className="modal-title">Set a temporary password</h3>
        </div>
        <div className="modal-body">
          <p style={{ margin: '0 0 12px', fontSize: 13.5 }}>
            For <strong>{name}</strong>. This replaces their current password, signs them out
            everywhere, and they must choose a new password the next time they sign in.
            {accountId
              ? ''
              : ' They have no sign-in yet, so one will be created with their employee ID as the username.'}
          </p>
          <label className="small" style={{ display: 'block', marginBottom: 8 }}>
            Temporary password
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                className="input"
                type={show ? 'text' : 'password'}
                autoComplete="new-password"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                style={{ flex: 1 }}
              />
              <Button size="sm" type="button" onClick={() => setShow(!show)}>
                {show ? 'Hide' : 'Show'}
              </Button>
              <Button
                size="sm"
                type="button"
                onClick={() => {
                  const g = generate();
                  setPw(g);
                  setConfirm(g);
                  setShow(true);
                }}
              >
                Generate
              </Button>
            </div>
          </label>
          <label className="small" style={{ display: 'block' }}>
            Type it again
            <input
              className="input"
              type={show ? 'text' : 'password'}
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </label>
          <p className="muted small" style={{ marginTop: 6 }}>
            {problem ??
              'Ready. Give it to them privately; it is not stored anywhere you can view later.'}
          </p>
          {error ? (
            <div className="form-error" role="alert">
              {error}
            </div>
          ) : null}
        </div>
        <div
          className="modal-footer"
          style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}
        >
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" variant="primary" disabled={busy} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Set password'}
          </Button>
        </div>
      </div>
    </div>
  );
}
