import { Navigate, Route, Routes } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ErrorState, Skeleton } from '@sns/ui';
import { api, ApiError, can, type Me } from './api.js';
import { LoginPage } from './pages/Login.js';
import { SetupPage } from './pages/Setup.js';
import { Shell } from './pages/Shell.js';
import { HomePage } from './pages/Home.js';
import { ApplyPage } from './pages/Apply.js';
import { QueuePage } from './pages/Queue.js';
import { CalendarPage } from './pages/Calendar.js';
import { TeamPage } from './pages/Team.js';
import { PeoplePage } from './pages/People.js';
import { ReportsPage } from './pages/Reports.js';
import { AuditPage } from './pages/Audit.js';
import { SettingsPage } from './pages/Settings.js';
import { AttendancePage } from './pages/Attendance.js';

export function App() {
  const setup = useQuery({
    queryKey: ['setup'],
    queryFn: () => api<{ needsSetup: boolean }>('/api/v1/setup/status'),
  });
  const me = useQuery({
    queryKey: ['me'],
    queryFn: () => api<Me>('/api/v1/me'),
    retry: false,
  });

  if (setup.isPending) return <Skeleton />;
  if (setup.data?.needsSetup) return <SetupPage />;
  if (me.isPending) return <Skeleton />;
  if (me.isError) {
    const err = me.error;
    if (err instanceof ApiError && (err.status === 401 || err.code === 'UNAUTHENTICATED')) {
      return <LoginPage />;
    }
    if (err instanceof ApiError && err.code === 'NETWORK') {
      return (
        <main
          className="login-pane"
          style={{ minHeight: '100vh', maxWidth: 520, margin: '0 auto' }}
        >
          <ErrorState
            title="Cannot reach the Leave OS server"
            body="The office computer may be off, asleep, or disconnected from the network."
            requestId={err.requestId}
            onRetry={() => void me.refetch()}
          />
        </main>
      );
    }
  }
  if (!me.data) return <LoginPage />;

  return (
    <Shell me={me.data}>
      <Routes>
        <Route path="/" element={<HomePage me={me.data} />} />
        <Route path="/apply" element={<ApplyPage me={me.data} />} />
        <Route path="/requests" element={<QueuePage me={me.data} />} />
        <Route path="/requests/:id" element={<QueuePage me={me.data} />} />
        <Route path="/calendar" element={<CalendarPage me={me.data} />} />
        <Route path="/team" element={<TeamPage />} />
        <Route
          path="/people"
          element={
            can(me.data, 'employee.read:company') ||
            can(me.data, 'employee.read:reports_recursive') ? (
              <PeoplePage me={me.data} />
            ) : (
              <Navigate to="/" replace />
            )
          }
        />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/audit" element={<AuditPage />} />
        <Route path="/settings" element={<SettingsPage me={me.data} />} />
        <Route path="/attendance" element={<AttendancePage me={me.data} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  );
}
