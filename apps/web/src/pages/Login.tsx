import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@sns/ui';
import { api, ApiError } from '../api.js';

type DemoAccountItem = {
  email: string;
  name: string;
  roles: string;
  password?: string;
};

type DemoAccountsResponse = {
  password: string;
  accounts: DemoAccountItem[];
};

const DEFAULT_DEMO_ACCOUNTS: DemoAccountItem[] = [
  {
    name: 'Ada Example',
    email: 'admin@example.invalid',
    roles: 'admin',
    password: 'ChangeMe_admin_1',
  },
  {
    name: 'Helen Example',
    email: 'helen@example.invalid',
    roles: 'hr_officer',
    password: 'ChangeMe_demo_1',
  },
  {
    name: 'Ravi Example',
    email: 'ravi@example.invalid',
    roles: 'manager',
    password: 'ChangeMe_demo_1',
  },
  {
    name: 'Amina Example',
    email: 'amina@example.invalid',
    roles: 'employee',
    password: 'ChangeMe_demo_1',
  },
  {
    name: 'Paul Example',
    email: 'paul@example.invalid',
    roles: 'payroll_officer',
    password: 'ChangeMe_demo_1',
  },
  {
    name: 'Nora Example',
    email: 'nora@example.invalid',
    roles: 'auditor',
    password: 'ChangeMe_demo_1',
  },
];

export function LoginPage() {
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Fetch accounts created on the server in development
  const demo = useQuery({
    queryKey: ['demo-accounts'],
    queryFn: () => api<DemoAccountsResponse>('/api/v1/setup/demo-accounts'),
    retry: false,
  });

  const accounts: DemoAccountItem[] =
    demo.data?.accounts && demo.data.accounts.length > 0
      ? demo.data.accounts
      : import.meta.env.DEV
        ? DEFAULT_DEMO_ACCOUNTS
        : [];

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
              Employees apply and track. HR decides. The office LAN is the network.
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
              <label htmlFor="lg-email">Work email</label>
              <input
                id="lg-email"
                className="input"
                type="email"
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
        {accounts.length > 0 ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h2 style={{ margin: 0, fontSize: 20, letterSpacing: '-0.02em' }}>Demo accounts</h2>
              <span
                style={{
                  fontSize: 11,
                  background: 'var(--status-neutral-bg, #f1f5f9)',
                  color: 'var(--status-neutral-fg, #475569)',
                  padding: '2px 8px',
                  borderRadius: 6,
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                }}
              >
                Testing Mode
              </span>
            </div>
            <p className="note" style={{ margin: 0 }}>
              Passcodes are revealed for testing. Select any account below to autofill or 1-click
              login.
            </p>
            <ul className="demo-list">
              {accounts.map((a) => {
                const accountPassword =
                  a.password ||
                  demo.data?.password ||
                  (a.email.startsWith('admin') ? 'ChangeMe_admin_1' : 'ChangeMe_demo_1');
                return (
                  <li key={a.email}>
                    <div
                      className="demo-account"
                      style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                        }}
                      >
                        <span className="demo-name" style={{ fontWeight: 600 }}>
                          {a.name}
                        </span>
                        <span className="mono demo-role">{a.roles}</span>
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          fontSize: 12,
                        }}
                      >
                        <span className="note demo-email">{a.email}</span>
                        <span
                          className="mono"
                          style={{
                            background: '#f8fafc',
                            border: '1px solid #e2e8f0',
                            padding: '2px 6px',
                            borderRadius: 4,
                            color: '#0f172a',
                            fontWeight: 600,
                            fontSize: 12,
                          }}
                        >
                          {accountPassword}
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                        <button
                          type="button"
                          className="button"
                          style={{
                            flex: 1,
                            height: 30,
                            fontSize: 12,
                            padding: '0 8px',
                            background: 'var(--bg-secondary, #f8fafc)',
                            border: '1px solid var(--border-default, #e2e8f0)',
                            borderRadius: 6,
                            cursor: 'pointer',
                            fontWeight: 500,
                          }}
                          onClick={() => {
                            setEmail(a.email);
                            setPassword(accountPassword);
                            setError(null);
                          }}
                        >
                          Fill Form
                        </button>
                        <button
                          type="button"
                          className="button"
                          style={{
                            flex: 1,
                            height: 30,
                            fontSize: 12,
                            padding: '0 8px',
                            background: 'var(--text-primary, #0f172a)',
                            color: '#ffffff',
                            border: 'none',
                            borderRadius: 6,
                            cursor: 'pointer',
                            fontWeight: 600,
                          }}
                          disabled={pending}
                          onClick={() => {
                            setEmail(a.email);
                            setPassword(accountPassword);
                            void performLogin(a.email, accountPassword);
                          }}
                        >
                          1-Click Login →
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
            <p className="note" style={{ margin: 0 }}>
              Each role sees a different application. Sign in as more than one to compare what they
              can and cannot do.
            </p>
          </>
        ) : (
          <>
            <h2 style={{ margin: 0, fontSize: 20, letterSpacing: '-0.02em' }}>
              This cycle, on this machine
            </h2>
            <div className="card">
              <p className="muted">No internet required</p>
              <p style={{ margin: 0, fontWeight: 600 }}>
                Core functions run on the office computer.
              </p>
            </div>
            <div className="card">
              <p className="muted">Email is a safety net</p>
              <p style={{ margin: 0, fontWeight: 600 }}>
                In-app notifications still work if mail is down.
              </p>
            </div>
            <div className="card">
              <p className="muted">Nothing is deleted</p>
              <p style={{ margin: 0, fontWeight: 600 }}>People are deactivated. History stays.</p>
            </div>
          </>
        )}
      </aside>
    </main>
  );
}
