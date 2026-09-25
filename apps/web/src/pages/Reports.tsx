import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api.js';
import { Button, Select, StatusPill, Skeleton, EmptyState, ErrorState } from '@sns/ui';
import {
  FileSpreadsheet,
  FileText,
  Download,
  Printer,
  Search,
  Users,
  Calendar,
  TrendingUp,
  Clock,
  ShieldCheck,
  Building2,
  PieChart,
  BarChart3,
  X,
} from 'lucide-react';

type ReportsResponse = {
  period: { id: string; label: string; startsOn: string; endsOn: string } | null;
  cards: { label: string; value: string; note: string }[];
  summary: {
    totalApprovedDays: number;
    totalApprovedRequests: number;
    pendingCount: number;
    pendingDays: number;
    activeEmployeesCount: number;
    avgDaysPerEmployee: string;
    selfApprovalsCount: number;
    rejectedCount: number;
    mostUsedLeaveType: string;
  };
  byMonth: {
    ym: string;
    label: string;
    days: number;
    half: number;
    requestCount: number;
    employeeCount: number;
  }[];
  byDepartment: {
    id: string;
    code: string;
    name: string;
    headcount: number;
    totalDaysTaken: number;
    avgDaysPerEmployee: string;
    requestCount: number;
  }[];
  byLeaveType: {
    id: string;
    code: string;
    name: string;
    colourToken: string;
    totalDaysTaken: number;
    percentOfTotal: number;
    requestCount: number;
    employeeCount: number;
  }[];
  employeeSummaries: {
    id: string;
    code: string;
    name: string;
    departmentId: string;
    departmentName: string;
    teamName: string;
    status: string;
    joinedOn: string;
    entitlementDays: number;
    takenDays: number;
    remainingDays: number;
    pendingDays: number;
  }[];
  payroll: {
    year: number;
    month: number;
    ym: string;
    label: string;
    rows: {
      employeeId: string;
      employeeCode: string;
      name: string;
      department: string;
      opening: number;
      earned: number;
      used: number;
      leaveTaken?: number;
      lossOfPay?: number;
      permissionHours?: number;
      pending: number;
      closing: number;
    }[];
  };
};

type ActiveTab = 'overview' | 'departments' | 'leaveTypes' | 'balances' | 'payroll' | 'annual';

