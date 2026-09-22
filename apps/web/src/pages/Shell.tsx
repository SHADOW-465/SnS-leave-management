import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  CalendarDays,
  CheckCheck,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  FileBarChart,
  Grid3x3,
  LayoutDashboard,
  Menu,
  PlaneTakeoff,
  ScrollText,
  Settings,
  Timer,
  Users,
  XCircle,
  CheckSquare,
  Scale,
  GitBranch,
  KeyRound,
  History,
  UserRound,
} from 'lucide-react';
import { Button } from '@sns/ui';
import { api, can, type Me } from '../api.js';
import { formatRelativeTime } from '../format.js';

type NotificationItem = {
  id: string;
  recipient_user_id?: string;
  kind?: string | null;
  title: string;
  body: string;
  entity_type?: string | null;
  entity_id?: string | null;
  created_at: string;
  read_at: string | null;
};

type NavItem = {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  badge?: number;
  section?: string;
};

/** One nav built from what this person can actually do, grouped so each role sees its jobs. */
/**
 * One navigation, grouped the way the functional framework describes the three roles:
 * what everyone does for themselves, what a manager does for their people, and the HR /
 * administrator menu. Each person sees only the groups they can act in.
 */
function navFor(me: Me): NavItem[] {
  const staff = can(me, 'leave.request.approve') || can(me, 'leave.policy.manage');
  const items: NavItem[] = [
    {
      to: '/',
      label: staff ? 'Dashboard' : 'My dashboard',
      icon: LayoutDashboard,
      section: 'My leave',
    },
  ];
  if (me.employeeId) {
    items.push({ to: '/apply', label: 'Apply for leave', icon: PlaneTakeoff });
    items.push({ to: '/requests', label: 'My requests', icon: ClipboardList });
    if (!staff) items.push({ to: '/transactions', label: 'Leave history', icon: History });
  }
  items.push({
    to: '/calendar',
    label: staff ? 'Government holidays' : 'Holiday calendar',
    icon: CalendarDays,
  });
  if (me.approvesLeave) {
    items.push({
      to: '/approvals',
      label: 'Pending requests',
      icon: CheckSquare,
      badge: me.pendingApprovals,
      section: 'Approvals',
    });
  }
  items.push({
    to: '/team',
    label: 'Team leave calendar',
    icon: Grid3x3,
    ...(me.approvesLeave ? {} : { section: 'Team' }),
  });
  if (staff) {
    items.push({ to: '/people', label: 'Employees', icon: Users, section: 'HR & payroll' });
    items.push({ to: '/transactions', label: 'Leave transactions', icon: History });
    if (can(me, 'leave.balance.adjust')) {
      items.push({ to: '/allowances', label: 'Leave allowances', icon: Scale });
    }
    items.push({ to: '/reports', label: 'Payroll & annual reports', icon: FileBarChart });
    items.push({ to: '/attendance', label: 'Attendance', icon: Timer });
    items.push({ to: '/audit', label: 'Audit log', icon: ScrollText });
  } else if (can(me, 'report.leave.view')) {
    items.push({ to: '/reports', label: 'Reports', icon: FileBarChart, section: 'Reports' });
  }
  if (can(me, 'approval.routing.manage') || can(me, 'leave.policy.manage')) {
    items.push({
      to: '/settings',
      label: 'Leave configuration',
      icon: Settings,
      section: 'Administration',
    });
  }
  if (can(me, 'approval.routing.manage')) {
    items.push({ to: '/admin/routing', label: 'Reporting managers', icon: GitBranch });
    items.push({ to: '/admin/users', label: 'Users & access', icon: KeyRound });
  }
  return items;
}

function getNotificationIcon(n: NotificationItem) {
  const kind = n.kind ?? '';
  const title = n.title.toLowerCase();

  if (kind === 'leave.approved' || title.includes('approved')) {
    return {
      icon: CheckCircle2,
      bg: '#ecfdf5',
      color: '#059669',
      borderColor: '#a7f3d0',
    };
  }
  if (kind === 'leave.rejected' || title.includes('rejected')) {
    return {
      icon: XCircle,
      bg: '#fff1f2',
      color: '#e11d48',
      borderColor: '#fecdd3',
    };
  }
  if (
    kind === 'leave.submitted' ||
    title.includes('decision') ||
    title.includes('awaiting') ||
    title.includes('leave')
  ) {
    return {
      icon: CalendarDays,
      bg: '#eff6ff',
      color: '#2563eb',
      borderColor: '#bfdbfe',
    };
  }
  if (
    kind.startsWith('attendance') ||
    title.includes('attendance') ||
    title.includes('presence') ||
    title.includes('login')
  ) {
    return {
      icon: Timer,
      bg: '#eef2ff',
      color: '#4f46e5',
      borderColor: '#c7d2fe',
    };
  }
  if (kind.startsWith('calendar') || title.includes('holiday')) {
    return {
      icon: CalendarDays,
      bg: '#faf5ff',
      color: '#9333ea',
      borderColor: '#e9d5ff',
    };
  }
  if (kind.startsWith('employee') || title.includes('employee') || title.includes('staff')) {
    return {
      icon: Users,
      bg: '#f0fdf4',
      color: '#16a34a',
      borderColor: '#bbf7d0',
    };
  }
  return {
    icon: Bell,
    bg: '#f1f5f9',
    color: '#475569',
    borderColor: '#cbd5e1',
  };
}

