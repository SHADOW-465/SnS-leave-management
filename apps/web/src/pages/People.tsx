import { useState, useMemo, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, EmptyState, StatusPill, Select } from '@sns/ui';
import { api, can, type Me } from '../api.js';
import { initials, formatDate } from '../format.js';
import {
  Users,
  UserPlus,
  UserCheck,
  UserX,
  Building2,
  Network,
  Plus,
  Edit3,
  KeyRound,
  Copy,
  Check,
  X,
  ShieldAlert,
  RotateCcw,
  UserMinus,
} from 'lucide-react';

interface EmployeeRecord {
  id: string;
  employee_code: string;
  first_name: string;
  last_name: string;
  work_email: string;
  joined_on: string;
  probation_end_on: string | null;
  exited_on: string | null;
  department_id: string;
  department_name: string;
  team_id: string | null;
  team_name: string | null;
  location_id: string;
  location_name: string;
  job_title_id: string;
  job_title_name: string;
  employment_type_id: string;
  employment_name: string;
  manager_employee_id: string | null;
  manager_name: string | null;
  status: 'active' | 'probation' | 'notice' | 'exited' | 'suspended';
  version: number;
  user_account_id: string | null;
  account_disabled: number | null;
}

interface DepartmentRecord {
  id: string;
  name: string;
  code: string;
  head_employee_id: string | null;
  head_employee_name: string | null;
  employee_count: number;
  team_count: number;
  archived_at: string | null;
}

interface TeamRecord {
  id: string;
  department_id: string;
  department_name: string;
  department_code: string;
  name: string;
  lead_employee_id: string | null;
  lead_employee_name: string | null;
  member_count: number;
  archived_at: string | null;
}

interface OrgData {
  locations: { id: string; name: string }[];
  departments: { id: string; name: string; code?: string }[];
  teams?: { id: string; name: string; department_id?: string }[];
  jobTitles: { id: string; name: string }[];
  employmentTypes: { id: string; name: string }[];
}

