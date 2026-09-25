import { useState, useMemo, type FormEvent, type ChangeEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, EmptyState, Select } from '@sns/ui';
import { api, can, type Me } from '../api.js';
import { initials, formatDate } from '../format.js';
import {
  LogIn,
  LogOut,
  Radio,
  FileUp,
  Download,
  RefreshCw,
  Search,
  Filter,
  CheckCircle2,
  AlertCircle,
  Info,
  FileSpreadsheet,
  History,
  Edit3,
  Eye,
  X,
  FileText,
  Users,
  Timer,
  ChevronRight,
} from 'lucide-react';

interface AttendanceCorrection {
  id: string;
  field: string;
  old_value: string | null;
  new_value: string;
  reason: string;
  corrected_by: string;
  corrector_name?: string;
  created_at: string;
}

interface AttendanceRow {
  id: string;
  source: 'login' | 'import';
  work_date: string;
  employee_id: string;
  employee_code?: string;
  name: string;
  work_email?: string;
  department_id?: string;
  department_name?: string;
  job_title_name?: string;
  first_login_at: string | null;
  last_login_at: string | null;
  last_logout_at: string | null;
  created_at: string;
  payload_json: string;
  corrections: AttendanceCorrection[];
}

interface AttendanceMetrics {
  todaySignalsCount?: number;
  todayRecords?: number;
  todayLoginSignals?: number;
  todayDistinctEmployees?: number;
  earliestLoginToday: { time: string; employeeName: string } | null;
  latestLoginToday: { time: string; employeeName: string } | null;
  latestLogoutToday?: { time: string; employeeName: string } | null;
  totalLoginSignals: number;
  totalImportedSignals: number;
}

interface AttendanceResponse {
  notice: string;
  metrics: AttendanceMetrics;
  rows: AttendanceRow[];
}

interface OrgData {
  departments: { id: string; name: string }[];
}

function formatTimeOnly(isoString: string | null): string {
  if (!isoString) return '—';
  try {
    if (isoString.length >= 19 && isoString.includes('T')) {
      return isoString.slice(11, 19);
    }
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return isoString;
  }
}

function calculateSpan(first: string | null, last: string | null): string {
  if (!first || !last) return '—';
  try {
    const t1 = new Date(first).getTime();
    const t2 = new Date(last).getTime();
    if (isNaN(t1) || isNaN(t2)) return '—';
    const diffMs = Math.max(0, t2 - t1);
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins === 0) return 'Instant';
    const hours = Math.floor(diffMins / 60);
    const mins = diffMins % 60;
    if (hours === 0) return `${mins}m`;
    return `${hours}h ${mins}m`;
  } catch {
    return '—';
  }
}

