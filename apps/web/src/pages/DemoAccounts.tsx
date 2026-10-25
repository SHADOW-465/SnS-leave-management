import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api.js';

/**
 * Local development only. Login.tsx renders this behind `import.meta.env.DEV`, so a
 * production build (including the hosted one) contains no sample accounts and no shared
 * password. The server also returns an empty list outside local dev and test.
 */
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
    name: 'Vijay Antony',
    email: 'admin@sns.test',
    roles: 'admin',
    title: 'IT Administrator',
    password: 'ChangeMe_admin_1',
  },
  {
    name: 'Anjusha R',
    email: 'anjusha@sns.test',
    roles: 'hr_officer',
    title: 'HR Manager',
    code: 'SNS-1041',
  },
  {
    name: 'Suresh Kumar',
    email: 'suresh@sns.test',
    roles: 'manager',
    title: 'Publishing Operations Manager',
    code: 'SNS-1001',
  },
  {
    name: 'Rajesh Menon',
    email: 'rajesh@sns.test',
    roles: 'director',
    title: 'Managing Director',
    code: 'SNS-1042',
  },
  {
    name: 'Arun Prakash',
    email: 'arun@sns.test',
    roles: 'employee',
    title: 'InDesign & Pagination Specialist',
    code: 'SNS-1003',
  },
  {
    name: 'Ramesh V',
    email: 'ramesh@sns.test',
    roles: 'payroll_officer',
    title: 'Senior Payroll Officer',
    code: 'SNS-1043',
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

export function DemoPanel({
  pending,
  onSignIn,
  fallback,
}: {
  pending: boolean;
  onSignIn: (email: string, password: string) => void;
  fallback: ReactNode;
}) {
  const demo = useQuery({
    queryKey: ['demo-accounts'],
    queryFn: () => api<DemoAccountsResponse>('/api/v1/setup/demo-accounts'),
    retry: false,
  });
  const accounts: DemoAccountItem[] = demo.data
    ? (demo.data.accounts ?? [])
    : DEFAULT_DEMO_ACCOUNTS;
  if (accounts.length === 0) return fallback;
  return (
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
        administrator uses <span className="mono">ChangeMe_admin_1</span>), or with username or
        employee ID instead of email.
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
                  onSignIn(a.email, accountPassword);
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
        Click a person to sign in as them. Try Arun (employee) → Suresh (his manager) → Anjusha (HR)
        → Vijay Antony (administrator) to follow a request end to end.
      </p>
    </>
  );
}