function getNotificationDestination(n: NotificationItem): string {
  if (n.entity_type === 'leave_request') {
    return n.entity_id ? `/requests/${n.entity_id}` : '/requests';
  }
  if (n.entity_type === 'attendance_raw' || n.entity_type === 'attendance') {
    return '/attendance';
  }
  if (n.entity_type === 'holiday' || n.entity_type === 'calendar') {
    return '/calendar';
  }
  if (n.entity_type === 'employee') {
    return '/people';
  }
  // A request waiting for this person's decision opens in their approvals inbox.
  if (n.kind === 'leave.submitted' || n.kind === 'leave.reassigned') {
    return n.entity_id ? `/approvals/${n.entity_id}` : '/approvals';
  }
  if (n.kind?.startsWith('leave.')) {
    return n.entity_id ? `/requests/${n.entity_id}` : '/requests';
  }
  if (n.kind?.startsWith('attendance.')) {
    return '/attendance';
  }
  if (n.kind?.startsWith('calendar.')) {
    return '/calendar';
  }

  // Fallback text matching
  const text = `${n.title} ${n.body}`.toLowerCase();
  if (
    text.includes('leave') ||
    text.includes('request') ||
    text.includes('decision') ||
    text.includes('approval')
  ) {
    return n.entity_id ? `/requests/${n.entity_id}` : '/requests';
  }
  if (
    text.includes('attendance') ||
    text.includes('presence') ||
    text.includes('signal') ||
    text.includes('login')
  ) {
    return '/attendance';
  }
  if (text.includes('calendar') || text.includes('holiday')) {
    return '/calendar';
  }
  if (text.includes('employee') || text.includes('staff') || text.includes('probation')) {
    return '/people';
  }
  return '/requests';
}