export function AttendancePage({ me }: { me: Me }) {
  const [search, setSearch] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState<'all' | 'login' | 'import'>('all');
  const [deptFilter, setDeptFilter] = useState('ALL');

  const [inspectingRow, setInspectingRow] = useState<AttendanceRow | null>(null);
  const [correctingRow, setCorrectingRow] = useState<AttendanceRow | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  // Correction Form State
  const [correctionField, setCorrectionField] = useState<
    'first_login_at' | 'last_login_at' | 'last_logout_at' | 'work_date' | 'notes'
  >('first_login_at');
  const [correctionNewValue, setCorrectionNewValue] = useState('');
  const [correctionReason, setCorrectionReason] = useState('');
  const [correctionSubmitting, setCorrectionSubmitting] = useState(false);
  const [correctionError, setCorrectionError] = useState<string | null>(null);

  // CSV Import Form State
  const [csvContent, setCsvContent] = useState('');
  const [importSubmitting, setImportSubmitting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);

  const qc = useQueryClient();

  const queryParams = useMemo(() => {
    const params = new URLSearchParams();
    if (dateFilter) params.set('date', dateFilter);
    if (sourceFilter !== 'all') params.set('source', sourceFilter);
    if (deptFilter !== 'ALL') params.set('departmentId', deptFilter);
    if (search.trim()) params.set('search', search.trim());
    return params.toString();
  }, [dateFilter, sourceFilter, deptFilter, search]);

  const q = useQuery({
    queryKey: ['attendance', queryParams],
    queryFn: () =>
      api<AttendanceResponse>(`/api/v1/attendance${queryParams ? `?${queryParams}` : ''}`),
  });

  const org = useQuery({
    queryKey: ['org'],
    queryFn: () => api<OrgData>('/api/v1/org'),
    enabled: can(me, 'employee.read'),
  });

  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const handleOpenCorrection = (row: AttendanceRow) => {
    setCorrectingRow(row);
    setCorrectionField('first_login_at');
    setCorrectionNewValue(row.first_login_at || '');
    setCorrectionReason('');
    setCorrectionError(null);
  };

  const submitCorrection = async (e: FormEvent) => {
    e.preventDefault();
    if (!correctingRow) return;
    setCorrectionSubmitting(true);
    setCorrectionError(null);
    try {
      await api('/api/v1/attendance/corrections', {
        method: 'POST',
        body: JSON.stringify({
          attendanceRawId: correctingRow.id,
          field: correctionField,
          newValue: correctionNewValue.trim(),
          reason: correctionReason.trim(),
        }),
      });
      await qc.invalidateQueries({ queryKey: ['attendance'] });
      setCorrectingRow(null);
      if (inspectingRow && inspectingRow.id === correctingRow.id) {
        // Refresh inspected row if open
        setInspectingRow(null);
      }
    } catch (err) {
      setCorrectionError(err instanceof Error ? err.message : 'Failed to record correction');
    } finally {
      setCorrectionSubmitting(false);
    }
  };

  const handleCsvFileUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      setCsvContent(text || '');
      setImportError(null);
      setImportSuccess(null);
    };
    reader.readAsText(file);
  };

  const parsedCsvRows = useMemo(() => {
    if (!csvContent.trim()) return [];
    const lines = csvContent.trim().split('\n');
    const firstLine = lines[0];
    if (!firstLine || lines.length <= 1) return [];
    const headers = firstLine.split(',').map((h) => h.trim().toLowerCase());
    const codeIdx = headers.indexOf('employee_code');
    const dateIdx = headers.indexOf('work_date');
    const firstIdx = headers.indexOf('first_login_at');
    const lastIdx = headers.indexOf('last_login_at');
    const logoutIdx = headers.indexOf('last_logout_at');
    const notesIdx = headers.indexOf('notes');

    if (codeIdx === -1 || dateIdx === -1) {
      return [];
    }

    const result = [];
    for (let i = 1; i < lines.length; i++) {
      const rawLine = lines[i];
      if (!rawLine) continue;
      const line = rawLine.trim();
      if (!line) continue;
      const cols = line.split(',').map((c) => c.trim());
      result.push({
        employeeCode: cols[codeIdx] || '',
        workDate: cols[dateIdx] || '',
        firstLoginAt: firstIdx !== -1 ? cols[firstIdx] || null : null,
        lastLoginAt: lastIdx !== -1 ? cols[lastIdx] || null : null,
        lastLogoutAt: logoutIdx !== -1 ? cols[logoutIdx] || null : null,
        notes: notesIdx !== -1 ? cols[notesIdx] || null : null,
      });
    }
    return result;
  }, [csvContent]);

  const submitImport = async (e: FormEvent) => {
    e.preventDefault();
    if (parsedCsvRows.length === 0) {
      setImportError('No valid rows found in CSV. Required headers: employee_code, work_date');
      return;
    }
    setImportSubmitting(true);
    setImportError(null);
    setImportSuccess(null);
    try {
      const res = await api<{ importedCount: number; updatedCount: number }>(
        '/api/v1/attendance/import',
        {
          method: 'POST',
          body: JSON.stringify({ rows: parsedCsvRows }),
        },
      );
      setImportSuccess(
        `Import completed: ${res.importedCount} created, ${res.updatedCount} updated.`,
      );
      await qc.invalidateQueries({ queryKey: ['attendance'] });
      setTimeout(() => {
        setImportOpen(false);
        setCsvContent('');
        setImportSuccess(null);
      }, 1500);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImportSubmitting(false);
    }
  };

  const exportFilteredCsv = () => {
    const rows = q.data?.rows ?? [];
    if (rows.length === 0) return;
    const header = [
      'Employee Code',
      'Name',
      'Department',
      'Date',
      'Source',
      'Entry',
      'Logout',
      'Corrections Count',
    ];
    const csvRows = [header.join(',')];
    for (const r of rows) {
      csvRows.push(
        [
          `"${r.employee_code ?? ''}"`,
          `"${r.name}"`,
          `"${r.department_name ?? ''}"`,
          `"${r.work_date}"`,
          `"${r.source}"`,
          `"${r.first_login_at ?? ''}"`,
          `"${r.last_logout_at ?? ''}"`,
          `"${r.corrections.length}"`,
        ].join(','),
      );
    }
    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `attendance-signals-${dateFilter || 'all'}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const metrics = q.data?.metrics;
  const rows = q.data?.rows ?? [];

  return (
    <div className="att-container">
      {/* Header & Action Bar */}
      <div className="att-header">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em' }}>
              Attendance & Presence Signals
            </h1>
            <span className="signal-badge">
              <Radio size={12} className="pulse-icon" /> Signals, not verdicts
            </span>
          </div>
          <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: 13.5 }}>
            Positive presence signals from system logins and verified imports. A missing login is
            not treated as an absence (ADR 0011).
          </p>
        </div>
        <div className="att-actions">
          {can(me, 'attendance.import') && (
            <Button
              variant="primary"
              onClick={() => setImportOpen(true)}
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <FileUp size={15} /> Import Signals (CSV)
            </Button>
          )}
          <a href="/api/v1/attendance/template.csv" download className="btn-secondary-link">
            <Download size={14} /> CSV Template
          </a>
          <Button
            variant="secondary"
            onClick={exportFilteredCsv}
            disabled={rows.length === 0}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <FileSpreadsheet size={15} /> Export View
          </Button>
          <Button
            variant="ghost"
            onClick={() => void q.refetch()}
            aria-label="Refresh attendance"
            style={{ padding: '8px 10px' }}
          >
            <RefreshCw size={15} className={q.isFetching ? 'spin' : ''} />
          </Button>
        </div>
      </div>

      {/* KPI Overview Grid */}
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-icon-wrap" style={{ background: '#ecfdf5', color: '#059669' }}>
            <Radio size={18} />
          </div>
          <div className="kpi-content">
            <span className="kpi-label">Today's Active Signals</span>
            <div className="kpi-value-row">
              <span className="kpi-value">
                {metrics?.todayLoginSignals ??
                  metrics?.todayRecords ??
                  metrics?.todaySignalsCount ??
                  0}
              </span>
              <span className="kpi-subtext">
                {metrics?.todayRecords ?? metrics?.todayDistinctEmployees ?? 0} records today
              </span>
            </div>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-icon-wrap" style={{ background: '#eff6ff', color: '#2563eb' }}>
            <LogIn size={18} />
          </div>
          <div className="kpi-content">
            <span className="kpi-label">Earliest Presence Today</span>
            <div className="kpi-value-row">
              <span className="kpi-value" style={{ fontSize: 20 }}>
                {metrics?.earliestLoginToday
                  ? formatTimeOnly(metrics.earliestLoginToday.time)
                  : '—'}
              </span>
              {metrics?.earliestLoginToday && (
                <span className="kpi-name-tag" title={metrics.earliestLoginToday.employeeName}>
                  {metrics.earliestLoginToday.employeeName.split(' ')[0]}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-icon-wrap" style={{ background: '#fdf4ff', color: '#9333ea' }}>
            <LogOut size={18} />
          </div>
          <div className="kpi-content">
            <span className="kpi-label">Latest logout today</span>
            <div className="kpi-value-row">
              <span className="kpi-value" style={{ fontSize: 20 }}>
                {metrics?.latestLogoutToday ? formatTimeOnly(metrics.latestLogoutToday.time) : '—'}
              </span>
              {metrics?.latestLogoutToday && (
                <span className="kpi-name-tag" title={metrics.latestLogoutToday.employeeName}>
                  {metrics.latestLogoutToday.employeeName.split(' ')[0]}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-icon-wrap" style={{ background: '#f8fafc', color: '#475569' }}>
            <History size={18} />
          </div>
          <div className="kpi-content">
            <span className="kpi-label">Signal Source Breakdown</span>
            <div className="kpi-value-row">
              <span className="kpi-value">{metrics?.totalLoginSignals ?? 0}</span>
              <span className="kpi-subtext">
                Logins · {metrics?.totalImportedSignals ?? 0} Imported
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ADR 0011 Philosophy Notice Card */}
      <div className="philosophy-callout">
        <div className="callout-icon">
          <Info size={20} color="#b45309" />
        </div>
        <div className="callout-body">
          <strong style={{ fontSize: 14, color: '#92400e', display: 'block', marginBottom: 2 }}>
            Positive presence signals only (ADR 0011)
          </strong>
          <p style={{ margin: 0, fontSize: 13, color: '#78350f', lineHeight: 1.45 }}>
            A system login proves that an account authenticated on that date. It does not measure
            total hours worked or require shop-floor staff to log in daily.
            <strong> Missing logins are never treated as absences</strong>, preventing unfair
            payroll deductions. Hardware, turnstile, or biometric logs can be imported via CSV.
          </p>
        </div>
      </div>

      {/* Control Bar: Search, Date Preset, Source, and Department Filters */}
      <div className="filter-bar">
        <div className="search-wrap">
          <Search size={16} className="search-icon" />
          <input
            type="text"
            className="search-input"
            placeholder="Search person, employee code, or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button className="clear-btn" onClick={() => setSearch('')} aria-label="Clear search">
              <X size={14} />
            </button>
          )}
        </div>

        <div className="date-filter-group">
          <button
            type="button"
            className={`date-preset-btn ${dateFilter === '' ? 'is-active' : ''}`}
            onClick={() => setDateFilter('')}
          >
            All Dates
          </button>
          <button
            type="button"
            className={`date-preset-btn ${dateFilter === todayStr ? 'is-active' : ''}`}
            onClick={() => setDateFilter(todayStr)}
          >
            Today
          </button>
          <input
            type="date"
            className="custom-date-picker"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            title="Filter by specific date"
          />
        </div>

        <Select
          value={sourceFilter}
          onChange={(v) => setSourceFilter(v as 'all' | 'login' | 'import')}
          aria-label="Filter by signal source"
          icon={<Filter size={14} />}
          options={[
            { value: 'all', label: 'All Sources' },
            { value: 'login', label: 'Login Signals' },
            { value: 'import', label: 'Imported Records' },
          ]}
        />

        {org.data?.departments && org.data.departments.length > 0 && (
          <Select
            value={deptFilter}
            onChange={setDeptFilter}
            aria-label="Filter by department"
            icon={<Users size={14} />}
            options={[
              { value: 'ALL', label: 'All Departments' },
              ...org.data.departments.map((d) => ({
                value: d.id,
                label: d.name,
              })),
            ]}
          />
        )}
      </div>

      {/* Attendance Signals High-Contrast Table */}
      <div className="table-card">
        {q.isPending ? (
          <div className="loading-state">
            <RefreshCw size={24} className="spin" />
            <p>Loading attendance signals...</p>
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            title="No attendance signals found"
            body={
              search || dateFilter || sourceFilter !== 'all' || deptFilter !== 'ALL'
                ? 'Try adjusting your filters or search query.'
                : 'No login signals or imported records have been recorded yet.'
            }
          />
        ) : (
          <div className="table-responsive">
            <table className="att-table">
              <thead>
                <tr>
                  <th style={{ minWidth: 220 }}>Employee</th>
                  <th style={{ minWidth: 120 }}>Date</th>
                  <th style={{ minWidth: 130 }}>Signal Source</th>
                  <th style={{ minWidth: 130 }}>Entry</th>
                  <th style={{ minWidth: 130 }}>Logout</th>
                  <th style={{ minWidth: 120 }}>Presence Window</th>
                  <th style={{ minWidth: 110 }}>Corrections</th>
                  <th style={{ textAlign: 'right', minWidth: 130 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const isToday = r.work_date === todayStr;
                  const spanText = calculateSpan(
                    r.first_login_at,
                    r.last_logout_at ?? r.last_login_at,
                  );
                  const hasCorrections = r.corrections && r.corrections.length > 0;

                  return (
                    <tr key={r.id} className={isToday ? 'row-today' : ''}>
                      <td>
                        <div className="emp-cell">
                          <div className="emp-avatar">{initials(r.name)}</div>
                          <div>
                            <div className="emp-name-row">
                              <span className="emp-name">{r.name}</span>
                              {r.employee_code && (
                                <span className="emp-code-badge">{r.employee_code}</span>
                              )}
                            </div>
                            <span className="emp-sub">
                              {r.department_name ?? 'General'}
                              {r.job_title_name ? ` · ${r.job_title_name}` : ''}
                            </span>
                          </div>
                        </div>
                      </td>

                      <td>
                        <div className="date-cell">
                          <span className="mono-date">{r.work_date}</span>
                          {isToday && <span className="today-badge">Today</span>}
                        </div>
                      </td>

                      <td>
                        {r.source === 'login' ? (
                          <span className="source-pill login-pill">
                            <Radio size={12} className="pulse-dot" /> Login Signal
                          </span>
                        ) : (
                          <span className="source-pill import-pill">
                            <FileText size={12} /> CSV Imported
                          </span>
                        )}
                      </td>

                      <td>
                        <div className="time-cell">
                          <LogIn size={13} style={{ color: '#10b981' }} />
                          <span className="mono-time" title={r.first_login_at ?? 'No entry time'}>
                            {formatTimeOnly(r.first_login_at)}
                          </span>
                        </div>
                      </td>

                      <td>
                        <div className="time-cell">
                          <LogOut size={13} style={{ color: '#6366f1' }} />
                          <span className="mono-time" title={r.last_logout_at ?? 'Still signed in'}>
                            {r.last_logout_at ? formatTimeOnly(r.last_logout_at) : 'Still in'}
                          </span>
                        </div>
                      </td>

                      <td>
                        <div className="span-cell">
                          <Timer size={13} style={{ color: 'var(--text-tertiary)' }} />
                          <span className="span-text">{spanText}</span>
                        </div>
                      </td>

                      <td>
                        {hasCorrections ? (
                          <span
                            className="correction-pill"
                            title={`${r.corrections.length} manual correction(s) recorded`}
                          >
                            <Edit3 size={11} /> {r.corrections.length}{' '}
                            {r.corrections.length === 1 ? 'edit' : 'edits'}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>None</span>
                        )}
                      </td>

                      <td style={{ textAlign: 'right' }}>
                        <div className="actions-cell">
                          <button
                            type="button"
                            className="icon-action-btn"
                            title="Inspect signal payload and history"
                            onClick={() => setInspectingRow(r)}
                          >
                            <Eye size={14} /> Inspect
                          </button>
                          {can(me, 'attendance.correct') && (
                            <button
                              type="button"
                              className="icon-action-btn highlight"
                              title="Log manual attendance correction"
                              onClick={() => handleOpenCorrection(r)}
                            >
                              <Edit3 size={14} /> Correct
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* 1. Inspect Signal Modal (Curved Floating Window)                           */}
      {/* ========================================================================= */}
      {inspectingRow && (
        <div className="modal-backdrop" onClick={() => setInspectingRow(null)}>
          <div className="floating-window" onClick={(e) => e.stopPropagation()}>
            <div className="window-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div className="emp-avatar lg">{initials(inspectingRow.name)}</div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
                      {inspectingRow.name}
                    </h3>
                    {inspectingRow.employee_code && (
                      <span className="emp-code-badge">{inspectingRow.employee_code}</span>
                    )}
                  </div>
                  <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
                    Signal Record for {formatDate(inspectingRow.work_date)} ·{' '}
                    {inspectingRow.department_name ?? 'General'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="close-modal-btn"
                onClick={() => setInspectingRow(null)}
                aria-label="Close modal"
              >
                <X size={18} />
              </button>
            </div>

            <div className="window-body">
              {/* Key Attributes Grid */}
              <div className="detail-meta-grid">
                <div className="meta-box">
                  <span className="meta-label">Signal Source</span>
                  <strong className="meta-val" style={{ textTransform: 'capitalize' }}>
                    {inspectingRow.source === 'login' ? 'System Login' : 'File Import'}
                  </strong>
                </div>
                <div className="meta-box">
                  <span className="meta-label">Work Date</span>
                  <strong className="meta-val mono">{inspectingRow.work_date}</strong>
                </div>
                <div className="meta-box">
                  <span className="meta-label">Entry (first login)</span>
                  <strong className="meta-val mono">
                    {inspectingRow.first_login_at ?? 'None'}
                  </strong>
                </div>
                <div className="meta-box">
                  <span className="meta-label">Logout (last sign-out)</span>
                  <strong className="meta-val mono">
                    {inspectingRow.last_logout_at ?? 'Still signed in'}
                  </strong>
                </div>
                <div className="meta-box">
                  <span className="meta-label">Session Window</span>
                  <strong className="meta-val">
                    {calculateSpan(
                      inspectingRow.first_login_at,
                      inspectingRow.last_logout_at ?? inspectingRow.last_login_at,
                    )}
                  </strong>
                </div>
                <div className="meta-box">
                  <span className="meta-label">Record ID</span>
                  <strong className="meta-val mono" style={{ fontSize: 11 }}>
                    {inspectingRow.id}
                  </strong>
                </div>
              </div>

              {/* Correction History */}
              <div className="detail-section">
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 8,
                  }}
                >
                  <h4 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>
                    Correction History ({inspectingRow.corrections.length})
                  </h4>
                  {can(me, 'attendance.correct') && (
                    <Button
                      variant="secondary"
                      onClick={() => {
                        handleOpenCorrection(inspectingRow);
                      }}
                      style={{ fontSize: 12, padding: '4px 10px' }}
                    >
                      <Edit3 size={13} /> Add Correction
                    </Button>
                  )}
                </div>

                {inspectingRow.corrections.length === 0 ? (
                  <p
                    style={{
                      margin: 0,
                      fontSize: 13,
                      color: 'var(--text-tertiary)',
                      fontStyle: 'italic',
                    }}
                  >
                    No manual corrections recorded for this raw signal.
                  </p>
                ) : (
                  <div className="correction-list">
                    {inspectingRow.corrections.map((c) => (
                      <div key={c.id} className="correction-item">
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                          }}
                        >
                          <span className="field-tag">Field: {c.field}</span>
                          <span className="mono-time" style={{ fontSize: 11 }}>
                            {c.created_at}
                          </span>
                        </div>
                        <div style={{ margin: '6px 0', fontSize: 13 }}>
                          <span style={{ color: 'var(--text-tertiary)' }}>
                            {c.old_value ?? 'empty'}
                          </span>
                          <ChevronRight
                            size={13}
                            style={{ display: 'inline', margin: '0 4px', verticalAlign: 'middle' }}
                          />
                          <strong style={{ color: '#047857' }}>{c.new_value}</strong>
                        </div>
                        <p
                          style={{
                            margin: '4px 0 0',
                            fontSize: 12.5,
                            color: 'var(--text-secondary)',
                          }}
                        >
                          <strong>Reason:</strong> {c.reason}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Raw JSON Payload */}
              <div className="detail-section">
                <h4 style={{ margin: '0 0 6px', fontSize: 14, fontWeight: 600 }}>
                  Raw Signal Payload
                </h4>
                <pre className="json-box">{inspectingRow.payload_json || '{}'}</pre>
              </div>
            </div>

            <div className="window-footer">
              <Button variant="secondary" onClick={() => setInspectingRow(null)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 2. Manual Correction Modal (ADR 0011 compliant)                          */}
      {/* ========================================================================= */}
      {correctingRow && (
        <div className="modal-backdrop" onClick={() => setCorrectingRow(null)}>
          <div
            className="floating-window"
            style={{ maxWidth: 520 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="window-header">
              <div>
                <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
                  Record Attendance Correction
                </h3>
                <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--text-secondary)' }}>
                  {correctingRow.name} · {correctingRow.work_date} ({correctingRow.source} signal)
                </p>
              </div>
              <button
                type="button"
                className="close-modal-btn"
                onClick={() => setCorrectingRow(null)}
                aria-label="Close modal"
              >
                <X size={18} />
              </button>
            </div>

            <form
              onSubmit={(e) => {
                void submitCorrection(e);
              }}
            >
              <div className="window-body">
                {correctionError && (
                  <div className="form-error-banner">
                    <AlertCircle size={16} /> {correctionError}
                  </div>
                )}

                <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--text-secondary)' }}>
                  Corrections are stored as append-only audit records. The raw underlying signal is
                  preserved (ADR 0011).
                </p>

                <div className="form-field">
                  <label htmlFor="corr-field">Target Field</label>
                  <Select
                    id="corr-field"
                    value={correctionField}
                    fullWidth
                    onChange={(val) => {
                      const f = val as typeof correctionField;
                      setCorrectionField(f);
                      if (f === 'first_login_at')
                        setCorrectionNewValue(correctingRow.first_login_at || '');
                      else if (f === 'last_login_at')
                        setCorrectionNewValue(correctingRow.last_login_at || '');
                      else if (f === 'last_logout_at')
                        setCorrectionNewValue(correctingRow.last_logout_at || '');
                      else if (f === 'work_date') setCorrectionNewValue(correctingRow.work_date);
                      else setCorrectionNewValue('');
                    }}
                    options={[
                      {
                        value: 'first_login_at',
                        label: 'Entry time (first login of the day)',
                      },
                      {
                        value: 'last_login_at',
                        label: 'Last login of the day',
                      },
                      {
                        value: 'last_logout_at',
                        label: 'Logout time (last sign-out of the day)',
                      },
                      { value: 'work_date', label: 'Work Date (work_date)' },
                      { value: 'notes', label: 'Notes / Memo (notes)' },
                    ]}
                  />
                </div>

                <div className="form-field">
                  <label htmlFor="corr-val">New Value</label>
                  <input
                    id="corr-val"
                    type="text"
                    className="att-input mono"
                    placeholder="e.g. 2026-08-27T09:00:00.000Z"
                    value={correctionNewValue}
                    onChange={(e) => setCorrectionNewValue(e.target.value)}
                    required
                  />
                </div>

                <div className="form-field">
                  <label htmlFor="corr-reason">Reason for Correction (Mandatory)</label>
                  <textarea
                    id="corr-reason"
                    className="att-textarea"
                    rows={3}
                    placeholder="Explain why this correction is being recorded (e.g. badge scanner lag, missed logout, manual verification)..."
                    value={correctionReason}
                    onChange={(e) => setCorrectionReason(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="window-footer">
                <Button variant="secondary" type="button" onClick={() => setCorrectingRow(null)}>
                  Cancel
                </Button>
                <Button variant="primary" type="submit" disabled={correctionSubmitting}>
                  {correctionSubmitting ? 'Saving...' : 'Record Correction'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 3. CSV Import Modal                                                       */}
      {/* ========================================================================= */}
      {importOpen && (
        <div className="modal-backdrop" onClick={() => setImportOpen(false)}>
          <div
            className="floating-window"
            style={{ maxWidth: 640 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="window-header">
              <div>
                <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
                  Import Attendance Signals
                </h3>
                <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--text-secondary)' }}>
                  Batch import presence logs from external biometric devices or hardware scanners.
                </p>
              </div>
              <button
                type="button"
                className="close-modal-btn"
                onClick={() => setImportOpen(false)}
                aria-label="Close modal"
              >
                <X size={18} />
              </button>
            </div>

            <form
              onSubmit={(e) => {
                void submitImport(e);
              }}
            >
              <div className="window-body">
                {importError && (
                  <div className="form-error-banner">
                    <AlertCircle size={16} /> {importError}
                  </div>
                )}
                {importSuccess && (
                  <div className="form-success-banner">
                    <CheckCircle2 size={16} /> {importSuccess}
                  </div>
                )}

                <div className="upload-dropzone">
                  <FileUp size={28} style={{ color: 'var(--brand-primary)', marginBottom: 6 }} />
                  <p style={{ margin: '0 0 6px', fontWeight: 600, fontSize: 14 }}>
                    Choose a CSV file to upload
                  </p>
                  <p style={{ margin: '0 0 10px', fontSize: 12.5, color: 'var(--text-secondary)' }}>
                    Headers required:{' '}
                    <code>
                      employee_code,work_date,first_login_at,last_login_at,last_logout_at,notes
                    </code>
                  </p>
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    onChange={handleCsvFileUpload}
                    className="file-input-btn"
                  />
                </div>

                <div
                  style={{
                    margin: '14px 0 6px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <label htmlFor="csv-raw" style={{ fontSize: 13, fontWeight: 600 }}>
                    Or paste CSV text directly:
                  </label>
                  <a href="/api/v1/attendance/template.csv" download className="link-action">
                    <Download size={13} /> Sample CSV Template
                  </a>
                </div>
                <textarea
                  id="csv-raw"
                  className="att-textarea mono"
                  rows={4}
                  placeholder={`employee_code,work_date,first_login_at,last_login_at,last_logout_at,notes\nE-001,2026-08-27,2026-08-27T09:00:00Z,2026-08-27T17:00:00Z,2026-08-27T17:30:00Z,Scanner export`}
                  value={csvContent}
                  onChange={(e) => setCsvContent(e.target.value)}
                />

                {parsedCsvRows.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: 6,
                      }}
                    >
                      <span style={{ fontSize: 13, fontWeight: 600, color: '#047857' }}>
                        Preview: {parsedCsvRows.length} valid row(s) ready to import
                      </span>
                    </div>
                    <div className="preview-table-wrap">
                      <table className="mini-preview-table">
                        <thead>
                          <tr>
                            <th>Code</th>
                            <th>Date</th>
                            <th>First In</th>
                            <th>Last Out</th>
                          </tr>
                        </thead>
                        <tbody>
                          {parsedCsvRows.slice(0, 5).map((row, idx) => (
                            <tr key={idx}>
                              <td>{row.employeeCode}</td>
                              <td>{row.workDate}</td>
                              <td>{row.firstLoginAt ? formatTimeOnly(row.firstLoginAt) : '—'}</td>
                              <td>{row.lastLoginAt ? formatTimeOnly(row.lastLoginAt) : '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {parsedCsvRows.length > 5 && (
                        <p
                          style={{
                            margin: '4px 0 0',
                            fontSize: 11.5,
                            color: 'var(--text-tertiary)',
                            textAlign: 'center',
                          }}
                        >
                          + {parsedCsvRows.length - 5} more rows
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="window-footer">
                <Button variant="secondary" type="button" onClick={() => setImportOpen(false)}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  type="submit"
                  disabled={importSubmitting || parsedCsvRows.length === 0}
                >
                  {importSubmitting ? 'Importing...' : `Import ${parsedCsvRows.length} Signals`}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Enhanced Styles */}
      <style>{`
        .att-container {
          display: flex;
          flex-direction: column;
          gap: 18px;
          padding-bottom: 40px;
        }

        .att-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          flex-wrap: wrap;
          gap: 16px;
        }

        .signal-badge {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          background: #fef3c7;
          color: #92400e;
          border: 1px solid #fde68a;
          padding: 3px 9px;
          border-radius: 9999px;
          font-size: 12px;
          font-weight: 600;
        }

        .pulse-icon {
          color: #d97706;
          animation: pulse 2s infinite;
        }

        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }

        .att-actions {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }

        .btn-secondary-link {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          background: #fff;
          color: var(--text-primary);
          border: 1.5px solid var(--border-default);
          border-radius: 8px;
          padding: 7px 12px;
          font-size: 13.5px;
          font-weight: 500;
          text-decoration: none;
          transition: all 0.15s ease;
        }

        .btn-secondary-link:hover {
          background: var(--surface-subtle);
          border-color: var(--border-strong);
        }

        /* KPI Overview Grid */
        .kpi-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
          gap: 14px;
        }

        .kpi-card {
          background: #fff;
          border: 1.5px solid var(--border-default);
          border-radius: 12px;
          padding: 14px 16px;
          display: flex;
          align-items: center;
          gap: 14px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.03);
          transition: transform 0.15s ease, box-shadow 0.15s ease;
        }

        .kpi-card:hover {
          transform: translateY(-1px);
          box-shadow: 0 4px 10px rgba(0,0,0,0.05);
        }

        .kpi-icon-wrap {
          width: 42px;
          height: 42px;
          border-radius: 10px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }

        .kpi-content {
          display: flex;
          flex-direction: column;
          gap: 2px;
          overflow: hidden;
        }

        .kpi-label {
          font-size: 12px;
          font-weight: 600;
          color: var(--text-secondary);
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }

        .kpi-value-row {
          display: flex;
          align-items: baseline;
          gap: 8px;
          flex-wrap: wrap;
        }

        .kpi-value {
          font-size: 22px;
          font-weight: 700;
          color: var(--text-primary);
          letter-spacing: -0.02em;
        }

        .kpi-subtext {
          font-size: 12.5px;
          color: var(--text-tertiary);
        }

        .kpi-name-tag {
          font-size: 11.5px;
          font-weight: 600;
          background: #eff6ff;
          color: #1d4ed8;
          padding: 2px 6px;
          border-radius: 4px;
          max-width: 90px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        /* Philosophy Callout */
        .philosophy-callout {
          display: flex;
          gap: 12px;
          background: #fffbeb;
          border: 1.5px solid #fde68a;
          border-radius: 12px;
          padding: 14px 16px;
          align-items: flex-start;
        }

        .callout-icon {
          flex-shrink: 0;
          margin-top: 1px;
        }

        /* Filter Bar */
        .filter-bar {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
          background: #fff;
          border: 1.5px solid var(--border-default);
          border-radius: 12px;
          padding: 10px 14px;
        }

        .search-wrap {
          display: flex;
          align-items: center;
          gap: 8px;
          flex: 1;
          min-width: 220px;
          position: relative;
        }

        .search-icon {
          color: var(--text-tertiary);
          position: absolute;
          left: 10px;
        }

        .search-input {
          width: 100%;
          border: 1.5px solid var(--border-default);
          border-radius: 8px;
          padding: 7px 32px 7px 32px;
          font-size: 13.5px;
          background: #fff;
          transition: border-color 0.15s ease;
        }

        .search-input:focus {
          outline: none;
          border-color: var(--brand-primary);
        }

        .clear-btn {
          position: absolute;
          right: 8px;
          background: none;
          border: none;
          color: var(--text-tertiary);
          cursor: pointer;
          padding: 4px;
        }

        .date-filter-group {
          display: flex;
          align-items: center;
          gap: 4px;
          border: 1.5px solid var(--border-default);
          border-radius: 8px;
          padding: 2px;
          background: var(--surface-subtle);
        }

        .date-preset-btn {
          border: none;
          background: none;
          padding: 5px 10px;
          font-size: 12.5px;
          font-weight: 500;
          color: var(--text-secondary);
          border-radius: 6px;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .date-preset-btn.is-active {
          background: #fff;
          color: var(--text-primary);
          font-weight: 600;
          box-shadow: 0 1px 2px rgba(0,0,0,0.06);
        }

        .custom-date-picker {
          border: none;
          background: transparent;
          font-size: 12.5px;
          padding: 4px 6px;
          color: var(--text-primary);
          outline: none;
          cursor: pointer;
        }

        .filter-select-wrap {
          display: flex;
          align-items: center;
          gap: 6px;
          border: 1.5px solid var(--border-default);
          border-radius: 8px;
          padding: 5px 10px;
          background: #fff;
        }

        .att-select {
          border: none;
          background: transparent;
          font-size: 13px;
          color: var(--text-primary);
          outline: none;
          cursor: pointer;
        }

        /* High-Contrast Table */
        .table-card {
          background: #fff;
          border: 1.5px solid var(--border-default);
          border-radius: 14px;
          overflow: hidden;
          box-shadow: 0 1px 3px rgba(0,0,0,0.02);
        }

        .table-responsive {
          width: 100%;
          overflow-x: auto;
        }

        .att-table {
          width: 100%;
          border-collapse: collapse;
          text-align: left;
        }

        .att-table th {
          background: #f8fafc;
          color: #334155;
          font-size: 12px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          padding: 12px 16px;
          border-bottom: 2px solid #cbd5e1;
        }

        .att-table td {
          padding: 13px 16px;
          border-bottom: 1.5px solid var(--border-subtle);
          font-size: 13.5px;
          color: var(--text-primary);
        }

        .att-table tr:last-child td {
          border-bottom: none;
        }

        .att-table tr:hover td {
          background: #f8fafc;
        }

        .row-today td {
          background: #f0fdf4;
        }

        .row-today:hover td {
          background: #dcfce7;
        }

        /* Table Cells */
        .emp-cell {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .emp-avatar {
          width: 34px;
          height: 34px;
          border-radius: 50%;
          background: #e2e8f0;
          color: #334155;
          font-size: 12.5px;
          font-weight: 700;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }

        .emp-avatar.lg {
          width: 44px;
          height: 44px;
          font-size: 15px;
          background: #cbd5e1;
          color: #1e293b;
        }

        .emp-name-row {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .emp-name {
          font-weight: 600;
          color: var(--text-primary);
        }

        .emp-code-badge {
          font-family: var(--font-mono);
          font-size: 11px;
          background: #f1f5f9;
          color: #475569;
          padding: 1px 5px;
          border-radius: 4px;
          border: 1px solid #cbd5e1;
        }

        .emp-sub {
          display: block;
          font-size: 12px;
          color: var(--text-tertiary);
        }

        .date-cell {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .mono-date {
          font-family: var(--font-mono);
          font-size: 12.5px;
          color: var(--text-secondary);
        }

        .today-badge {
          background: #dcfce7;
          color: #15803d;
          font-size: 11px;
          font-weight: 700;
          padding: 1px 6px;
          border-radius: 4px;
        }

        .source-pill {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          font-size: 12px;
          font-weight: 600;
          padding: 3px 8px;
          border-radius: 6px;
        }

        .source-pill.login-pill {
          background: #ecfdf5;
          color: #065f46;
          border: 1px solid #a7f3d0;
        }

        .source-pill.import-pill {
          background: #eff6ff;
          color: #1e40af;
          border: 1px solid #bfdbfe;
        }

        .pulse-dot {
          color: #10b981;
          animation: pulse 1.5s infinite;
        }

        .time-cell {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .mono-time {
          font-family: var(--font-mono);
          font-size: 12.5px;
          color: var(--text-primary);
        }

        .span-cell {
          display: flex;
          align-items: center;
          gap: 5px;
        }

        .span-text {
          font-size: 12.5px;
          font-weight: 500;
          color: var(--text-secondary);
        }

        .correction-pill {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          background: #fffbeb;
          color: #b45309;
          border: 1px solid #fde68a;
          font-size: 11.5px;
          font-weight: 600;
          padding: 2px 7px;
          border-radius: 4px;
        }

        .actions-cell {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 6px;
        }

        .icon-action-btn {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          background: #fff;
          border: 1.5px solid var(--border-default);
          border-radius: 6px;
          padding: 5px 8px;
          font-size: 12px;
          font-weight: 600;
          color: var(--text-secondary);
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .icon-action-btn:hover {
          background: var(--surface-subtle);
          color: var(--text-primary);
          border-color: var(--border-strong);
        }

        .icon-action-btn.highlight:hover {
          background: #f0fdf4;
          color: #166534;
          border-color: #86efac;
        }

        /* Floating Windows / Modals */
        .modal-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(15, 23, 42, 0.55);
          backdrop-filter: blur(6px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 100;
          padding: 16px;
          animation: fadeIn 0.15s ease-out;
        }

        .floating-window {
          background: #fff;
          border-radius: 22px;
          border: 1px solid var(--border-subtle);
          box-shadow: 0 28px 60px -12px rgba(15, 23, 42, 0.25);
          width: 100%;
          max-width: 820px;
          max-height: 90vh;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          animation: scaleUp 0.18s cubic-bezier(0.16, 1, 0.3, 1);
        }

        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        @keyframes scaleUp {
          from { transform: scale(0.96); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }

        .window-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 20px 24px;
          border-bottom: 1.5px solid var(--border-subtle);
          background: #fafafa;
        }

        .close-modal-btn {
          background: none;
          border: none;
          color: var(--text-tertiary);
          cursor: pointer;
          padding: 6px;
          border-radius: 8px;
          transition: background 0.15s ease;
        }

        .close-modal-btn:hover {
          background: #f1f5f9;
          color: var(--text-primary);
        }

        .window-body {
          padding: 20px 24px;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .window-footer {
          padding: 16px 24px;
          border-top: 1.5px solid var(--border-subtle);
          display: flex;
          justify-content: flex-end;
          gap: 10px;
          background: #fafafa;
        }

        /* Detail Meta Grid */
        .detail-meta-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 10px;
        }

        .meta-box {
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          padding: 10px 12px;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .meta-label {
          font-size: 11.5px;
          font-weight: 600;
          color: var(--text-tertiary);
          text-transform: uppercase;
        }

        .meta-val {
          font-size: 13.5px;
          color: var(--text-primary);
        }

        .meta-val.mono {
          font-family: var(--font-mono);
        }

        .detail-section {
          background: #fff;
          border: 1px solid var(--border-subtle);
          border-radius: 10px;
          padding: 14px;
        }

        .correction-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
          margin-top: 8px;
        }

        .correction-item {
          background: #fffbeb;
          border: 1px solid #fde68a;
          border-radius: 8px;
          padding: 10px 12px;
        }

        .field-tag {
          font-family: var(--font-mono);
          font-size: 11.5px;
          font-weight: 600;
          color: #92400e;
        }

        .json-box {
          margin: 0;
          background: #0f172a;
          color: #f8fafc;
          padding: 10px 12px;
          border-radius: 8px;
          font-family: var(--font-mono);
          font-size: 12px;
          overflow-x: auto;
          max-height: 140px;
        }

        /* Form Controls */
        .form-field {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .form-field label {
          font-size: 13px;
          font-weight: 600;
          color: var(--text-primary);
        }

        .att-input {
          border: 1.5px solid var(--border-default);
          border-radius: 8px;
          padding: 8px 12px;
          font-size: 13.5px;
          color: var(--text-primary);
          outline: none;
          transition: border-color 0.15s ease;
        }

        .att-input:focus {
          border-color: var(--brand-primary);
        }

        .att-input.mono {
          font-family: var(--font-mono);
          font-size: 12.5px;
        }

        .att-textarea {
          border: 1.5px solid var(--border-default);
          border-radius: 8px;
          padding: 8px 12px;
          font-size: 13px;
          color: var(--text-primary);
          outline: none;
          resize: vertical;
          transition: border-color 0.15s ease;
        }

        .att-textarea:focus {
          border-color: var(--brand-primary);
        }

        .att-textarea.mono {
          font-family: var(--font-mono);
          font-size: 12px;
        }

        .form-error-banner {
          display: flex;
          align-items: center;
          gap: 8px;
          background: #fef2f2;
          color: #b91c1c;
          border: 1px solid #fecaca;
          padding: 10px 12px;
          border-radius: 8px;
          font-size: 13px;
        }

        .form-success-banner {
          display: flex;
          align-items: center;
          gap: 8px;
          background: #ecfdf5;
          color: #065f46;
          border: 1px solid #a7f3d0;
          padding: 10px 12px;
          border-radius: 8px;
          font-size: 13px;
        }

        /* Upload Dropzone */
        .upload-dropzone {
          border: 2px dashed #cbd5e1;
          border-radius: 12px;
          padding: 20px;
          text-align: center;
          background: #f8fafc;
          display: flex;
          flex-direction: column;
          align-items: center;
        }

        .file-input-btn {
          font-size: 13px;
          cursor: pointer;
        }

        .link-action {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          font-size: 12.5px;
          color: var(--brand-primary);
          text-decoration: none;
          font-weight: 500;
        }

        .link-action:hover {
          text-decoration: underline;
        }

        .preview-table-wrap {
          border: 1px solid var(--border-subtle);
          border-radius: 8px;
          overflow: hidden;
          padding: 6px;
          background: #f8fafc;
        }

        .mini-preview-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 12px;
        }

        .mini-preview-table th {
          text-align: left;
          padding: 4px 8px;
          color: var(--text-tertiary);
          font-weight: 600;
        }

        .mini-preview-table td {
          padding: 4px 8px;
          border-top: 1px solid var(--border-subtle);
          font-family: var(--font-mono);
          font-size: 11.5px;
        }

        .loading-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 48px;
          color: var(--text-tertiary);
          gap: 12px;
        }

        .spin {
          animation: rotate 1s linear infinite;
        }

        @keyframes rotate {
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
