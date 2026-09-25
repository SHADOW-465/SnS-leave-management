import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@sns/ui';
import { api, ApiError } from '../api.js';

type DemoAccountItem = {
  email: string;
  name: string;
  roles: string;
  title?: string | null;
  code?: string | null;
  department?: string | null;
  password?: string;
};

type DemoAccountsResponse = {
  password: string;
  accounts: DemoAccountItem[];
};

/** Used only if the server list cannot be fetched while developing. */
const DEFAULT_DEMO_ACCOUNTS: DemoAccountItem[] = [
  {
    name: 'Arjun Das',
    email: 'admin@sns.test',
    roles: 'admin',
    title: 'Administrator',
    password: 'ChangeMe_admin_1',
  },
  {
    name: 'Anitha Joseph',
    email: 'anitha@sns.test',
    roles: 'hr_officer',
    title: 'HR Manager',
    code: 'SNS-1015',
  },
  {
    name: 'David Fernandes',
    email: 'david@sns.test',
    roles: 'manager',
    title: 'Production Manager',
    code: 'SNS-1002',
  },
  {
    name: 'John Mathew',
    email: 'john@sns.test',
    roles: 'manager',
    title: 'Printing Supervisor',
    code: 'SNS-1003',
  },
  {
    name: 'Vijay Anand',
    email: 'vijay@sns.test',
    roles: 'employee',
    title: 'Machine Operator',
    code: 'SNS-1005',
  },
  {
    name: 'Ramesh Nagarajan',
    email: 'ramesh@sns.test',
    roles: 'payroll_officer',
    title: 'Payroll Accountant',
    code: 'SNS-1016',
  },
];

const ROLE_LABEL: Record<string, string> = {
  admin: 'Administrator',
  director: 'Managing Director',
  hr_officer: 'HR',
  manager: 'Manager',
  employee: 'Employee',
  payroll_officer: 'Payroll',
  auditor: 'Auditor',
};

/** What each demo person is useful for testing, in a few words. */
function demoHint(a: DemoAccountItem): string {
  if (a.roles.includes('admin')) return 'Reporting managers, users, leave configuration';
  if (a.roles.includes('director')) return 'Approves HR’s leave; sees leave across the company';
  if (a.roles.includes('hr_officer')) return 'Employees, holidays, payroll reports';
  if (a.roles.includes('payroll_officer')) return 'Monthly payroll report and export';
  if (a.roles.includes('auditor')) return 'Read-only access and the audit log';
  if (a.roles.includes('manager')) return 'Approves their team’s leave; their own goes to HR';
  return 'Applies for leave, sees balance and history';
}

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

  const accounts: DemoAccountItem[] = demo.data
    ? (demo.data.accounts ?? [])
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
              Simon &amp; Sons, a sample printing and publishing house. Everyone signs in with the
              password <span className="mono">{demo.data?.password || 'ChangeMe_demo_1'}</span> (the
              administrator uses <span className="mono">ChangeMe_admin_1</span>), or with username
              or employee ID instead of email.
            </p>
            <ul className="demo-list demo-compact">
              {accounts.map((a) => {
                const accountPassword =
                  a.password ||
                  demo.data?.password ||
                  (a.email.startsWith('admin') ? 'ChangeMe_admin_1' : 'ChangeMe_demo_1');
                const role = a.roles.split(',')[0]?.trim() ?? 'employee';
                return (
                  <li key={a.email}>
                    <button
                      type="button"
                      className="demo-row"
                      disabled={pending}
                      title={`Sign in as ${a.name}`}
                      onClick={() => {
                        setEmail(a.email);
                        setPassword(accountPassword);
                        void performLogin(a.email, accountPassword);
                      }}
                    >
                      <span className="demo-main">
                        <span className="demo-name">{a.name}</span>
                        <span className="note">
                          {[a.title, a.department, a.code].filter(Boolean).join(' · ')}
                        </span>
                        <span className="demo-hint">{demoHint(a)}</span>
                      </span>
                      <span className={`demo-role role-${role}`}>{ROLE_LABEL[role] ?? role}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <p className="note" style={{ margin: 0 }}>
              Click a person to sign in as them. Try Vijay (employee) → John (his manager) → Anitha
              (HR) → Arjun (administrator) to follow a request end to end.
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
