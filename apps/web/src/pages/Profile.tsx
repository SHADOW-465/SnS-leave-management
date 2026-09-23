import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ErrorState, Skeleton } from '@sns/ui';
import { api } from '../api.js';

type Profile = {
  email: string;
  roles: string[];
  employee: {
    code: string;
    name: string;
    workEmail: string;
    phone: string | null;
    department: string;
    team: string | null;
    designation: string | null;
    category: string | null;
    location: string | null;
    joinedOn: string;
    status: string;
    probationEndOn: string | null;
    reportingManager: string | null;
    leaveGoesTo: string;
  } | null;
};

const ROLE_NAMES: Record<string, string> = {
  employee: 'Employee',
  manager: 'Manager',
  hr_officer: 'HR',
  payroll_officer: 'Payroll',
  admin: 'Administrator',
  director: 'Managing Director',
  auditor: 'Auditor',
};

/** The person's own record. Changes go through HR; the password is theirs to change. */
export function ProfilePage() {
  const q = useQuery({ queryKey: ['profile'], queryFn: () => api<Profile>('/api/v1/profile') });
  if (q.isLoading) return <Skeleton rows={6} />;
  if (q.isError || !q.data)
    return (
      <ErrorState
        title="Could not load your profile"
        body={q.error instanceof Error ? q.error.message : 'Try again in a moment.'}
        onRetry={() => void q.refetch()}
      />
    );
  const { employee: e, email, roles } = q.data;
  const rows: [string, string | null | undefined][] = e
    ? [
        ['Employee ID', e.code],
        ['Department', e.department],
        ['Team', e.team],
        ['Designation', e.designation],
        ['Staff category', e.category],
        ['Reporting manager', e.reportingManager ?? 'Not assigned'],
        ['Your leave goes to', e.leaveGoesTo],
        ['Date of joining', e.joinedOn],
        [
          'Status',
          e.status === 'probation' ? `On probation until ${e.probationEndOn ?? '—'}` : e.status,
        ],
        ['Work email', e.workEmail],
        ['Mobile', e.phone],
        ['Location', e.location],
      ]
    : [['Sign-in', email]];
  return (
    <div className="profile">
      <section className="card">
        <h1>{e?.name ?? email}</h1>
        <p className="muted">
          Signs in as {email}
          {e ? ` or ${e.code}` : ''} · {roles.map((r) => ROLE_NAMES[r] ?? r).join(', ')}
        </p>
        <dl>
          {rows.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v || '—'}</dd>
            </div>
          ))}
        </dl>
        <p className="muted small">
          Something wrong? HR updates your record. <Link to="/password">Change your password</Link>
        </p>
      </section>
      <style>{`
        .profile .card { background:#fff; border:1px solid var(--border-subtle); border-radius:12px; padding:20px 22px; max-width:720px; }
        .profile h1 { margin:0 0 4px; font-size:22px; }
        .profile .muted { color:var(--text-secondary); }
        .profile .small { font-size:12.5px; }
        .profile dl { display:grid; grid-template-columns:repeat(auto-fit, minmax(260px, 1fr)); gap:12px 24px; margin:18px 0; }
        .profile dt { font-size:12px; color:var(--text-tertiary); text-transform:uppercase; letter-spacing:.04em; }
        .profile dd { margin:2px 0 0; font-size:14px; }
      `}</style>
    </div>
  );
}
