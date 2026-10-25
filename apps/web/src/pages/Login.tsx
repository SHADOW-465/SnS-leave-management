import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@sns/ui';
import { api, ApiError } from '../api.js';
import { DemoPanel } from './DemoAccounts.js';

const infoCards = (
  <>
    <h2 style={{ margin: 0, fontSize: 20, letterSpacing: '-0.02em' }}>
      This cycle, on this machine
    </h2>
    <div className="card">
      <p className="muted">No internet required</p>
      <p style={{ margin: 0, fontWeight: 600 }}>Core functions run on the office computer.</p>
    </div>
    <div className="card">
      <p className="muted">Notifications stay in the app</p>
      <p style={{ margin: 0, fontWeight: 600 }}>
        Requests and decisions appear under the bell. No email is sent.
      </p>
    </div>
    <div className="card">
      <p className="muted">Nothing is deleted</p>
      <p style={{ margin: 0, fontWeight: 600 }}>People are deactivated. History stays.</p>
    </div>
  </>
);

export function LoginPage() {
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function performLogin(targetEmail: string, targetPass: string) {
    setPending(true);
    setError(null);
    try {
      await api('/api/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: targetEmail, password: targetPass }),
      });
      await qc.invalidateQueries({ queryKey: ['me'] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sign in.');
    } finally {
      setPending(false);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    await performLogin(email, password);
  }

  return (
    <main className="login-grid">
      <div className="login-pane">
        <div className="brand">
          <div className="mark">S</div>
          <span className="brand-name">Simon &amp; Sons</span>
          <span className="brand-chip">Leave OS</span>
        </div>
        <div style={{ maxWidth: 420, display: 'flex', flexDirection: 'column', gap: 28 }}>
          <div>
            <h1
              style={{
                margin: '0 0 10px',
                fontSize: 38,
                lineHeight: 1.08,
                letterSpacing: '-0.03em',
                fontWeight: 600,
              }}
            >
              Sign in to Leave OS
            </h1>
            <p style={{ margin: 0, color: 'var(--text-secondary)' }}>
              Apply for leave, approve your team’s requests, and run the monthly leave report — all
              in one place.
            </p>
          </div>
          <form
            onSubmit={(e) => void onSubmit(e)}
            style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
          >
            {error ? (
              <p role="alert" style={{ margin: 0, color: 'var(--status-rejected-fg)' }}>
                {error}
              </p>
            ) : null}
            <div className="field">
              <label htmlFor="lg-email">Username, email or employee ID</label>
              <input
                id="lg-email"
                className="input"
                type="text"
                placeholder="vijay.anand, name@company.com or SNS-1005"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="field">
              <div
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
              >
                <label htmlFor="lg-pass" style={{ margin: 0 }}>
                  Password
                </label>
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: '0 4px',
                    fontSize: 12,
                    color: 'var(--brand-primary, #0284c7)',
                    cursor: 'pointer',
                    fontWeight: 500,
                  }}
                >
                  {showPassword ? 'Hide password' : 'Show password'}
                </button>
              </div>
              <div style={{ position: 'relative' }}>
                <input
                  id="lg-pass"
                  className="input"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  style={{ width: '100%', paddingRight: 40 }}
                />
              </div>
            </div>
            <Button variant="primary" type="submit" disabled={pending} style={{ height: 44 }}>
              {pending ? 'Signing in…' : 'Continue'}
            </Button>
          </form>
        </div>
        <p className="note" style={{ margin: 0 }}>
          Role comes from your account. There is nothing to pick on this screen.
        </p>
      </div>
      <aside className="login-aside">
        {import.meta.env.DEV ? (
          <DemoPanel
            pending={pending}
            fallback={infoCards}
            onSignIn={(e, p) => {
              setEmail(e);
              setPassword(p);
              void performLogin(e, p);
            }}
          />
        ) : (
          infoCards
        )}
      </aside>
    </main>
  );
}