export function PeoplePage({ me }: { me: Me }) {
  const [tab, setTab] = useState<'employees' | 'departments' | 'teams'>('employees');

  // Employee Filters
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('ALL');
  const [teamFilter, setTeamFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');

  // Department Filters
  const [deptSearch, setDeptSearch] = useState('');

  // Team Filters
  const [teamSearch, setTeamSearch] = useState('');
  const [teamDeptFilter, setTeamDeptFilter] = useState('ALL');

  // Modals state - Employee
  const [createOpen, setCreateOpen] = useState(false);
  const [editingEmp, setEditingEmp] = useState<EmployeeRecord | null>(null);
  const [deactivatingEmp, setDeactivatingEmp] = useState<EmployeeRecord | null>(null);
  const [reactivatingEmp, setReactivatingEmp] = useState<EmployeeRecord | null>(null);
  const [resettingEmp, setResettingEmp] = useState<EmployeeRecord | null>(null);
  const [tempPasswordInfo, setTempPasswordInfo] = useState<{
    name: string;
    email: string;
    temp: string;
  } | null>(null);

  // Modals state - Department
  const [createDeptOpen, setCreateDeptOpen] = useState(false);
  const [editingDept, setEditingDept] = useState<DepartmentRecord | null>(null);
  const [archivingDept, setArchivingDept] = useState<DepartmentRecord | null>(null);

  // Modals state - Team
  const [createTeamOpen, setCreateTeamOpen] = useState(false);
  const [editingTeam, setEditingTeam] = useState<TeamRecord | null>(null);
  const [managingTeam, setManagingTeam] = useState<TeamRecord | null>(null);
  const [archivingTeam, setArchivingTeam] = useState<TeamRecord | null>(null);

  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ['people', search],
    queryFn: () => api<EmployeeRecord[]>(`/api/v1/employees?search=${encodeURIComponent(search)}`),
  });

  const deptsQuery = useQuery({
    queryKey: ['departments'],
    queryFn: () => api<DepartmentRecord[]>('/api/v1/departments'),
    enabled: can(me, 'employee.read'),
  });

  const teamsQuery = useQuery({
    queryKey: ['teams'],
    queryFn: () => api<TeamRecord[]>('/api/v1/teams'),
    enabled: can(me, 'employee.read'),
  });

  const org = useQuery({
    queryKey: ['org'],
    queryFn: () => api<OrgData>('/api/v1/org'),
    enabled: can(me, 'employee.read'),
  });

  const employees = useMemo(() => q.data ?? [], [q.data]);
  const departments = useMemo(() => deptsQuery.data ?? [], [deptsQuery.data]);
  const teams = useMemo(() => teamsQuery.data ?? [], [teamsQuery.data]);

  const filteredEmployees = useMemo(() => {
    return employees.filter((emp) => {
      if (deptFilter !== 'ALL' && emp.department_id !== deptFilter) return false;
      if (teamFilter !== 'ALL' && emp.team_id !== teamFilter) return false;
      if (statusFilter !== 'ALL' && emp.status !== statusFilter) return false;
      return true;
    });
  }, [employees, deptFilter, teamFilter, statusFilter]);

  const filteredDepartments = useMemo(() => {
    const s = deptSearch.trim().toLowerCase();
    return departments.filter((d) => {
      if (!s) return true;
      return (
        d.name.toLowerCase().includes(s) ||
        d.code.toLowerCase().includes(s) ||
        (d.head_employee_name && d.head_employee_name.toLowerCase().includes(s))
      );
    });
  }, [departments, deptSearch]);

  const filteredTeams = useMemo(() => {
    const s = teamSearch.trim().toLowerCase();
    return teams.filter((t) => {
      if (teamDeptFilter !== 'ALL' && t.department_id !== teamDeptFilter) return false;
      if (!s) return true;
      return (
        t.name.toLowerCase().includes(s) ||
        t.department_name.toLowerCase().includes(s) ||
        (t.lead_employee_name && t.lead_employee_name.toLowerCase().includes(s))
      );
    });
  }, [teams, teamSearch, teamDeptFilter]);

  const stats = useMemo(() => {
    const total = employees.length;
    let active = 0;
    let probation = 0;
    let exited = 0;
    for (const emp of employees) {
      if (emp.status === 'active') active++;
      else if (emp.status === 'probation') probation++;
      else if (emp.status === 'exited') exited++;
    }
    return { total, active, probation, exited };
  }, [employees]);

  const canCreate = can(me, 'employee.create:company');
  const canUpdate = can(me, 'employee.update:company');
  const canArchive = can(me, 'employee.archive:company');
  const canManageOrg = can(me, 'org.structure.manage:company');

  return (
    <div className="page" style={{ maxWidth: 1280 }}>
      {/* Tab Navigation */}
      <div className="org-tabs-bar">
        <button
          type="button"
          className={`org-tab-btn ${tab === 'employees' ? 'active' : ''}`}
          onClick={() => setTab('employees')}
        >
          <Users size={16} />
          <span>Employees</span>
          <span className="org-tab-badge">{stats.total}</span>
        </button>

        <button
          type="button"
          className={`org-tab-btn ${tab === 'departments' ? 'active' : ''}`}
          onClick={() => setTab('departments')}
        >
          <Building2 size={16} />
          <span>Departments</span>
          <span className="org-tab-badge">{departments.length}</span>
        </button>

        <button
          type="button"
          className={`org-tab-btn ${tab === 'teams' ? 'active' : ''}`}
          onClick={() => setTab('teams')}
        >
          <Network size={16} />
          <span>Teams</span>
          <span className="org-tab-badge">{teams.length}</span>
        </button>
      </div>

      {/* TAB 1: EMPLOYEES */}
      {tab === 'employees' && (
        <>
          {/* Top KPI Summary */}
          <div className="people-kpi-grid">
            <div className="people-kpi-card">
              <div className="people-kpi-icon" style={{ background: '#e0e7ff', color: '#4338ca' }}>
                <Users size={18} />
              </div>
              <div>
                <span className="people-kpi-label">Total Employees</span>
                <strong className="people-kpi-val">{stats.total}</strong>
              </div>
            </div>

            <div className="people-kpi-card">
              <div className="people-kpi-icon" style={{ background: '#dcfce7', color: '#15803d' }}>
                <UserCheck size={18} />
              </div>
              <div>
                <span className="people-kpi-label">Active</span>
                <strong className="people-kpi-val">{stats.active}</strong>
              </div>
            </div>

            <div className="people-kpi-card">
              <div className="people-kpi-icon" style={{ background: '#fef3c7', color: '#b45309' }}>
                <Users size={18} />
              </div>
              <div>
                <span className="people-kpi-label">On Probation</span>
                <strong className="people-kpi-val">{stats.probation}</strong>
              </div>
            </div>

            <div className="people-kpi-card">
              <div className="people-kpi-icon" style={{ background: '#fee2e2', color: '#b91c1c' }}>
                <UserX size={18} />
              </div>
              <div>
                <span className="people-kpi-label">Exited / Inactive</span>
                <strong className="people-kpi-val">{stats.exited}</strong>
              </div>
            </div>
          </div>

          {/* Action & Filter Toolbar */}
          <div className="people-toolbar">
            <div className="people-search-filters">
              <input
                type="search"
                placeholder="Search name, email, code or role…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="people-search-input"
              />

              {org.data?.departments?.length ? (
                <Select
                  value={deptFilter}
                  onChange={setDeptFilter}
                  aria-label="Filter by department"
                  options={[
                    { value: 'ALL', label: 'All Departments' },
                    ...org.data.departments.map((d) => ({
                      value: d.id,
                      label: d.name,
                    })),
                  ]}
                />
              ) : null}

              {teams.length ? (
                <Select
                  value={teamFilter}
                  onChange={setTeamFilter}
                  aria-label="Filter by team"
                  options={[
                    { value: 'ALL', label: 'All Teams' },
                    ...teams.map((t) => ({
                      value: t.id,
                      label: `${t.name} (${t.department_name})`,
                    })),
                  ]}
                />
              ) : null}

              <Select
                value={statusFilter}
                onChange={setStatusFilter}
                aria-label="Filter by status"
                options={[
                  { value: 'ALL', label: 'All Statuses' },
                  { value: 'active', label: 'Active' },
                  { value: 'probation', label: 'Probation' },
                  { value: 'notice', label: 'Notice Period' },
                  { value: 'exited', label: 'Exited' },
                  { value: 'suspended', label: 'Suspended' },
                ]}
              />
            </div>

            {canCreate && (
              <Button
                variant="primary"
                onClick={() => setCreateOpen(true)}
                className="people-add-btn"
              >
                <UserPlus size={16} />
                <span>Add Employee</span>
              </Button>
            )}
          </div>

          {/* Employee Table */}
          {filteredEmployees.length === 0 ? (
            <div className="card" style={{ padding: '40px 24px', textAlign: 'center' }}>
              <EmptyState
                title={
                  search || deptFilter !== 'ALL' || statusFilter !== 'ALL'
                    ? 'No matching employees'
                    : 'No employees found'
                }
                body={
                  search || deptFilter !== 'ALL' || statusFilter !== 'ALL'
                    ? 'Try clearing filters or adjusting your search term.'
                    : 'Get started by adding your first employee.'
                }
              />
            </div>
          ) : (
            <div className="card card-flush people-table-wrap">
              <table className="people-table">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Code</th>
                    <th>Department & Team</th>
                    <th>Job Title</th>
                    <th>Manager</th>
                    <th>Joined</th>
                    <th>Status</th>
                    {(canUpdate || canArchive) && <th style={{ textAlign: 'right' }}>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {filteredEmployees.map((emp) => {
                    const isExited = emp.status === 'exited';
                    return (
                      <tr key={emp.id} className={isExited ? 'row-exited' : ''}>
                        <td>
                          <div className="emp-user-cell">
                            <div className="emp-avatar">
                              {initials(`${emp.first_name} ${emp.last_name}`)}
                            </div>
                            <div className="emp-info">
                              <span className="emp-name">
                                {emp.first_name} {emp.last_name}
                              </span>
                              <span className="emp-email">{emp.work_email}</span>
                            </div>
                          </div>
                        </td>
                        <td>
                          <span className="emp-code">{emp.employee_code}</span>
                        </td>
                        <td>
                          <div className="emp-dept">{emp.department_name}</div>
                          {emp.team_name && <div className="emp-team-tag">{emp.team_name}</div>}
                        </td>
                        <td>
                          <span className="emp-job">{emp.job_title_name}</span>
                        </td>
                        <td>
                          <span className="emp-mgr">{emp.manager_name ?? '—'}</span>
                        </td>
                        <td>
                          <span className="emp-date">{formatDate(emp.joined_on)}</span>
                        </td>
                        <td>
                          <StatusPill status={emp.status} />
                        </td>
                        {(canUpdate || canArchive) && (
                          <td style={{ textAlign: 'right' }}>
                            <div className="emp-actions-wrap">
                              {canUpdate && (
                                <button
                                  type="button"
                                  className="icon-action-btn"
                                  title="Edit profile"
                                  onClick={() => setEditingEmp(emp)}
                                >
                                  <Edit3 size={15} />
                                </button>
                              )}

                              {canUpdate && (
                                <button
                                  type="button"
                                  className="icon-action-btn"
                                  title="Reset password"
                                  onClick={() => setResettingEmp(emp)}
                                >
                                  <KeyRound size={15} />
                                </button>
                              )}

                              {isExited && canUpdate && (
                                <button
                                  type="button"
                                  className="icon-action-btn btn-reactivate"
                                  title="Reactivate employee"
                                  onClick={() => setReactivatingEmp(emp)}
                                >
                                  <RotateCcw size={15} />
                                </button>
                              )}

                              {!isExited && canArchive && (
                                <button
                                  type="button"
                                  className="icon-action-btn btn-danger"
                                  title="Deactivate / Remove employee"
                                  onClick={() => setDeactivatingEmp(emp)}
                                >
                                  <UserX size={15} />
                                </button>
                              )}
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* TAB 2: DEPARTMENTS */}
      {tab === 'departments' && (
        <>
          {/* Department Toolbar */}
          <div className="people-toolbar">
            <div className="people-search-filters">
              <input
                type="search"
                placeholder="Search department name or code…"
                value={deptSearch}
                onChange={(e) => setDeptSearch(e.target.value)}
                className="people-search-input"
              />
            </div>

            {canManageOrg && (
              <Button
                variant="primary"
                onClick={() => setCreateDeptOpen(true)}
                className="people-add-btn"
              >
                <Plus size={16} />
                <span>Add Department</span>
              </Button>
            )}
          </div>

          {/* Department Cards / Table */}
          {filteredDepartments.length === 0 ? (
            <div className="card" style={{ padding: '40px 24px', textAlign: 'center' }}>
              <EmptyState
                title={deptSearch ? 'No matching departments' : 'No departments configured'}
                body={
                  deptSearch
                    ? 'Try adjusting your search.'
                    : 'Create departments to organize your employees.'
                }
              />
            </div>
          ) : (
            <div className="dept-grid">
              {filteredDepartments.map((dept) => (
                <div key={dept.id} className="dept-card card">
                  <div className="dept-card-header">
                    <div>
                      <div className="dept-card-title-row">
                        <span className="dept-card-code">{dept.code}</span>
                        <h3 className="dept-card-name">{dept.name}</h3>
                      </div>
                    </div>
                    {canManageOrg && (
                      <div className="emp-actions-wrap">
                        <button
                          type="button"
                          className="icon-action-btn"
                          title="Edit department"
                          onClick={() => setEditingDept(dept)}
                        >
                          <Edit3 size={15} />
                        </button>
                        <button
                          type="button"
                          className="icon-action-btn btn-danger"
                          title="Deactivate department"
                          onClick={() => setArchivingDept(dept)}
                        >
                          <UserX size={15} />
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="dept-card-body">
                    <div className="dept-meta-item">
                      <span className="dept-meta-label">Department Head</span>
                      <strong className="dept-meta-val">
                        {dept.head_employee_name ? (
                          dept.head_employee_name
                        ) : (
                          <span className="text-muted">Unassigned</span>
                        )}
                      </strong>
                    </div>

                    <div className="dept-stats-row">
                      <div className="dept-stat-box">
                        <span className="dept-stat-val">{dept.employee_count}</span>
                        <span className="dept-stat-lbl">Active Staff</span>
                      </div>
                      <div className="dept-stat-box">
                        <span className="dept-stat-val">{dept.team_count}</span>
                        <span className="dept-stat-lbl">Teams</span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* TAB 3: TEAMS */}
      {tab === 'teams' && (
        <>
          {/* Teams Toolbar */}
          <div className="people-toolbar">
            <div className="people-search-filters">
              <input
                type="search"
                placeholder="Search team or lead…"
                value={teamSearch}
                onChange={(e) => setTeamSearch(e.target.value)}
                className="people-search-input"
              />

              {departments.length > 0 && (
                <Select
                  value={teamDeptFilter}
                  onChange={setTeamDeptFilter}
                  aria-label="Filter teams by department"
                  options={[
                    { value: 'ALL', label: 'All Departments' },
                    ...departments.map((d) => ({
                      value: d.id,
                      label: `${d.name} (${d.code})`,
                    })),
                  ]}
                />
              )}
            </div>

            {canManageOrg && (
              <Button
                variant="primary"
                onClick={() => setCreateTeamOpen(true)}
                className="people-add-btn"
              >
                <Plus size={16} />
                <span>Add Team</span>
              </Button>
            )}
          </div>

          {/* Teams Grid */}
          {filteredTeams.length === 0 ? (
            <div className="card" style={{ padding: '40px 24px', textAlign: 'center' }}>
              <EmptyState
                title={
                  teamSearch || teamDeptFilter !== 'ALL'
                    ? 'No matching teams'
                    : 'No teams configured'
                }
                body={
                  teamSearch || teamDeptFilter !== 'ALL'
                    ? 'Try adjusting your search filters.'
                    : 'Create teams under departments to assign employees and leads.'
                }
              />
            </div>
          ) : (
            <div className="dept-grid">
              {filteredTeams.map((team) => (
                <div key={team.id} className="dept-card card">
                  <div className="dept-card-header">
                    <div>
                      <span className="dept-card-dept-tag">{team.department_name}</span>
                      <h3 className="dept-card-name" style={{ marginTop: 4 }}>
                        {team.name}
                      </h3>
                    </div>
                    {canManageOrg && (
                      <div className="emp-actions-wrap">
                        <button
                          type="button"
                          className="icon-action-btn"
                          title="Manage team members"
                          onClick={() => setManagingTeam(team)}
                        >
                          <Users size={15} />
                        </button>
                        <button
                          type="button"
                          className="icon-action-btn"
                          title="Edit team"
                          onClick={() => setEditingTeam(team)}
                        >
                          <Edit3 size={15} />
                        </button>
                        <button
                          type="button"
                          className="icon-action-btn btn-danger"
                          title="Deactivate team"
                          onClick={() => setArchivingTeam(team)}
                        >
                          <UserX size={15} />
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="dept-card-body">
                    <div className="dept-meta-item">
                      <span className="dept-meta-label">Team Lead</span>
                      <strong className="dept-meta-val">
                        {team.lead_employee_name ? (
                          team.lead_employee_name
                        ) : (
                          <span className="text-muted">Unassigned</span>
                        )}
                      </strong>
                    </div>

                    <div className="dept-stats-row">
                      <div className="dept-stat-box" style={{ flex: 1 }}>
                        <span className="dept-stat-val">{team.member_count}</span>
                        <span className="dept-stat-lbl">Members Assigned</span>
                      </div>
                      {canManageOrg && (
                        <button
                          type="button"
                          className="dept-stat-action-btn"
                          onClick={() => setManagingTeam(team)}
                        >
                          Manage Members →
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* MODALS */}
      {/* 1. Add Employee Modal */}
      {createOpen && org.data && (
        <CreateEmployeeModal
          org={org.data}
          employees={employees}
          onClose={() => setCreateOpen(false)}
          onSuccess={() => {
            setCreateOpen(false);
            void qc.invalidateQueries({ queryKey: ['people'] });
            void qc.invalidateQueries({ queryKey: ['departments'] });
            void qc.invalidateQueries({ queryKey: ['teams'] });
            void qc.invalidateQueries({ queryKey: ['org'] });
          }}
          onTempPassword={(info) => setTempPasswordInfo(info)}
        />
      )}

      {/* 2. Edit Employee Modal */}
      {editingEmp && org.data && (
        <EditEmployeeModal
          emp={editingEmp}
          org={org.data}
          employees={employees}
          onClose={() => setEditingEmp(null)}
          onSuccess={() => {
            setEditingEmp(null);
            void qc.invalidateQueries({ queryKey: ['people'] });
            void qc.invalidateQueries({ queryKey: ['departments'] });
            void qc.invalidateQueries({ queryKey: ['teams'] });
            void qc.invalidateQueries({ queryKey: ['org'] });
          }}
        />
      )}

      {/* 3. Deactivate Employee Modal */}
      {deactivatingEmp && (
        <DeactivateEmployeeModal
          emp={deactivatingEmp}
          onClose={() => setDeactivatingEmp(null)}
          onSuccess={() => {
            setDeactivatingEmp(null);
            void qc.invalidateQueries({ queryKey: ['people'] });
            void qc.invalidateQueries({ queryKey: ['departments'] });
            void qc.invalidateQueries({ queryKey: ['teams'] });
          }}
        />
      )}

      {/* 4. Reactivate Employee Modal */}
      {reactivatingEmp && (
        <ReactivateEmployeeModal
          emp={reactivatingEmp}
          onClose={() => setReactivatingEmp(null)}
          onSuccess={() => {
            setReactivatingEmp(null);
            void qc.invalidateQueries({ queryKey: ['people'] });
            void qc.invalidateQueries({ queryKey: ['departments'] });
            void qc.invalidateQueries({ queryKey: ['teams'] });
          }}
        />
      )}

      {/* 5. Reset Password Modal */}
      {resettingEmp && (
        <ResetPasswordModal
          emp={resettingEmp}
          onClose={() => setResettingEmp(null)}
          onSuccess={(info) => {
            setResettingEmp(null);
            setTempPasswordInfo(info);
          }}
        />
      )}

      {/* 6. Temporary Password Widget */}
      {tempPasswordInfo && (
        <TempPasswordModal info={tempPasswordInfo} onClose={() => setTempPasswordInfo(null)} />
      )}

      {/* 7. Create Department Modal */}
      {createDeptOpen && (
        <CreateDepartmentModal
          employees={employees}
          onClose={() => setCreateDeptOpen(false)}
          onSuccess={() => {
            setCreateDeptOpen(false);
            void qc.invalidateQueries({ queryKey: ['departments'] });
            void qc.invalidateQueries({ queryKey: ['org'] });
          }}
        />
      )}

      {/* 8. Edit Department Modal */}
      {editingDept && (
        <EditDepartmentModal
          dept={editingDept}
          employees={employees}
          onClose={() => setEditingDept(null)}
          onSuccess={() => {
            setEditingDept(null);
            void qc.invalidateQueries({ queryKey: ['departments'] });
            void qc.invalidateQueries({ queryKey: ['org'] });
            void qc.invalidateQueries({ queryKey: ['people'] });
          }}
        />
      )}

      {/* 9. Deactivate Department Modal */}
      {archivingDept && (
        <ArchiveDepartmentModal
          dept={archivingDept}
          onClose={() => setArchivingDept(null)}
          onSuccess={() => {
            setArchivingDept(null);
            void qc.invalidateQueries({ queryKey: ['departments'] });
            void qc.invalidateQueries({ queryKey: ['org'] });
          }}
        />
      )}

      {/* 10. Create Team Modal */}
      {createTeamOpen && (
        <CreateTeamModal
          departments={departments}
          employees={employees}
          onClose={() => setCreateTeamOpen(false)}
          onSuccess={() => {
            setCreateTeamOpen(false);
            void qc.invalidateQueries({ queryKey: ['teams'] });
            void qc.invalidateQueries({ queryKey: ['departments'] });
            void qc.invalidateQueries({ queryKey: ['org'] });
          }}
        />
      )}

      {/* 11. Edit Team Modal */}
      {editingTeam && (
        <EditTeamModal
          team={editingTeam}
          departments={departments}
          employees={employees}
          onClose={() => setEditingTeam(null)}
          onSuccess={() => {
            setEditingTeam(null);
            void qc.invalidateQueries({ queryKey: ['teams'] });
            void qc.invalidateQueries({ queryKey: ['departments'] });
            void qc.invalidateQueries({ queryKey: ['org'] });
            void qc.invalidateQueries({ queryKey: ['people'] });
          }}
        />
      )}

      {/* 12. Manage Team Members Modal */}
      {managingTeam && (
        <ManageTeamMembersModal
          team={managingTeam}
          employees={employees}
          onClose={() => setManagingTeam(null)}
          onSuccess={() => {
            setManagingTeam(null);
            void qc.invalidateQueries({ queryKey: ['teams'] });
            void qc.invalidateQueries({ queryKey: ['people'] });
          }}
        />
      )}

      {/* 13. Deactivate Team Modal */}
      {archivingTeam && (
        <ArchiveTeamModal
          team={archivingTeam}
          onClose={() => setArchivingTeam(null)}
          onSuccess={() => {
            setArchivingTeam(null);
            void qc.invalidateQueries({ queryKey: ['teams'] });
            void qc.invalidateQueries({ queryKey: ['departments'] });
            void qc.invalidateQueries({ queryKey: ['people'] });
          }}
        />
      )}

      {/* Styles */}
      <style>{`
        .org-tabs-bar {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 20px;
          border-bottom: 1px solid var(--border, #e2e8f0);
          padding-bottom: 12px;
        }
        .org-tab-btn {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 8px 16px;
          border-radius: 8px;
          border: 1px solid transparent;
          background: transparent;
          font-size: 14px;
          font-weight: 500;
          color: var(--muted, #64748b);
          cursor: pointer;
          transition: all 0.15s ease;
        }
        .org-tab-btn:hover {
          background: var(--bg-hover, #f1f5f9);
          color: var(--fg, #0f172a);
        }
        .org-tab-btn.active {
          background: var(--bg-active, #e0e7ff);
          color: #4338ca;
          font-weight: 600;
        }
        .org-tab-badge {
          display: inline-block;
          padding: 2px 7px;
          border-radius: 999px;
          font-size: 11px;
          background: rgba(0, 0, 0, 0.06);
          color: inherit;
        }
        .org-tab-btn.active .org-tab-badge {
          background: #c7d2fe;
          color: #3730a3;
        }

        .people-kpi-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
          gap: 16px;
          margin-bottom: 20px;
        }
        .people-kpi-card {
          background: var(--card-bg, #ffffff);
          border: 1px solid var(--border, #e2e8f0);
          border-radius: 12px;
          padding: 16px;
          display: flex;
          align-items: center;
          gap: 14px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.03);
        }
        .people-kpi-icon {
          width: 42px;
          height: 42px;
          border-radius: 10px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .people-kpi-label {
          display: block;
          font-size: 12px;
          color: var(--muted, #64748b);
          font-weight: 500;
        }
        .people-kpi-val {
          font-size: 20px;
          font-weight: 700;
          color: var(--fg, #0f172a);
        }

        .people-toolbar {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 20px;
        }
        .people-search-filters {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 10px;
          flex: 1;
        }
        .people-search-input {
          min-width: 240px;
          flex: 1;
          max-width: 380px;
          padding: 8px 12px;
          border-radius: 8px;
          border: 1px solid var(--border, #cbd5e1);
          background: var(--input-bg, #ffffff);
          color: var(--fg, #0f172a);
          font-size: 13.5px;
          outline: none;
        }
        .people-search-input:focus {
          border-color: #6366f1;
          box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.2);
        }
        .people-select-filter {
          appearance: none !important;
          -webkit-appearance: none !important;
          padding: 8px 32px 8px 12px;
          border-radius: 8px;
          border: 1px solid var(--border, #cbd5e1);
          background-color: var(--input-bg, #ffffff);
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E") !important;
          background-repeat: no-repeat !important;
          background-position: right 10px center !important;
          background-size: 14px 14px !important;
          color: var(--fg, #0f172a);
          font-size: 13.5px;
          cursor: pointer;
        }
        .people-add-btn {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 8px 16px;
          border-radius: 8px;
        }

        .people-table-wrap {
          overflow-x: auto;
          border-radius: 12px;
          border: 1px solid var(--border, #e2e8f0);
          background: var(--card-bg, #ffffff);
        }
        .people-table {
          width: 100%;
          border-collapse: collapse;
          text-align: left;
          font-size: 13.5px;
        }
        .people-table th {
          padding: 12px 16px;
          background: var(--table-th-bg, #f8fafc);
          border-bottom: 1px solid var(--border, #e2e8f0);
          font-weight: 600;
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: var(--muted, #64748b);
        }
        .people-table td {
          padding: 12px 16px;
          border-bottom: 1px solid var(--border-subtle, #f1f5f9);
          vertical-align: middle;
        }
        .people-table tr:last-child td {
          border-bottom: none;
        }
        .people-table tr:hover td {
          background: var(--table-hover, #f8fafc);
        }
        .row-exited td {
          opacity: 0.65;
        }

        .emp-user-cell {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .emp-avatar {
          width: 34px;
          height: 34px;
          border-radius: 50%;
          background: #e0e7ff;
          color: #4338ca;
          font-weight: 600;
          font-size: 12.5px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .emp-info {
          display: flex;
          flex-direction: column;
        }
        .emp-name {
          font-weight: 600;
          color: var(--fg, #0f172a);
        }
        .emp-email {
          font-size: 12px;
          color: var(--muted, #64748b);
        }
        .emp-code {
          font-family: monospace;
          font-size: 12px;
          padding: 2px 6px;
          background: var(--code-bg, #f1f5f9);
          border-radius: 4px;
          color: var(--fg, #0f172a);
        }
        .emp-dept {
          font-weight: 500;
          color: var(--fg, #0f172a);
        }
        .emp-team-tag {
          font-size: 11.5px;
          color: var(--muted, #64748b);
        }
        .emp-job {
          color: var(--fg, #0f172a);
        }
        .emp-mgr {
          color: var(--muted, #64748b);
          font-size: 13px;
        }
        .emp-date {
          font-size: 12.5px;
          color: var(--muted, #64748b);
        }

        .emp-actions-wrap {
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }
        .icon-action-btn {
          width: 30px;
          height: 30px;
          border-radius: 6px;
          border: 1px solid var(--border, #cbd5e1);
          background: var(--card-bg, #ffffff);
          color: var(--muted, #475569);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.15s ease;
        }
        .icon-action-btn:hover {
          background: var(--bg-hover, #f8fafc);
          color: var(--fg, #0f172a);
          border-color: #94a3b8;
        }
        .icon-action-btn.btn-danger:hover {
          background: #fef2f2;
          color: #dc2626;
          border-color: #fca5a5;
        }
        .icon-action-btn.btn-reactivate:hover {
          background: #f0fdf4;
          color: #16a34a;
          border-color: #86efac;
        }

        /* Department & Team Grid */
        .dept-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
          gap: 18px;
        }
        .dept-card {
          padding: 20px;
          border-radius: 12px;
          border: 1px solid var(--border, #e2e8f0);
          background: var(--card-bg, #ffffff);
          box-shadow: 0 1px 3px rgba(0,0,0,0.02);
          display: flex;
          flex-direction: column;
          justify-content: space-between;
        }
        .dept-card-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 16px;
        }
        .dept-card-code {
          display: inline-block;
          padding: 2px 7px;
          border-radius: 4px;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.04em;
          background: #e0e7ff;
          color: #4338ca;
        }
        .dept-card-dept-tag {
          display: inline-block;
          font-size: 12px;
          font-weight: 600;
          color: #6366f1;
        }
        .dept-card-name {
          margin: 6px 0 0;
          font-size: 16px;
          font-weight: 600;
          color: var(--fg, #0f172a);
        }
        .dept-card-body {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .dept-meta-item {
          font-size: 13px;
        }
        .dept-meta-label {
          display: block;
          font-size: 11.5px;
          color: var(--muted, #64748b);
          margin-bottom: 2px;
        }
        .dept-meta-val {
          color: var(--fg, #0f172a);
          font-weight: 500;
        }
        .dept-stats-row {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-top: 6px;
          padding-top: 12px;
          border-top: 1px solid var(--border-subtle, #f1f5f9);
        }
        .dept-stat-box {
          background: var(--bg-subtle, #f8fafc);
          border-radius: 8px;
          padding: 8px 12px;
          text-align: center;
          flex: 1;
        }
        .dept-stat-val {
          display: block;
          font-size: 16px;
          font-weight: 700;
          color: var(--fg, #0f172a);
        }
        .dept-stat-lbl {
          font-size: 11px;
          color: var(--muted, #64748b);
        }
        .dept-stat-action-btn {
          padding: 8px 14px;
          border-radius: 8px;
          background: #e0e7ff;
          color: #4338ca;
          border: none;
          font-size: 12.5px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.15s ease;
        }
        .dept-stat-action-btn:hover {
          background: #c7d2fe;
        }

        /* Modal Styles */
        .modal-overlay {
          position: fixed;
          inset: 0;
          background: rgba(15, 23, 42, 0.45);
          backdrop-filter: blur(4px);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
          z-index: 9999;
          animation: fadeIn 0.15s ease-out;
        }
        .curved-modal {
          background: var(--card-bg, #ffffff);
          border-radius: 22px;
          box-shadow: 0 28px 60px -12px rgba(15, 23, 42, 0.25), 0 8px 20px -4px rgba(15, 23, 42, 0.08);
          width: 100%;
          max-width: 780px;
          max-height: 90vh;
          overflow-y: auto;
          border: 1px solid var(--border, #e2e8f0);
          animation: scaleUp 0.15s ease-out;
        }
        .modal-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 18px 24px;
          border-bottom: 1px solid var(--border, #e2e8f0);
        }
        .modal-title {
          font-size: 17px;
          font-weight: 600;
          color: var(--fg, #0f172a);
          margin: 0;
        }
        .modal-close-btn {
          background: transparent;
          border: none;
          color: var(--muted, #94a3b8);
          cursor: pointer;
          padding: 4px;
          border-radius: 6px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .modal-close-btn:hover {
          background: var(--bg-hover, #f1f5f9);
          color: var(--fg, #0f172a);
        }
        .modal-body {
          padding: 20px 24px;
        }
        .modal-footer {
          padding: 16px 24px;
          border-top: 1px solid var(--border, #e2e8f0);
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 10px;
        }
        .form-grid-2 {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 14px;
        }
        .form-group {
          margin-bottom: 14px;
        }
        .form-label {
          display: block;
          font-size: 12.5px;
          font-weight: 600;
          color: var(--fg, #334155);
          margin-bottom: 5px;
        }
        .form-input {
          width: 100%;
          padding: 8px 12px;
          border-radius: 8px;
          border: 1px solid var(--border, #cbd5e1);
          background: var(--input-bg, #ffffff);
          color: var(--fg, #0f172a);
          font-size: 13.5px;
          box-sizing: border-box;
          outline: none;
        }
        select.form-input {
          appearance: none !important;
          -webkit-appearance: none !important;
          background-color: var(--input-bg, #ffffff);
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E") !important;
          background-repeat: no-repeat !important;
          background-position: right 10px center !important;
          background-size: 14px 14px !important;
          padding-right: 32px !important;
          cursor: pointer;
        }
        select.form-input option {
          background: #ffffff;
          color: #0f172a;
          padding: 8px 12px;
        }
        .form-input:focus {
          border-color: #6366f1;
          box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.2);
        }
        .form-error {
          padding: 10px 14px;
          background: #fef2f2;
          border: 1px solid #fecaca;
          color: #b91c1c;
          border-radius: 8px;
          font-size: 13px;
          margin-bottom: 14px;
        }

        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes scaleUp {
          from { transform: scale(0.96); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

/* -------------------------------------------------------------
 * MODAL COMPONENTS
 * ------------------------------------------------------------- */

function CreateEmployeeModal({
  org,
  employees,
  onClose,
  onSuccess,
  onTempPassword,
}: {
  org: OrgData;
  employees: EmployeeRecord[];
  onClose: () => void;
  onSuccess: () => void;
  onTempPassword: (info: { name: string; email: string; temp: string }) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedDeptId, setSelectedDeptId] = useState<string>(org.departments[0]?.id ?? '');

  const availableTeams = useMemo(() => {
    if (!org.teams) return [];
    return org.teams.filter((t) => !t.department_id || t.department_id === selectedDeptId);
  }, [org.teams, selectedDeptId]);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const fd = new FormData(e.currentTarget);

    const employeeCode = String(fd.get('employeeCode') ?? '').trim();
    const firstName = String(fd.get('firstName') ?? '').trim();
    const lastName = String(fd.get('lastName') ?? '').trim();
    const workEmail = String(fd.get('workEmail') ?? '').trim();
    const joinedOn = String(fd.get('joinedOn') ?? '').trim();
    const probationEndOn = String(fd.get('probationEndOn') ?? '').trim() || null;
    const locationId = String(fd.get('locationId') ?? '');
    const departmentId = selectedDeptId;
    const teamId = String(fd.get('teamId') ?? '') || null;
    const managerEmployeeId = String(fd.get('managerEmployeeId') ?? '') || null;
    const jobTitleId = String(fd.get('jobTitleId') ?? '');
    const employmentTypeId = String(fd.get('employmentTypeId') ?? '');
    const createAccount = fd.get('createAccount') === 'on';

    try {
      const res = await api<{ id: string; temporaryPassword?: string }>('/api/v1/employees', {
        method: 'POST',
        body: JSON.stringify({
          employeeCode,
          firstName,
          lastName,
          workEmail,
          joinedOn,
          probationEndOn,
          locationId,
          departmentId,
          teamId,
          managerEmployeeId,
          jobTitleId,
          employmentTypeId,
          createAccount,
        }),
      });

      onSuccess();
      if (res.temporaryPassword) {
        onTempPassword({
          name: `${firstName} ${lastName}`,
          email: workEmail,
          temp: res.temporaryPassword,
        });
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create employee');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="curved-modal" onClick={(e) => e.stopPropagation()}>
        <form
          onSubmit={(e) => {
            void handleSubmit(e);
          }}
        >
          <div className="modal-header">
            <h3 className="modal-title">Add New Employee</h3>
            <button type="button" className="modal-close-btn" onClick={onClose}>
              <X size={18} />
            </button>
          </div>

          <div className="modal-body">
            {error && <div className="form-error">{error}</div>}

            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label">First Name *</label>
                <input name="firstName" required className="form-input" placeholder="e.g. Maya" />
              </div>
              <div className="form-group">
                <label className="form-label">Last Name *</label>
                <input name="lastName" required className="form-input" placeholder="e.g. Lin" />
              </div>
            </div>

            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label">Employee Code *</label>
                <input
                  name="employeeCode"
                  required
                  className="form-input"
                  placeholder="e.g. EMP-105"
                />
              </div>
              <div className="form-group">
                <label className="form-label">Work Email *</label>
                <input
                  name="workEmail"
                  type="email"
                  required
                  className="form-input"
                  placeholder="name@example.invalid"
                />
              </div>
            </div>

            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label">Department *</label>
                <Select
                  value={selectedDeptId}
                  onChange={(val) => setSelectedDeptId(val)}
                  fullWidth
                  options={org.departments.map((d) => ({
                    value: d.id,
                    label: `${d.name}${d.code ? ` (${d.code})` : ''}`,
                  }))}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Team (Optional)</label>
                <Select
                  name="teamId"
                  fullWidth
                  options={[
                    { value: '', label: 'None / Unassigned' },
                    ...availableTeams.map((t) => ({ value: t.id, label: t.name })),
                  ]}
                />
              </div>
            </div>

            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label">Job Title *</label>
                <Select
                  name="jobTitleId"
                  required
                  fullWidth
                  options={org.jobTitles.map((jt) => ({ value: jt.id, label: jt.name }))}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Employment Type *</label>
                <Select
                  name="employmentTypeId"
                  required
                  fullWidth
                  options={org.employmentTypes.map((et) => ({ value: et.id, label: et.name }))}
                />
              </div>
            </div>

            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label">Location *</label>
                <Select
                  name="locationId"
                  required
                  fullWidth
                  options={org.locations.map((loc) => ({ value: loc.id, label: loc.name }))}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Manager (Optional)</label>
                <Select
                  name="managerEmployeeId"
                  fullWidth
                  options={[
                    { value: '', label: 'None (Top-level)' },
                    ...employees
                      .filter((e) => e.status !== 'exited')
                      .map((e) => ({
                        value: e.id,
                        label: `${e.first_name} ${e.last_name} (${e.department_name})`,
                      })),
                  ]}
                />
              </div>
            </div>

            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label">Joining Date *</label>
                <input
                  name="joinedOn"
                  type="date"
                  required
                  defaultValue={new Date().toISOString().slice(0, 10)}
                  className="form-input"
                />
              </div>
              <div className="form-group">
                <label className="form-label">Probation End Date</label>
                <input name="probationEndOn" type="date" className="form-input" />
              </div>
            </div>

            <div style={{ marginTop: 8 }}>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                <input name="createAccount" type="checkbox" defaultChecked />
                <span>Create login account and generate temporary password</span>
              </label>
            </div>
          </div>

          <div className="modal-footer">
            <Button variant="secondary" onClick={onClose} type="button" disabled={loading}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={loading}>
              {loading ? 'Creating…' : 'Add Employee'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EditEmployeeModal({
  emp,
  org,
  employees,
  onClose,
  onSuccess,
}: {
  emp: EmployeeRecord;
  org: OrgData;
  employees: EmployeeRecord[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedDeptId, setSelectedDeptId] = useState<string>(emp.department_id);

  const availableTeams = useMemo(() => {
    if (!org.teams) return [];
    return org.teams.filter((t) => !t.department_id || t.department_id === selectedDeptId);
  }, [org.teams, selectedDeptId]);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const fd = new FormData(e.currentTarget);

    const employeeCode = String(fd.get('employeeCode') ?? '').trim();
    const firstName = String(fd.get('firstName') ?? '').trim();
    const lastName = String(fd.get('lastName') ?? '').trim();
    const workEmail = String(fd.get('workEmail') ?? '').trim();
    const joinedOn = String(fd.get('joinedOn') ?? '').trim();
    const probationEndOn = String(fd.get('probationEndOn') ?? '').trim() || null;
    const locationId = String(fd.get('locationId') ?? '');
    const departmentId = selectedDeptId;
    const teamId = String(fd.get('teamId') ?? '') || null;
    const managerEmployeeId = String(fd.get('managerEmployeeId') ?? '') || null;
    const jobTitleId = String(fd.get('jobTitleId') ?? '');
    const employmentTypeId = String(fd.get('employmentTypeId') ?? '');
    const status = String(fd.get('status') ?? emp.status) as EmployeeRecord['status'];

    try {
      await api(`/api/v1/employees/${emp.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          employeeCode,
          firstName,
          lastName,
          workEmail,
          joinedOn,
          probationEndOn,
          locationId,
          departmentId,
          teamId,
          managerEmployeeId,
          jobTitleId,
          employmentTypeId,
          status,
          expectedVersion: emp.version,
        }),
      });
      onSuccess();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update employee');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="curved-modal" onClick={(e) => e.stopPropagation()}>
        <form
          onSubmit={(e) => {
            void handleSubmit(e);
          }}
        >
          <div className="modal-header">
            <h3 className="modal-title">
              Edit Employee: {emp.first_name} {emp.last_name}
            </h3>
            <button type="button" className="modal-close-btn" onClick={onClose}>
              <X size={18} />
            </button>
          </div>

          <div className="modal-body">
            {error && <div className="form-error">{error}</div>}

            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label">First Name *</label>
                <input
                  name="firstName"
                  required
                  defaultValue={emp.first_name}
                  className="form-input"
                />
              </div>
              <div className="form-group">
                <label className="form-label">Last Name *</label>
                <input
                  name="lastName"
                  required
                  defaultValue={emp.last_name}
                  className="form-input"
                />
              </div>
            </div>

            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label">Employee Code *</label>
                <input
                  name="employeeCode"
                  required
                  defaultValue={emp.employee_code}
                  className="form-input"
                />
              </div>
              <div className="form-group">
                <label className="form-label">Work Email *</label>
                <input
                  name="workEmail"
                  type="email"
                  required
                  defaultValue={emp.work_email}
                  className="form-input"
                />
              </div>
            </div>

            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label">Department *</label>
                <Select
                  value={selectedDeptId}
                  onChange={(val) => setSelectedDeptId(val)}
                  fullWidth
                  options={org.departments.map((d) => ({
                    value: d.id,
                    label: `${d.name}${d.code ? ` (${d.code})` : ''}`,
                  }))}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Team</label>
                <Select
                  name="teamId"
                  defaultValue={emp.team_id ?? ''}
                  fullWidth
                  options={[
                    { value: '', label: 'None / Unassigned' },
                    ...availableTeams.map((t) => ({ value: t.id, label: t.name })),
                  ]}
                />
              </div>
            </div>

            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label">Job Title *</label>
                <Select
                  name="jobTitleId"
                  defaultValue={emp.job_title_id}
                  required
                  fullWidth
                  options={org.jobTitles.map((jt) => ({ value: jt.id, label: jt.name }))}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Employment Type *</label>
                <Select
                  name="employmentTypeId"
                  defaultValue={emp.employment_type_id}
                  required
                  fullWidth
                  options={org.employmentTypes.map((et) => ({ value: et.id, label: et.name }))}
                />
              </div>
            </div>

            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label">Location *</label>
                <Select
                  name="locationId"
                  defaultValue={emp.location_id}
                  required
                  fullWidth
                  options={org.locations.map((loc) => ({ value: loc.id, label: loc.name }))}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Manager</label>
                <Select
                  name="managerEmployeeId"
                  defaultValue={emp.manager_employee_id ?? ''}
                  fullWidth
                  options={[
                    { value: '', label: 'None (Top-level)' },
                    ...employees
                      .filter((e) => e.id !== emp.id && e.status !== 'exited')
                      .map((e) => ({
                        value: e.id,
                        label: `${e.first_name} ${e.last_name} (${e.department_name})`,
                      })),
                  ]}
                />
              </div>
            </div>

            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label">Joining Date *</label>
                <input
                  name="joinedOn"
                  type="date"
                  required
                  defaultValue={emp.joined_on}
                  className="form-input"
                />
              </div>
              <div className="form-group">
                <label className="form-label">Probation End Date</label>
                <input
                  name="probationEndOn"
                  type="date"
                  defaultValue={emp.probation_end_on ?? ''}
                  className="form-input"
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Status *</label>
              <Select
                name="status"
                defaultValue={emp.status}
                fullWidth
                options={[
                  { value: 'active', label: 'Active' },
                  { value: 'probation', label: 'Probation' },
                  { value: 'notice', label: 'Notice' },
                  { value: 'suspended', label: 'Suspended' },
                ]}
              />
            </div>
          </div>

          <div className="modal-footer">
            <Button variant="secondary" onClick={onClose} type="button" disabled={loading}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={loading}>
              {loading ? 'Saving…' : 'Save Changes'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DeactivateEmployeeModal({
  emp,
  onClose,
  onSuccess,
}: {
  emp: EmployeeRecord;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const fd = new FormData(e.currentTarget);
    const reason = String(fd.get('reason') ?? '').trim();
    const exitedOn = String(fd.get('exitedOn') ?? '').trim();

    try {
      await api(`/api/v1/employees/${emp.id}/deactivate`, {
        method: 'POST',
        body: JSON.stringify({
          reason,
          exitedOn,
          expectedVersion: emp.version,
        }),
      });
      onSuccess();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to deactivate employee');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="curved-modal" onClick={(e) => e.stopPropagation()}>
        <form
          onSubmit={(e) => {
            void handleSubmit(e);
          }}
        >
          <div className="modal-header">
            <h3 className="modal-title" style={{ color: '#dc2626' }}>
              Deactivate Employee
            </h3>
            <button type="button" className="modal-close-btn" onClick={onClose}>
              <X size={18} />
            </button>
          </div>

          <div className="modal-body">
            {error && <div className="form-error">{error}</div>}

            <div
              style={{
                background: '#fef2f2',
                border: '1px solid #fee2e2',
                borderRadius: 8,
                padding: '12px 14px',
                marginBottom: 16,
                display: 'flex',
                gap: 10,
                alignItems: 'flex-start',
              }}
            >
              <ShieldAlert size={18} color="#dc2626" style={{ flexShrink: 0, marginTop: 2 }} />
              <div style={{ fontSize: 13, color: '#991b1b' }}>
                Deactivating{' '}
                <strong>
                  {emp.first_name} {emp.last_name}
                </strong>{' '}
                will set their status to <strong>Exited</strong>, revoke active sessions, and
                disable system login access. Historical leave and audit records are permanently
                preserved.
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Exit Date *</label>
              <input
                name="exitedOn"
                type="date"
                required
                defaultValue={new Date().toISOString().slice(0, 10)}
                className="form-input"
              />
            </div>

            <div className="form-group">
              <label className="form-label">Reason for Deactivation *</label>
              <textarea
                name="reason"
                required
                rows={3}
                className="form-input"
                placeholder="e.g. Resignation, end of contract, retirement…"
              />
            </div>
          </div>

          <div className="modal-footer">
            <Button variant="secondary" onClick={onClose} type="button" disabled={loading}>
              Cancel
            </Button>
            <Button variant="danger" type="submit" disabled={loading}>
              {loading ? 'Deactivating…' : 'Confirm Deactivation'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ReactivateEmployeeModal({
  emp,
  onClose,
  onSuccess,
}: {
  emp: EmployeeRecord;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setError(null);
    setLoading(true);
    try {
      await api(`/api/v1/employees/${emp.id}/reactivate`, {
        method: 'POST',
        body: JSON.stringify({
          expectedVersion: emp.version,
        }),
      });
      onSuccess();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to reactivate employee');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="curved-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">Reactivate Employee</h3>
          <button type="button" className="modal-close-btn" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          {error && <div className="form-error">{error}</div>}

          <p style={{ margin: '0 0 12px', fontSize: 13.5, color: 'var(--fg, #0f172a)' }}>
            Are you sure you want to reactivate{' '}
            <strong>
              {emp.first_name} {emp.last_name}
            </strong>
            ?
          </p>

          <p style={{ margin: 0, fontSize: 13, color: 'var(--muted, #64748b)' }}>
            This will set their status back to <strong>Active</strong> and re-enable their user
            login account.
          </p>
        </div>

        <div className="modal-footer">
          <Button variant="secondary" onClick={onClose} type="button" disabled={loading}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              void handleConfirm();
            }}
            disabled={loading}
          >
            {loading ? 'Reactivating…' : 'Reactivate'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ResetPasswordModal({
  emp,
  onClose,
  onSuccess,
}: {
  emp: EmployeeRecord;
  onClose: () => void;
  onSuccess: (info: { name: string; email: string; temp: string }) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setError(null);
    setLoading(true);
    try {
      const res = await api<{ temporaryPassword: string }>(
        `/api/v1/accounts/${emp.id}/reset-password`,
        {
          method: 'POST',
        },
      );
      onSuccess({
        name: `${emp.first_name} ${emp.last_name}`,
        email: emp.work_email,
        temp: res.temporaryPassword,
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to reset password');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="curved-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">Reset Employee Password</h3>
          <button type="button" className="modal-close-btn" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          {error && <div className="form-error">{error}</div>}

          <p style={{ margin: '0 0 12px', fontSize: 13.5, color: 'var(--fg, #0f172a)' }}>
            Generate a new temporary password for{' '}
            <strong>
              {emp.first_name} {emp.last_name}
            </strong>{' '}
            (<code>{emp.work_email}</code>)?
          </p>

          <p style={{ margin: 0, fontSize: 13, color: 'var(--muted, #64748b)' }}>
            Their existing password will be revoked immediately, and they will be prompted to choose
            a new password upon their next login.
          </p>
        </div>

        <div className="modal-footer">
          <Button variant="secondary" onClick={onClose} type="button" disabled={loading}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              void handleConfirm();
            }}
            disabled={loading}
          >
            {loading ? 'Resetting…' : 'Generate Temporary Password'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function TempPasswordModal({
  info,
  onClose,
}: {
  info: { name: string; email: string; temp: string };
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    void navigator.clipboard.writeText(info.temp);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="curved-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">Temporary Password Issued</h3>
          <button type="button" className="modal-close-btn" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          <p style={{ margin: '0 0 14px', fontSize: 13.5, color: 'var(--fg, #0f172a)' }}>
            Please securely convey this temporary password to <strong>{info.name}</strong> (
            <code>{info.email}</code>).
          </p>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: '#f8fafc',
              border: '1px solid #cbd5e1',
              borderRadius: 8,
              padding: '10px 14px',
              marginBottom: 14,
            }}
          >
            <code
              style={{ fontSize: 16, fontWeight: 700, letterSpacing: '0.05em', color: '#0f172a' }}
            >
              {info.temp}
            </code>
            <Button variant="secondary" size="sm" onClick={handleCopy}>
              {copied ? <Check size={14} color="#16a34a" /> : <Copy size={14} />}
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </Button>
          </div>

          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--muted, #64748b)' }}>
            The employee must change this password upon their initial sign-in.
          </p>
        </div>

        <div className="modal-footer">
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------
 * DEPARTMENT MODALS
 * ------------------------------------------------------------- */

function CreateDepartmentModal({
  employees,
  onClose,
  onSuccess,
}: {
  employees: EmployeeRecord[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const fd = new FormData(e.currentTarget);
    const name = String(fd.get('name') ?? '').trim();
    const code = String(fd.get('code') ?? '')
      .trim()
      .toUpperCase();
    const headEmployeeId = String(fd.get('headEmployeeId') ?? '') || null;

    try {
      await api('/api/v1/departments', {
        method: 'POST',
        body: JSON.stringify({ name, code, headEmployeeId }),
      });
      onSuccess();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create department');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="curved-modal" onClick={(e) => e.stopPropagation()}>
        <form
          onSubmit={(e) => {
            void handleSubmit(e);
          }}
        >
          <div className="modal-header">
            <h3 className="modal-title">Create Department</h3>
            <button type="button" className="modal-close-btn" onClick={onClose}>
              <X size={18} />
            </button>
          </div>

          <div className="modal-body">
            {error && <div className="form-error">{error}</div>}

            <div className="form-group">
              <label className="form-label">Department Name *</label>
              <input
                name="name"
                required
                className="form-input"
                placeholder="e.g. Engineering, Human Resources…"
              />
            </div>

            <div className="form-group">
              <label className="form-label">Department Code * (Unique)</label>
              <input
                name="code"
                required
                maxLength={20}
                className="form-input"
                placeholder="e.g. ENG, HR, FIN, SALES"
                style={{ textTransform: 'uppercase' }}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Department Head (Optional)</label>
              <Select
                name="headEmployeeId"
                fullWidth
                options={[
                  { value: '', label: 'None (Unassigned)' },
                  ...employees
                    .filter((e) => e.status !== 'exited')
                    .map((e) => ({
                      value: e.id,
                      label: `${e.first_name} ${e.last_name} (${e.job_title_name})`,
                    })),
                ]}
              />
            </div>
          </div>

          <div className="modal-footer">
            <Button variant="secondary" onClick={onClose} type="button" disabled={loading}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={loading}>
              {loading ? 'Creating…' : 'Create Department'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EditDepartmentModal({
  dept,
  employees,
  onClose,
  onSuccess,
}: {
  dept: DepartmentRecord;
  employees: EmployeeRecord[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const fd = new FormData(e.currentTarget);
    const name = String(fd.get('name') ?? '').trim();
    const code = String(fd.get('code') ?? '')
      .trim()
      .toUpperCase();
    const headEmployeeId = String(fd.get('headEmployeeId') ?? '') || null;

    try {
      await api(`/api/v1/departments/${dept.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name, code, headEmployeeId }),
      });
      onSuccess();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update department');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="curved-modal" onClick={(e) => e.stopPropagation()}>
        <form
          onSubmit={(e) => {
            void handleSubmit(e);
          }}
        >
          <div className="modal-header">
            <h3 className="modal-title">Edit Department: {dept.name}</h3>
            <button type="button" className="modal-close-btn" onClick={onClose}>
              <X size={18} />
            </button>
          </div>

          <div className="modal-body">
            {error && <div className="form-error">{error}</div>}

            <div className="form-group">
              <label className="form-label">Department Name *</label>
              <input name="name" required defaultValue={dept.name} className="form-input" />
            </div>

            <div className="form-group">
              <label className="form-label">Department Code *</label>
              <input
                name="code"
                required
                maxLength={20}
                defaultValue={dept.code}
                className="form-input"
                style={{ textTransform: 'uppercase' }}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Department Head</label>
              <Select
                name="headEmployeeId"
                defaultValue={dept.head_employee_id ?? ''}
                fullWidth
                options={[
                  { value: '', label: 'None (Unassigned)' },
                  ...employees
                    .filter((e) => e.status !== 'exited')
                    .map((e) => ({
                      value: e.id,
                      label: `${e.first_name} ${e.last_name} (${e.job_title_name})`,
                    })),
                ]}
              />
            </div>
          </div>

          <div className="modal-footer">
            <Button variant="secondary" onClick={onClose} type="button" disabled={loading}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={loading}>
              {loading ? 'Saving…' : 'Save Changes'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ArchiveDepartmentModal({
  dept,
  onClose,
  onSuccess,
}: {
  dept: DepartmentRecord;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setError(null);
    setLoading(true);
    try {
      await api(`/api/v1/departments/${dept.id}/archive`, {
        method: 'POST',
      });
      onSuccess();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to deactivate department');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="curved-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title" style={{ color: '#dc2626' }}>
            Deactivate Department: {dept.name}
          </h3>
          <button type="button" className="modal-close-btn" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          {error && <div className="form-error">{error}</div>}

          {dept.employee_count > 0 ? (
            <div
              style={{
                background: '#fef2f2',
                border: '1px solid #fee2e2',
                borderRadius: 8,
                padding: '12px 14px',
                color: '#991b1b',
                fontSize: 13.5,
              }}
            >
              <strong>Cannot deactivate:</strong> This department currently has{' '}
              <strong>{dept.employee_count} active employee(s)</strong> assigned to it. Please
              reassign them to another department first.
            </div>
          ) : (
            <p style={{ margin: 0, fontSize: 13.5, color: 'var(--fg, #0f172a)' }}>
              Are you sure you want to deactivate <strong>{dept.name}</strong> ({dept.code})? It
              will no longer appear for employee assignments.
            </p>
          )}
        </div>

        <div className="modal-footer">
          <Button variant="secondary" onClick={onClose} type="button" disabled={loading}>
            Cancel
          </Button>
          {dept.employee_count === 0 && (
            <Button
              variant="danger"
              onClick={() => {
                void handleConfirm();
              }}
              disabled={loading}
            >
              {loading ? 'Deactivating…' : 'Confirm Deactivation'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------
 * TEAM MODALS
 * ------------------------------------------------------------- */

function CreateTeamModal({
  departments,
  employees,
  onClose,
  onSuccess,
}: {
  departments: DepartmentRecord[];
  employees: EmployeeRecord[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const fd = new FormData(e.currentTarget);
    const departmentId = String(fd.get('departmentId') ?? '');
    const name = String(fd.get('name') ?? '').trim();
    const leadEmployeeId = String(fd.get('leadEmployeeId') ?? '') || null;

    try {
      await api('/api/v1/teams', {
        method: 'POST',
        body: JSON.stringify({ departmentId, name, leadEmployeeId }),
      });
      onSuccess();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create team');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="curved-modal" onClick={(e) => e.stopPropagation()}>
        <form
          onSubmit={(e) => {
            void handleSubmit(e);
          }}
        >
          <div className="modal-header">
            <h3 className="modal-title">Create Team</h3>
            <button type="button" className="modal-close-btn" onClick={onClose}>
              <X size={18} />
            </button>
          </div>

          <div className="modal-body">
            {error && <div className="form-error">{error}</div>}

            <div className="form-group">
              <label className="form-label">Department *</label>
              <Select
                name="departmentId"
                required
                fullWidth
                options={departments.map((d) => ({
                  value: d.id,
                  label: `${d.name} (${d.code})`,
                }))}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Team Name *</label>
              <input
                name="name"
                required
                className="form-input"
                placeholder="e.g. Frontend Core, Payments, Growth…"
              />
            </div>

            <div className="form-group">
              <label className="form-label">Team Lead (Optional)</label>
              <Select
                name="leadEmployeeId"
                fullWidth
                options={[
                  { value: '', label: 'None (Unassigned)' },
                  ...employees
                    .filter((e) => e.status !== 'exited')
                    .map((e) => ({
                      value: e.id,
                      label: `${e.first_name} ${e.last_name} (${e.job_title_name})`,
                    })),
                ]}
              />
            </div>
          </div>

          <div className="modal-footer">
            <Button variant="secondary" onClick={onClose} type="button" disabled={loading}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={loading}>
              {loading ? 'Creating…' : 'Create Team'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EditTeamModal({
  team,
  departments,
  employees,
  onClose,
  onSuccess,
}: {
  team: TeamRecord;
  departments: DepartmentRecord[];
  employees: EmployeeRecord[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const fd = new FormData(e.currentTarget);
    const departmentId = String(fd.get('departmentId') ?? '');
    const name = String(fd.get('name') ?? '').trim();
    const leadEmployeeId = String(fd.get('leadEmployeeId') ?? '') || null;

    try {
      await api(`/api/v1/teams/${team.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ departmentId, name, leadEmployeeId }),
      });
      onSuccess();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update team');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="curved-modal" onClick={(e) => e.stopPropagation()}>
        <form
          onSubmit={(e) => {
            void handleSubmit(e);
          }}
        >
          <div className="modal-header">
            <h3 className="modal-title">Edit Team: {team.name}</h3>
            <button type="button" className="modal-close-btn" onClick={onClose}>
              <X size={18} />
            </button>
          </div>

          <div className="modal-body">
            {error && <div className="form-error">{error}</div>}

            <div className="form-group">
              <label className="form-label">Department *</label>
              <Select
                name="departmentId"
                defaultValue={team.department_id}
                required
                fullWidth
                options={departments.map((d) => ({
                  value: d.id,
                  label: `${d.name} (${d.code})`,
                }))}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Team Name *</label>
              <input name="name" required defaultValue={team.name} className="form-input" />
            </div>

            <div className="form-group">
              <label className="form-label">Team Lead</label>
              <Select
                name="leadEmployeeId"
                defaultValue={team.lead_employee_id ?? ''}
                fullWidth
                options={[
                  { value: '', label: 'None (Unassigned)' },
                  ...employees
                    .filter((e) => e.status !== 'exited')
                    .map((e) => ({
                      value: e.id,
                      label: `${e.first_name} ${e.last_name} (${e.job_title_name})`,
                    })),
                ]}
              />
            </div>
          </div>

          <div className="modal-footer">
            <Button variant="secondary" onClick={onClose} type="button" disabled={loading}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={loading}>
              {loading ? 'Saving…' : 'Save Changes'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ManageTeamMembersModal({
  team,
  employees,
  onClose,
  onSuccess,
}: {
  team: TeamRecord;
  employees: EmployeeRecord[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedToAdd, setSelectedToAdd] = useState<string>('');

  const currentMembers = useMemo(() => {
    return employees.filter((e) => e.team_id === team.id && e.status !== 'exited');
  }, [employees, team.id]);

  const availableToAdd = useMemo(() => {
    return employees.filter((e) => e.team_id !== team.id && e.status !== 'exited');
  }, [employees, team.id]);

  async function handleAddMember() {
    if (!selectedToAdd) return;
    setLoading(true);
    setError(null);
    try {
      await api(`/api/v1/teams/${team.id}/members`, {
        method: 'POST',
        body: JSON.stringify({ addEmployeeIds: [selectedToAdd] }),
      });
      setSelectedToAdd('');
      onSuccess();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to add team member');
    } finally {
      setLoading(false);
    }
  }

  async function handleRemoveMember(empId: string) {
    setLoading(true);
    setError(null);
    try {
      await api(`/api/v1/teams/${team.id}/members`, {
        method: 'POST',
        body: JSON.stringify({ removeEmployeeIds: [empId] }),
      });
      onSuccess();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to remove team member');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="curved-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h3 className="modal-title">Team Members: {team.name}</h3>
            <span style={{ fontSize: 12, color: 'var(--muted, #64748b)' }}>
              {team.department_name}
            </span>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          {error && <div className="form-error">{error}</div>}

          {/* Add member box */}
          <div
            style={{
              background: 'var(--bg-subtle, #f8fafc)',
              border: '1px solid var(--border, #e2e8f0)',
              borderRadius: 10,
              padding: '12px 14px',
              marginBottom: 16,
            }}
          >
            <label className="form-label" style={{ marginBottom: 6 }}>
              Add Employee to Team
            </label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Select
                value={selectedToAdd}
                onChange={(val) => setSelectedToAdd(val)}
                style={{ flex: 1 }}
                fullWidth
                placeholder="Select an employee to add…"
                options={[
                  { value: '', label: 'Select an employee to add…' },
                  ...availableToAdd.map((e) => ({
                    value: e.id,
                    label: `${e.first_name} ${e.last_name} (${e.job_title_name} • ${e.department_name})`,
                  })),
                ]}
              />
              <Button
                variant="primary"
                onClick={() => {
                  void handleAddMember();
                }}
                disabled={!selectedToAdd || loading}
              >
                <Plus size={15} />
                <span>Add</span>
              </Button>
            </div>
          </div>

          {/* Current member list */}
          <div className="form-label" style={{ marginBottom: 8 }}>
            Current Members ({currentMembers.length})
          </div>

          {currentMembers.length === 0 ? (
            <div
              style={{
                padding: '20px 0',
                textAlign: 'center',
                color: 'var(--muted, #64748b)',
                fontSize: 13,
              }}
            >
              No members currently assigned to this team.
            </div>
          ) : (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                maxHeight: 280,
                overflowY: 'auto',
                border: '1px solid var(--border, #e2e8f0)',
                borderRadius: 8,
                padding: 6,
              }}
            >
              {currentMembers.map((emp) => (
                <div
                  key={emp.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 10px',
                    borderRadius: 6,
                    background: 'var(--card-bg, #ffffff)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div className="emp-avatar" style={{ width: 28, height: 28, fontSize: 11 }}>
                      {initials(`${emp.first_name} ${emp.last_name}`)}
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--fg, #0f172a)' }}>
                        {emp.first_name} {emp.last_name}
                      </div>
                      <div style={{ fontSize: 11.5, color: 'var(--muted, #64748b)' }}>
                        {emp.job_title_name}
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    className="icon-action-btn btn-danger"
                    title="Remove from team"
                    onClick={() => {
                      void handleRemoveMember(emp.id);
                    }}
                    disabled={loading}
                  >
                    <UserMinus size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}

function ArchiveTeamModal({
  team,
  onClose,
  onSuccess,
}: {
  team: TeamRecord;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setError(null);
    setLoading(true);
    try {
      await api(`/api/v1/teams/${team.id}/archive`, {
        method: 'POST',
      });
      onSuccess();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to deactivate team');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="curved-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title" style={{ color: '#dc2626' }}>
            Deactivate Team: {team.name}
          </h3>
          <button type="button" className="modal-close-btn" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          {error && <div className="form-error">{error}</div>}

          <p style={{ margin: '0 0 10px', fontSize: 13.5, color: 'var(--fg, #0f172a)' }}>
            Are you sure you want to deactivate <strong>{team.name}</strong> ({team.department_name}
            )?
          </p>

          <p style={{ margin: 0, fontSize: 13, color: 'var(--muted, #64748b)' }}>
            Any employees currently assigned to this team will have their team assignment cleared
            and remain active members of their department.
          </p>
        </div>

        <div className="modal-footer">
          <Button variant="secondary" onClick={onClose} type="button" disabled={loading}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              void handleConfirm();
            }}
            disabled={loading}
          >
            {loading ? 'Deactivating…' : 'Confirm Deactivation'}
          </Button>
        </div>
      </div>
    </div>
  );
}