export function ReportsPage() {
  const now = new Date();
  const [activeTab, setActiveTab] = useState<ActiveTab>('overview');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedDeptId, setSelectedDeptId] = useState('all');
  const [selectedStatus, setSelectedStatus] = useState('all');
  const [payrollYear, setPayrollYear] = useState(now.getFullYear());
  const [payrollMonth, setPayrollMonth] = useState(now.getMonth() + 1);

  const qs = `year=${payrollYear}&month=${payrollMonth}`;
  const { data, isPending, isError, error, refetch } = useQuery<ReportsResponse>({
    queryKey: ['reports', payrollYear, payrollMonth],
    queryFn: () => api<ReportsResponse>(`/api/v1/reports?${qs}`),
  });

  const departmentOptions = useMemo(() => {
    if (!data?.byDepartment) return [{ value: 'all', label: 'All Departments' }];
    return [
      { value: 'all', label: 'All Departments' },
      ...data.byDepartment.map((d) => ({
        value: d.id,
        label: `${d.name} (${d.code})`,
      })),
    ];
  }, [data?.byDepartment]);

  const statusOptions = useMemo(
    () => [
      { value: 'all', label: 'All Statuses' },
      { value: 'active', label: 'Active' },
      { value: 'probation', label: 'Probation' },
      { value: 'notice', label: 'Notice' },
      { value: 'exited', label: 'Exited' },
    ],
    [],
  );

  const filteredEmployees = useMemo(() => {
    if (!data?.employeeSummaries) return [];
    return data.employeeSummaries.filter((emp) => {
      const matchesSearch =
        !searchTerm.trim() ||
        emp.name.toLowerCase().includes(searchTerm.toLowerCase().trim()) ||
        emp.code.toLowerCase().includes(searchTerm.toLowerCase().trim()) ||
        emp.departmentName.toLowerCase().includes(searchTerm.toLowerCase().trim()) ||
        emp.teamName.toLowerCase().includes(searchTerm.toLowerCase().trim());

      const matchesDept = selectedDeptId === 'all' || emp.departmentId === selectedDeptId;
      const matchesStatus = selectedStatus === 'all' || emp.status === selectedStatus;

      return matchesSearch && matchesDept && matchesStatus;
    });
  }, [data?.employeeSummaries, searchTerm, selectedDeptId, selectedStatus]);

  if (isPending) {
    return <Skeleton rows={8} />;
  }

  if (isError || !data) {
    return (
      <div style={{ padding: '24px 0' }}>
        <ErrorState
          title="Unable to load reports"
          body={error instanceof Error ? error.message : 'Failed to retrieve leave reporting data.'}
          onRetry={() => {
            void refetch();
          }}
        />
      </div>
    );
  }

  const { summary, byMonth, byDepartment, byLeaveType, period } = data;
  const maxMonthDays = Math.max(1, ...(byMonth.map((m) => m.days) ?? [1]));
  const maxDeptDays = Math.max(1, ...(byDepartment.map((d) => d.totalDaysTaken) ?? [1]));

  return (
    <div className="reports-page">
      {/* Header & Export Actions Bar */}
      <div className="reports-header-row">
        <div className="reports-title-area">
          <h1 className="reports-title">
            <BarChart3 size={24} style={{ color: 'var(--accent-default, #3b82f6)' }} />
            Reports & Analytics
          </h1>
          <p className="reports-subtitle">
            Executive leave metrics, department utilization, leave balances, and audit compliance.
          </p>
          <div className="reports-period-badge">
            <Calendar size={13} />
            <span>Reporting Period: {period?.label ?? 'Active Period'}</span>
          </div>
        </div>

        <div className="reports-actions-group">
          <a
            href={`/api/v1/reports/export.xlsx?${qs}`}
            download="leave-report.xlsx"
            className="reports-export-btn reports-export-excel"
            title="Download detailed multi-sheet Excel spreadsheet with all tables and metrics"
          >
            <FileSpreadsheet size={15} />
            <span>Export Excel (.xlsx)</span>
          </a>

          <a
            href={`/api/v1/reports/export.pdf?${qs}`}
            download="leave-report.pdf"
            className="reports-export-btn reports-export-pdf"
            title="Download formatted executive PDF summary report"
          >
            <FileText size={15} />
            <span>Export PDF (.pdf)</span>
          </a>

          <a
            href={`/api/v1/reports/export.csv?${qs}`}
            download="leave-report.csv"
            className="reports-export-btn reports-export-csv"
            title="Download CSV of employee balances"
          >
            <Download size={15} />
            <span>CSV</span>
          </a>

          <button
            type="button"
            onClick={() => window.print()}
            className="reports-export-btn reports-export-csv"
            title="Print or save this report via browser print"
          >
            <Printer size={15} />
            <span>Print</span>
          </button>
        </div>
      </div>

      {/* Executive KPI Ribbon */}
      <div className="reports-kpi-ribbon">
        <div className="reports-kpi-card">
          <div className="reports-kpi-top">
            <span className="reports-kpi-label">Total Leave Taken</span>
            <TrendingUp size={16} className="reports-kpi-icon" />
          </div>
          <p className="reports-kpi-val">
            {summary.totalApprovedDays}{' '}
            <span style={{ fontSize: '15px', fontWeight: 500, color: 'var(--text-secondary)' }}>
              Days
            </span>
          </p>
          <p className="reports-kpi-note">{summary.totalApprovedRequests} approved requests</p>
        </div>

        <div className="reports-kpi-card">
          <div className="reports-kpi-top">
            <span className="reports-kpi-label">Active Headcount</span>
            <Users size={16} className="reports-kpi-icon" />
          </div>
          <p className="reports-kpi-val">
            {summary.activeEmployeesCount}{' '}
            <span style={{ fontSize: '15px', fontWeight: 500, color: 'var(--text-secondary)' }}>
              Staff
            </span>
          </p>
          <p className="reports-kpi-note">Across {byDepartment.length} departments</p>
        </div>

        <div className="reports-kpi-card">
          <div className="reports-kpi-top">
            <span className="reports-kpi-label">Avg Days / Staff</span>
            <PieChart size={16} className="reports-kpi-icon" />
          </div>
          <p className="reports-kpi-val">
            {summary.avgDaysPerEmployee}{' '}
            <span style={{ fontSize: '15px', fontWeight: 500, color: 'var(--text-secondary)' }}>
              Days
            </span>
          </p>
          <p className="reports-kpi-note">Average leave density</p>
        </div>

        <div
          className="reports-kpi-card"
          style={
            summary.pendingCount > 0 ? { borderColor: '#fed7aa', background: '#fffbeb' } : undefined
          }
        >
          <div className="reports-kpi-top">
            <span
              className="reports-kpi-label"
              style={summary.pendingCount > 0 ? { color: '#b45309' } : undefined}
            >
              Pending Approvals
            </span>
            <Clock
              size={16}
              className="reports-kpi-icon"
              style={summary.pendingCount > 0 ? { color: '#b45309' } : undefined}
            />
          </div>
          <p
            className="reports-kpi-val"
            style={summary.pendingCount > 0 ? { color: '#b45309' } : undefined}
          >
            {summary.pendingCount}
          </p>
          <p className="reports-kpi-note">{summary.pendingDays} days awaiting decision</p>
        </div>

        <div className="reports-kpi-card">
          <div className="reports-kpi-top">
            <span className="reports-kpi-label">Audit & Compliance</span>
            <ShieldCheck size={16} className="reports-kpi-icon" />
          </div>
          <p className="reports-kpi-val" style={{ fontSize: '20px' }}>
            {summary.mostUsedLeaveType}
          </p>
          <p className="reports-kpi-note">{summary.selfApprovalsCount} self-approvals (DW-32)</p>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="reports-tabs-nav">
        <button
          type="button"
          className={`reports-tab-btn ${activeTab === 'overview' ? 'is-active' : ''}`}
          onClick={() => setActiveTab('overview')}
        >
          <BarChart3 size={16} />
          <span>Monthly Trends</span>
          <span className="reports-tab-badge">{byMonth.length}</span>
        </button>

        <button
          type="button"
          className={`reports-tab-btn ${activeTab === 'departments' ? 'is-active' : ''}`}
          onClick={() => setActiveTab('departments')}
        >
          <Building2 size={16} />
          <span>Department Breakdown</span>
          <span className="reports-tab-badge">{byDepartment.length}</span>
        </button>

        <button
          type="button"
          className={`reports-tab-btn ${activeTab === 'leaveTypes' ? 'is-active' : ''}`}
          onClick={() => setActiveTab('leaveTypes')}
        >
          <PieChart size={16} />
          <span>Leave Types</span>
          <span className="reports-tab-badge">{byLeaveType.length}</span>
        </button>

        <button
          type="button"
          className={`reports-tab-btn ${activeTab === 'balances' ? 'is-active' : ''}`}
          onClick={() => setActiveTab('balances')}
        >
          <Users size={16} />
          <span>Employee Leave Balances</span>
          <span className="reports-tab-badge">{data.employeeSummaries.length}</span>
        </button>

        <button
          type="button"
          className={`reports-tab-btn ${activeTab === 'payroll' ? 'is-active' : ''}`}
          onClick={() => setActiveTab('payroll')}
        >
          <FileSpreadsheet size={16} />
          <span>Monthly Payroll</span>
          <span className="reports-tab-badge">{data.payroll.rows.length}</span>
        </button>

        <button
          type="button"
          className={`reports-tab-btn ${activeTab === 'annual' ? 'is-active' : ''}`}
          onClick={() => setActiveTab('annual')}
        >
          <FileSpreadsheet size={16} />
          <span>Annual Leave Report</span>
        </button>
      </div>

      {/* TAB 1: OVERVIEW & MONTHLY TRENDS */}
      {activeTab === 'overview' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card">
            <div className="card-head" style={{ borderBottom: 'none', padding: '0 0 12px 0' }}>
              <div>
                <h2 style={{ fontSize: '16px', margin: 0 }}>Approved Leave Days by Month</h2>
                <p className="dim" style={{ fontSize: '13px', margin: '2px 0 0 0' }}>
                  Visual distribution of taken leave across reporting months. Hover over bars to
                  view detailed counts.
                </p>
              </div>
            </div>

            {byMonth.length === 0 ? (
              <p className="dim" style={{ padding: '32px 0', textAlign: 'center' }}>
                No approved leave data recorded yet.
              </p>
            ) : (
              <>
                <div
                  className="reports-chart-box"
                  role="img"
                  aria-label="Monthly leave distribution chart"
                >
                  {byMonth.map((m) => {
                    const heightPx = Math.max(8, Math.round((m.days / maxMonthDays) * 175));
                    return (
                      <div key={m.ym} className="reports-chart-bar-col">
                        <div className="reports-bar-tooltip">
                          <strong>{m.ym}</strong>: {m.days} days ({m.requestCount} requests,{' '}
                          {m.employeeCount} staff)
                        </div>
                        <div className="reports-chart-bar" style={{ height: `${heightPx}px` }} />
                        <span
                          style={{
                            fontSize: '11px',
                            fontFamily: 'var(--font-mono)',
                            color: 'var(--text-secondary)',
                          }}
                        >
                          {m.label}
                        </span>
                      </div>
                    );
                  })}
                </div>

                <div style={{ overflowX: 'auto', marginTop: 16 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13.5px' }}>
                    <thead>
                      <tr
                        style={{
                          borderBottom: '1px solid var(--border-subtle, #e2e8f0)',
                          textAlign: 'left',
                        }}
                      >
                        <th
                          style={{
                            padding: '10px 12px',
                            color: 'var(--text-secondary)',
                            fontWeight: 600,
                          }}
                        >
                          Year-Month
                        </th>
                        <th
                          style={{
                            padding: '10px 12px',
                            color: 'var(--text-secondary)',
                            fontWeight: 600,
                          }}
                        >
                          Month
                        </th>
                        <th
                          style={{
                            padding: '10px 12px',
                            color: 'var(--text-secondary)',
                            fontWeight: 600,
                            textAlign: 'right',
                          }}
                        >
                          Approved Days
                        </th>
                        <th
                          style={{
                            padding: '10px 12px',
                            color: 'var(--text-secondary)',
                            fontWeight: 600,
                            textAlign: 'right',
                          }}
                        >
                          Requests
                        </th>
                        <th
                          style={{
                            padding: '10px 12px',
                            color: 'var(--text-secondary)',
                            fontWeight: 600,
                            textAlign: 'right',
                          }}
                        >
                          Employees Out
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {byMonth.map((m) => (
                        <tr
                          key={m.ym}
                          style={{ borderBottom: '1px solid var(--border-subtle, #f1f5f9)' }}
                        >
                          <td
                            style={{
                              padding: '10px 12px',
                              fontFamily: 'var(--font-mono)',
                              fontWeight: 600,
                            }}
                          >
                            {m.ym}
                          </td>
                          <td style={{ padding: '10px 12px' }}>{m.label}</td>
                          <td
                            style={{
                              padding: '10px 12px',
                              textAlign: 'right',
                              fontWeight: 600,
                              fontVariantNumeric: 'tabular-nums',
                            }}
                          >
                            {m.days}
                          </td>
                          <td
                            style={{
                              padding: '10px 12px',
                              textAlign: 'right',
                              fontVariantNumeric: 'tabular-nums',
                            }}
                          >
                            {m.requestCount}
                          </td>
                          <td
                            style={{
                              padding: '10px 12px',
                              textAlign: 'right',
                              fontVariantNumeric: 'tabular-nums',
                            }}
                          >
                            {m.employeeCount}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: DEPARTMENT BREAKDOWN */}
      {activeTab === 'departments' && (
        <div className="card">
          <div className="card-head" style={{ borderBottom: 'none', padding: '0 0 16px 0' }}>
            <div>
              <h2 style={{ fontSize: '16px', margin: 0 }}>Department Leave & Utilization</h2>
              <p className="dim" style={{ fontSize: '13px', margin: '2px 0 0 0' }}>
                Comparative breakdown of leave taken, active headcount, and average days per
                employee by department.
              </p>
            </div>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13.5px' }}>
              <thead>
                <tr
                  style={{
                    borderBottom: '1px solid var(--border-subtle, #e2e8f0)',
                    textAlign: 'left',
                  }}
                >
                  <th
                    style={{
                      padding: '10px 12px',
                      color: 'var(--text-secondary)',
                      fontWeight: 600,
                    }}
                  >
                    Code
                  </th>
                  <th
                    style={{
                      padding: '10px 12px',
                      color: 'var(--text-secondary)',
                      fontWeight: 600,
                    }}
                  >
                    Department
                  </th>
                  <th
                    style={{
                      padding: '10px 12px',
                      color: 'var(--text-secondary)',
                      fontWeight: 600,
                      textAlign: 'right',
                    }}
                  >
                    Headcount
                  </th>
                  <th
                    style={{
                      padding: '10px 12px',
                      color: 'var(--text-secondary)',
                      fontWeight: 600,
                      textAlign: 'right',
                    }}
                  >
                    Total Days Taken
                  </th>
                  <th
                    style={{
                      padding: '10px 12px',
                      color: 'var(--text-secondary)',
                      fontWeight: 600,
                      textAlign: 'right',
                    }}
                  >
                    Avg Days / Staff
                  </th>
                  <th
                    style={{
                      padding: '10px 12px',
                      color: 'var(--text-secondary)',
                      fontWeight: 600,
                      textAlign: 'right',
                    }}
                  >
                    Requests
                  </th>
                  <th
                    style={{
                      padding: '10px 12px',
                      color: 'var(--text-secondary)',
                      fontWeight: 600,
                      width: '180px',
                    }}
                  >
                    Utilization Share
                  </th>
                </tr>
              </thead>
              <tbody>
                {byDepartment.map((d) => {
                  const sharePct =
                    summary.totalApprovedDays > 0
                      ? Math.round((d.totalDaysTaken / summary.totalApprovedDays) * 100)
                      : 0;
                  return (
                    <tr
                      key={d.id}
                      style={{ borderBottom: '1px solid var(--border-subtle, #f1f5f9)' }}
                    >
                      <td
                        style={{
                          padding: '10px 12px',
                          fontFamily: 'var(--font-mono)',
                          fontWeight: 600,
                        }}
                      >
                        <span
                          style={{
                            padding: '2px 6px',
                            background: '#f1f5f9',
                            borderRadius: '4px',
                            fontSize: '12px',
                          }}
                        >
                          {d.code}
                        </span>
                      </td>
                      <td
                        style={{
                          padding: '10px 12px',
                          fontWeight: 600,
                          color: 'var(--text-primary)',
                        }}
                      >
                        {d.name}
                      </td>
                      <td
                        style={{
                          padding: '10px 12px',
                          textAlign: 'right',
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        {d.headcount}
                      </td>
                      <td
                        style={{
                          padding: '10px 12px',
                          textAlign: 'right',
                          fontWeight: 600,
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        {d.totalDaysTaken}
                      </td>
                      <td
                        style={{
                          padding: '10px 12px',
                          textAlign: 'right',
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        {d.avgDaysPerEmployee}
                      </td>
                      <td
                        style={{
                          padding: '10px 12px',
                          textAlign: 'right',
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        {d.requestCount}
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div className="reports-progress-container" style={{ flex: 1 }}>
                            <div
                              className="reports-progress-fill"
                              style={{
                                ['--fill' as string]: Math.min(
                                  1,
                                  maxDeptDays > 0 ? d.totalDaysTaken / maxDeptDays : 0,
                                ),
                              }}
                            />
                          </div>
                          <span
                            style={{
                              fontSize: '11px',
                              color: 'var(--text-secondary)',
                              width: '32px',
                              textAlign: 'right',
                            }}
                          >
                            {sharePct}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: LEAVE TYPE DISTRIBUTION */}
      {activeTab === 'leaveTypes' && (
        <div className="card">
          <div className="card-head" style={{ borderBottom: 'none', padding: '0 0 16px 0' }}>
            <div>
              <h2 style={{ fontSize: '16px', margin: 0 }}>Leave Type Distribution</h2>
              <p className="dim" style={{ fontSize: '13px', margin: '2px 0 0 0' }}>
                Usage volume, share of total leave, and number of requesting employees across leave
                categories.
              </p>
            </div>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13.5px' }}>
              <thead>
                <tr
                  style={{
                    borderBottom: '1px solid var(--border-subtle, #e2e8f0)',
                    textAlign: 'left',
                  }}
                >
                  <th
                    style={{
                      padding: '10px 12px',
                      color: 'var(--text-secondary)',
                      fontWeight: 600,
                    }}
                  >
                    Category
                  </th>
                  <th
                    style={{
                      padding: '10px 12px',
                      color: 'var(--text-secondary)',
                      fontWeight: 600,
                    }}
                  >
                    Code
                  </th>
                  <th
                    style={{
                      padding: '10px 12px',
                      color: 'var(--text-secondary)',
                      fontWeight: 600,
                      textAlign: 'right',
                    }}
                  >
                    Total Days Taken
                  </th>
                  <th
                    style={{
                      padding: '10px 12px',
                      color: 'var(--text-secondary)',
                      fontWeight: 600,
                      textAlign: 'right',
                    }}
                  >
                    Requests
                  </th>
                  <th
                    style={{
                      padding: '10px 12px',
                      color: 'var(--text-secondary)',
                      fontWeight: 600,
                      textAlign: 'right',
                    }}
                  >
                    Employees
                  </th>
                  <th
                    style={{
                      padding: '10px 12px',
                      color: 'var(--text-secondary)',
                      fontWeight: 600,
                      width: '220px',
                    }}
                  >
                    % of Company Leave
                  </th>
                </tr>
              </thead>
              <tbody>
                {byLeaveType.map((t) => (
                  <tr
                    key={t.id}
                    style={{ borderBottom: '1px solid var(--border-subtle, #f1f5f9)' }}
                  >
                    <td style={{ padding: '10px 12px', fontWeight: 600 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span
                          style={{
                            width: 10,
                            height: 10,
                            borderRadius: '50%',
                            background: t.colourToken || '#3b82f6',
                            display: 'inline-block',
                          }}
                        />
                        <span>{t.name}</span>
                      </div>
                    </td>
                    <td style={{ padding: '10px 12px', fontFamily: 'var(--font-mono)' }}>
                      <span
                        style={{
                          padding: '2px 6px',
                          background: '#f1f5f9',
                          borderRadius: '4px',
                          fontSize: '12px',
                        }}
                      >
                        {t.code}
                      </span>
                    </td>
                    <td
                      style={{
                        padding: '10px 12px',
                        textAlign: 'right',
                        fontWeight: 600,
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {t.totalDaysTaken}
                    </td>
                    <td
                      style={{
                        padding: '10px 12px',
                        textAlign: 'right',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {t.requestCount}
                    </td>
                    <td
                      style={{
                        padding: '10px 12px',
                        textAlign: 'right',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {t.employeeCount}
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div className="reports-progress-container" style={{ flex: 1 }}>
                          <div
                            className="reports-progress-fill"
                            style={{
                              ['--fill' as string]: Math.min(1, t.percentOfTotal / 100),
                              background: t.colourToken || 'var(--accent-default, #3b82f6)',
                            }}
                          />
                        </div>
                        <span
                          style={{
                            fontSize: '11px',
                            color: 'var(--text-secondary)',
                            width: '36px',
                            textAlign: 'right',
                            fontWeight: 600,
                          }}
                        >
                          {t.percentOfTotal}%
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 4: EMPLOYEE LEAVE BALANCES */}
      {activeTab === 'balances' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Search and Filters Bar */}
          <div className="reports-filter-bar">
            <div className="reports-search-wrap">
              <Search size={15} />
              <input
                type="text"
                className="reports-search-input"
                placeholder="Search by employee name, code, department, or team…"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  style={{
                    position: 'absolute',
                    right: 10,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--text-tertiary)',
                  }}
                  title="Clear search"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            <div style={{ minWidth: 200 }}>
              <Select
                options={departmentOptions}
                value={selectedDeptId}
                onChange={setSelectedDeptId}
                placeholder="Filter department…"
              />
            </div>

            <div style={{ minWidth: 150 }}>
              <Select
                options={statusOptions}
                value={selectedStatus}
                onChange={setSelectedStatus}
                placeholder="Filter status…"
              />
            </div>

            {(searchTerm || selectedDeptId !== 'all' || selectedStatus !== 'all') && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearchTerm('');
                  setSelectedDeptId('all');
                  setSelectedStatus('all');
                }}
              >
                Clear Filters
              </Button>
            )}
          </div>

          {/* Balances Results Table */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div
              style={{
                padding: '12px 18px',
                borderBottom: '1px solid var(--border-subtle, #e2e8f0)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <span style={{ fontSize: '13px', color: 'var(--text-secondary)', fontWeight: 550 }}>
                Showing {filteredEmployees.length} of {data.employeeSummaries.length} employees
              </span>
              <span style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>
                Earned leave for {period?.label ?? 'this leave year'} (monthly credit, not every
                leave type added together)
              </span>
            </div>

            {filteredEmployees.length === 0 ? (
              <div style={{ padding: '40px 18px' }}>
                <EmptyState
                  title="No matching employees found"
                  body="Try changing or clearing your search term or department filters."
                  action={
                    <Button
                      onClick={() => {
                        setSearchTerm('');
                        setSelectedDeptId('all');
                        setSelectedStatus('all');
                      }}
                    >
                      Reset filters
                    </Button>
                  }
                />
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13.5px' }}>
                  <thead>
                    <tr
                      style={{
                        background: '#f8fafc',
                        borderBottom: '1px solid var(--border-subtle, #e2e8f0)',
                        textAlign: 'left',
                      }}
                    >
                      <th
                        style={{
                          padding: '11px 14px',
                          color: 'var(--text-secondary)',
                          fontWeight: 600,
                        }}
                      >
                        Code
                      </th>
                      <th
                        style={{
                          padding: '11px 14px',
                          color: 'var(--text-secondary)',
                          fontWeight: 600,
                        }}
                      >
                        Employee
                      </th>
                      <th
                        style={{
                          padding: '11px 14px',
                          color: 'var(--text-secondary)',
                          fontWeight: 600,
                        }}
                      >
                        Department
                      </th>
                      <th
                        style={{
                          padding: '11px 14px',
                          color: 'var(--text-secondary)',
                          fontWeight: 600,
                        }}
                      >
                        Team
                      </th>
                      <th
                        style={{
                          padding: '11px 14px',
                          color: 'var(--text-secondary)',
                          fontWeight: 600,
                        }}
                      >
                        Status
                      </th>
                      <th
                        style={{
                          padding: '11px 14px',
                          color: 'var(--text-secondary)',
                          fontWeight: 600,
                          textAlign: 'right',
                        }}
                      >
                        Earned
                      </th>
                      <th
                        style={{
                          padding: '11px 14px',
                          color: 'var(--text-secondary)',
                          fontWeight: 600,
                          textAlign: 'right',
                        }}
                      >
                        Taken
                      </th>
                      <th
                        style={{
                          padding: '11px 14px',
                          color: 'var(--text-secondary)',
                          fontWeight: 600,
                          textAlign: 'right',
                        }}
                      >
                        Remaining
                      </th>
                      <th
                        style={{
                          padding: '11px 14px',
                          color: 'var(--text-secondary)',
                          fontWeight: 600,
                          textAlign: 'right',
                        }}
                      >
                        Pending
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredEmployees.map((e) => (
                      <tr
                        key={e.id}
                        style={{ borderBottom: '1px solid var(--border-subtle, #f1f5f9)' }}
                      >
                        <td style={{ padding: '10px 14px', fontFamily: 'var(--font-mono)' }}>
                          <span
                            style={{
                              padding: '2px 6px',
                              background: '#f1f5f9',
                              borderRadius: '4px',
                              fontSize: '12px',
                            }}
                          >
                            {e.code}
                          </span>
                        </td>
                        <td
                          style={{
                            padding: '10px 14px',
                            fontWeight: 600,
                            color: 'var(--text-primary)',
                          }}
                        >
                          {e.name}
                        </td>
                        <td style={{ padding: '10px 14px', color: 'var(--text-secondary)' }}>
                          {e.departmentName}
                        </td>
                        <td style={{ padding: '10px 14px', color: 'var(--text-tertiary)' }}>
                          {e.teamName}
                        </td>
                        <td style={{ padding: '10px 14px' }}>
                          <StatusPill status={e.status} />
                        </td>
                        <td
                          style={{
                            padding: '10px 14px',
                            textAlign: 'right',
                            fontVariantNumeric: 'tabular-nums',
                          }}
                        >
                          {e.entitlementDays} d
                        </td>
                        <td
                          style={{
                            padding: '10px 14px',
                            textAlign: 'right',
                            fontVariantNumeric: 'tabular-nums',
                          }}
                        >
                          {e.takenDays} d
                        </td>
                        <td
                          style={{
                            padding: '10px 14px',
                            textAlign: 'right',
                            fontWeight: 700,
                            fontVariantNumeric: 'tabular-nums',
                            color:
                              e.remainingDays < 0
                                ? 'var(--status-rejected-fg, #b91c1c)'
                                : 'var(--text-primary)',
                          }}
                        >
                          {e.remainingDays} d
                        </td>
                        <td style={{ padding: '10px 14px', textAlign: 'right' }}>
                          {e.pendingDays > 0 ? (
                            <span
                              style={{
                                padding: '2px 6px',
                                background: '#fffbeb',
                                color: '#b45309',
                                borderRadius: '4px',
                                fontWeight: 600,
                                fontSize: '12px',
                              }}
                            >
                              {e.pendingDays} d
                            </span>
                          ) : (
                            <span style={{ color: 'var(--text-tertiary)' }}>—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'payroll' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="card">
            <div className="card-head" style={{ borderBottom: 'none', padding: '0 0 12px 0' }}>
              <div>
                <h2 style={{ fontSize: '16px', margin: 0 }}>
                  Monthly payroll leave — {data.payroll.label}
                </h2>
                <p className="dim" style={{ fontSize: '13px', margin: '2px 0 0 0' }}>
                  Opening + earned − used = closing. Pending is shown and is not deducted until
                  approval.
                </p>
              </div>
              <div style={{ display: 'flex', gap: 8, minWidth: 280 }}>
                <Select
                  value={String(payrollMonth)}
                  onChange={(v) => setPayrollMonth(Number(v))}
                  options={Array.from({ length: 12 }, (_, i) => ({
                    value: String(i + 1),
                    label: new Date(Date.UTC(2026, i, 1)).toLocaleString('en-GB', {
                      month: 'long',
                      timeZone: 'UTC',
                    }),
                  }))}
                />
                <Select
                  value={String(payrollYear)}
                  onChange={(v) => setPayrollYear(Number(v))}
                  options={[payrollYear - 1, payrollYear, payrollYear + 1].map((y) => ({
                    value: String(y),
                    label: String(y),
                  }))}
                />
              </div>
            </div>
            {data.payroll.rows.length === 0 ? (
              <EmptyState
                title="No employees to report"
                body="Active employees appear here once they are on the directory."
              />
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="data">
                  <caption className="sr-only">Monthly payroll leave report</caption>
                  <thead>
                    <tr>
                      <th>Employee ID</th>
                      <th>Employee</th>
                      <th>Department</th>
                      <th>Opening</th>
                      <th>Earned</th>
                      <th>Leave taken</th>
                      <th>Loss of pay</th>
                      <th>Permission (hours)</th>
                      <th>Pending</th>
                      <th>Closing</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.payroll.rows.map((r) => (
                      <tr key={r.employeeId}>
                        <td className="mono">{r.employeeCode}</td>
                        <td>
                          <strong>{r.name}</strong>
                        </td>
                        <td>{r.department}</td>
                        <td className="mono">{r.opening}</td>
                        <td className="mono">{r.earned}</td>
                        <td className="mono">{r.leaveTaken ?? r.used}</td>
                        <td className="mono">{r.lossOfPay ?? 0}</td>
                        <td className="mono">{r.permissionHours ?? 0}</td>
                        <td className="mono">{r.pending}</td>
                        <td className="mono">
                          <strong>{r.closing}</strong>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
      {activeTab === 'annual' ? <AnnualReport /> : null}
    </div>
  );
}

type Annual = {
  periods: { id: string; label: string }[];
  periodId: string;
  label: string;
  leaveTypes: { id: string; code: string; name: string }[];
  leaveTypeId: string | null;
  months: string[];
  rows: {
    employeeId: string;
    code: string;
    name: string;
    department: string;
    opening: number;
    earned: number;
    adjusted: number;
    used: number;
    pending: number;
    closing: number;
    monthly: number[];
  }[];
};

/**
 * The annual leave report: each person's year for one leave type — opening, earned,
 * adjustments, days used in each month, pending and closing.
 */
function AnnualReport() {
  const [periodId, setPeriodId] = useState('');
  const [typeId, setTypeId] = useState('');
  const qs = new URLSearchParams({
    ...(periodId ? { periodId } : {}),
    ...(typeId ? { leaveTypeId: typeId } : {}),
  }).toString();
  const q = useQuery({
    queryKey: ['annual-report', periodId, typeId],
    queryFn: () => api<Annual>(`/api/v1/reports/annual?${qs}`),
  });
  if (q.isLoading) return <div className="card">Loading…</div>;
  if (q.isError || !q.data) return <div className="card">Could not load the annual report.</div>;
  const d = q.data;
  const fmt = (x: number) => (x === 0 ? '—' : Number.isInteger(x) ? String(x) : x.toFixed(1));
  return (
    <div className="card">
      <div
        className="card-head"
        style={{ borderBottom: 'none', padding: '0 0 12px 0', flexWrap: 'wrap', gap: 8 }}
      >
        <div>
          <h2 style={{ fontSize: '16px', margin: 0 }}>Annual leave report — {d.label}</h2>
          <p className="dim" style={{ fontSize: '13px', margin: '2px 0 0 0' }}>
            Days used are counted in the month they fall in, so leave across two months is split.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <Select
            size="sm"
            aria-label="Leave type"
            value={typeId || d.leaveTypeId || ''}
            onChange={setTypeId}
            options={d.leaveTypes.map((t) => ({ value: t.id, label: t.name }))}
          />
          <Select
            size="sm"
            aria-label="Leave year"
            value={periodId || d.periodId}
            onChange={setPeriodId}
            options={d.periods.map((p) => ({ value: p.id, label: p.label }))}
          />
          <a className="reports-export-btn" href={`/api/v1/reports/annual.xlsx?${qs}`} download>
            Excel
          </a>
          <a
            className="reports-export-btn reports-export-csv"
            href={`/api/v1/reports/annual.csv?${qs}`}
            download
          >
            CSV
          </a>
        </div>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="table" style={{ minWidth: 1100 }}>
          <thead>
            <tr>
              <th>Emp ID</th>
              <th>Employee</th>
              <th>Department</th>
              <th>Opening</th>
              <th>Earned</th>
              <th>Adjusted</th>
              {d.months.map((m) => (
                <th key={m}>{m}</th>
              ))}
              <th>Used</th>
              <th>Pending</th>
              <th>Closing</th>
            </tr>
          </thead>
          <tbody>
            {d.rows.map((r) => (
              <tr key={r.employeeId}>
                <td className="mono">{r.code}</td>
                <td>{r.name}</td>
                <td>{r.department}</td>
                <td className="mono">{fmt(r.opening)}</td>
                <td className="mono">{fmt(r.earned)}</td>
                <td className="mono">{fmt(r.adjusted)}</td>
                {r.monthly.map((m, i) => (
                  <td key={i} className="mono">
                    {fmt(m)}
                  </td>
                ))}
                <td className="mono">{fmt(r.used)}</td>
                <td className="mono">{fmt(r.pending)}</td>
                <td className="mono">
                  <strong>{r.closing}</strong>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