export function Shell({ me, children }: { me: Me; children: ReactNode }) {
  const nav = navFor(me);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const loc = useLocation();
  const [open, setOpen] = useState(false);
  const [notifsOpen, setNotifsOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const bellBtnRef = useRef<HTMLButtonElement>(null);

  // A full page load, not a cache reset. Clearing React Query state leaves the previous
  // user's data in memory and (with `clear()`) does not even re-render, which is why
  // signing out appeared to do nothing. Reloading guarantees no stale state survives.
  function signOut() {
    setSigningOut(true);
    void api('/api/v1/auth/logout', { method: 'POST' })
      .catch(() => undefined) // the cookie is dead either way; never trap the user in the app
      .finally(() => {
        qc.clear();
        window.location.assign('/');
      });
  }

  const notifs = useQuery({
    queryKey: ['notifs'],
    queryFn: () => api<NotificationItem[]>('/api/v1/notifications'),
  });

  const unread = notifs.data?.filter((n) => !n.read_at).length ?? 0;

  const titles: Record<string, [string, string]> = {
    '/': can(me, 'leave.request.approve')
      ? ['Dashboard', 'What needs a decision today']
      : ['My dashboard', 'Your balance, requests, and holidays'],
    '/apply': ['Apply for leave', 'Working days are calculated before you submit'],
    '/requests': ['My requests', 'Status of everything you have applied for'],
    '/approvals': ['Pending requests', 'Leave waiting for your decision'],
    '/calendar': ['Holiday calendar', 'Government holidays and working days'],
    '/team': ['Team leave calendar', 'Who is in over the next fortnight'],
    '/people': ['Employees', 'Add and edit employees, departments and teams'],
    '/transactions': ['Leave transactions', 'Every credit, deduction and adjustment'],
    '/allowances': ['Leave allowances', 'How much leave each person has this year'],
    '/reports': ['Reports', 'Monthly payroll, annual leave and utilisation'],
    '/audit': ['Audit log', 'Append-only. Nothing here can be edited.'],
    '/settings': ['Leave configuration', 'Leave types, accrual, working week and leave year'],
    '/attendance': ['Attendance', 'Signals, not verdicts. A missing login is not an absence.'],
    '/admin/routing': ['Reporting managers', 'Who approves whose leave'],
    '/admin/users': ['Users & access', 'Sign-ins, roles and access'],
    '/profile': ['My profile', 'Your employee record'],
    '/password': ['Change password', 'Choose a new password'],
  };
  const base = `/${loc.pathname.split('/')[1] ?? ''}`;
  const [title, sub] = titles[loc.pathname] ?? titles[base] ?? ['Leave OS', me.companyName];

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    if (!notifsOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setNotifsOpen(false);
    };
    const onMousedown = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        bellBtnRef.current &&
        !bellBtnRef.current.contains(e.target as Node)
      ) {
        setNotifsOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onMousedown);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onMousedown);
    };
  }, [notifsOpen]);

  function handleNotificationClick(n: NotificationItem) {
    // 1. Mark notification as read if unread
    if (!n.read_at) {
      void api('/api/v1/notifications/read', {
        method: 'POST',
        body: JSON.stringify({ id: n.id }),
      }).then(() => {
        void qc.invalidateQueries({ queryKey: ['notifs'] });
      });
      // Optimistic local update in cache
      qc.setQueryData<NotificationItem[]>(['notifs'], (old) => {
        if (!old) return old;
        return old.map((item) =>
          item.id === n.id ? { ...item, read_at: new Date().toISOString() } : item,
        );
      });
    }

    // 2. Close notification dropdown
    setNotifsOpen(false);

    // 3. Navigate to target destination
    const dest = getNotificationDestination(n);
    void navigate(dest);
  }

  function handleMarkAllRead() {
    void api('/api/v1/notifications/read', { method: 'POST' }).then(() => {
      void qc.invalidateQueries({ queryKey: ['notifs'] });
    });
    // Optimistic cache update
    qc.setQueryData<NotificationItem[]>(['notifs'], (old) => {
      if (!old) return old;
      const nowIso = new Date().toISOString();
      return old.map((item) => ({ ...item, read_at: item.read_at ?? nowIso }));
    });
  }

  return (
    <div className="app-shell">
      <a href="#main" className="skip">
        Skip to main content
      </a>
      <button
        type="button"
        className="menu-btn"
        aria-label={open ? 'Close menu' : 'Open menu'}
        aria-expanded={open}
        aria-controls="primary-nav"
        onClick={() => setOpen((v) => !v)}
      >
        <Menu size={18} strokeWidth={1.75} aria-hidden />
      </button>
      <button
        type="button"
        className={open ? 'scrim open' : 'scrim'}
        aria-label="Close menu"
        onClick={() => setOpen(false)}
      />
      <nav id="primary-nav" aria-label="Primary" className={open ? 'nav open' : 'nav'}>
        <div className="brand" style={{ padding: '0 6px 8px' }}>
          <div className="mark">S</div>
          <span className="brand-name" style={{ fontSize: 14.5 }}>
            {me.companyName}
          </span>
        </div>
        <p
          className="mono"
          style={{
            margin: '4px 0 8px',
            padding: '0 8px',
            fontSize: 10.5,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--text-tertiary)',
          }}
        >
          {me.roles.join(' · ')}
        </p>
        {nav.map((item) => {
          const Icon = item.icon;
          return [
            item.section ? (
              <p key={`s-${item.section}`} className="nav-section">
                {item.section}
              </p>
            ) : null,
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `nav-link${isActive ? ' is-active' : ''}`}
              onClick={() => setOpen(false)}
            >
              <Icon size={16} strokeWidth={1.75} aria-hidden />
              {item.label}
              {item.badge ? <span className="nav-badge">{item.badge}</span> : null}
            </NavLink>,
          ];
        })}
        <div className="nav-foot">
          <NavLink
            to="/profile"
            className="nav-profile"
            title="Your profile"
            onClick={() => setOpen(false)}
          >
            <UserRound size={16} strokeWidth={1.75} aria-hidden />
            <span>
              <span className="nav-profile-name">{me.displayName}</span>
              <span className="note">{me.email}</span>
            </span>
          </NavLink>
          <Button size="sm" onClick={signOut} disabled={signingOut} style={{ width: '100%' }}>
            {signingOut ? 'Signing out…' : 'Sign out'}
          </Button>
        </div>
      </nav>
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <header className="topbar">
          <div style={{ minWidth: 0, flex: 1 }}>
            <h1>{title}</h1>
            <p className="note" style={{ margin: '2px 0 0' }}>
              {sub}
            </p>
          </div>
          {can(me, 'leave.request.create') ? (
            <Button variant="primary" onClick={() => void navigate('/apply')}>
              Apply for leave
            </Button>
          ) : null}
          <div style={{ position: 'relative' }}>
            <button
              ref={bellBtnRef}
              type="button"
              className="icon-btn"
              aria-label={unread ? `${unread} unread notifications` : 'Notifications'}
              aria-expanded={notifsOpen}
              onClick={() => setNotifsOpen((v) => !v)}
            >
              <Bell size={16} strokeWidth={1.75} aria-hidden />
              {unread ? <span className="badge">{unread}</span> : null}
            </button>
            {notifsOpen ? (
              <div
                ref={popoverRef}
                className="notif-pop"
                role="region"
                aria-label="Notifications"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  maxHeight: 460,
                }}
              >
                <div
                  className="card-head"
                  style={{
                    padding: '12px 14px',
                    borderBottom: '1px solid #e2e8f0',
                    background: '#f8fafc',
                    margin: 0,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <strong style={{ fontSize: 14 }}>Notifications</strong>
                    {unread > 0 ? (
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          padding: '1px 7px',
                          borderRadius: 999,
                          background: '#e0e7ff',
                          color: '#4338ca',
                        }}
                      >
                        {unread} new
                      </span>
                    ) : null}
                  </div>
                  {unread > 0 ? (
                    <Button
                      variant="ghost"
                      style={{ fontSize: 12, padding: '4px 8px', height: 'auto' }}
                      onClick={handleMarkAllRead}
                    >
                      <CheckCheck size={14} style={{ marginRight: 4 }} />
                      Mark all read
                    </Button>
                  ) : null}
                </div>
                <div
                  style={{
                    margin: 0,
                    padding: '6px',
                    overflowY: 'auto',
                    flex: 1,
                  }}
                >
                  {(notifs.data ?? []).length === 0 ? (
                    <div style={{ padding: '24px 16px', textAlign: 'center' }}>
                      <Bell
                        size={28}
                        strokeWidth={1.5}
                        style={{ color: 'var(--text-tertiary)', margin: '0 auto 8px' }}
                      />
                      <p style={{ margin: 0, fontWeight: 600, fontSize: 13.5 }}>Nothing waiting</p>
                      <p className="note" style={{ margin: '4px 0 0', fontSize: 12 }}>
                        New requests, approvals, and decisions appear here in real time.
                      </p>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {(notifs.data ?? []).map((n) => {
                        const styleInfo = getNotificationIcon(n);
                        const Icon = styleInfo.icon;
                        const isUnread = !n.read_at;
                        return (
                          <button
                            key={n.id}
                            type="button"
                            className={`notif-item${isUnread ? ' is-unread' : ''}`}
                            onClick={() => handleNotificationClick(n)}
                            title={`Go to ${getNotificationDestination(n)}`}
                          >
                            <div
                              className="notif-icon-wrap"
                              style={{
                                background: styleInfo.bg,
                                color: styleInfo.color,
                                border: `1px solid ${styleInfo.borderColor}`,
                              }}
                            >
                              <Icon size={15} strokeWidth={2} />
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  gap: 6,
                                  marginBottom: 2,
                                }}
                              >
                                <strong
                                  style={{
                                    fontSize: 13,
                                    fontWeight: isUnread ? 700 : 600,
                                    color: isUnread ? '#0f172a' : 'var(--text-primary)',
                                    lineHeight: 1.3,
                                  }}
                                >
                                  {n.title}
                                </strong>
                                {n.created_at ? (
                                  <span
                                    style={{
                                      fontSize: 11,
                                      color: isUnread ? '#4338ca' : 'var(--text-tertiary)',
                                      fontWeight: isUnread ? 600 : 400,
                                      whiteSpace: 'nowrap',
                                    }}
                                  >
                                    {formatRelativeTime(n.created_at)}
                                  </span>
                                ) : null}
                              </div>
                              <p
                                className="note"
                                style={{
                                  margin: 0,
                                  fontSize: 12.5,
                                  lineHeight: 1.4,
                                  color: isUnread ? '#334155' : 'var(--text-secondary)',
                                  display: '-webkit-box',
                                  WebkitLineClamp: 2,
                                  WebkitBoxOrient: 'vertical',
                                  overflow: 'hidden',
                                }}
                              >
                                {n.body}
                              </p>
                            </div>
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                alignSelf: 'center',
                                color: 'var(--text-tertiary)',
                                paddingLeft: 2,
                              }}
                            >
                              <ChevronRight size={15} />
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </header>
        <main id="main" tabIndex={-1} className="main">
          {children}
        </main>
      </div>
    </div>
  );
}
