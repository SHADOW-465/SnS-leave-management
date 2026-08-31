import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@sns/ui';
import { api, ApiError, type Me } from '../api.js';

export function PasswordPage({ me }: { me: Me }) {
  const qc = useQueryClient();
  const [currentPassword, setCurrent] = useState('');
  const [newPassword, setNew] = useState('');
  const [showCurrent, setShowCurrent] = useState(true);
  const [showNew, setShowNew] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    try {
      await api('/api/v1/auth/password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      await qc.invalidateQueries({ queryKey: ['me'] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not change password.');
    }
  }

  return (
    <main className="login-pane" style={{ minHeight: '100vh', maxWidth: 460, margin: '0 auto' }}>
      <div className="brand">
        <div className="mark">S</div>
        <span className="brand-name">Leave OS</span>
      </div>
      <form onSubmit={(e) => void onSubmit(e)} className="page-stack" style={{ marginTop: 40 }}>
        <div>
          <h1 style={{ margin: '0 0 8px' }}>Choose a new password</h1>
          <p style={{ color: 'var(--text-secondary)', margin: 0 }}>
            {me.displayName}, you signed in with a temporary password. Other sessions on this
            account will be signed out.
          </p>
        </div>
        {error ? (
          <p role="alert" style={{ color: 'var(--status-rejected-fg)' }}>
            {error}
          </p>
        ) : null}
        <div className="field">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <label htmlFor="p-cur" style={{ margin: 0 }}>
              Current password
            </label>
            <button
              type="button"
              onClick={() => setShowCurrent(!showCurrent)}
              style={{
                background: 'none',
                border: 'none',
                padding: 0,
                fontSize: 12,
                color: 'var(--brand-primary, #0284c7)',
                cursor: 'pointer',
              }}
            >
              {showCurrent ? 'Hide' : 'Show'}
            </button>
          </div>
          <input
            id="p-cur"
            className="input"
            type={showCurrent ? 'text' : 'password'}
            value={currentPassword}
            onChange={(e) => setCurrent(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <label htmlFor="p-new" style={{ margin: 0 }}>
              New password (12+ characters)
            </label>
            <button
              type="button"
              onClick={() => setShowNew(!showNew)}
              style={{
                background: 'none',
                border: 'none',
                padding: 0,
                fontSize: 12,
                color: 'var(--brand-primary, #0284c7)',
                cursor: 'pointer',
              }}
            >
              {showNew ? 'Hide' : 'Show'}
            </button>
          </div>
          <input
            id="p-new"
            className="input"
            type={showNew ? 'text' : 'password'}
            minLength={12}
            value={newPassword}
            onChange={(e) => setNew(e.target.value)}
            required
          />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="primary" type="submit" style={{ flex: 1 }}>
            Update password
          </Button>
          <button
            type="button"
            className="button"
            style={{
              fontSize: 12,
              padding: '0 12px',
              background: 'var(--bg-secondary, #f8fafc)',
              border: '1px solid var(--border-default, #e2e8f0)',
              borderRadius: 6,
              cursor: 'pointer',
            }}
            onClick={() => {
              setNew('ChangeMe_test_123');
              setShowNew(true);
            }}
          >
            Auto-fill Test Pass
          </button>
        </div>
      </form>
    </main>
  );
}
