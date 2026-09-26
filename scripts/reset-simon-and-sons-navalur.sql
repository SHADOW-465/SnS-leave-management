-- =====================================================================
-- Simon & Sons Leave OS - Navalur Chennai Dataset Reset & Migration
-- Digital Publishing Solutions & ITES Services, Navalur, Chennai
-- 5 Departments, 5 Teams, 10 Members per Department/Team (50 staff) + Admin
-- Admin: Vijay Antony | HR: Anjusha R | Manager: Suresh Kumar
-- Edge cases included for realistic verification on Vercel & Supabase
-- =====================================================================

BEGIN;
-- Temporary suppression of append-only triggers for clean reset
DROP TRIGGER IF EXISTS balance_ledger_no_delete ON balance_ledger;
DROP TRIGGER IF EXISTS balance_ledger_no_update ON balance_ledger;
DROP TRIGGER IF EXISTS audit_event_no_delete ON audit_event;
DROP TRIGGER IF EXISTS audit_event_no_update ON audit_event;

-- 1. Clean out existing leave requests, attendance, balances, and accounts
DELETE FROM period_rollover_run;
DELETE FROM accrual_run;
DELETE FROM permission_request;
DELETE FROM approval_override;
DELETE FROM approval_delegation;
DELETE FROM workstation_device;
DELETE FROM attachment;
DELETE FROM leave_comment;
DELETE FROM approval_step_instance;
DELETE FROM leave_request_day;
DELETE FROM leave_request;
DELETE FROM balance_ledger;
DELETE FROM notification;
DELETE FROM attendance_correction;
DELETE FROM attendance_raw;
DELETE FROM session;
DELETE FROM password_history;
DELETE FROM login_attempt;
DELETE FROM user_role;
DELETE FROM user_account;
DELETE FROM emergency_contact;
DELETE FROM employee_contact;
DELETE FROM employment_history;
UPDATE employee SET manager_employee_id = NULL;
DELETE FROM employee;
UPDATE team SET lead_employee_id = NULL;
DELETE FROM team;
UPDATE department SET head_employee_id = NULL;
DELETE FROM department;
DELETE FROM policy_assignment;
DELETE FROM leave_policy_version;
DELETE FROM leave_type;
DELETE FROM holiday;
DELETE FROM holiday_calendar;
DELETE FROM approval_workflow_step;
DELETE FROM approval_workflow;
DELETE FROM job_title;
DELETE FROM employment_type;
DELETE FROM leave_period;

-- 2. Core Organization Setup
INSERT INTO role (id, code, name, is_system)
VALUES
  ('role-admin', 'admin', 'Administrator', 1),
  ('role-director', 'director', 'Managing Director', 1),
  ('role-hr_officer', 'hr_officer', 'HR Officer', 1),
  ('role-manager', 'manager', 'Manager', 1),
  ('role-employee', 'employee', 'Employee', 1),
  ('role-payroll_officer', 'payroll_officer', 'Payroll Officer', 1),
  ('role-auditor', 'auditor', 'Auditor', 1)
ON CONFLICT (code) DO NOTHING;

INSERT INTO company (id, name, timezone, leave_year_start_month, leave_year_start_day, created_at, created_by, updated_at, updated_by)
VALUES ('company', 'Simon & Sons', 'Asia/Kolkata', 1, 1, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys')
ON CONFLICT (id) DO UPDATE SET name = 'Simon & Sons', timezone = 'Asia/Kolkata';

INSERT INTO location (id, name, code, timezone, created_at, created_by, updated_at, updated_by)
VALUES ('loc-navalur', 'Navalur, Chennai', 'CHE-NAV', 'Asia/Kolkata', '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys')
ON CONFLICT (code) DO UPDATE SET name = 'Navalur, Chennai', timezone = 'Asia/Kolkata';

INSERT INTO leave_period (id, label, starts_on, ends_on)
VALUES ('lp-2026', '2026', '2026-01-01', '2026-12-31')
ON CONFLICT (id) DO NOTHING;

INSERT INTO leave_type (id, code, name, colour_token, is_paid, unit, created_at, created_by, updated_at, updated_by)
VALUES
  ('lt-al', 'AL', 'Annual Leave', 'accent', 1, 'half_day', '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys')
ON CONFLICT (code) DO NOTHING;

INSERT INTO leave_policy_version (id, leave_type_id, version_no, effective_from, rules_json, published_at, published_by, created_at, created_by)
VALUES (
  'lpv-al-1',
  'lt-al',
  1,
  '2026-01-01',
  '{"entitlementHalfDays":48,"accrualMethod":"monthly","accrualCadenceMonths":1,"midYearProrate":true,"carryForwardCapHalfDays":400,"carryForwardExpiryMonths":0,"probationRestriction":"none","probationMaxHalfDays":6,"halfDaysAllowed":true,"minNoticeDays":0,"maxConsecutiveDays":30,"negativeBalanceAllowed":false,"attachmentRequiredAfterHalfDays":null,"excludeWeekends":true,"excludeHolidays":true,"joinMonthAccrual":"prorated","categoryMonthlyHalfDays":{},"probationMonthlyHalfDays":null,"maxBalanceHalfDays":0,"confirmedTenureYears":3,"confirmedUnderMonthlyHalfDays":3,"confirmedFromMonthlyHalfDays":4,"probationExperiencedMonthlyHalfDays":2,"probationFresherMonthlyHalfDays":0,"lossOfPayOnShortfall":true}',
  '2026-01-01T00:00:00.000Z',
  'sys',
  '2026-01-01T00:00:00.000Z',
  'sys'
) ON CONFLICT (leave_type_id, version_no) DO NOTHING;

INSERT INTO policy_assignment (id, leave_policy_version_id, scope_type, scope_id, priority)
VALUES ('pa-al-comp', 'lpv-al-1', 'company', 'company', 0)
ON CONFLICT (id) DO NOTHING;

INSERT INTO employment_type (id, name, code, is_leave_eligible, created_at, created_by, updated_at, updated_by)
VALUES
  ('et-perm', 'Permanent', 'PERM', 1, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys'),
  ('et-prod', 'Production Staff', 'PROD', 1, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys'),
  ('et-mgmt', 'Management', 'MGMT', 1, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys')
ON CONFLICT (code) DO NOTHING;

INSERT INTO holiday_calendar (id, name, year, created_at, created_by, updated_at, updated_by)
VALUES ('cal-2026', 'Tamil Nadu / Chennai Holidays 2026', 2026, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys')
ON CONFLICT (id) DO NOTHING;

INSERT INTO holiday (id, holiday_calendar_id, date, name, kind)
VALUES ('hol-2026-01-15', 'cal-2026', '2026-01-15', 'Pongal', 'public')
ON CONFLICT (holiday_calendar_id, date) DO NOTHING;
INSERT INTO holiday (id, holiday_calendar_id, date, name, kind)
VALUES ('hol-2026-01-16', 'cal-2026', '2026-01-16', 'Thiruvalluvar Day', 'public')
ON CONFLICT (holiday_calendar_id, date) DO NOTHING;
INSERT INTO holiday (id, holiday_calendar_id, date, name, kind)
VALUES ('hol-2026-01-17', 'cal-2026', '2026-01-17', 'Uzhavar Thirunal', 'public')
ON CONFLICT (holiday_calendar_id, date) DO NOTHING;
INSERT INTO holiday (id, holiday_calendar_id, date, name, kind)
VALUES ('hol-2026-01-26', 'cal-2026', '2026-01-26', 'Republic Day', 'public')
ON CONFLICT (holiday_calendar_id, date) DO NOTHING;
INSERT INTO holiday (id, holiday_calendar_id, date, name, kind)
VALUES ('hol-2026-04-14', 'cal-2026', '2026-04-14', 'Tamil New Year', 'public')
ON CONFLICT (holiday_calendar_id, date) DO NOTHING;
INSERT INTO holiday (id, holiday_calendar_id, date, name, kind)
VALUES ('hol-2026-05-01', 'cal-2026', '2026-05-01', 'May Day', 'public')
ON CONFLICT (holiday_calendar_id, date) DO NOTHING;
INSERT INTO holiday (id, holiday_calendar_id, date, name, kind)
VALUES ('hol-2026-08-15', 'cal-2026', '2026-08-15', 'Independence Day', 'public')
ON CONFLICT (holiday_calendar_id, date) DO NOTHING;
INSERT INTO holiday (id, holiday_calendar_id, date, name, kind)
VALUES ('hol-2026-10-02', 'cal-2026', '2026-10-02', 'Gandhi Jayanti', 'public')
ON CONFLICT (holiday_calendar_id, date) DO NOTHING;
INSERT INTO holiday (id, holiday_calendar_id, date, name, kind)
VALUES ('hol-2026-10-20', 'cal-2026', '2026-10-20', 'Ayutha Pooja', 'public')
ON CONFLICT (holiday_calendar_id, date) DO NOTHING;
INSERT INTO holiday (id, holiday_calendar_id, date, name, kind)
VALUES ('hol-2026-10-21', 'cal-2026', '2026-10-21', 'Vijaya Dasami', 'public')
ON CONFLICT (holiday_calendar_id, date) DO NOTHING;
INSERT INTO holiday (id, holiday_calendar_id, date, name, kind)
VALUES ('hol-2026-11-08', 'cal-2026', '2026-11-08', 'Deepavali', 'public')
ON CONFLICT (holiday_calendar_id, date) DO NOTHING;
INSERT INTO holiday (id, holiday_calendar_id, date, name, kind)
VALUES ('hol-2026-12-25', 'cal-2026', '2026-12-25', 'Christmas Day', 'public')
ON CONFLICT (holiday_calendar_id, date) DO NOTHING;

-- 3. Departments
INSERT INTO department (id, code, name, created_at, created_by, updated_at, updated_by)
VALUES ('dept-pub', 'PUB', 'Digital Publishing & Composition', '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys')
ON CONFLICT (code) DO UPDATE SET name = 'Digital Publishing & Composition';
INSERT INTO department (id, code, name, created_at, created_by, updated_at, updated_by)
VALUES ('dept-ites', 'ITES', 'ITES & Data Operations', '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys')
ON CONFLICT (code) DO UPDATE SET name = 'ITES & Data Operations';
INSERT INTO department (id, code, name, created_at, created_by, updated_at, updated_by)
VALUES ('dept-qa', 'QA', 'Quality Assurance & Editorial', '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys')
ON CONFLICT (code) DO UPDATE SET name = 'Quality Assurance & Editorial';
INSERT INTO department (id, code, name, created_at, created_by, updated_at, updated_by)
VALUES ('dept-tech', 'TECH', 'Content Technology & Tools', '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys')
ON CONFLICT (code) DO UPDATE SET name = 'Content Technology & Tools';
INSERT INTO department (id, code, name, created_at, created_by, updated_at, updated_by)
VALUES ('dept-hr', 'HR', 'Human Resources & Administration', '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys')
ON CONFLICT (code) DO UPDATE SET name = 'Human Resources & Administration';
INSERT INTO department (id, code, name, created_at, created_by, updated_at, updated_by)
VALUES ('dept-adm', 'ADM', 'Administration', '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys')
ON CONFLICT (code) DO UPDATE SET name = 'Administration';

-- 4. Teams
INSERT INTO team (id, department_id, name, created_at, created_by, updated_at, updated_by)
VALUES ('team-team-pub', 'dept-pub', 'e-Publishing & Conversion', '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys')
ON CONFLICT (department_id, name) DO NOTHING;
INSERT INTO team (id, department_id, name, created_at, created_by, updated_at, updated_by)
VALUES ('team-team-ites', 'dept-ites', 'Data Processing & Annotation', '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys')
ON CONFLICT (department_id, name) DO NOTHING;
INSERT INTO team (id, department_id, name, created_at, created_by, updated_at, updated_by)
VALUES ('team-team-qa', 'dept-qa', 'Quality Control & Pre-Media', '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys')
ON CONFLICT (department_id, name) DO NOTHING;
INSERT INTO team (id, department_id, name, created_at, created_by, updated_at, updated_by)
VALUES ('team-team-tech', 'dept-tech', 'Workflow & Automation', '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys')
ON CONFLICT (department_id, name) DO NOTHING;
INSERT INTO team (id, department_id, name, created_at, created_by, updated_at, updated_by)
VALUES ('team-team-hr', 'dept-hr', 'HR Operations & Support', '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys')
ON CONFLICT (department_id, name) DO NOTHING;

-- 5. Job Titles
INSERT INTO job_title (id, name, created_at, created_by, updated_at, updated_by)
VALUES ('jt-1', 'IT Administrator', '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys')
ON CONFLICT (id) DO NOTHING;
INSERT INTO job_title (id, name, created_at, created_by, updated_at, updated_by)
VALUES ('jt-2', 'Publishing Operations Manager', '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys')
ON CONFLICT (id) DO NOTHING;
INSERT INTO job_title (id, name, created_at, created_by, updated_at, updated_by)
VALUES ('jt-3', 'Senior Typesetting Specialist', '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys')
ON CONFLICT (id) DO NOTHING;
INSERT INTO job_title (id, name, created_at, created_by, updated_at, updated_by)
VALUES ('jt-4', 'InDesign & Pagination Specialist', '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys')
ON CONFLICT (id) DO NOTHING;
INSERT INTO job_title (id, name, created_at, created_by, updated_at, updated_by)
VALUES ('jt-5', 'XML / HTML Conversion Lead', '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys')
ON CONFLICT (id) DO NOTHING;
INSERT INTO job_title (id, name, created_at, created_by, updated_at, updated_by)
VALUES ('jt-6', 'eBook Production Executive', '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys')
ON CONFLICT (id) DO NOTHING;
INSERT INTO job_title (id, name, created_at, created_by, updated_at, updated_by)
VALUES ('jt-7', 'Digital Publishing Operator', '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys')
ON CONFLICT (id) DO NOTHING;
INSERT INTO job_title (id, name, created_at, created_by, updated_at, updated_by)
VALUES ('jt-8', 'Pre-Press Composition Associate', '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys')
ON CONFLICT (id) DO NOTHING;
INSERT INTO job_title (id, name, created_at, created_by, updated_at, updated_by)
VALUES ('jt-9', 'MathML & TeX Typesetter', '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys')
ON CONFLICT (id) DO NOTHING;
INSERT INTO job_title (id, name, created_at, created_by, updated_at, updated_by)
VALUES ('jt-10', 'EPUB Quality Specialist', '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys')
ON CONFLICT (id) DO NOTHING;
INSERT INTO job_title (id, name, created_at, created_by, updated_at, updated_by)
VALUES ('jt-11', 'Junior Layout Artist', '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys')
ON CONFLICT (id) DO NOTHING;
INSERT INTO job_title (id, name, created_at, created_by, updated_at, updated_by)
VALUES ('jt-12', 'ITES Operations Manager', '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys')
ON CONFLICT (id) DO NOTHING;
INSERT INTO job_title (id, name, created_at, created_by, updated_at, updated_by)
VALUES ('jt-13', 'Senior Data Processing Analyst', '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys')
ON CONFLICT (id) DO NOTHING;
INSERT INTO job_title (id, name, created_at, created_by, updated_at, updated_by)
VALUES ('jt-14', 'OCR & Digitization Specialist', '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys')
ON CONFLICT (id) DO NOTHING;
INSERT INTO job_title (id, name, created_at, created_by, updated_at, updated_by)
VALUES ('jt-15', 'Data Verification Executive', '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys')
ON CONFLICT (id) DO NOTHING;
INSERT INTO job_title (id, name, created_at, created_by, updated_at, updated_by)
VALUES ('jt-16', 'Metadata Indexing Associate', '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys')
ON CONFLICT (id) DO NOTHING;
INSERT INTO job_title (id, name, created_at, created_by, updated_at, updated_by)
VALUES ('jt-17', 'Content Annotation Specialist', '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys')
ON CONFLICT (id) DO NOTHING;
INSERT INTO job_title (id, name, created_at, created_by, updated_at, updated_by)
VALUES ('jt-18', 'Data Scrubbing Executive', '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys')
ON CONFLICT (id) DO NOTHING;
INSERT INTO job_title (id, name, created_at, created_by, updated_at, updated_by)
VALUES ('jt-19', 'Cataloging Specialist', '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys')
ON CONFLICT (id) DO NOTHING;
INSERT INTO job_title (id, name, created_at, created_by, updated_at, updated_by)
VALUES ('jt-20', 'ITES Associate', '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys')
ON CONFLICT (id) DO NOTHING;
INSERT INTO job_title (id, name, created_at, created_by, updated_at, updated_by)
VALUES ('jt-21', 'Data Processing Trainee', '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys')
ON CONFLICT (id) DO NOTHING;
INSERT INTO job_title (id, name, created_at, created_by, updated_at, updated_by)
VALUES ('jt-22', 'QA & Editorial Manager', '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys')
ON CONFLICT (id) DO NOTHING;
INSERT INTO job_title (id, name, created_at, created_by, updated_at, updated_by)
VALUES ('jt-23', 'Senior Quality Lead', '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys')
ON CONFLICT (id) DO NOTHING;
INSERT INTO job_title (id, name, created_at, created_by, updated_at, updated_by)
VALUES ('jt-24', 'Lead Copyeditor', '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys')
ON CONFLICT (id) DO NOTHING;
INSERT INTO job_title (id, name, created_at, created_by, updated_at, updated_by)
VALUES ('jt-25', 'Technical Proofreader', '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys')
ON CONFLICT (id) DO NOTHING;
INSERT INTO job_title (id, name, created_at, created_by, updated_at, updated_by)
VALUES ('jt-26', 'Editorial QA Analyst', '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys')
ON CONFLICT (id) DO NOTHING;
INSERT INTO job_title (id, name, created_at, created_by, updated_at, updated_by)
VALUES ('jt-27', 'Pre-Media Inspector', '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys')
ON CONFLICT (id) DO NOTHING;
INSERT INTO job_title (id, name, created_at, created_by, updated_at, updated_by)
VALUES ('jt-28', 'Content Quality Analyst', '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys')
ON CONFLICT (id) DO NOTHING;
INSERT INTO job_title (id, name, created_at, created_by, updated_at, updated_by)
VALUES ('jt-29', 'Digital Compliance Reviewer', '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys')
ON CONFLICT (id) DO NOTHING;
INSERT INTO job_title (id, name, created_at, created_by, updated_at, updated_by)
VALUES ('jt-30', 'Proofreader', '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys')
ON CONFLICT (id) DO NOTHING;
INSERT INTO job_title (id, name, created_at, created_by, updated_at, updated_by)
VALUES ('jt-31', 'Editorial Assistant', '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys')
ON CONFLICT (id) DO NOTHING;
INSERT INTO job_title (id, name, created_at, created_by, updated_at, updated_by)
VALUES ('jt-32', 'Publishing Technology Manager', '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys')
ON CONFLICT (id) DO NOTHING;
INSERT INTO job_title (id, name, created_at, created_by, updated_at, updated_by)
VALUES ('jt-33', 'Senior Workflow Automation Engineer', '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys')
ON CONFLICT (id) DO NOTHING;
INSERT INTO job_title (id, name, created_at, created_by, updated_at, updated_by)
VALUES ('jt-34', 'Publishing Tool Developer', '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys')
ON CONFLICT (id) DO NOTHING;
INSERT INTO job_title (id, name, created_at, created_by, updated_at, updated_by)
VALUES ('jt-35', 'Python & XSLT Specialist', '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys')
ON CONFLICT (id) DO NOTHING;
INSERT INTO job_title (id, name, created_at, created_by, updated_at, updated_by)
VALUES ('jt-36', 'IT Systems & Prepress Admin', '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys')
ON CONFLICT (id) DO NOTHING;
INSERT INTO job_title (id, name, created_at, created_by, updated_at, updated_by)
VALUES ('jt-37', 'Scripting & Transformation Engineer', '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys')
ON CONFLICT (id) DO NOTHING;
INSERT INTO job_title (id, name, created_at, created_by, updated_at, updated_by)
VALUES ('jt-38', 'Prepress Automation Engineer', '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys')
ON CONFLICT (id) DO NOTHING;
INSERT INTO job_title (id, name, created_at, created_by, updated_at, updated_by)
VALUES ('jt-39', 'Digital Production Support Analyst', '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys')
ON CONFLICT (id) DO NOTHING;
INSERT INTO job_title (id, name, created_at, created_by, updated_at, updated_by)
VALUES ('jt-40', 'Database & Asset Management Specialist', '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys')
ON CONFLICT (id) DO NOTHING;
INSERT INTO job_title (id, name, created_at, created_by, updated_at, updated_by)
VALUES ('jt-41', 'Junior Tools Developer', '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys')
ON CONFLICT (id) DO NOTHING;
INSERT INTO job_title (id, name, created_at, created_by, updated_at, updated_by)
VALUES ('jt-42', 'HR Manager', '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys')
ON CONFLICT (id) DO NOTHING;
INSERT INTO job_title (id, name, created_at, created_by, updated_at, updated_by)
VALUES ('jt-43', 'Managing Director', '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys')
ON CONFLICT (id) DO NOTHING;
INSERT INTO job_title (id, name, created_at, created_by, updated_at, updated_by)
VALUES ('jt-44', 'Senior Payroll Officer', '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys')
ON CONFLICT (id) DO NOTHING;
INSERT INTO job_title (id, name, created_at, created_by, updated_at, updated_by)
VALUES ('jt-45', 'Internal Auditor & Compliance Officer', '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys')
ON CONFLICT (id) DO NOTHING;
INSERT INTO job_title (id, name, created_at, created_by, updated_at, updated_by)
VALUES ('jt-46', 'Talent Acquisition Lead', '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys')
ON CONFLICT (id) DO NOTHING;
INSERT INTO job_title (id, name, created_at, created_by, updated_at, updated_by)
VALUES ('jt-47', 'HR Operations Executive', '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys')
ON CONFLICT (id) DO NOTHING;
INSERT INTO job_title (id, name, created_at, created_by, updated_at, updated_by)
VALUES ('jt-48', 'Employee Relations Specialist', '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys')
ON CONFLICT (id) DO NOTHING;
INSERT INTO job_title (id, name, created_at, created_by, updated_at, updated_by)
VALUES ('jt-49', 'Workplace & Facilities Administrator', '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys')
ON CONFLICT (id) DO NOTHING;
INSERT INTO job_title (id, name, created_at, created_by, updated_at, updated_by)
VALUES ('jt-50', 'HR Compliance Coordinator', '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys')
ON CONFLICT (id) DO NOTHING;
INSERT INTO job_title (id, name, created_at, created_by, updated_at, updated_by)
VALUES ('jt-51', 'HR Executive Trainee', '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys')
ON CONFLICT (id) DO NOTHING;

-- 6. Employees and Sign-in User Accounts
INSERT INTO employee (id, employee_code, first_name, last_name, work_email, status, joined_on, probation_end_on, location_id, department_id, team_id, job_title_id, employment_type_id, retention_class, version, created_at, created_by, updated_at, updated_by)
VALUES ('emp-admin', 'SNS-1000', 'Vijay', 'Antony', 'admin@sns.test', 'active', '2020-01-06', NULL, 'loc-navalur', 'dept-adm', NULL, 'jt-1', 'et-mgmt', 'standard', 1, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_account (id, employee_id, email, username, password_hash, password_algo, must_change_password, is_disabled, failed_attempts, created_at, created_by, updated_at, updated_by)
VALUES ('usr-admin', 'emp-admin', 'admin@sns.test', 'admin', '$argon2id$v=19$m=19456,t=2,p=1$1V0xS/0MQC+DGz4QUAmbOA$y5hdGjdPiDEW7JnhQaGJV6GfuzQ9NXQBU0dHfljaMIU', 'argon2id', 0, 0, 0, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_role (user_account_id, role_id, granted_by, granted_at)
SELECT 'usr-admin', id, 'sys', '2026-01-01T00:00:00.000Z' FROM role WHERE code = 'admin';
INSERT INTO balance_ledger (id, employee_id, leave_type_id, period_id, entry_type, quantity_half_days, effective_on, reason, created_by, created_at)
VALUES ('bal-admin-open', 'emp-admin', 'lt-al', 'lp-2026', 'OPENING', 36, '2026-01-01', 'Opening grant for 2026 leave year', 'sys', '2026-01-01T00:00:00.000Z');
INSERT INTO employee (id, employee_code, first_name, last_name, work_email, status, joined_on, probation_end_on, location_id, department_id, team_id, job_title_id, employment_type_id, retention_class, version, created_at, created_by, updated_at, updated_by)
VALUES ('emp-suresh', 'SNS-1001', 'Suresh', 'Kumar', 'suresh@sns.test', 'active', '2018-03-12', NULL, 'loc-navalur', 'dept-pub', 'team-team-pub', 'jt-2', 'et-mgmt', 'standard', 1, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_account (id, employee_id, email, username, password_hash, password_algo, must_change_password, is_disabled, failed_attempts, created_at, created_by, updated_at, updated_by)
VALUES ('usr-suresh', 'emp-suresh', 'suresh@sns.test', 'suresh', '$argon2id$v=19$m=19456,t=2,p=1$JtxHxP3JFR+k+BHjQ/mPGw$P6QVGZNCx2MrUxz3mZdkyT1/D8c/58cnBhlnS10DXxk', 'argon2id', 0, 0, 0, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_role (user_account_id, role_id, granted_by, granted_at)
SELECT 'usr-suresh', id, 'sys', '2026-01-01T00:00:00.000Z' FROM role WHERE code = 'manager';
INSERT INTO balance_ledger (id, employee_id, leave_type_id, period_id, entry_type, quantity_half_days, effective_on, reason, created_by, created_at)
VALUES ('bal-suresh-open', 'emp-suresh', 'lt-al', 'lp-2026', 'OPENING', 36, '2026-01-01', 'Opening grant for 2026 leave year', 'sys', '2026-01-01T00:00:00.000Z');
INSERT INTO employee (id, employee_code, first_name, last_name, work_email, status, joined_on, probation_end_on, location_id, department_id, team_id, job_title_id, employment_type_id, retention_class, version, created_at, created_by, updated_at, updated_by)
VALUES ('emp-meera', 'SNS-1002', 'Meera', 'Krishnan', 'meera@sns.test', 'active', '2019-06-17', NULL, 'loc-navalur', 'dept-pub', 'team-team-pub', 'jt-3', 'et-prod', 'standard', 1, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_account (id, employee_id, email, username, password_hash, password_algo, must_change_password, is_disabled, failed_attempts, created_at, created_by, updated_at, updated_by)
VALUES ('usr-meera', 'emp-meera', 'meera@sns.test', 'meera', '$argon2id$v=19$m=19456,t=2,p=1$JtxHxP3JFR+k+BHjQ/mPGw$P6QVGZNCx2MrUxz3mZdkyT1/D8c/58cnBhlnS10DXxk', 'argon2id', 0, 0, 0, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_role (user_account_id, role_id, granted_by, granted_at)
SELECT 'usr-meera', id, 'sys', '2026-01-01T00:00:00.000Z' FROM role WHERE code = 'employee';
INSERT INTO balance_ledger (id, employee_id, leave_type_id, period_id, entry_type, quantity_half_days, effective_on, reason, created_by, created_at)
VALUES ('bal-meera-open', 'emp-meera', 'lt-al', 'lp-2026', 'OPENING', 36, '2026-01-01', 'Opening grant for 2026 leave year', 'sys', '2026-01-01T00:00:00.000Z');
INSERT INTO employee (id, employee_code, first_name, last_name, work_email, status, joined_on, probation_end_on, location_id, department_id, team_id, job_title_id, employment_type_id, retention_class, version, created_at, created_by, updated_at, updated_by)
VALUES ('emp-arun', 'SNS-1003', 'Arun', 'Prakash', 'arun@sns.test', 'active', '2020-02-10', NULL, 'loc-navalur', 'dept-pub', 'team-team-pub', 'jt-4', 'et-prod', 'standard', 1, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_account (id, employee_id, email, username, password_hash, password_algo, must_change_password, is_disabled, failed_attempts, created_at, created_by, updated_at, updated_by)
VALUES ('usr-arun', 'emp-arun', 'arun@sns.test', 'arun', '$argon2id$v=19$m=19456,t=2,p=1$JtxHxP3JFR+k+BHjQ/mPGw$P6QVGZNCx2MrUxz3mZdkyT1/D8c/58cnBhlnS10DXxk', 'argon2id', 0, 0, 0, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_role (user_account_id, role_id, granted_by, granted_at)
SELECT 'usr-arun', id, 'sys', '2026-01-01T00:00:00.000Z' FROM role WHERE code = 'employee';
INSERT INTO balance_ledger (id, employee_id, leave_type_id, period_id, entry_type, quantity_half_days, effective_on, reason, created_by, created_at)
VALUES ('bal-arun-open', 'emp-arun', 'lt-al', 'lp-2026', 'OPENING', 36, '2026-01-01', 'Opening grant for 2026 leave year', 'sys', '2026-01-01T00:00:00.000Z');
INSERT INTO employee (id, employee_code, first_name, last_name, work_email, status, joined_on, probation_end_on, location_id, department_id, team_id, job_title_id, employment_type_id, retention_class, version, created_at, created_by, updated_at, updated_by)
VALUES ('emp-karthi', 'SNS-1004', 'Karthi', 'Keyan', 'karthi@sns.test', 'active', '2021-04-05', NULL, 'loc-navalur', 'dept-pub', 'team-team-pub', 'jt-5', 'et-prod', 'standard', 1, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_account (id, employee_id, email, username, password_hash, password_algo, must_change_password, is_disabled, failed_attempts, created_at, created_by, updated_at, updated_by)
VALUES ('usr-karthi', 'emp-karthi', 'karthi@sns.test', 'karthi', '$argon2id$v=19$m=19456,t=2,p=1$JtxHxP3JFR+k+BHjQ/mPGw$P6QVGZNCx2MrUxz3mZdkyT1/D8c/58cnBhlnS10DXxk', 'argon2id', 0, 0, 0, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_role (user_account_id, role_id, granted_by, granted_at)
SELECT 'usr-karthi', id, 'sys', '2026-01-01T00:00:00.000Z' FROM role WHERE code = 'employee';
INSERT INTO balance_ledger (id, employee_id, leave_type_id, period_id, entry_type, quantity_half_days, effective_on, reason, created_by, created_at)
VALUES ('bal-karthi-open', 'emp-karthi', 'lt-al', 'lp-2026', 'OPENING', 36, '2026-01-01', 'Opening grant for 2026 leave year', 'sys', '2026-01-01T00:00:00.000Z');
INSERT INTO employee (id, employee_code, first_name, last_name, work_email, status, joined_on, probation_end_on, location_id, department_id, team_id, job_title_id, employment_type_id, retention_class, version, created_at, created_by, updated_at, updated_by)
VALUES ('emp-priya', 'SNS-1005', 'Priya', 'Dharshini', 'priya@sns.test', 'active', '2021-09-20', NULL, 'loc-navalur', 'dept-pub', 'team-team-pub', 'jt-6', 'et-prod', 'standard', 1, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_account (id, employee_id, email, username, password_hash, password_algo, must_change_password, is_disabled, failed_attempts, created_at, created_by, updated_at, updated_by)
VALUES ('usr-priya', 'emp-priya', 'priya@sns.test', 'priya', '$argon2id$v=19$m=19456,t=2,p=1$JtxHxP3JFR+k+BHjQ/mPGw$P6QVGZNCx2MrUxz3mZdkyT1/D8c/58cnBhlnS10DXxk', 'argon2id', 0, 0, 0, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_role (user_account_id, role_id, granted_by, granted_at)
SELECT 'usr-priya', id, 'sys', '2026-01-01T00:00:00.000Z' FROM role WHERE code = 'employee';
INSERT INTO balance_ledger (id, employee_id, leave_type_id, period_id, entry_type, quantity_half_days, effective_on, reason, created_by, created_at)
VALUES ('bal-priya-open', 'emp-priya', 'lt-al', 'lp-2026', 'OPENING', 36, '2026-01-01', 'Opening grant for 2026 leave year', 'sys', '2026-01-01T00:00:00.000Z');
INSERT INTO employee (id, employee_code, first_name, last_name, work_email, status, joined_on, probation_end_on, location_id, department_id, team_id, job_title_id, employment_type_id, retention_class, version, created_at, created_by, updated_at, updated_by)
VALUES ('emp-vignesh', 'SNS-1006', 'Vignesh', 'S', 'vignesh@sns.test', 'active', '2022-01-18', NULL, 'loc-navalur', 'dept-pub', 'team-team-pub', 'jt-7', 'et-prod', 'standard', 1, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_account (id, employee_id, email, username, password_hash, password_algo, must_change_password, is_disabled, failed_attempts, created_at, created_by, updated_at, updated_by)
VALUES ('usr-vignesh', 'emp-vignesh', 'vignesh@sns.test', 'vignesh', '$argon2id$v=19$m=19456,t=2,p=1$JtxHxP3JFR+k+BHjQ/mPGw$P6QVGZNCx2MrUxz3mZdkyT1/D8c/58cnBhlnS10DXxk', 'argon2id', 0, 0, 0, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_role (user_account_id, role_id, granted_by, granted_at)
SELECT 'usr-vignesh', id, 'sys', '2026-01-01T00:00:00.000Z' FROM role WHERE code = 'employee';
INSERT INTO balance_ledger (id, employee_id, leave_type_id, period_id, entry_type, quantity_half_days, effective_on, reason, created_by, created_at)
VALUES ('bal-vignesh-open', 'emp-vignesh', 'lt-al', 'lp-2026', 'OPENING', 36, '2026-01-01', 'Opening grant for 2026 leave year', 'sys', '2026-01-01T00:00:00.000Z');
INSERT INTO employee (id, employee_code, first_name, last_name, work_email, status, joined_on, probation_end_on, location_id, department_id, team_id, job_title_id, employment_type_id, retention_class, version, created_at, created_by, updated_at, updated_by)
VALUES ('emp-deepa', 'SNS-1007', 'Deepa', 'R', 'deepa@sns.test', 'active', '2022-08-11', NULL, 'loc-navalur', 'dept-pub', 'team-team-pub', 'jt-8', 'et-prod', 'standard', 1, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_account (id, employee_id, email, username, password_hash, password_algo, must_change_password, is_disabled, failed_attempts, created_at, created_by, updated_at, updated_by)
VALUES ('usr-deepa', 'emp-deepa', 'deepa@sns.test', 'deepa', '$argon2id$v=19$m=19456,t=2,p=1$JtxHxP3JFR+k+BHjQ/mPGw$P6QVGZNCx2MrUxz3mZdkyT1/D8c/58cnBhlnS10DXxk', 'argon2id', 0, 0, 0, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_role (user_account_id, role_id, granted_by, granted_at)
SELECT 'usr-deepa', id, 'sys', '2026-01-01T00:00:00.000Z' FROM role WHERE code = 'employee';
INSERT INTO balance_ledger (id, employee_id, leave_type_id, period_id, entry_type, quantity_half_days, effective_on, reason, created_by, created_at)
VALUES ('bal-deepa-open', 'emp-deepa', 'lt-al', 'lp-2026', 'OPENING', 36, '2026-01-01', 'Opening grant for 2026 leave year', 'sys', '2026-01-01T00:00:00.000Z');
INSERT INTO employee (id, employee_code, first_name, last_name, work_email, status, joined_on, probation_end_on, location_id, department_id, team_id, job_title_id, employment_type_id, retention_class, version, created_at, created_by, updated_at, updated_by)
VALUES ('emp-saravanan', 'SNS-1008', 'Saravanan', 'M', 'saravanan@sns.test', 'active', '2023-03-06', NULL, 'loc-navalur', 'dept-pub', 'team-team-pub', 'jt-9', 'et-prod', 'standard', 1, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_account (id, employee_id, email, username, password_hash, password_algo, must_change_password, is_disabled, failed_attempts, created_at, created_by, updated_at, updated_by)
VALUES ('usr-saravanan', 'emp-saravanan', 'saravanan@sns.test', 'saravanan', '$argon2id$v=19$m=19456,t=2,p=1$JtxHxP3JFR+k+BHjQ/mPGw$P6QVGZNCx2MrUxz3mZdkyT1/D8c/58cnBhlnS10DXxk', 'argon2id', 0, 0, 0, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_role (user_account_id, role_id, granted_by, granted_at)
SELECT 'usr-saravanan', id, 'sys', '2026-01-01T00:00:00.000Z' FROM role WHERE code = 'employee';
INSERT INTO employee (id, employee_code, first_name, last_name, work_email, status, joined_on, probation_end_on, location_id, department_id, team_id, job_title_id, employment_type_id, retention_class, version, created_at, created_by, updated_at, updated_by)
VALUES ('emp-nithya', 'SNS-1009', 'Nithya', 'Kalyani', 'nithya@sns.test', 'active', '2023-11-15', NULL, 'loc-navalur', 'dept-pub', 'team-team-pub', 'jt-10', 'et-prod', 'standard', 1, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_account (id, employee_id, email, username, password_hash, password_algo, must_change_password, is_disabled, failed_attempts, created_at, created_by, updated_at, updated_by)
VALUES ('usr-nithya', 'emp-nithya', 'nithya@sns.test', 'nithya', '$argon2id$v=19$m=19456,t=2,p=1$JtxHxP3JFR+k+BHjQ/mPGw$P6QVGZNCx2MrUxz3mZdkyT1/D8c/58cnBhlnS10DXxk', 'argon2id', 0, 0, 0, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_role (user_account_id, role_id, granted_by, granted_at)
SELECT 'usr-nithya', id, 'sys', '2026-01-01T00:00:00.000Z' FROM role WHERE code = 'employee';
INSERT INTO balance_ledger (id, employee_id, leave_type_id, period_id, entry_type, quantity_half_days, effective_on, reason, created_by, created_at)
VALUES ('bal-nithya-open', 'emp-nithya', 'lt-al', 'lp-2026', 'OPENING', 36, '2026-01-01', 'Opening grant for 2026 leave year', 'sys', '2026-01-01T00:00:00.000Z');
INSERT INTO employee (id, employee_code, first_name, last_name, work_email, status, joined_on, probation_end_on, location_id, department_id, team_id, job_title_id, employment_type_id, retention_class, version, created_at, created_by, updated_at, updated_by)
VALUES ('emp-harish', 'SNS-1010', 'Harish', 'Babu', 'harish@sns.test', 'probation', '2026-07-01', '2026-12-31', 'loc-navalur', 'dept-pub', 'team-team-pub', 'jt-11', 'et-prod', 'standard', 1, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_account (id, employee_id, email, username, password_hash, password_algo, must_change_password, is_disabled, failed_attempts, created_at, created_by, updated_at, updated_by)
VALUES ('usr-harish', 'emp-harish', 'harish@sns.test', 'harish', '$argon2id$v=19$m=19456,t=2,p=1$JtxHxP3JFR+k+BHjQ/mPGw$P6QVGZNCx2MrUxz3mZdkyT1/D8c/58cnBhlnS10DXxk', 'argon2id', 0, 0, 0, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_role (user_account_id, role_id, granted_by, granted_at)
SELECT 'usr-harish', id, 'sys', '2026-01-01T00:00:00.000Z' FROM role WHERE code = 'employee';
INSERT INTO balance_ledger (id, employee_id, leave_type_id, period_id, entry_type, quantity_half_days, effective_on, reason, created_by, created_at)
VALUES ('bal-harish-open', 'emp-harish', 'lt-al', 'lp-2026', 'OPENING', 36, '2026-01-01', 'Opening grant for 2026 leave year', 'sys', '2026-01-01T00:00:00.000Z');
INSERT INTO employee (id, employee_code, first_name, last_name, work_email, status, joined_on, probation_end_on, location_id, department_id, team_id, job_title_id, employment_type_id, retention_class, version, created_at, created_by, updated_at, updated_by)
VALUES ('emp-dinesh', 'SNS-1011', 'Dinesh', 'Kumar', 'dinesh@sns.test', 'active', '2017-09-04', NULL, 'loc-navalur', 'dept-ites', 'team-team-ites', 'jt-12', 'et-mgmt', 'standard', 1, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_account (id, employee_id, email, username, password_hash, password_algo, must_change_password, is_disabled, failed_attempts, created_at, created_by, updated_at, updated_by)
VALUES ('usr-dinesh', 'emp-dinesh', 'dinesh@sns.test', 'dinesh', '$argon2id$v=19$m=19456,t=2,p=1$JtxHxP3JFR+k+BHjQ/mPGw$P6QVGZNCx2MrUxz3mZdkyT1/D8c/58cnBhlnS10DXxk', 'argon2id', 0, 0, 0, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_role (user_account_id, role_id, granted_by, granted_at)
SELECT 'usr-dinesh', id, 'sys', '2026-01-01T00:00:00.000Z' FROM role WHERE code = 'manager';
INSERT INTO balance_ledger (id, employee_id, leave_type_id, period_id, entry_type, quantity_half_days, effective_on, reason, created_by, created_at)
VALUES ('bal-dinesh-open', 'emp-dinesh', 'lt-al', 'lp-2026', 'OPENING', 36, '2026-01-01', 'Opening grant for 2026 leave year', 'sys', '2026-01-01T00:00:00.000Z');
INSERT INTO employee (id, employee_code, first_name, last_name, work_email, status, joined_on, probation_end_on, location_id, department_id, team_id, job_title_id, employment_type_id, retention_class, version, created_at, created_by, updated_at, updated_by)
VALUES ('emp-anandhi', 'SNS-1012', 'Anandhi', 'S', 'anandhi@sns.test', 'active', '2019-01-21', NULL, 'loc-navalur', 'dept-ites', 'team-team-ites', 'jt-13', 'et-perm', 'standard', 1, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_account (id, employee_id, email, username, password_hash, password_algo, must_change_password, is_disabled, failed_attempts, created_at, created_by, updated_at, updated_by)
VALUES ('usr-anandhi', 'emp-anandhi', 'anandhi@sns.test', 'anandhi', '$argon2id$v=19$m=19456,t=2,p=1$JtxHxP3JFR+k+BHjQ/mPGw$P6QVGZNCx2MrUxz3mZdkyT1/D8c/58cnBhlnS10DXxk', 'argon2id', 0, 0, 0, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_role (user_account_id, role_id, granted_by, granted_at)
SELECT 'usr-anandhi', id, 'sys', '2026-01-01T00:00:00.000Z' FROM role WHERE code = 'employee';
INSERT INTO balance_ledger (id, employee_id, leave_type_id, period_id, entry_type, quantity_half_days, effective_on, reason, created_by, created_at)
VALUES ('bal-anandhi-open', 'emp-anandhi', 'lt-al', 'lp-2026', 'OPENING', 36, '2026-01-01', 'Opening grant for 2026 leave year', 'sys', '2026-01-01T00:00:00.000Z');
INSERT INTO employee (id, employee_code, first_name, last_name, work_email, status, joined_on, probation_end_on, location_id, department_id, team_id, job_title_id, employment_type_id, retention_class, version, created_at, created_by, updated_at, updated_by)
VALUES ('emp-balaji', 'SNS-1013', 'Balaji', 'V', 'balaji@sns.test', 'active', '2020-05-18', NULL, 'loc-navalur', 'dept-ites', 'team-team-ites', 'jt-14', 'et-perm', 'standard', 1, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_account (id, employee_id, email, username, password_hash, password_algo, must_change_password, is_disabled, failed_attempts, created_at, created_by, updated_at, updated_by)
VALUES ('usr-balaji', 'emp-balaji', 'balaji@sns.test', 'balaji', '$argon2id$v=19$m=19456,t=2,p=1$JtxHxP3JFR+k+BHjQ/mPGw$P6QVGZNCx2MrUxz3mZdkyT1/D8c/58cnBhlnS10DXxk', 'argon2id', 0, 0, 0, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_role (user_account_id, role_id, granted_by, granted_at)
SELECT 'usr-balaji', id, 'sys', '2026-01-01T00:00:00.000Z' FROM role WHERE code = 'employee';
INSERT INTO balance_ledger (id, employee_id, leave_type_id, period_id, entry_type, quantity_half_days, effective_on, reason, created_by, created_at)
VALUES ('bal-balaji-open', 'emp-balaji', 'lt-al', 'lp-2026', 'OPENING', 36, '2026-01-01', 'Opening grant for 2026 leave year', 'sys', '2026-01-01T00:00:00.000Z');
INSERT INTO employee (id, employee_code, first_name, last_name, work_email, status, joined_on, probation_end_on, location_id, department_id, team_id, job_title_id, employment_type_id, retention_class, version, created_at, created_by, updated_at, updated_by)
VALUES ('emp-chitra', 'SNS-1014', 'Chitra', 'Devi', 'chitra@sns.test', 'active', '2021-02-15', NULL, 'loc-navalur', 'dept-ites', 'team-team-ites', 'jt-15', 'et-perm', 'standard', 1, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_account (id, employee_id, email, username, password_hash, password_algo, must_change_password, is_disabled, failed_attempts, created_at, created_by, updated_at, updated_by)
VALUES ('usr-chitra', 'emp-chitra', 'chitra@sns.test', 'chitra', '$argon2id$v=19$m=19456,t=2,p=1$JtxHxP3JFR+k+BHjQ/mPGw$P6QVGZNCx2MrUxz3mZdkyT1/D8c/58cnBhlnS10DXxk', 'argon2id', 0, 0, 0, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_role (user_account_id, role_id, granted_by, granted_at)
SELECT 'usr-chitra', id, 'sys', '2026-01-01T00:00:00.000Z' FROM role WHERE code = 'employee';
INSERT INTO balance_ledger (id, employee_id, leave_type_id, period_id, entry_type, quantity_half_days, effective_on, reason, created_by, created_at)
VALUES ('bal-chitra-open', 'emp-chitra', 'lt-al', 'lp-2026', 'OPENING', 36, '2026-01-01', 'Opening grant for 2026 leave year', 'sys', '2026-01-01T00:00:00.000Z');
INSERT INTO employee (id, employee_code, first_name, last_name, work_email, status, joined_on, probation_end_on, location_id, department_id, team_id, job_title_id, employment_type_id, retention_class, version, created_at, created_by, updated_at, updated_by)
VALUES ('emp-gowtham', 'SNS-1015', 'Gowtham', 'R', 'gowtham@sns.test', 'active', '2021-10-11', NULL, 'loc-navalur', 'dept-ites', 'team-team-ites', 'jt-16', 'et-perm', 'standard', 1, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_account (id, employee_id, email, username, password_hash, password_algo, must_change_password, is_disabled, failed_attempts, created_at, created_by, updated_at, updated_by)
VALUES ('usr-gowtham', 'emp-gowtham', 'gowtham@sns.test', 'gowtham', '$argon2id$v=19$m=19456,t=2,p=1$JtxHxP3JFR+k+BHjQ/mPGw$P6QVGZNCx2MrUxz3mZdkyT1/D8c/58cnBhlnS10DXxk', 'argon2id', 0, 0, 0, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_role (user_account_id, role_id, granted_by, granted_at)
SELECT 'usr-gowtham', id, 'sys', '2026-01-01T00:00:00.000Z' FROM role WHERE code = 'employee';
INSERT INTO balance_ledger (id, employee_id, leave_type_id, period_id, entry_type, quantity_half_days, effective_on, reason, created_by, created_at)
VALUES ('bal-gowtham-open', 'emp-gowtham', 'lt-al', 'lp-2026', 'OPENING', 36, '2026-01-01', 'Opening grant for 2026 leave year', 'sys', '2026-01-01T00:00:00.000Z');
INSERT INTO employee (id, employee_code, first_name, last_name, work_email, status, joined_on, probation_end_on, location_id, department_id, team_id, job_title_id, employment_type_id, retention_class, version, created_at, created_by, updated_at, updated_by)
VALUES ('emp-janani', 'SNS-1016', 'Janani', 'K', 'janani@sns.test', 'active', '2022-04-04', NULL, 'loc-navalur', 'dept-ites', 'team-team-ites', 'jt-17', 'et-perm', 'standard', 1, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_account (id, employee_id, email, username, password_hash, password_algo, must_change_password, is_disabled, failed_attempts, created_at, created_by, updated_at, updated_by)
VALUES ('usr-janani', 'emp-janani', 'janani@sns.test', 'janani', '$argon2id$v=19$m=19456,t=2,p=1$JtxHxP3JFR+k+BHjQ/mPGw$P6QVGZNCx2MrUxz3mZdkyT1/D8c/58cnBhlnS10DXxk', 'argon2id', 0, 0, 0, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_role (user_account_id, role_id, granted_by, granted_at)
SELECT 'usr-janani', id, 'sys', '2026-01-01T00:00:00.000Z' FROM role WHERE code = 'employee';
INSERT INTO balance_ledger (id, employee_id, leave_type_id, period_id, entry_type, quantity_half_days, effective_on, reason, created_by, created_at)
VALUES ('bal-janani-open', 'emp-janani', 'lt-al', 'lp-2026', 'OPENING', 36, '2026-01-01', 'Opening grant for 2026 leave year', 'sys', '2026-01-01T00:00:00.000Z');
INSERT INTO employee (id, employee_code, first_name, last_name, work_email, status, joined_on, probation_end_on, location_id, department_id, team_id, job_title_id, employment_type_id, retention_class, version, created_at, created_by, updated_at, updated_by)
VALUES ('emp-manikandan', 'SNS-1017', 'Manikandan', 'P', 'manikandan@sns.test', 'active', '2022-11-28', NULL, 'loc-navalur', 'dept-ites', 'team-team-ites', 'jt-18', 'et-perm', 'standard', 1, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_account (id, employee_id, email, username, password_hash, password_algo, must_change_password, is_disabled, failed_attempts, created_at, created_by, updated_at, updated_by)
VALUES ('usr-manikandan', 'emp-manikandan', 'manikandan@sns.test', 'manikandan', '$argon2id$v=19$m=19456,t=2,p=1$JtxHxP3JFR+k+BHjQ/mPGw$P6QVGZNCx2MrUxz3mZdkyT1/D8c/58cnBhlnS10DXxk', 'argon2id', 0, 0, 0, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_role (user_account_id, role_id, granted_by, granted_at)
SELECT 'usr-manikandan', id, 'sys', '2026-01-01T00:00:00.000Z' FROM role WHERE code = 'employee';
INSERT INTO balance_ledger (id, employee_id, leave_type_id, period_id, entry_type, quantity_half_days, effective_on, reason, created_by, created_at)
VALUES ('bal-manikandan-open', 'emp-manikandan', 'lt-al', 'lp-2026', 'OPENING', 36, '2026-01-01', 'Opening grant for 2026 leave year', 'sys', '2026-01-01T00:00:00.000Z');
INSERT INTO employee (id, employee_code, first_name, last_name, work_email, status, joined_on, probation_end_on, location_id, department_id, team_id, job_title_id, employment_type_id, retention_class, version, created_at, created_by, updated_at, updated_by)
VALUES ('emp-poornima', 'SNS-1018', 'Poornima', 'N', 'poornima@sns.test', 'active', '2023-06-19', NULL, 'loc-navalur', 'dept-ites', 'team-team-ites', 'jt-19', 'et-perm', 'standard', 1, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_account (id, employee_id, email, username, password_hash, password_algo, must_change_password, is_disabled, failed_attempts, created_at, created_by, updated_at, updated_by)
VALUES ('usr-poornima', 'emp-poornima', 'poornima@sns.test', 'poornima', '$argon2id$v=19$m=19456,t=2,p=1$JtxHxP3JFR+k+BHjQ/mPGw$P6QVGZNCx2MrUxz3mZdkyT1/D8c/58cnBhlnS10DXxk', 'argon2id', 0, 0, 0, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_role (user_account_id, role_id, granted_by, granted_at)
SELECT 'usr-poornima', id, 'sys', '2026-01-01T00:00:00.000Z' FROM role WHERE code = 'employee';
INSERT INTO balance_ledger (id, employee_id, leave_type_id, period_id, entry_type, quantity_half_days, effective_on, reason, created_by, created_at)
VALUES ('bal-poornima-open', 'emp-poornima', 'lt-al', 'lp-2026', 'OPENING', 36, '2026-01-01', 'Opening grant for 2026 leave year', 'sys', '2026-01-01T00:00:00.000Z');
INSERT INTO employee (id, employee_code, first_name, last_name, work_email, status, joined_on, probation_end_on, location_id, department_id, team_id, job_title_id, employment_type_id, retention_class, version, created_at, created_by, updated_at, updated_by)
VALUES ('emp-sathish', 'SNS-1019', 'Sathish', 'Raj', 'sathish@sns.test', 'active', '2024-01-15', NULL, 'loc-navalur', 'dept-ites', 'team-team-ites', 'jt-20', 'et-perm', 'standard', 1, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_account (id, employee_id, email, username, password_hash, password_algo, must_change_password, is_disabled, failed_attempts, created_at, created_by, updated_at, updated_by)
VALUES ('usr-sathish', 'emp-sathish', 'sathish@sns.test', 'sathish', '$argon2id$v=19$m=19456,t=2,p=1$JtxHxP3JFR+k+BHjQ/mPGw$P6QVGZNCx2MrUxz3mZdkyT1/D8c/58cnBhlnS10DXxk', 'argon2id', 0, 0, 0, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_role (user_account_id, role_id, granted_by, granted_at)
SELECT 'usr-sathish', id, 'sys', '2026-01-01T00:00:00.000Z' FROM role WHERE code = 'employee';
INSERT INTO balance_ledger (id, employee_id, leave_type_id, period_id, entry_type, quantity_half_days, effective_on, reason, created_by, created_at)
VALUES ('bal-sathish-open', 'emp-sathish', 'lt-al', 'lp-2026', 'OPENING', 36, '2026-01-01', 'Opening grant for 2026 leave year', 'sys', '2026-01-01T00:00:00.000Z');
INSERT INTO employee (id, employee_code, first_name, last_name, work_email, status, joined_on, probation_end_on, location_id, department_id, team_id, job_title_id, employment_type_id, retention_class, version, created_at, created_by, updated_at, updated_by)
VALUES ('emp-shalini', 'SNS-1020', 'Shalini', 'M', 'shalini@sns.test', 'probation', '2026-06-15', '2026-12-15', 'loc-navalur', 'dept-ites', 'team-team-ites', 'jt-21', 'et-perm', 'standard', 1, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_account (id, employee_id, email, username, password_hash, password_algo, must_change_password, is_disabled, failed_attempts, created_at, created_by, updated_at, updated_by)
VALUES ('usr-shalini', 'emp-shalini', 'shalini@sns.test', 'shalini', '$argon2id$v=19$m=19456,t=2,p=1$JtxHxP3JFR+k+BHjQ/mPGw$P6QVGZNCx2MrUxz3mZdkyT1/D8c/58cnBhlnS10DXxk', 'argon2id', 0, 0, 0, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_role (user_account_id, role_id, granted_by, granted_at)
SELECT 'usr-shalini', id, 'sys', '2026-01-01T00:00:00.000Z' FROM role WHERE code = 'employee';
INSERT INTO balance_ledger (id, employee_id, leave_type_id, period_id, entry_type, quantity_half_days, effective_on, reason, created_by, created_at)
VALUES ('bal-shalini-open', 'emp-shalini', 'lt-al', 'lp-2026', 'OPENING', 36, '2026-01-01', 'Opening grant for 2026 leave year', 'sys', '2026-01-01T00:00:00.000Z');
INSERT INTO employee (id, employee_code, first_name, last_name, work_email, status, joined_on, probation_end_on, location_id, department_id, team_id, job_title_id, employment_type_id, retention_class, version, created_at, created_by, updated_at, updated_by)
VALUES ('emp-lakshmi', 'SNS-1021', 'Lakshmi', 'Priya', 'lakshmi@sns.test', 'active', '2016-11-07', NULL, 'loc-navalur', 'dept-qa', 'team-team-qa', 'jt-22', 'et-mgmt', 'standard', 1, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_account (id, employee_id, email, username, password_hash, password_algo, must_change_password, is_disabled, failed_attempts, created_at, created_by, updated_at, updated_by)
VALUES ('usr-lakshmi', 'emp-lakshmi', 'lakshmi@sns.test', 'lakshmi', '$argon2id$v=19$m=19456,t=2,p=1$JtxHxP3JFR+k+BHjQ/mPGw$P6QVGZNCx2MrUxz3mZdkyT1/D8c/58cnBhlnS10DXxk', 'argon2id', 0, 0, 0, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_role (user_account_id, role_id, granted_by, granted_at)
SELECT 'usr-lakshmi', id, 'sys', '2026-01-01T00:00:00.000Z' FROM role WHERE code = 'manager';
INSERT INTO balance_ledger (id, employee_id, leave_type_id, period_id, entry_type, quantity_half_days, effective_on, reason, created_by, created_at)
VALUES ('bal-lakshmi-open', 'emp-lakshmi', 'lt-al', 'lp-2026', 'OPENING', 36, '2026-01-01', 'Opening grant for 2026 leave year', 'sys', '2026-01-01T00:00:00.000Z');
INSERT INTO employee (id, employee_code, first_name, last_name, work_email, status, joined_on, probation_end_on, location_id, department_id, team_id, job_title_id, employment_type_id, retention_class, version, created_at, created_by, updated_at, updated_by)
VALUES ('emp-gokul', 'SNS-1022', 'Gokul', 'Nath', 'gokul@sns.test', 'active', '2018-08-20', NULL, 'loc-navalur', 'dept-qa', 'team-team-qa', 'jt-23', 'et-perm', 'standard', 1, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_account (id, employee_id, email, username, password_hash, password_algo, must_change_password, is_disabled, failed_attempts, created_at, created_by, updated_at, updated_by)
VALUES ('usr-gokul', 'emp-gokul', 'gokul@sns.test', 'gokul', '$argon2id$v=19$m=19456,t=2,p=1$JtxHxP3JFR+k+BHjQ/mPGw$P6QVGZNCx2MrUxz3mZdkyT1/D8c/58cnBhlnS10DXxk', 'argon2id', 0, 0, 0, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_role (user_account_id, role_id, granted_by, granted_at)
SELECT 'usr-gokul', id, 'sys', '2026-01-01T00:00:00.000Z' FROM role WHERE code = 'employee';
INSERT INTO balance_ledger (id, employee_id, leave_type_id, period_id, entry_type, quantity_half_days, effective_on, reason, created_by, created_at)
VALUES ('bal-gokul-open', 'emp-gokul', 'lt-al', 'lp-2026', 'OPENING', 36, '2026-01-01', 'Opening grant for 2026 leave year', 'sys', '2026-01-01T00:00:00.000Z');
INSERT INTO employee (id, employee_code, first_name, last_name, work_email, status, joined_on, probation_end_on, location_id, department_id, team_id, job_title_id, employment_type_id, retention_class, version, created_at, created_by, updated_at, updated_by)
VALUES ('emp-hema', 'SNS-1023', 'Hema', 'Malini', 'hema@sns.test', 'active', '2019-09-02', NULL, 'loc-navalur', 'dept-qa', 'team-team-qa', 'jt-24', 'et-perm', 'standard', 1, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_account (id, employee_id, email, username, password_hash, password_algo, must_change_password, is_disabled, failed_attempts, created_at, created_by, updated_at, updated_by)
VALUES ('usr-hema', 'emp-hema', 'hema@sns.test', 'hema', '$argon2id$v=19$m=19456,t=2,p=1$JtxHxP3JFR+k+BHjQ/mPGw$P6QVGZNCx2MrUxz3mZdkyT1/D8c/58cnBhlnS10DXxk', 'argon2id', 0, 0, 0, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_role (user_account_id, role_id, granted_by, granted_at)
SELECT 'usr-hema', id, 'sys', '2026-01-01T00:00:00.000Z' FROM role WHERE code = 'employee';
INSERT INTO balance_ledger (id, employee_id, leave_type_id, period_id, entry_type, quantity_half_days, effective_on, reason, created_by, created_at)
VALUES ('bal-hema-open', 'emp-hema', 'lt-al', 'lp-2026', 'OPENING', 36, '2026-01-01', 'Opening grant for 2026 leave year', 'sys', '2026-01-01T00:00:00.000Z');
INSERT INTO employee (id, employee_code, first_name, last_name, work_email, status, joined_on, probation_end_on, location_id, department_id, team_id, job_title_id, employment_type_id, retention_class, version, created_at, created_by, updated_at, updated_by)
VALUES ('emp-ilango', 'SNS-1024', 'Ilango', 'T', 'ilango@sns.test', 'active', '2020-07-13', NULL, 'loc-navalur', 'dept-qa', 'team-team-qa', 'jt-25', 'et-perm', 'standard', 1, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_account (id, employee_id, email, username, password_hash, password_algo, must_change_password, is_disabled, failed_attempts, created_at, created_by, updated_at, updated_by)
VALUES ('usr-ilango', 'emp-ilango', 'ilango@sns.test', 'ilango', '$argon2id$v=19$m=19456,t=2,p=1$JtxHxP3JFR+k+BHjQ/mPGw$P6QVGZNCx2MrUxz3mZdkyT1/D8c/58cnBhlnS10DXxk', 'argon2id', 0, 0, 0, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_role (user_account_id, role_id, granted_by, granted_at)
SELECT 'usr-ilango', id, 'sys', '2026-01-01T00:00:00.000Z' FROM role WHERE code = 'employee';
INSERT INTO balance_ledger (id, employee_id, leave_type_id, period_id, entry_type, quantity_half_days, effective_on, reason, created_by, created_at)
VALUES ('bal-ilango-open', 'emp-ilango', 'lt-al', 'lp-2026', 'OPENING', 36, '2026-01-01', 'Opening grant for 2026 leave year', 'sys', '2026-01-01T00:00:00.000Z');
INSERT INTO employee (id, employee_code, first_name, last_name, work_email, status, joined_on, probation_end_on, location_id, department_id, team_id, job_title_id, employment_type_id, retention_class, version, created_at, created_by, updated_at, updated_by)
VALUES ('emp-keerthana', 'SNS-1025', 'Keerthana', 'S', 'keerthana@sns.test', 'active', '2021-03-22', NULL, 'loc-navalur', 'dept-qa', 'team-team-qa', 'jt-26', 'et-perm', 'standard', 1, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_account (id, employee_id, email, username, password_hash, password_algo, must_change_password, is_disabled, failed_attempts, created_at, created_by, updated_at, updated_by)
VALUES ('usr-keerthana', 'emp-keerthana', 'keerthana@sns.test', 'keerthana', '$argon2id$v=19$m=19456,t=2,p=1$JtxHxP3JFR+k+BHjQ/mPGw$P6QVGZNCx2MrUxz3mZdkyT1/D8c/58cnBhlnS10DXxk', 'argon2id', 0, 0, 0, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_role (user_account_id, role_id, granted_by, granted_at)
SELECT 'usr-keerthana', id, 'sys', '2026-01-01T00:00:00.000Z' FROM role WHERE code = 'employee';
INSERT INTO balance_ledger (id, employee_id, leave_type_id, period_id, entry_type, quantity_half_days, effective_on, reason, created_by, created_at)
VALUES ('bal-keerthana-open', 'emp-keerthana', 'lt-al', 'lp-2026', 'OPENING', 36, '2026-01-01', 'Opening grant for 2026 leave year', 'sys', '2026-01-01T00:00:00.000Z');
INSERT INTO employee (id, employee_code, first_name, last_name, work_email, status, joined_on, probation_end_on, location_id, department_id, team_id, job_title_id, employment_type_id, retention_class, version, created_at, created_by, updated_at, updated_by)
VALUES ('emp-mohan', 'SNS-1026', 'Mohan', 'Doss', 'mohan@sns.test', 'active', '2022-02-07', NULL, 'loc-navalur', 'dept-qa', 'team-team-qa', 'jt-27', 'et-perm', 'standard', 1, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_account (id, employee_id, email, username, password_hash, password_algo, must_change_password, is_disabled, failed_attempts, created_at, created_by, updated_at, updated_by)
VALUES ('usr-mohan', 'emp-mohan', 'mohan@sns.test', 'mohan', '$argon2id$v=19$m=19456,t=2,p=1$JtxHxP3JFR+k+BHjQ/mPGw$P6QVGZNCx2MrUxz3mZdkyT1/D8c/58cnBhlnS10DXxk', 'argon2id', 0, 0, 0, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_role (user_account_id, role_id, granted_by, granted_at)
SELECT 'usr-mohan', id, 'sys', '2026-01-01T00:00:00.000Z' FROM role WHERE code = 'employee';
INSERT INTO balance_ledger (id, employee_id, leave_type_id, period_id, entry_type, quantity_half_days, effective_on, reason, created_by, created_at)
VALUES ('bal-mohan-open', 'emp-mohan', 'lt-al', 'lp-2026', 'OPENING', 36, '2026-01-01', 'Opening grant for 2026 leave year', 'sys', '2026-01-01T00:00:00.000Z');
INSERT INTO employee (id, employee_code, first_name, last_name, work_email, status, joined_on, probation_end_on, location_id, department_id, team_id, job_title_id, employment_type_id, retention_class, version, created_at, created_by, updated_at, updated_by)
VALUES ('emp-nandhini', 'SNS-1027', 'Nandhini', 'G', 'nandhini@sns.test', 'active', '2022-10-17', NULL, 'loc-navalur', 'dept-qa', 'team-team-qa', 'jt-28', 'et-perm', 'standard', 1, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_account (id, employee_id, email, username, password_hash, password_algo, must_change_password, is_disabled, failed_attempts, created_at, created_by, updated_at, updated_by)
VALUES ('usr-nandhini', 'emp-nandhini', 'nandhini@sns.test', 'nandhini', '$argon2id$v=19$m=19456,t=2,p=1$JtxHxP3JFR+k+BHjQ/mPGw$P6QVGZNCx2MrUxz3mZdkyT1/D8c/58cnBhlnS10DXxk', 'argon2id', 0, 0, 0, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_role (user_account_id, role_id, granted_by, granted_at)
SELECT 'usr-nandhini', id, 'sys', '2026-01-01T00:00:00.000Z' FROM role WHERE code = 'employee';
INSERT INTO balance_ledger (id, employee_id, leave_type_id, period_id, entry_type, quantity_half_days, effective_on, reason, created_by, created_at)
VALUES ('bal-nandhini-open', 'emp-nandhini', 'lt-al', 'lp-2026', 'OPENING', 36, '2026-01-01', 'Opening grant for 2026 leave year', 'sys', '2026-01-01T00:00:00.000Z');
INSERT INTO employee (id, employee_code, first_name, last_name, work_email, status, joined_on, probation_end_on, location_id, department_id, team_id, job_title_id, employment_type_id, retention_class, version, created_at, created_by, updated_at, updated_by)
VALUES ('emp-pradeep', 'SNS-1028', 'Pradeep', 'Kumar', 'pradeep@sns.test', 'active', '2023-05-08', NULL, 'loc-navalur', 'dept-qa', 'team-team-qa', 'jt-29', 'et-perm', 'standard', 1, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_account (id, employee_id, email, username, password_hash, password_algo, must_change_password, is_disabled, failed_attempts, created_at, created_by, updated_at, updated_by)
VALUES ('usr-pradeep', 'emp-pradeep', 'pradeep@sns.test', 'pradeep', '$argon2id$v=19$m=19456,t=2,p=1$JtxHxP3JFR+k+BHjQ/mPGw$P6QVGZNCx2MrUxz3mZdkyT1/D8c/58cnBhlnS10DXxk', 'argon2id', 0, 0, 0, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_role (user_account_id, role_id, granted_by, granted_at)
SELECT 'usr-pradeep', id, 'sys', '2026-01-01T00:00:00.000Z' FROM role WHERE code = 'employee';
INSERT INTO balance_ledger (id, employee_id, leave_type_id, period_id, entry_type, quantity_half_days, effective_on, reason, created_by, created_at)
VALUES ('bal-pradeep-open', 'emp-pradeep', 'lt-al', 'lp-2026', 'OPENING', 36, '2026-01-01', 'Opening grant for 2026 leave year', 'sys', '2026-01-01T00:00:00.000Z');
INSERT INTO employee (id, employee_code, first_name, last_name, work_email, status, joined_on, probation_end_on, location_id, department_id, team_id, job_title_id, employment_type_id, retention_class, version, created_at, created_by, updated_at, updated_by)
VALUES ('emp-radhika', 'SNS-1029', 'Radhika', 'V', 'radhika@sns.test', 'active', '2024-02-12', NULL, 'loc-navalur', 'dept-qa', 'team-team-qa', 'jt-30', 'et-perm', 'standard', 1, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_account (id, employee_id, email, username, password_hash, password_algo, must_change_password, is_disabled, failed_attempts, created_at, created_by, updated_at, updated_by)
VALUES ('usr-radhika', 'emp-radhika', 'radhika@sns.test', 'radhika', '$argon2id$v=19$m=19456,t=2,p=1$JtxHxP3JFR+k+BHjQ/mPGw$P6QVGZNCx2MrUxz3mZdkyT1/D8c/58cnBhlnS10DXxk', 'argon2id', 0, 0, 0, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_role (user_account_id, role_id, granted_by, granted_at)
SELECT 'usr-radhika', id, 'sys', '2026-01-01T00:00:00.000Z' FROM role WHERE code = 'employee';
INSERT INTO balance_ledger (id, employee_id, leave_type_id, period_id, entry_type, quantity_half_days, effective_on, reason, created_by, created_at)
VALUES ('bal-radhika-open', 'emp-radhika', 'lt-al', 'lp-2026', 'OPENING', 36, '2026-01-01', 'Opening grant for 2026 leave year', 'sys', '2026-01-01T00:00:00.000Z');
INSERT INTO employee (id, employee_code, first_name, last_name, work_email, status, joined_on, probation_end_on, location_id, department_id, team_id, job_title_id, employment_type_id, retention_class, version, created_at, created_by, updated_at, updated_by)
VALUES ('emp-sandhiya', 'SNS-1030', 'Sandhiya', 'B', 'sandhiya@sns.test', 'probation', '2026-08-01', '2027-01-31', 'loc-navalur', 'dept-qa', 'team-team-qa', 'jt-31', 'et-perm', 'standard', 1, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_account (id, employee_id, email, username, password_hash, password_algo, must_change_password, is_disabled, failed_attempts, created_at, created_by, updated_at, updated_by)
VALUES ('usr-sandhiya', 'emp-sandhiya', 'sandhiya@sns.test', 'sandhiya', '$argon2id$v=19$m=19456,t=2,p=1$JtxHxP3JFR+k+BHjQ/mPGw$P6QVGZNCx2MrUxz3mZdkyT1/D8c/58cnBhlnS10DXxk', 'argon2id', 0, 0, 0, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_role (user_account_id, role_id, granted_by, granted_at)
SELECT 'usr-sandhiya', id, 'sys', '2026-01-01T00:00:00.000Z' FROM role WHERE code = 'employee';
INSERT INTO balance_ledger (id, employee_id, leave_type_id, period_id, entry_type, quantity_half_days, effective_on, reason, created_by, created_at)
VALUES ('bal-sandhiya-open', 'emp-sandhiya', 'lt-al', 'lp-2026', 'OPENING', 36, '2026-01-01', 'Opening grant for 2026 leave year', 'sys', '2026-01-01T00:00:00.000Z');
INSERT INTO employee (id, employee_code, first_name, last_name, work_email, status, joined_on, probation_end_on, location_id, department_id, team_id, job_title_id, employment_type_id, retention_class, version, created_at, created_by, updated_at, updated_by)
VALUES ('emp-ashwin', 'SNS-1031', 'Ashwin', 'K', 'ashwin@sns.test', 'active', '2017-02-13', NULL, 'loc-navalur', 'dept-tech', 'team-team-tech', 'jt-32', 'et-mgmt', 'standard', 1, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_account (id, employee_id, email, username, password_hash, password_algo, must_change_password, is_disabled, failed_attempts, created_at, created_by, updated_at, updated_by)
VALUES ('usr-ashwin', 'emp-ashwin', 'ashwin@sns.test', 'ashwin', '$argon2id$v=19$m=19456,t=2,p=1$JtxHxP3JFR+k+BHjQ/mPGw$P6QVGZNCx2MrUxz3mZdkyT1/D8c/58cnBhlnS10DXxk', 'argon2id', 0, 0, 0, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_role (user_account_id, role_id, granted_by, granted_at)
SELECT 'usr-ashwin', id, 'sys', '2026-01-01T00:00:00.000Z' FROM role WHERE code = 'manager';
INSERT INTO balance_ledger (id, employee_id, leave_type_id, period_id, entry_type, quantity_half_days, effective_on, reason, created_by, created_at)
VALUES ('bal-ashwin-open', 'emp-ashwin', 'lt-al', 'lp-2026', 'OPENING', 36, '2026-01-01', 'Opening grant for 2026 leave year', 'sys', '2026-01-01T00:00:00.000Z');
INSERT INTO employee (id, employee_code, first_name, last_name, work_email, status, joined_on, probation_end_on, location_id, department_id, team_id, job_title_id, employment_type_id, retention_class, version, created_at, created_by, updated_at, updated_by)
VALUES ('emp-bhuvana', 'SNS-1032', 'Bhuvana', 'M', 'bhuvana@sns.test', 'active', '2018-11-05', NULL, 'loc-navalur', 'dept-tech', 'team-team-tech', 'jt-33', 'et-perm', 'standard', 1, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_account (id, employee_id, email, username, password_hash, password_algo, must_change_password, is_disabled, failed_attempts, created_at, created_by, updated_at, updated_by)
VALUES ('usr-bhuvana', 'emp-bhuvana', 'bhuvana@sns.test', 'bhuvana', '$argon2id$v=19$m=19456,t=2,p=1$JtxHxP3JFR+k+BHjQ/mPGw$P6QVGZNCx2MrUxz3mZdkyT1/D8c/58cnBhlnS10DXxk', 'argon2id', 0, 0, 0, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_role (user_account_id, role_id, granted_by, granted_at)
SELECT 'usr-bhuvana', id, 'sys', '2026-01-01T00:00:00.000Z' FROM role WHERE code = 'employee';
INSERT INTO balance_ledger (id, employee_id, leave_type_id, period_id, entry_type, quantity_half_days, effective_on, reason, created_by, created_at)
VALUES ('bal-bhuvana-open', 'emp-bhuvana', 'lt-al', 'lp-2026', 'OPENING', 36, '2026-01-01', 'Opening grant for 2026 leave year', 'sys', '2026-01-01T00:00:00.000Z');
INSERT INTO employee (id, employee_code, first_name, last_name, work_email, status, joined_on, probation_end_on, location_id, department_id, team_id, job_title_id, employment_type_id, retention_class, version, created_at, created_by, updated_at, updated_by)
VALUES ('emp-chandru', 'SNS-1033', 'Chandru', 'P', 'chandru@sns.test', 'active', '2019-12-09', NULL, 'loc-navalur', 'dept-tech', 'team-team-tech', 'jt-34', 'et-perm', 'standard', 1, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_account (id, employee_id, email, username, password_hash, password_algo, must_change_password, is_disabled, failed_attempts, created_at, created_by, updated_at, updated_by)
VALUES ('usr-chandru', 'emp-chandru', 'chandru@sns.test', 'chandru', '$argon2id$v=19$m=19456,t=2,p=1$JtxHxP3JFR+k+BHjQ/mPGw$P6QVGZNCx2MrUxz3mZdkyT1/D8c/58cnBhlnS10DXxk', 'argon2id', 0, 0, 0, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_role (user_account_id, role_id, granted_by, granted_at)
SELECT 'usr-chandru', id, 'sys', '2026-01-01T00:00:00.000Z' FROM role WHERE code = 'employee';
INSERT INTO balance_ledger (id, employee_id, leave_type_id, period_id, entry_type, quantity_half_days, effective_on, reason, created_by, created_at)
VALUES ('bal-chandru-open', 'emp-chandru', 'lt-al', 'lp-2026', 'OPENING', 36, '2026-01-01', 'Opening grant for 2026 leave year', 'sys', '2026-01-01T00:00:00.000Z');
INSERT INTO employee (id, employee_code, first_name, last_name, work_email, status, joined_on, probation_end_on, location_id, department_id, team_id, job_title_id, employment_type_id, retention_class, version, created_at, created_by, updated_at, updated_by)
VALUES ('emp-divya', 'SNS-1034', 'Divya', 'Bharathi', 'divya@sns.test', 'active', '2020-11-23', NULL, 'loc-navalur', 'dept-tech', 'team-team-tech', 'jt-35', 'et-perm', 'standard', 1, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_account (id, employee_id, email, username, password_hash, password_algo, must_change_password, is_disabled, failed_attempts, created_at, created_by, updated_at, updated_by)
VALUES ('usr-divya', 'emp-divya', 'divya@sns.test', 'divya', '$argon2id$v=19$m=19456,t=2,p=1$JtxHxP3JFR+k+BHjQ/mPGw$P6QVGZNCx2MrUxz3mZdkyT1/D8c/58cnBhlnS10DXxk', 'argon2id', 0, 0, 0, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_role (user_account_id, role_id, granted_by, granted_at)
SELECT 'usr-divya', id, 'sys', '2026-01-01T00:00:00.000Z' FROM role WHERE code = 'employee';
INSERT INTO balance_ledger (id, employee_id, leave_type_id, period_id, entry_type, quantity_half_days, effective_on, reason, created_by, created_at)
VALUES ('bal-divya-open', 'emp-divya', 'lt-al', 'lp-2026', 'OPENING', 36, '2026-01-01', 'Opening grant for 2026 leave year', 'sys', '2026-01-01T00:00:00.000Z');
INSERT INTO employee (id, employee_code, first_name, last_name, work_email, status, joined_on, probation_end_on, location_id, department_id, team_id, job_title_id, employment_type_id, retention_class, version, created_at, created_by, updated_at, updated_by)
VALUES ('emp-eashwar', 'SNS-1035', 'Eashwar', 'T', 'eashwar@sns.test', 'active', '2021-08-16', NULL, 'loc-navalur', 'dept-tech', 'team-team-tech', 'jt-36', 'et-perm', 'standard', 1, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_account (id, employee_id, email, username, password_hash, password_algo, must_change_password, is_disabled, failed_attempts, created_at, created_by, updated_at, updated_by)
VALUES ('usr-eashwar', 'emp-eashwar', 'eashwar@sns.test', 'eashwar', '$argon2id$v=19$m=19456,t=2,p=1$JtxHxP3JFR+k+BHjQ/mPGw$P6QVGZNCx2MrUxz3mZdkyT1/D8c/58cnBhlnS10DXxk', 'argon2id', 0, 0, 0, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_role (user_account_id, role_id, granted_by, granted_at)
SELECT 'usr-eashwar', id, 'sys', '2026-01-01T00:00:00.000Z' FROM role WHERE code = 'employee';
INSERT INTO balance_ledger (id, employee_id, leave_type_id, period_id, entry_type, quantity_half_days, effective_on, reason, created_by, created_at)
VALUES ('bal-eashwar-open', 'emp-eashwar', 'lt-al', 'lp-2026', 'OPENING', 36, '2026-01-01', 'Opening grant for 2026 leave year', 'sys', '2026-01-01T00:00:00.000Z');
INSERT INTO employee (id, employee_code, first_name, last_name, work_email, status, joined_on, probation_end_on, location_id, department_id, team_id, job_title_id, employment_type_id, retention_class, version, created_at, created_by, updated_at, updated_by)
VALUES ('emp-gayathri', 'SNS-1036', 'Gayathri', 'R', 'gayathri@sns.test', 'active', '2022-03-14', NULL, 'loc-navalur', 'dept-tech', 'team-team-tech', 'jt-37', 'et-perm', 'standard', 1, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_account (id, employee_id, email, username, password_hash, password_algo, must_change_password, is_disabled, failed_attempts, created_at, created_by, updated_at, updated_by)
VALUES ('usr-gayathri', 'emp-gayathri', 'gayathri@sns.test', 'gayathri', '$argon2id$v=19$m=19456,t=2,p=1$JtxHxP3JFR+k+BHjQ/mPGw$P6QVGZNCx2MrUxz3mZdkyT1/D8c/58cnBhlnS10DXxk', 'argon2id', 0, 0, 0, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_role (user_account_id, role_id, granted_by, granted_at)
SELECT 'usr-gayathri', id, 'sys', '2026-01-01T00:00:00.000Z' FROM role WHERE code = 'employee';
INSERT INTO balance_ledger (id, employee_id, leave_type_id, period_id, entry_type, quantity_half_days, effective_on, reason, created_by, created_at)
VALUES ('bal-gayathri-open', 'emp-gayathri', 'lt-al', 'lp-2026', 'OPENING', 36, '2026-01-01', 'Opening grant for 2026 leave year', 'sys', '2026-01-01T00:00:00.000Z');
INSERT INTO employee (id, employee_code, first_name, last_name, work_email, status, joined_on, probation_end_on, location_id, department_id, team_id, job_title_id, employment_type_id, retention_class, version, created_at, created_by, updated_at, updated_by)
VALUES ('emp-jagadeesh', 'SNS-1037', 'Jagadeesh', 'S', 'jagadeesh@sns.test', 'active', '2022-12-05', NULL, 'loc-navalur', 'dept-tech', 'team-team-tech', 'jt-38', 'et-perm', 'standard', 1, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_account (id, employee_id, email, username, password_hash, password_algo, must_change_password, is_disabled, failed_attempts, created_at, created_by, updated_at, updated_by)
VALUES ('usr-jagadeesh', 'emp-jagadeesh', 'jagadeesh@sns.test', 'jagadeesh', '$argon2id$v=19$m=19456,t=2,p=1$JtxHxP3JFR+k+BHjQ/mPGw$P6QVGZNCx2MrUxz3mZdkyT1/D8c/58cnBhlnS10DXxk', 'argon2id', 0, 0, 0, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_role (user_account_id, role_id, granted_by, granted_at)
SELECT 'usr-jagadeesh', id, 'sys', '2026-01-01T00:00:00.000Z' FROM role WHERE code = 'employee';
INSERT INTO balance_ledger (id, employee_id, leave_type_id, period_id, entry_type, quantity_half_days, effective_on, reason, created_by, created_at)
VALUES ('bal-jagadeesh-open', 'emp-jagadeesh', 'lt-al', 'lp-2026', 'OPENING', 36, '2026-01-01', 'Opening grant for 2026 leave year', 'sys', '2026-01-01T00:00:00.000Z');
INSERT INTO employee (id, employee_code, first_name, last_name, work_email, status, joined_on, probation_end_on, location_id, department_id, team_id, job_title_id, employment_type_id, retention_class, version, created_at, created_by, updated_at, updated_by)
VALUES ('emp-kavin', 'SNS-1038', 'Kavin', 'Raj', 'kavin@sns.test', 'active', '2023-07-24', NULL, 'loc-navalur', 'dept-tech', 'team-team-tech', 'jt-39', 'et-perm', 'standard', 1, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_account (id, employee_id, email, username, password_hash, password_algo, must_change_password, is_disabled, failed_attempts, created_at, created_by, updated_at, updated_by)
VALUES ('usr-kavin', 'emp-kavin', 'kavin@sns.test', 'kavin', '$argon2id$v=19$m=19456,t=2,p=1$JtxHxP3JFR+k+BHjQ/mPGw$P6QVGZNCx2MrUxz3mZdkyT1/D8c/58cnBhlnS10DXxk', 'argon2id', 0, 0, 0, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_role (user_account_id, role_id, granted_by, granted_at)
SELECT 'usr-kavin', id, 'sys', '2026-01-01T00:00:00.000Z' FROM role WHERE code = 'employee';
INSERT INTO balance_ledger (id, employee_id, leave_type_id, period_id, entry_type, quantity_half_days, effective_on, reason, created_by, created_at)
VALUES ('bal-kavin-open', 'emp-kavin', 'lt-al', 'lp-2026', 'OPENING', 36, '2026-01-01', 'Opening grant for 2026 leave year', 'sys', '2026-01-01T00:00:00.000Z');
INSERT INTO employee (id, employee_code, first_name, last_name, work_email, status, joined_on, probation_end_on, location_id, department_id, team_id, job_title_id, employment_type_id, retention_class, version, created_at, created_by, updated_at, updated_by)
VALUES ('emp-lavanya', 'SNS-1039', 'Lavanya', 'D', 'lavanya@sns.test', 'active', '2024-04-08', NULL, 'loc-navalur', 'dept-tech', 'team-team-tech', 'jt-40', 'et-perm', 'standard', 1, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_account (id, employee_id, email, username, password_hash, password_algo, must_change_password, is_disabled, failed_attempts, created_at, created_by, updated_at, updated_by)
VALUES ('usr-lavanya', 'emp-lavanya', 'lavanya@sns.test', 'lavanya', '$argon2id$v=19$m=19456,t=2,p=1$JtxHxP3JFR+k+BHjQ/mPGw$P6QVGZNCx2MrUxz3mZdkyT1/D8c/58cnBhlnS10DXxk', 'argon2id', 0, 0, 0, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_role (user_account_id, role_id, granted_by, granted_at)
SELECT 'usr-lavanya', id, 'sys', '2026-01-01T00:00:00.000Z' FROM role WHERE code = 'employee';
INSERT INTO balance_ledger (id, employee_id, leave_type_id, period_id, entry_type, quantity_half_days, effective_on, reason, created_by, created_at)
VALUES ('bal-lavanya-open', 'emp-lavanya', 'lt-al', 'lp-2026', 'OPENING', 36, '2026-01-01', 'Opening grant for 2026 leave year', 'sys', '2026-01-01T00:00:00.000Z');
INSERT INTO employee (id, employee_code, first_name, last_name, work_email, status, joined_on, probation_end_on, location_id, department_id, team_id, job_title_id, employment_type_id, retention_class, version, created_at, created_by, updated_at, updated_by)
VALUES ('emp-naveen', 'SNS-1040', 'Naveen', 'Kumar', 'naveen@sns.test', 'probation', '2026-07-15', '2027-01-14', 'loc-navalur', 'dept-tech', 'team-team-tech', 'jt-41', 'et-perm', 'standard', 1, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_account (id, employee_id, email, username, password_hash, password_algo, must_change_password, is_disabled, failed_attempts, created_at, created_by, updated_at, updated_by)
VALUES ('usr-naveen', 'emp-naveen', 'naveen@sns.test', 'naveen', '$argon2id$v=19$m=19456,t=2,p=1$JtxHxP3JFR+k+BHjQ/mPGw$P6QVGZNCx2MrUxz3mZdkyT1/D8c/58cnBhlnS10DXxk', 'argon2id', 0, 0, 0, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_role (user_account_id, role_id, granted_by, granted_at)
SELECT 'usr-naveen', id, 'sys', '2026-01-01T00:00:00.000Z' FROM role WHERE code = 'employee';
INSERT INTO balance_ledger (id, employee_id, leave_type_id, period_id, entry_type, quantity_half_days, effective_on, reason, created_by, created_at)
VALUES ('bal-naveen-open', 'emp-naveen', 'lt-al', 'lp-2026', 'OPENING', 36, '2026-01-01', 'Opening grant for 2026 leave year', 'sys', '2026-01-01T00:00:00.000Z');
INSERT INTO employee (id, employee_code, first_name, last_name, work_email, status, joined_on, probation_end_on, location_id, department_id, team_id, job_title_id, employment_type_id, retention_class, version, created_at, created_by, updated_at, updated_by)
VALUES ('emp-anjusha', 'SNS-1041', 'Anjusha', 'R', 'anjusha@sns.test', 'active', '2016-04-18', NULL, 'loc-navalur', 'dept-hr', 'team-team-hr', 'jt-42', 'et-mgmt', 'standard', 1, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_account (id, employee_id, email, username, password_hash, password_algo, must_change_password, is_disabled, failed_attempts, created_at, created_by, updated_at, updated_by)
VALUES ('usr-anjusha', 'emp-anjusha', 'anjusha@sns.test', 'anjusha', '$argon2id$v=19$m=19456,t=2,p=1$JtxHxP3JFR+k+BHjQ/mPGw$P6QVGZNCx2MrUxz3mZdkyT1/D8c/58cnBhlnS10DXxk', 'argon2id', 0, 0, 0, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_role (user_account_id, role_id, granted_by, granted_at)
SELECT 'usr-anjusha', id, 'sys', '2026-01-01T00:00:00.000Z' FROM role WHERE code = 'hr_officer';
INSERT INTO balance_ledger (id, employee_id, leave_type_id, period_id, entry_type, quantity_half_days, effective_on, reason, created_by, created_at)
VALUES ('bal-anjusha-open', 'emp-anjusha', 'lt-al', 'lp-2026', 'OPENING', 36, '2026-01-01', 'Opening grant for 2026 leave year', 'sys', '2026-01-01T00:00:00.000Z');
INSERT INTO employee (id, employee_code, first_name, last_name, work_email, status, joined_on, probation_end_on, location_id, department_id, team_id, job_title_id, employment_type_id, retention_class, version, created_at, created_by, updated_at, updated_by)
VALUES ('emp-rajesh', 'SNS-1042', 'Rajesh', 'Menon', 'rajesh@sns.test', 'active', '2015-01-05', NULL, 'loc-navalur', 'dept-hr', 'team-team-hr', 'jt-43', 'et-mgmt', 'standard', 1, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_account (id, employee_id, email, username, password_hash, password_algo, must_change_password, is_disabled, failed_attempts, created_at, created_by, updated_at, updated_by)
VALUES ('usr-rajesh', 'emp-rajesh', 'rajesh@sns.test', 'rajesh', '$argon2id$v=19$m=19456,t=2,p=1$JtxHxP3JFR+k+BHjQ/mPGw$P6QVGZNCx2MrUxz3mZdkyT1/D8c/58cnBhlnS10DXxk', 'argon2id', 0, 0, 0, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_role (user_account_id, role_id, granted_by, granted_at)
SELECT 'usr-rajesh', id, 'sys', '2026-01-01T00:00:00.000Z' FROM role WHERE code = 'director';
INSERT INTO balance_ledger (id, employee_id, leave_type_id, period_id, entry_type, quantity_half_days, effective_on, reason, created_by, created_at)
VALUES ('bal-rajesh-open', 'emp-rajesh', 'lt-al', 'lp-2026', 'OPENING', 36, '2026-01-01', 'Opening grant for 2026 leave year', 'sys', '2026-01-01T00:00:00.000Z');
INSERT INTO employee (id, employee_code, first_name, last_name, work_email, status, joined_on, probation_end_on, location_id, department_id, team_id, job_title_id, employment_type_id, retention_class, version, created_at, created_by, updated_at, updated_by)
VALUES ('emp-ramesh', 'SNS-1043', 'Ramesh', 'V', 'ramesh@sns.test', 'active', '2017-06-12', NULL, 'loc-navalur', 'dept-hr', 'team-team-hr', 'jt-44', 'et-perm', 'standard', 1, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_account (id, employee_id, email, username, password_hash, password_algo, must_change_password, is_disabled, failed_attempts, created_at, created_by, updated_at, updated_by)
VALUES ('usr-ramesh', 'emp-ramesh', 'ramesh@sns.test', 'ramesh', '$argon2id$v=19$m=19456,t=2,p=1$JtxHxP3JFR+k+BHjQ/mPGw$P6QVGZNCx2MrUxz3mZdkyT1/D8c/58cnBhlnS10DXxk', 'argon2id', 0, 0, 0, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_role (user_account_id, role_id, granted_by, granted_at)
SELECT 'usr-ramesh', id, 'sys', '2026-01-01T00:00:00.000Z' FROM role WHERE code = 'payroll_officer';
INSERT INTO balance_ledger (id, employee_id, leave_type_id, period_id, entry_type, quantity_half_days, effective_on, reason, created_by, created_at)
VALUES ('bal-ramesh-open', 'emp-ramesh', 'lt-al', 'lp-2026', 'OPENING', 36, '2026-01-01', 'Opening grant for 2026 leave year', 'sys', '2026-01-01T00:00:00.000Z');
INSERT INTO employee (id, employee_code, first_name, last_name, work_email, status, joined_on, probation_end_on, location_id, department_id, team_id, job_title_id, employment_type_id, retention_class, version, created_at, created_by, updated_at, updated_by)
VALUES ('emp-sanjay', 'SNS-1044', 'Sanjay', 'G', 'sanjay@sns.test', 'active', '2019-04-15', NULL, 'loc-navalur', 'dept-hr', 'team-team-hr', 'jt-45', 'et-perm', 'standard', 1, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_account (id, employee_id, email, username, password_hash, password_algo, must_change_password, is_disabled, failed_attempts, created_at, created_by, updated_at, updated_by)
VALUES ('usr-sanjay', 'emp-sanjay', 'sanjay@sns.test', 'sanjay', '$argon2id$v=19$m=19456,t=2,p=1$JtxHxP3JFR+k+BHjQ/mPGw$P6QVGZNCx2MrUxz3mZdkyT1/D8c/58cnBhlnS10DXxk', 'argon2id', 0, 0, 0, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_role (user_account_id, role_id, granted_by, granted_at)
SELECT 'usr-sanjay', id, 'sys', '2026-01-01T00:00:00.000Z' FROM role WHERE code = 'auditor';
INSERT INTO balance_ledger (id, employee_id, leave_type_id, period_id, entry_type, quantity_half_days, effective_on, reason, created_by, created_at)
VALUES ('bal-sanjay-open', 'emp-sanjay', 'lt-al', 'lp-2026', 'OPENING', 36, '2026-01-01', 'Opening grant for 2026 leave year', 'sys', '2026-01-01T00:00:00.000Z');
INSERT INTO employee (id, employee_code, first_name, last_name, work_email, status, joined_on, probation_end_on, location_id, department_id, team_id, job_title_id, employment_type_id, retention_class, version, created_at, created_by, updated_at, updated_by)
VALUES ('emp-swetha', 'SNS-1045', 'Swetha', 'P', 'swetha@sns.test', 'active', '2020-09-07', NULL, 'loc-navalur', 'dept-hr', 'team-team-hr', 'jt-46', 'et-perm', 'standard', 1, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_account (id, employee_id, email, username, password_hash, password_algo, must_change_password, is_disabled, failed_attempts, created_at, created_by, updated_at, updated_by)
VALUES ('usr-swetha', 'emp-swetha', 'swetha@sns.test', 'swetha', '$argon2id$v=19$m=19456,t=2,p=1$JtxHxP3JFR+k+BHjQ/mPGw$P6QVGZNCx2MrUxz3mZdkyT1/D8c/58cnBhlnS10DXxk', 'argon2id', 0, 0, 0, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_role (user_account_id, role_id, granted_by, granted_at)
SELECT 'usr-swetha', id, 'sys', '2026-01-01T00:00:00.000Z' FROM role WHERE code = 'employee';
INSERT INTO balance_ledger (id, employee_id, leave_type_id, period_id, entry_type, quantity_half_days, effective_on, reason, created_by, created_at)
VALUES ('bal-swetha-open', 'emp-swetha', 'lt-al', 'lp-2026', 'OPENING', 36, '2026-01-01', 'Opening grant for 2026 leave year', 'sys', '2026-01-01T00:00:00.000Z');
INSERT INTO employee (id, employee_code, first_name, last_name, work_email, status, joined_on, probation_end_on, location_id, department_id, team_id, job_title_id, employment_type_id, retention_class, version, created_at, created_by, updated_at, updated_by)
VALUES ('emp-tharun', 'SNS-1046', 'Tharun', 'K', 'tharun@sns.test', 'active', '2021-06-21', NULL, 'loc-navalur', 'dept-hr', 'team-team-hr', 'jt-47', 'et-perm', 'standard', 1, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_account (id, employee_id, email, username, password_hash, password_algo, must_change_password, is_disabled, failed_attempts, created_at, created_by, updated_at, updated_by)
VALUES ('usr-tharun', 'emp-tharun', 'tharun@sns.test', 'tharun', '$argon2id$v=19$m=19456,t=2,p=1$JtxHxP3JFR+k+BHjQ/mPGw$P6QVGZNCx2MrUxz3mZdkyT1/D8c/58cnBhlnS10DXxk', 'argon2id', 0, 0, 0, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_role (user_account_id, role_id, granted_by, granted_at)
SELECT 'usr-tharun', id, 'sys', '2026-01-01T00:00:00.000Z' FROM role WHERE code = 'employee';
INSERT INTO balance_ledger (id, employee_id, leave_type_id, period_id, entry_type, quantity_half_days, effective_on, reason, created_by, created_at)
VALUES ('bal-tharun-open', 'emp-tharun', 'lt-al', 'lp-2026', 'OPENING', 36, '2026-01-01', 'Opening grant for 2026 leave year', 'sys', '2026-01-01T00:00:00.000Z');
INSERT INTO employee (id, employee_code, first_name, last_name, work_email, status, joined_on, probation_end_on, location_id, department_id, team_id, job_title_id, employment_type_id, retention_class, version, created_at, created_by, updated_at, updated_by)
VALUES ('emp-usha', 'SNS-1047', 'Usha', 'Rani', 'usha@sns.test', 'active', '2022-05-16', NULL, 'loc-navalur', 'dept-hr', 'team-team-hr', 'jt-48', 'et-perm', 'standard', 1, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_account (id, employee_id, email, username, password_hash, password_algo, must_change_password, is_disabled, failed_attempts, created_at, created_by, updated_at, updated_by)
VALUES ('usr-usha', 'emp-usha', 'usha@sns.test', 'usha', '$argon2id$v=19$m=19456,t=2,p=1$JtxHxP3JFR+k+BHjQ/mPGw$P6QVGZNCx2MrUxz3mZdkyT1/D8c/58cnBhlnS10DXxk', 'argon2id', 0, 0, 0, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_role (user_account_id, role_id, granted_by, granted_at)
SELECT 'usr-usha', id, 'sys', '2026-01-01T00:00:00.000Z' FROM role WHERE code = 'employee';
INSERT INTO balance_ledger (id, employee_id, leave_type_id, period_id, entry_type, quantity_half_days, effective_on, reason, created_by, created_at)
VALUES ('bal-usha-open', 'emp-usha', 'lt-al', 'lp-2026', 'OPENING', 36, '2026-01-01', 'Opening grant for 2026 leave year', 'sys', '2026-01-01T00:00:00.000Z');
INSERT INTO employee (id, employee_code, first_name, last_name, work_email, status, joined_on, probation_end_on, location_id, department_id, team_id, job_title_id, employment_type_id, retention_class, version, created_at, created_by, updated_at, updated_by)
VALUES ('emp-vimal', 'SNS-1048', 'Vimal', 'Raj', 'vimal@sns.test', 'active', '2023-02-20', NULL, 'loc-navalur', 'dept-hr', 'team-team-hr', 'jt-49', 'et-perm', 'standard', 1, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_account (id, employee_id, email, username, password_hash, password_algo, must_change_password, is_disabled, failed_attempts, created_at, created_by, updated_at, updated_by)
VALUES ('usr-vimal', 'emp-vimal', 'vimal@sns.test', 'vimal', '$argon2id$v=19$m=19456,t=2,p=1$JtxHxP3JFR+k+BHjQ/mPGw$P6QVGZNCx2MrUxz3mZdkyT1/D8c/58cnBhlnS10DXxk', 'argon2id', 0, 0, 0, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_role (user_account_id, role_id, granted_by, granted_at)
SELECT 'usr-vimal', id, 'sys', '2026-01-01T00:00:00.000Z' FROM role WHERE code = 'employee';
INSERT INTO balance_ledger (id, employee_id, leave_type_id, period_id, entry_type, quantity_half_days, effective_on, reason, created_by, created_at)
VALUES ('bal-vimal-open', 'emp-vimal', 'lt-al', 'lp-2026', 'OPENING', 36, '2026-01-01', 'Opening grant for 2026 leave year', 'sys', '2026-01-01T00:00:00.000Z');
INSERT INTO employee (id, employee_code, first_name, last_name, work_email, status, joined_on, probation_end_on, location_id, department_id, team_id, job_title_id, employment_type_id, retention_class, version, created_at, created_by, updated_at, updated_by)
VALUES ('emp-yamini', 'SNS-1049', 'Yamini', 'S', 'yamini@sns.test', 'active', '2024-03-11', NULL, 'loc-navalur', 'dept-hr', 'team-team-hr', 'jt-50', 'et-perm', 'standard', 1, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_account (id, employee_id, email, username, password_hash, password_algo, must_change_password, is_disabled, failed_attempts, created_at, created_by, updated_at, updated_by)
VALUES ('usr-yamini', 'emp-yamini', 'yamini@sns.test', 'yamini', '$argon2id$v=19$m=19456,t=2,p=1$JtxHxP3JFR+k+BHjQ/mPGw$P6QVGZNCx2MrUxz3mZdkyT1/D8c/58cnBhlnS10DXxk', 'argon2id', 0, 0, 0, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_role (user_account_id, role_id, granted_by, granted_at)
SELECT 'usr-yamini', id, 'sys', '2026-01-01T00:00:00.000Z' FROM role WHERE code = 'employee';
INSERT INTO balance_ledger (id, employee_id, leave_type_id, period_id, entry_type, quantity_half_days, effective_on, reason, created_by, created_at)
VALUES ('bal-yamini-open', 'emp-yamini', 'lt-al', 'lp-2026', 'OPENING', 36, '2026-01-01', 'Opening grant for 2026 leave year', 'sys', '2026-01-01T00:00:00.000Z');
INSERT INTO employee (id, employee_code, first_name, last_name, work_email, status, joined_on, probation_end_on, location_id, department_id, team_id, job_title_id, employment_type_id, retention_class, version, created_at, created_by, updated_at, updated_by)
VALUES ('emp-zoya', 'SNS-1050', 'Zoya', 'Fathima', 'zoya@sns.test', 'probation', '2026-08-10', '2027-02-09', 'loc-navalur', 'dept-hr', 'team-team-hr', 'jt-51', 'et-perm', 'standard', 1, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_account (id, employee_id, email, username, password_hash, password_algo, must_change_password, is_disabled, failed_attempts, created_at, created_by, updated_at, updated_by)
VALUES ('usr-zoya', 'emp-zoya', 'zoya@sns.test', 'zoya', '$argon2id$v=19$m=19456,t=2,p=1$JtxHxP3JFR+k+BHjQ/mPGw$P6QVGZNCx2MrUxz3mZdkyT1/D8c/58cnBhlnS10DXxk', 'argon2id', 0, 0, 0, '2026-01-01T00:00:00.000Z', 'sys', '2026-01-01T00:00:00.000Z', 'sys');
INSERT INTO user_role (user_account_id, role_id, granted_by, granted_at)
SELECT 'usr-zoya', id, 'sys', '2026-01-01T00:00:00.000Z' FROM role WHERE code = 'employee';
INSERT INTO balance_ledger (id, employee_id, leave_type_id, period_id, entry_type, quantity_half_days, effective_on, reason, created_by, created_at)
VALUES ('bal-zoya-open', 'emp-zoya', 'lt-al', 'lp-2026', 'OPENING', 36, '2026-01-01', 'Opening grant for 2026 leave year', 'sys', '2026-01-01T00:00:00.000Z');

-- 7. Reporting Lines & Leadership
UPDATE employee SET manager_employee_id = 'emp-rajesh' WHERE id = 'emp-admin';
INSERT INTO employment_history (id, employee_id, job_title_id, employment_type_id, department_id, manager_employee_id, effective_from, effective_to, reason, created_at, created_by)
VALUES ('eh-admin', 'emp-admin', (SELECT job_title_id FROM employee WHERE id = 'emp-admin'), (SELECT employment_type_id FROM employee WHERE id = 'emp-admin'), (SELECT department_id FROM employee WHERE id = 'emp-admin'), 'emp-rajesh', '2020-01-06', NULL, 'Joined Simon & Sons Navalur', '2026-01-01T00:00:00.000Z', 'sys');
UPDATE employee SET manager_employee_id = 'emp-rajesh' WHERE id = 'emp-suresh';
INSERT INTO employment_history (id, employee_id, job_title_id, employment_type_id, department_id, manager_employee_id, effective_from, effective_to, reason, created_at, created_by)
VALUES ('eh-suresh', 'emp-suresh', (SELECT job_title_id FROM employee WHERE id = 'emp-suresh'), (SELECT employment_type_id FROM employee WHERE id = 'emp-suresh'), (SELECT department_id FROM employee WHERE id = 'emp-suresh'), 'emp-rajesh', '2018-03-12', NULL, 'Joined Simon & Sons Navalur', '2026-01-01T00:00:00.000Z', 'sys');
UPDATE department SET head_employee_id = 'emp-suresh' WHERE code = 'PUB';
UPDATE team SET lead_employee_id = 'emp-suresh' WHERE id = 'team-team-pub';
UPDATE employee SET manager_employee_id = 'emp-suresh' WHERE id = 'emp-meera';
INSERT INTO employment_history (id, employee_id, job_title_id, employment_type_id, department_id, manager_employee_id, effective_from, effective_to, reason, created_at, created_by)
VALUES ('eh-meera', 'emp-meera', (SELECT job_title_id FROM employee WHERE id = 'emp-meera'), (SELECT employment_type_id FROM employee WHERE id = 'emp-meera'), (SELECT department_id FROM employee WHERE id = 'emp-meera'), 'emp-suresh', '2019-06-17', NULL, 'Joined Simon & Sons Navalur', '2026-01-01T00:00:00.000Z', 'sys');
UPDATE employee SET manager_employee_id = 'emp-suresh' WHERE id = 'emp-arun';
INSERT INTO employment_history (id, employee_id, job_title_id, employment_type_id, department_id, manager_employee_id, effective_from, effective_to, reason, created_at, created_by)
VALUES ('eh-arun', 'emp-arun', (SELECT job_title_id FROM employee WHERE id = 'emp-arun'), (SELECT employment_type_id FROM employee WHERE id = 'emp-arun'), (SELECT department_id FROM employee WHERE id = 'emp-arun'), 'emp-suresh', '2020-02-10', NULL, 'Joined Simon & Sons Navalur', '2026-01-01T00:00:00.000Z', 'sys');
UPDATE employee SET manager_employee_id = 'emp-suresh' WHERE id = 'emp-karthi';
INSERT INTO employment_history (id, employee_id, job_title_id, employment_type_id, department_id, manager_employee_id, effective_from, effective_to, reason, created_at, created_by)
VALUES ('eh-karthi', 'emp-karthi', (SELECT job_title_id FROM employee WHERE id = 'emp-karthi'), (SELECT employment_type_id FROM employee WHERE id = 'emp-karthi'), (SELECT department_id FROM employee WHERE id = 'emp-karthi'), 'emp-suresh', '2021-04-05', NULL, 'Joined Simon & Sons Navalur', '2026-01-01T00:00:00.000Z', 'sys');
UPDATE employee SET manager_employee_id = 'emp-suresh' WHERE id = 'emp-priya';
INSERT INTO employment_history (id, employee_id, job_title_id, employment_type_id, department_id, manager_employee_id, effective_from, effective_to, reason, created_at, created_by)
VALUES ('eh-priya', 'emp-priya', (SELECT job_title_id FROM employee WHERE id = 'emp-priya'), (SELECT employment_type_id FROM employee WHERE id = 'emp-priya'), (SELECT department_id FROM employee WHERE id = 'emp-priya'), 'emp-suresh', '2021-09-20', NULL, 'Joined Simon & Sons Navalur', '2026-01-01T00:00:00.000Z', 'sys');
UPDATE employee SET manager_employee_id = 'emp-suresh' WHERE id = 'emp-vignesh';
INSERT INTO employment_history (id, employee_id, job_title_id, employment_type_id, department_id, manager_employee_id, effective_from, effective_to, reason, created_at, created_by)
VALUES ('eh-vignesh', 'emp-vignesh', (SELECT job_title_id FROM employee WHERE id = 'emp-vignesh'), (SELECT employment_type_id FROM employee WHERE id = 'emp-vignesh'), (SELECT department_id FROM employee WHERE id = 'emp-vignesh'), 'emp-suresh', '2022-01-18', NULL, 'Joined Simon & Sons Navalur', '2026-01-01T00:00:00.000Z', 'sys');
UPDATE employee SET manager_employee_id = 'emp-suresh' WHERE id = 'emp-deepa';
INSERT INTO employment_history (id, employee_id, job_title_id, employment_type_id, department_id, manager_employee_id, effective_from, effective_to, reason, created_at, created_by)
VALUES ('eh-deepa', 'emp-deepa', (SELECT job_title_id FROM employee WHERE id = 'emp-deepa'), (SELECT employment_type_id FROM employee WHERE id = 'emp-deepa'), (SELECT department_id FROM employee WHERE id = 'emp-deepa'), 'emp-suresh', '2022-08-11', NULL, 'Joined Simon & Sons Navalur', '2026-01-01T00:00:00.000Z', 'sys');
UPDATE employee SET manager_employee_id = 'emp-suresh' WHERE id = 'emp-saravanan';
INSERT INTO employment_history (id, employee_id, job_title_id, employment_type_id, department_id, manager_employee_id, effective_from, effective_to, reason, created_at, created_by)
VALUES ('eh-saravanan', 'emp-saravanan', (SELECT job_title_id FROM employee WHERE id = 'emp-saravanan'), (SELECT employment_type_id FROM employee WHERE id = 'emp-saravanan'), (SELECT department_id FROM employee WHERE id = 'emp-saravanan'), 'emp-suresh', '2023-03-06', NULL, 'Joined Simon & Sons Navalur', '2026-01-01T00:00:00.000Z', 'sys');
UPDATE employee SET manager_employee_id = 'emp-suresh' WHERE id = 'emp-nithya';
INSERT INTO employment_history (id, employee_id, job_title_id, employment_type_id, department_id, manager_employee_id, effective_from, effective_to, reason, created_at, created_by)
VALUES ('eh-nithya', 'emp-nithya', (SELECT job_title_id FROM employee WHERE id = 'emp-nithya'), (SELECT employment_type_id FROM employee WHERE id = 'emp-nithya'), (SELECT department_id FROM employee WHERE id = 'emp-nithya'), 'emp-suresh', '2023-11-15', NULL, 'Joined Simon & Sons Navalur', '2026-01-01T00:00:00.000Z', 'sys');
UPDATE employee SET manager_employee_id = 'emp-suresh' WHERE id = 'emp-harish';
INSERT INTO employment_history (id, employee_id, job_title_id, employment_type_id, department_id, manager_employee_id, effective_from, effective_to, reason, created_at, created_by)
VALUES ('eh-harish', 'emp-harish', (SELECT job_title_id FROM employee WHERE id = 'emp-harish'), (SELECT employment_type_id FROM employee WHERE id = 'emp-harish'), (SELECT department_id FROM employee WHERE id = 'emp-harish'), 'emp-suresh', '2026-07-01', NULL, 'Joined Simon & Sons Navalur', '2026-01-01T00:00:00.000Z', 'sys');
UPDATE employee SET manager_employee_id = 'emp-rajesh' WHERE id = 'emp-dinesh';
INSERT INTO employment_history (id, employee_id, job_title_id, employment_type_id, department_id, manager_employee_id, effective_from, effective_to, reason, created_at, created_by)
VALUES ('eh-dinesh', 'emp-dinesh', (SELECT job_title_id FROM employee WHERE id = 'emp-dinesh'), (SELECT employment_type_id FROM employee WHERE id = 'emp-dinesh'), (SELECT department_id FROM employee WHERE id = 'emp-dinesh'), 'emp-rajesh', '2017-09-04', NULL, 'Joined Simon & Sons Navalur', '2026-01-01T00:00:00.000Z', 'sys');
UPDATE department SET head_employee_id = 'emp-dinesh' WHERE code = 'ITES';
UPDATE team SET lead_employee_id = 'emp-dinesh' WHERE id = 'team-team-ites';
UPDATE employee SET manager_employee_id = 'emp-dinesh' WHERE id = 'emp-anandhi';
INSERT INTO employment_history (id, employee_id, job_title_id, employment_type_id, department_id, manager_employee_id, effective_from, effective_to, reason, created_at, created_by)
VALUES ('eh-anandhi', 'emp-anandhi', (SELECT job_title_id FROM employee WHERE id = 'emp-anandhi'), (SELECT employment_type_id FROM employee WHERE id = 'emp-anandhi'), (SELECT department_id FROM employee WHERE id = 'emp-anandhi'), 'emp-dinesh', '2019-01-21', NULL, 'Joined Simon & Sons Navalur', '2026-01-01T00:00:00.000Z', 'sys');
UPDATE employee SET manager_employee_id = 'emp-dinesh' WHERE id = 'emp-balaji';
INSERT INTO employment_history (id, employee_id, job_title_id, employment_type_id, department_id, manager_employee_id, effective_from, effective_to, reason, created_at, created_by)
VALUES ('eh-balaji', 'emp-balaji', (SELECT job_title_id FROM employee WHERE id = 'emp-balaji'), (SELECT employment_type_id FROM employee WHERE id = 'emp-balaji'), (SELECT department_id FROM employee WHERE id = 'emp-balaji'), 'emp-dinesh', '2020-05-18', NULL, 'Joined Simon & Sons Navalur', '2026-01-01T00:00:00.000Z', 'sys');
UPDATE employee SET manager_employee_id = 'emp-dinesh' WHERE id = 'emp-chitra';
INSERT INTO employment_history (id, employee_id, job_title_id, employment_type_id, department_id, manager_employee_id, effective_from, effective_to, reason, created_at, created_by)
VALUES ('eh-chitra', 'emp-chitra', (SELECT job_title_id FROM employee WHERE id = 'emp-chitra'), (SELECT employment_type_id FROM employee WHERE id = 'emp-chitra'), (SELECT department_id FROM employee WHERE id = 'emp-chitra'), 'emp-dinesh', '2021-02-15', NULL, 'Joined Simon & Sons Navalur', '2026-01-01T00:00:00.000Z', 'sys');
UPDATE employee SET manager_employee_id = 'emp-dinesh' WHERE id = 'emp-gowtham';
INSERT INTO employment_history (id, employee_id, job_title_id, employment_type_id, department_id, manager_employee_id, effective_from, effective_to, reason, created_at, created_by)
VALUES ('eh-gowtham', 'emp-gowtham', (SELECT job_title_id FROM employee WHERE id = 'emp-gowtham'), (SELECT employment_type_id FROM employee WHERE id = 'emp-gowtham'), (SELECT department_id FROM employee WHERE id = 'emp-gowtham'), 'emp-dinesh', '2021-10-11', NULL, 'Joined Simon & Sons Navalur', '2026-01-01T00:00:00.000Z', 'sys');
UPDATE employee SET manager_employee_id = 'emp-dinesh' WHERE id = 'emp-janani';
INSERT INTO employment_history (id, employee_id, job_title_id, employment_type_id, department_id, manager_employee_id, effective_from, effective_to, reason, created_at, created_by)
VALUES ('eh-janani', 'emp-janani', (SELECT job_title_id FROM employee WHERE id = 'emp-janani'), (SELECT employment_type_id FROM employee WHERE id = 'emp-janani'), (SELECT department_id FROM employee WHERE id = 'emp-janani'), 'emp-dinesh', '2022-04-04', NULL, 'Joined Simon & Sons Navalur', '2026-01-01T00:00:00.000Z', 'sys');
UPDATE employee SET manager_employee_id = 'emp-dinesh' WHERE id = 'emp-manikandan';
INSERT INTO employment_history (id, employee_id, job_title_id, employment_type_id, department_id, manager_employee_id, effective_from, effective_to, reason, created_at, created_by)
VALUES ('eh-manikandan', 'emp-manikandan', (SELECT job_title_id FROM employee WHERE id = 'emp-manikandan'), (SELECT employment_type_id FROM employee WHERE id = 'emp-manikandan'), (SELECT department_id FROM employee WHERE id = 'emp-manikandan'), 'emp-dinesh', '2022-11-28', NULL, 'Joined Simon & Sons Navalur', '2026-01-01T00:00:00.000Z', 'sys');
UPDATE employee SET manager_employee_id = 'emp-dinesh' WHERE id = 'emp-poornima';
INSERT INTO employment_history (id, employee_id, job_title_id, employment_type_id, department_id, manager_employee_id, effective_from, effective_to, reason, created_at, created_by)
VALUES ('eh-poornima', 'emp-poornima', (SELECT job_title_id FROM employee WHERE id = 'emp-poornima'), (SELECT employment_type_id FROM employee WHERE id = 'emp-poornima'), (SELECT department_id FROM employee WHERE id = 'emp-poornima'), 'emp-dinesh', '2023-06-19', NULL, 'Joined Simon & Sons Navalur', '2026-01-01T00:00:00.000Z', 'sys');
UPDATE employee SET manager_employee_id = 'emp-dinesh' WHERE id = 'emp-sathish';
INSERT INTO employment_history (id, employee_id, job_title_id, employment_type_id, department_id, manager_employee_id, effective_from, effective_to, reason, created_at, created_by)
VALUES ('eh-sathish', 'emp-sathish', (SELECT job_title_id FROM employee WHERE id = 'emp-sathish'), (SELECT employment_type_id FROM employee WHERE id = 'emp-sathish'), (SELECT department_id FROM employee WHERE id = 'emp-sathish'), 'emp-dinesh', '2024-01-15', NULL, 'Joined Simon & Sons Navalur', '2026-01-01T00:00:00.000Z', 'sys');
UPDATE employee SET manager_employee_id = 'emp-dinesh' WHERE id = 'emp-shalini';
INSERT INTO employment_history (id, employee_id, job_title_id, employment_type_id, department_id, manager_employee_id, effective_from, effective_to, reason, created_at, created_by)
VALUES ('eh-shalini', 'emp-shalini', (SELECT job_title_id FROM employee WHERE id = 'emp-shalini'), (SELECT employment_type_id FROM employee WHERE id = 'emp-shalini'), (SELECT department_id FROM employee WHERE id = 'emp-shalini'), 'emp-dinesh', '2026-06-15', NULL, 'Joined Simon & Sons Navalur', '2026-01-01T00:00:00.000Z', 'sys');
UPDATE employee SET manager_employee_id = 'emp-rajesh' WHERE id = 'emp-lakshmi';
INSERT INTO employment_history (id, employee_id, job_title_id, employment_type_id, department_id, manager_employee_id, effective_from, effective_to, reason, created_at, created_by)
VALUES ('eh-lakshmi', 'emp-lakshmi', (SELECT job_title_id FROM employee WHERE id = 'emp-lakshmi'), (SELECT employment_type_id FROM employee WHERE id = 'emp-lakshmi'), (SELECT department_id FROM employee WHERE id = 'emp-lakshmi'), 'emp-rajesh', '2016-11-07', NULL, 'Joined Simon & Sons Navalur', '2026-01-01T00:00:00.000Z', 'sys');
UPDATE department SET head_employee_id = 'emp-lakshmi' WHERE code = 'QA';
UPDATE team SET lead_employee_id = 'emp-lakshmi' WHERE id = 'team-team-qa';
UPDATE employee SET manager_employee_id = 'emp-lakshmi' WHERE id = 'emp-gokul';
INSERT INTO employment_history (id, employee_id, job_title_id, employment_type_id, department_id, manager_employee_id, effective_from, effective_to, reason, created_at, created_by)
VALUES ('eh-gokul', 'emp-gokul', (SELECT job_title_id FROM employee WHERE id = 'emp-gokul'), (SELECT employment_type_id FROM employee WHERE id = 'emp-gokul'), (SELECT department_id FROM employee WHERE id = 'emp-gokul'), 'emp-lakshmi', '2018-08-20', NULL, 'Joined Simon & Sons Navalur', '2026-01-01T00:00:00.000Z', 'sys');
UPDATE employee SET manager_employee_id = 'emp-lakshmi' WHERE id = 'emp-hema';
INSERT INTO employment_history (id, employee_id, job_title_id, employment_type_id, department_id, manager_employee_id, effective_from, effective_to, reason, created_at, created_by)
VALUES ('eh-hema', 'emp-hema', (SELECT job_title_id FROM employee WHERE id = 'emp-hema'), (SELECT employment_type_id FROM employee WHERE id = 'emp-hema'), (SELECT department_id FROM employee WHERE id = 'emp-hema'), 'emp-lakshmi', '2019-09-02', NULL, 'Joined Simon & Sons Navalur', '2026-01-01T00:00:00.000Z', 'sys');
UPDATE employee SET manager_employee_id = 'emp-lakshmi' WHERE id = 'emp-ilango';
INSERT INTO employment_history (id, employee_id, job_title_id, employment_type_id, department_id, manager_employee_id, effective_from, effective_to, reason, created_at, created_by)
VALUES ('eh-ilango', 'emp-ilango', (SELECT job_title_id FROM employee WHERE id = 'emp-ilango'), (SELECT employment_type_id FROM employee WHERE id = 'emp-ilango'), (SELECT department_id FROM employee WHERE id = 'emp-ilango'), 'emp-lakshmi', '2020-07-13', NULL, 'Joined Simon & Sons Navalur', '2026-01-01T00:00:00.000Z', 'sys');
UPDATE employee SET manager_employee_id = 'emp-lakshmi' WHERE id = 'emp-keerthana';
INSERT INTO employment_history (id, employee_id, job_title_id, employment_type_id, department_id, manager_employee_id, effective_from, effective_to, reason, created_at, created_by)
VALUES ('eh-keerthana', 'emp-keerthana', (SELECT job_title_id FROM employee WHERE id = 'emp-keerthana'), (SELECT employment_type_id FROM employee WHERE id = 'emp-keerthana'), (SELECT department_id FROM employee WHERE id = 'emp-keerthana'), 'emp-lakshmi', '2021-03-22', NULL, 'Joined Simon & Sons Navalur', '2026-01-01T00:00:00.000Z', 'sys');
UPDATE employee SET manager_employee_id = 'emp-lakshmi' WHERE id = 'emp-mohan';
INSERT INTO employment_history (id, employee_id, job_title_id, employment_type_id, department_id, manager_employee_id, effective_from, effective_to, reason, created_at, created_by)
VALUES ('eh-mohan', 'emp-mohan', (SELECT job_title_id FROM employee WHERE id = 'emp-mohan'), (SELECT employment_type_id FROM employee WHERE id = 'emp-mohan'), (SELECT department_id FROM employee WHERE id = 'emp-mohan'), 'emp-lakshmi', '2022-02-07', NULL, 'Joined Simon & Sons Navalur', '2026-01-01T00:00:00.000Z', 'sys');
UPDATE employee SET manager_employee_id = 'emp-lakshmi' WHERE id = 'emp-nandhini';
INSERT INTO employment_history (id, employee_id, job_title_id, employment_type_id, department_id, manager_employee_id, effective_from, effective_to, reason, created_at, created_by)
VALUES ('eh-nandhini', 'emp-nandhini', (SELECT job_title_id FROM employee WHERE id = 'emp-nandhini'), (SELECT employment_type_id FROM employee WHERE id = 'emp-nandhini'), (SELECT department_id FROM employee WHERE id = 'emp-nandhini'), 'emp-lakshmi', '2022-10-17', NULL, 'Joined Simon & Sons Navalur', '2026-01-01T00:00:00.000Z', 'sys');
UPDATE employee SET manager_employee_id = 'emp-lakshmi' WHERE id = 'emp-pradeep';
INSERT INTO employment_history (id, employee_id, job_title_id, employment_type_id, department_id, manager_employee_id, effective_from, effective_to, reason, created_at, created_by)
VALUES ('eh-pradeep', 'emp-pradeep', (SELECT job_title_id FROM employee WHERE id = 'emp-pradeep'), (SELECT employment_type_id FROM employee WHERE id = 'emp-pradeep'), (SELECT department_id FROM employee WHERE id = 'emp-pradeep'), 'emp-lakshmi', '2023-05-08', NULL, 'Joined Simon & Sons Navalur', '2026-01-01T00:00:00.000Z', 'sys');
UPDATE employee SET manager_employee_id = 'emp-lakshmi' WHERE id = 'emp-radhika';
INSERT INTO employment_history (id, employee_id, job_title_id, employment_type_id, department_id, manager_employee_id, effective_from, effective_to, reason, created_at, created_by)
VALUES ('eh-radhika', 'emp-radhika', (SELECT job_title_id FROM employee WHERE id = 'emp-radhika'), (SELECT employment_type_id FROM employee WHERE id = 'emp-radhika'), (SELECT department_id FROM employee WHERE id = 'emp-radhika'), 'emp-lakshmi', '2024-02-12', NULL, 'Joined Simon & Sons Navalur', '2026-01-01T00:00:00.000Z', 'sys');
UPDATE employee SET manager_employee_id = 'emp-lakshmi' WHERE id = 'emp-sandhiya';
INSERT INTO employment_history (id, employee_id, job_title_id, employment_type_id, department_id, manager_employee_id, effective_from, effective_to, reason, created_at, created_by)
VALUES ('eh-sandhiya', 'emp-sandhiya', (SELECT job_title_id FROM employee WHERE id = 'emp-sandhiya'), (SELECT employment_type_id FROM employee WHERE id = 'emp-sandhiya'), (SELECT department_id FROM employee WHERE id = 'emp-sandhiya'), 'emp-lakshmi', '2026-08-01', NULL, 'Joined Simon & Sons Navalur', '2026-01-01T00:00:00.000Z', 'sys');
UPDATE employee SET manager_employee_id = 'emp-rajesh' WHERE id = 'emp-ashwin';
INSERT INTO employment_history (id, employee_id, job_title_id, employment_type_id, department_id, manager_employee_id, effective_from, effective_to, reason, created_at, created_by)
VALUES ('eh-ashwin', 'emp-ashwin', (SELECT job_title_id FROM employee WHERE id = 'emp-ashwin'), (SELECT employment_type_id FROM employee WHERE id = 'emp-ashwin'), (SELECT department_id FROM employee WHERE id = 'emp-ashwin'), 'emp-rajesh', '2017-02-13', NULL, 'Joined Simon & Sons Navalur', '2026-01-01T00:00:00.000Z', 'sys');
UPDATE department SET head_employee_id = 'emp-ashwin' WHERE code = 'TECH';
UPDATE team SET lead_employee_id = 'emp-ashwin' WHERE id = 'team-team-tech';
UPDATE employee SET manager_employee_id = 'emp-ashwin' WHERE id = 'emp-bhuvana';
INSERT INTO employment_history (id, employee_id, job_title_id, employment_type_id, department_id, manager_employee_id, effective_from, effective_to, reason, created_at, created_by)
VALUES ('eh-bhuvana', 'emp-bhuvana', (SELECT job_title_id FROM employee WHERE id = 'emp-bhuvana'), (SELECT employment_type_id FROM employee WHERE id = 'emp-bhuvana'), (SELECT department_id FROM employee WHERE id = 'emp-bhuvana'), 'emp-ashwin', '2018-11-05', NULL, 'Joined Simon & Sons Navalur', '2026-01-01T00:00:00.000Z', 'sys');
UPDATE employee SET manager_employee_id = 'emp-ashwin' WHERE id = 'emp-chandru';
INSERT INTO employment_history (id, employee_id, job_title_id, employment_type_id, department_id, manager_employee_id, effective_from, effective_to, reason, created_at, created_by)
VALUES ('eh-chandru', 'emp-chandru', (SELECT job_title_id FROM employee WHERE id = 'emp-chandru'), (SELECT employment_type_id FROM employee WHERE id = 'emp-chandru'), (SELECT department_id FROM employee WHERE id = 'emp-chandru'), 'emp-ashwin', '2019-12-09', NULL, 'Joined Simon & Sons Navalur', '2026-01-01T00:00:00.000Z', 'sys');
UPDATE employee SET manager_employee_id = 'emp-ashwin' WHERE id = 'emp-divya';
INSERT INTO employment_history (id, employee_id, job_title_id, employment_type_id, department_id, manager_employee_id, effective_from, effective_to, reason, created_at, created_by)
VALUES ('eh-divya', 'emp-divya', (SELECT job_title_id FROM employee WHERE id = 'emp-divya'), (SELECT employment_type_id FROM employee WHERE id = 'emp-divya'), (SELECT department_id FROM employee WHERE id = 'emp-divya'), 'emp-ashwin', '2020-11-23', NULL, 'Joined Simon & Sons Navalur', '2026-01-01T00:00:00.000Z', 'sys');
UPDATE employee SET manager_employee_id = 'emp-ashwin' WHERE id = 'emp-eashwar';
INSERT INTO employment_history (id, employee_id, job_title_id, employment_type_id, department_id, manager_employee_id, effective_from, effective_to, reason, created_at, created_by)
VALUES ('eh-eashwar', 'emp-eashwar', (SELECT job_title_id FROM employee WHERE id = 'emp-eashwar'), (SELECT employment_type_id FROM employee WHERE id = 'emp-eashwar'), (SELECT department_id FROM employee WHERE id = 'emp-eashwar'), 'emp-ashwin', '2021-08-16', NULL, 'Joined Simon & Sons Navalur', '2026-01-01T00:00:00.000Z', 'sys');
UPDATE employee SET manager_employee_id = 'emp-ashwin' WHERE id = 'emp-gayathri';
INSERT INTO employment_history (id, employee_id, job_title_id, employment_type_id, department_id, manager_employee_id, effective_from, effective_to, reason, created_at, created_by)
VALUES ('eh-gayathri', 'emp-gayathri', (SELECT job_title_id FROM employee WHERE id = 'emp-gayathri'), (SELECT employment_type_id FROM employee WHERE id = 'emp-gayathri'), (SELECT department_id FROM employee WHERE id = 'emp-gayathri'), 'emp-ashwin', '2022-03-14', NULL, 'Joined Simon & Sons Navalur', '2026-01-01T00:00:00.000Z', 'sys');
UPDATE employee SET manager_employee_id = 'emp-ashwin' WHERE id = 'emp-jagadeesh';
INSERT INTO employment_history (id, employee_id, job_title_id, employment_type_id, department_id, manager_employee_id, effective_from, effective_to, reason, created_at, created_by)
VALUES ('eh-jagadeesh', 'emp-jagadeesh', (SELECT job_title_id FROM employee WHERE id = 'emp-jagadeesh'), (SELECT employment_type_id FROM employee WHERE id = 'emp-jagadeesh'), (SELECT department_id FROM employee WHERE id = 'emp-jagadeesh'), 'emp-ashwin', '2022-12-05', NULL, 'Joined Simon & Sons Navalur', '2026-01-01T00:00:00.000Z', 'sys');
UPDATE employee SET manager_employee_id = 'emp-ashwin' WHERE id = 'emp-kavin';
INSERT INTO employment_history (id, employee_id, job_title_id, employment_type_id, department_id, manager_employee_id, effective_from, effective_to, reason, created_at, created_by)
VALUES ('eh-kavin', 'emp-kavin', (SELECT job_title_id FROM employee WHERE id = 'emp-kavin'), (SELECT employment_type_id FROM employee WHERE id = 'emp-kavin'), (SELECT department_id FROM employee WHERE id = 'emp-kavin'), 'emp-ashwin', '2023-07-24', NULL, 'Joined Simon & Sons Navalur', '2026-01-01T00:00:00.000Z', 'sys');
UPDATE employee SET manager_employee_id = 'emp-ashwin' WHERE id = 'emp-lavanya';
INSERT INTO employment_history (id, employee_id, job_title_id, employment_type_id, department_id, manager_employee_id, effective_from, effective_to, reason, created_at, created_by)
VALUES ('eh-lavanya', 'emp-lavanya', (SELECT job_title_id FROM employee WHERE id = 'emp-lavanya'), (SELECT employment_type_id FROM employee WHERE id = 'emp-lavanya'), (SELECT department_id FROM employee WHERE id = 'emp-lavanya'), 'emp-ashwin', '2024-04-08', NULL, 'Joined Simon & Sons Navalur', '2026-01-01T00:00:00.000Z', 'sys');
UPDATE employee SET manager_employee_id = 'emp-ashwin' WHERE id = 'emp-naveen';
INSERT INTO employment_history (id, employee_id, job_title_id, employment_type_id, department_id, manager_employee_id, effective_from, effective_to, reason, created_at, created_by)
VALUES ('eh-naveen', 'emp-naveen', (SELECT job_title_id FROM employee WHERE id = 'emp-naveen'), (SELECT employment_type_id FROM employee WHERE id = 'emp-naveen'), (SELECT department_id FROM employee WHERE id = 'emp-naveen'), 'emp-ashwin', '2026-07-15', NULL, 'Joined Simon & Sons Navalur', '2026-01-01T00:00:00.000Z', 'sys');
UPDATE employee SET manager_employee_id = 'emp-rajesh' WHERE id = 'emp-anjusha';
INSERT INTO employment_history (id, employee_id, job_title_id, employment_type_id, department_id, manager_employee_id, effective_from, effective_to, reason, created_at, created_by)
VALUES ('eh-anjusha', 'emp-anjusha', (SELECT job_title_id FROM employee WHERE id = 'emp-anjusha'), (SELECT employment_type_id FROM employee WHERE id = 'emp-anjusha'), (SELECT department_id FROM employee WHERE id = 'emp-anjusha'), 'emp-rajesh', '2016-04-18', NULL, 'Joined Simon & Sons Navalur', '2026-01-01T00:00:00.000Z', 'sys');
UPDATE department SET head_employee_id = 'emp-anjusha' WHERE code = 'HR';
UPDATE team SET lead_employee_id = 'emp-anjusha' WHERE id = 'team-team-hr';
UPDATE employee SET manager_employee_id = 'emp-anjusha' WHERE id = 'emp-ramesh';
INSERT INTO employment_history (id, employee_id, job_title_id, employment_type_id, department_id, manager_employee_id, effective_from, effective_to, reason, created_at, created_by)
VALUES ('eh-ramesh', 'emp-ramesh', (SELECT job_title_id FROM employee WHERE id = 'emp-ramesh'), (SELECT employment_type_id FROM employee WHERE id = 'emp-ramesh'), (SELECT department_id FROM employee WHERE id = 'emp-ramesh'), 'emp-anjusha', '2017-06-12', NULL, 'Joined Simon & Sons Navalur', '2026-01-01T00:00:00.000Z', 'sys');
UPDATE employee SET manager_employee_id = 'emp-anjusha' WHERE id = 'emp-sanjay';
INSERT INTO employment_history (id, employee_id, job_title_id, employment_type_id, department_id, manager_employee_id, effective_from, effective_to, reason, created_at, created_by)
VALUES ('eh-sanjay', 'emp-sanjay', (SELECT job_title_id FROM employee WHERE id = 'emp-sanjay'), (SELECT employment_type_id FROM employee WHERE id = 'emp-sanjay'), (SELECT department_id FROM employee WHERE id = 'emp-sanjay'), 'emp-anjusha', '2019-04-15', NULL, 'Joined Simon & Sons Navalur', '2026-01-01T00:00:00.000Z', 'sys');
UPDATE employee SET manager_employee_id = 'emp-anjusha' WHERE id = 'emp-swetha';
INSERT INTO employment_history (id, employee_id, job_title_id, employment_type_id, department_id, manager_employee_id, effective_from, effective_to, reason, created_at, created_by)
VALUES ('eh-swetha', 'emp-swetha', (SELECT job_title_id FROM employee WHERE id = 'emp-swetha'), (SELECT employment_type_id FROM employee WHERE id = 'emp-swetha'), (SELECT department_id FROM employee WHERE id = 'emp-swetha'), 'emp-anjusha', '2020-09-07', NULL, 'Joined Simon & Sons Navalur', '2026-01-01T00:00:00.000Z', 'sys');
UPDATE employee SET manager_employee_id = 'emp-anjusha' WHERE id = 'emp-tharun';
INSERT INTO employment_history (id, employee_id, job_title_id, employment_type_id, department_id, manager_employee_id, effective_from, effective_to, reason, created_at, created_by)
VALUES ('eh-tharun', 'emp-tharun', (SELECT job_title_id FROM employee WHERE id = 'emp-tharun'), (SELECT employment_type_id FROM employee WHERE id = 'emp-tharun'), (SELECT department_id FROM employee WHERE id = 'emp-tharun'), 'emp-anjusha', '2021-06-21', NULL, 'Joined Simon & Sons Navalur', '2026-01-01T00:00:00.000Z', 'sys');
UPDATE employee SET manager_employee_id = 'emp-anjusha' WHERE id = 'emp-usha';
INSERT INTO employment_history (id, employee_id, job_title_id, employment_type_id, department_id, manager_employee_id, effective_from, effective_to, reason, created_at, created_by)
VALUES ('eh-usha', 'emp-usha', (SELECT job_title_id FROM employee WHERE id = 'emp-usha'), (SELECT employment_type_id FROM employee WHERE id = 'emp-usha'), (SELECT department_id FROM employee WHERE id = 'emp-usha'), 'emp-anjusha', '2022-05-16', NULL, 'Joined Simon & Sons Navalur', '2026-01-01T00:00:00.000Z', 'sys');
UPDATE employee SET manager_employee_id = 'emp-anjusha' WHERE id = 'emp-vimal';
INSERT INTO employment_history (id, employee_id, job_title_id, employment_type_id, department_id, manager_employee_id, effective_from, effective_to, reason, created_at, created_by)
VALUES ('eh-vimal', 'emp-vimal', (SELECT job_title_id FROM employee WHERE id = 'emp-vimal'), (SELECT employment_type_id FROM employee WHERE id = 'emp-vimal'), (SELECT department_id FROM employee WHERE id = 'emp-vimal'), 'emp-anjusha', '2023-02-20', NULL, 'Joined Simon & Sons Navalur', '2026-01-01T00:00:00.000Z', 'sys');
UPDATE employee SET manager_employee_id = 'emp-anjusha' WHERE id = 'emp-yamini';
INSERT INTO employment_history (id, employee_id, job_title_id, employment_type_id, department_id, manager_employee_id, effective_from, effective_to, reason, created_at, created_by)
VALUES ('eh-yamini', 'emp-yamini', (SELECT job_title_id FROM employee WHERE id = 'emp-yamini'), (SELECT employment_type_id FROM employee WHERE id = 'emp-yamini'), (SELECT department_id FROM employee WHERE id = 'emp-yamini'), 'emp-anjusha', '2024-03-11', NULL, 'Joined Simon & Sons Navalur', '2026-01-01T00:00:00.000Z', 'sys');
UPDATE employee SET manager_employee_id = 'emp-anjusha' WHERE id = 'emp-zoya';
INSERT INTO employment_history (id, employee_id, job_title_id, employment_type_id, department_id, manager_employee_id, effective_from, effective_to, reason, created_at, created_by)
VALUES ('eh-zoya', 'emp-zoya', (SELECT job_title_id FROM employee WHERE id = 'emp-zoya'), (SELECT employment_type_id FROM employee WHERE id = 'emp-zoya'), (SELECT department_id FROM employee WHERE id = 'emp-zoya'), 'emp-anjusha', '2026-08-10', NULL, 'Joined Simon & Sons Navalur', '2026-01-01T00:00:00.000Z', 'sys');

-- 8. Realistic Real-Life Edge Cases for Leave Requests
INSERT INTO leave_request (id, employee_id, leave_type_id, policy_version_id, start_date, end_date, half_day_start, half_day_end, total_half_days, lop_half_days, reason, status, submitted_at, decided_at, submitted_by, version, created_at, created_by, updated_at, updated_by)
VALUES ('req-meera-aug', 'emp-meera', 'lt-al', 'lpv-al-1', '2026-08-10', '2026-08-12', 'full', 'full', 6, 0, 'Family visit to Tiruchirappalli', 'approved', '2026-09-20T09:30:00.000Z', '2026-09-21T14:00:00.000Z', 'emp-meera', 1, '2026-09-20T09:30:00.000Z', 'emp-meera', '2026-09-20T09:30:00.000Z', 'emp-meera');
INSERT INTO leave_request_day (id, leave_request_id, date, portion, is_counted, skip_reason)
VALUES ('req-meera-aug-d1', 'req-meera-aug', '2026-08-10', 'full', 1, NULL);
INSERT INTO leave_request_day (id, leave_request_id, date, portion, is_counted, skip_reason)
VALUES ('req-meera-aug-d2', 'req-meera-aug', '2026-08-11', 'full', 1, NULL);
INSERT INTO leave_request_day (id, leave_request_id, date, portion, is_counted, skip_reason)
VALUES ('req-meera-aug-d3', 'req-meera-aug', '2026-08-12', 'full', 1, NULL);
INSERT INTO approval_step_instance (id, leave_request_id, step_no, approver_employee_id, approver_user_id, status, decided_at, decision_note)
VALUES ('req-meera-aug-step1', 'req-meera-aug', 1, 'emp-suresh', 'usr-suresh', 'approved', '2026-09-21T14:00:00.000Z', 'Approved. Work handed over to Arun.');
INSERT INTO balance_ledger (id, employee_id, leave_type_id, period_id, entry_type, quantity_half_days, effective_on, source_type, source_id, reason, created_by, created_at)
VALUES ('bal-req-meera-aug-ded', 'emp-meera', 'lt-al', 'lp-2026', 'DEDUCTION', -6, '2026-08-10', 'leave_request', 'req-meera-aug', 'Approved leave deduction', 'sys', '2026-09-20T09:30:00.000Z');
INSERT INTO leave_request (id, employee_id, leave_type_id, policy_version_id, start_date, end_date, half_day_start, half_day_end, total_half_days, lop_half_days, reason, status, submitted_at, decided_at, submitted_by, version, created_at, created_by, updated_at, updated_by)
VALUES ('req-arun-oct', 'emp-arun', 'lt-al', 'lpv-al-1', '2026-10-14', '2026-10-15', 'full', 'full', 4, 0, 'Attending relative wedding in Madurai', 'pending_approval', '2026-09-20T09:30:00.000Z', NULL, 'emp-arun', 1, '2026-09-20T09:30:00.000Z', 'emp-arun', '2026-09-20T09:30:00.000Z', 'emp-arun');
INSERT INTO leave_request_day (id, leave_request_id, date, portion, is_counted, skip_reason)
VALUES ('req-arun-oct-d1', 'req-arun-oct', '2026-10-14', 'full', 1, NULL);
INSERT INTO leave_request_day (id, leave_request_id, date, portion, is_counted, skip_reason)
VALUES ('req-arun-oct-d2', 'req-arun-oct', '2026-10-15', 'full', 1, NULL);
INSERT INTO approval_step_instance (id, leave_request_id, step_no, approver_employee_id, approver_user_id, status, decided_at, decision_note)
VALUES ('req-arun-oct-step1', 'req-arun-oct', 1, 'emp-suresh', 'usr-suresh', 'pending', NULL, NULL);
INSERT INTO balance_ledger (id, employee_id, leave_type_id, period_id, entry_type, quantity_half_days, effective_on, source_type, source_id, reason, created_by, created_at)
VALUES ('bal-req-arun-oct-hold', 'emp-arun', 'lt-al', 'lp-2026', 'PENDING_HOLD', -4, '2026-10-14', 'leave_request', 'req-arun-oct', 'Pending approval hold', 'sys', '2026-09-20T09:30:00.000Z');
INSERT INTO leave_request (id, employee_id, leave_type_id, policy_version_id, start_date, end_date, half_day_start, half_day_end, total_half_days, lop_half_days, reason, status, submitted_at, decided_at, submitted_by, version, created_at, created_by, updated_at, updated_by)
VALUES ('req-priya-nov', 'emp-priya', 'lt-al', 'lpv-al-1', '2026-11-09', '2026-11-13', 'full', 'full', 10, 0, 'Annual vacation trip to Ooty', 'rejected', '2026-09-20T09:30:00.000Z', '2026-09-21T14:00:00.000Z', 'emp-priya', 1, '2026-09-20T09:30:00.000Z', 'emp-priya', '2026-09-20T09:30:00.000Z', 'emp-priya');
INSERT INTO leave_request_day (id, leave_request_id, date, portion, is_counted, skip_reason)
VALUES ('req-priya-nov-d1', 'req-priya-nov', '2026-11-09', 'full', 1, NULL);
INSERT INTO leave_request_day (id, leave_request_id, date, portion, is_counted, skip_reason)
VALUES ('req-priya-nov-d2', 'req-priya-nov', '2026-11-10', 'full', 1, NULL);
INSERT INTO leave_request_day (id, leave_request_id, date, portion, is_counted, skip_reason)
VALUES ('req-priya-nov-d3', 'req-priya-nov', '2026-11-11', 'full', 1, NULL);
INSERT INTO leave_request_day (id, leave_request_id, date, portion, is_counted, skip_reason)
VALUES ('req-priya-nov-d4', 'req-priya-nov', '2026-11-12', 'full', 1, NULL);
INSERT INTO leave_request_day (id, leave_request_id, date, portion, is_counted, skip_reason)
VALUES ('req-priya-nov-d5', 'req-priya-nov', '2026-11-13', 'full', 1, NULL);
INSERT INTO approval_step_instance (id, leave_request_id, step_no, approver_employee_id, approver_user_id, status, decided_at, decision_note)
VALUES ('req-priya-nov-step1', 'req-priya-nov', 1, 'emp-suresh', 'usr-suresh', 'rejected', '2026-09-21T14:00:00.000Z', 'Major journal publishing release cycle that week. Please reschedule after Nov 20.');
INSERT INTO leave_request (id, employee_id, leave_type_id, policy_version_id, start_date, end_date, half_day_start, half_day_end, total_half_days, lop_half_days, reason, status, submitted_at, decided_at, submitted_by, version, created_at, created_by, updated_at, updated_by)
VALUES ('req-vignesh-am', 'emp-vignesh', 'lt-al', 'lpv-al-1', '2026-10-06', '2026-10-06', 'am', 'am', 1, 0, 'Bank work at Navalur branch in the morning', 'pending_approval', '2026-09-20T09:30:00.000Z', NULL, 'emp-vignesh', 1, '2026-09-20T09:30:00.000Z', 'emp-vignesh', '2026-09-20T09:30:00.000Z', 'emp-vignesh');
INSERT INTO leave_request_day (id, leave_request_id, date, portion, is_counted, skip_reason)
VALUES ('req-vignesh-am-d1', 'req-vignesh-am', '2026-10-06', 'am', 1, NULL);
INSERT INTO approval_step_instance (id, leave_request_id, step_no, approver_employee_id, approver_user_id, status, decided_at, decision_note)
VALUES ('req-vignesh-am-step1', 'req-vignesh-am', 1, 'emp-suresh', 'usr-suresh', 'pending', NULL, NULL);
INSERT INTO balance_ledger (id, employee_id, leave_type_id, period_id, entry_type, quantity_half_days, effective_on, source_type, source_id, reason, created_by, created_at)
VALUES ('bal-req-vignesh-am-hold', 'emp-vignesh', 'lt-al', 'lp-2026', 'PENDING_HOLD', -1, '2026-10-06', 'leave_request', 'req-vignesh-am', 'Pending approval hold', 'sys', '2026-09-20T09:30:00.000Z');
INSERT INTO leave_request (id, employee_id, leave_type_id, policy_version_id, start_date, end_date, half_day_start, half_day_end, total_half_days, lop_half_days, reason, status, submitted_at, decided_at, submitted_by, version, created_at, created_by, updated_at, updated_by)
VALUES ('req-chitra-pm', 'emp-chitra', 'lt-al', 'lpv-al-1', '2026-09-18', '2026-09-18', 'pm', 'pm', 1, 0, 'Medical appointment at Chettinad Health City', 'approved', '2026-09-20T09:30:00.000Z', '2026-09-21T14:00:00.000Z', 'emp-chitra', 1, '2026-09-20T09:30:00.000Z', 'emp-chitra', '2026-09-20T09:30:00.000Z', 'emp-chitra');
INSERT INTO leave_request_day (id, leave_request_id, date, portion, is_counted, skip_reason)
VALUES ('req-chitra-pm-d1', 'req-chitra-pm', '2026-09-18', 'pm', 1, NULL);
INSERT INTO approval_step_instance (id, leave_request_id, step_no, approver_employee_id, approver_user_id, status, decided_at, decision_note)
VALUES ('req-chitra-pm-step1', 'req-chitra-pm', 1, 'emp-dinesh', 'usr-dinesh', 'approved', '2026-09-21T14:00:00.000Z', 'Approved. Please complete batch indexing before noon.');
INSERT INTO balance_ledger (id, employee_id, leave_type_id, period_id, entry_type, quantity_half_days, effective_on, source_type, source_id, reason, created_by, created_at)
VALUES ('bal-req-chitra-pm-ded', 'emp-chitra', 'lt-al', 'lp-2026', 'DEDUCTION', -1, '2026-09-18', 'leave_request', 'req-chitra-pm', 'Approved leave deduction', 'sys', '2026-09-20T09:30:00.000Z');
INSERT INTO leave_request (id, employee_id, leave_type_id, policy_version_id, start_date, end_date, half_day_start, half_day_end, total_half_days, lop_half_days, reason, status, submitted_at, decided_at, submitted_by, version, created_at, created_by, updated_at, updated_by)
VALUES ('req-anjusha-md', 'emp-anjusha', 'lt-al', 'lpv-al-1', '2026-10-26', '2026-10-27', 'full', 'full', 4, 0, 'Personal family commitment in Thrissur', 'pending_approval', '2026-09-20T09:30:00.000Z', NULL, 'emp-anjusha', 1, '2026-09-20T09:30:00.000Z', 'emp-anjusha', '2026-09-20T09:30:00.000Z', 'emp-anjusha');
INSERT INTO leave_request_day (id, leave_request_id, date, portion, is_counted, skip_reason)
VALUES ('req-anjusha-md-d1', 'req-anjusha-md', '2026-10-26', 'full', 1, NULL);
INSERT INTO leave_request_day (id, leave_request_id, date, portion, is_counted, skip_reason)
VALUES ('req-anjusha-md-d2', 'req-anjusha-md', '2026-10-27', 'full', 1, NULL);
INSERT INTO approval_step_instance (id, leave_request_id, step_no, approver_employee_id, approver_user_id, status, decided_at, decision_note)
VALUES ('req-anjusha-md-step1', 'req-anjusha-md', 1, 'emp-rajesh', 'usr-rajesh', 'pending', NULL, NULL);
INSERT INTO balance_ledger (id, employee_id, leave_type_id, period_id, entry_type, quantity_half_days, effective_on, source_type, source_id, reason, created_by, created_at)
VALUES ('bal-req-anjusha-md-hold', 'emp-anjusha', 'lt-al', 'lp-2026', 'PENDING_HOLD', -4, '2026-10-26', 'leave_request', 'req-anjusha-md', 'Pending approval hold', 'sys', '2026-09-20T09:30:00.000Z');
INSERT INTO leave_request (id, employee_id, leave_type_id, policy_version_id, start_date, end_date, half_day_start, half_day_end, total_half_days, lop_half_days, reason, status, submitted_at, decided_at, submitted_by, version, created_at, created_by, updated_at, updated_by)
VALUES ('req-suresh-hr', 'emp-suresh', 'lt-al', 'lpv-al-1', '2026-10-19', '2026-10-19', 'full', 'full', 2, 0, 'Personal work at Tambaram Registrar office', 'pending_approval', '2026-09-20T09:30:00.000Z', NULL, 'emp-suresh', 1, '2026-09-20T09:30:00.000Z', 'emp-suresh', '2026-09-20T09:30:00.000Z', 'emp-suresh');
INSERT INTO leave_request_day (id, leave_request_id, date, portion, is_counted, skip_reason)
VALUES ('req-suresh-hr-d1', 'req-suresh-hr', '2026-10-19', 'full', 1, NULL);
INSERT INTO approval_step_instance (id, leave_request_id, step_no, approver_employee_id, approver_user_id, status, decided_at, decision_note)
VALUES ('req-suresh-hr-step1', 'req-suresh-hr', 1, 'emp-anjusha', 'usr-anjusha', 'pending', NULL, NULL);
INSERT INTO balance_ledger (id, employee_id, leave_type_id, period_id, entry_type, quantity_half_days, effective_on, source_type, source_id, reason, created_by, created_at)
VALUES ('bal-req-suresh-hr-hold', 'emp-suresh', 'lt-al', 'lp-2026', 'PENDING_HOLD', -2, '2026-10-19', 'leave_request', 'req-suresh-hr', 'Pending approval hold', 'sys', '2026-09-20T09:30:00.000Z');
INSERT INTO leave_request (id, employee_id, leave_type_id, policy_version_id, start_date, end_date, half_day_start, half_day_end, total_half_days, lop_half_days, reason, status, submitted_at, decided_at, submitted_by, version, created_at, created_by, updated_at, updated_by)
VALUES ('req-balaji-weekend', 'emp-balaji', 'lt-al', 'lpv-al-1', '2026-10-09', '2026-10-12', 'full', 'full', 4, 0, 'Long weekend family trip to Kodaikanal', 'pending_approval', '2026-09-20T09:30:00.000Z', NULL, 'emp-balaji', 1, '2026-09-20T09:30:00.000Z', 'emp-balaji', '2026-09-20T09:30:00.000Z', 'emp-balaji');
INSERT INTO leave_request_day (id, leave_request_id, date, portion, is_counted, skip_reason)
VALUES ('req-balaji-weekend-d1', 'req-balaji-weekend', '2026-10-09', 'full', 1, NULL);
INSERT INTO leave_request_day (id, leave_request_id, date, portion, is_counted, skip_reason)
VALUES ('req-balaji-weekend-d2', 'req-balaji-weekend', '2026-10-10', 'full', 0, 'weekend');
INSERT INTO leave_request_day (id, leave_request_id, date, portion, is_counted, skip_reason)
VALUES ('req-balaji-weekend-d3', 'req-balaji-weekend', '2026-10-11', 'full', 0, 'weekend');
INSERT INTO leave_request_day (id, leave_request_id, date, portion, is_counted, skip_reason)
VALUES ('req-balaji-weekend-d4', 'req-balaji-weekend', '2026-10-12', 'full', 1, NULL);
INSERT INTO approval_step_instance (id, leave_request_id, step_no, approver_employee_id, approver_user_id, status, decided_at, decision_note)
VALUES ('req-balaji-weekend-step1', 'req-balaji-weekend', 1, 'emp-dinesh', 'usr-dinesh', 'pending', NULL, NULL);
INSERT INTO balance_ledger (id, employee_id, leave_type_id, period_id, entry_type, quantity_half_days, effective_on, source_type, source_id, reason, created_by, created_at)
VALUES ('bal-req-balaji-weekend-hold', 'emp-balaji', 'lt-al', 'lp-2026', 'PENDING_HOLD', -4, '2026-10-09', 'leave_request', 'req-balaji-weekend', 'Pending approval hold', 'sys', '2026-09-20T09:30:00.000Z');
INSERT INTO leave_request (id, employee_id, leave_type_id, policy_version_id, start_date, end_date, half_day_start, half_day_end, total_half_days, lop_half_days, reason, status, submitted_at, decided_at, submitted_by, version, created_at, created_by, updated_at, updated_by)
VALUES ('req-keerthana-hol', 'emp-keerthana', 'lt-al', 'lpv-al-1', '2026-10-01', '2026-10-05', 'full', 'full', 4, 0, 'Pooja holidays family visit', 'pending_approval', '2026-09-20T09:30:00.000Z', NULL, 'emp-keerthana', 1, '2026-09-20T09:30:00.000Z', 'emp-keerthana', '2026-09-20T09:30:00.000Z', 'emp-keerthana');
INSERT INTO leave_request_day (id, leave_request_id, date, portion, is_counted, skip_reason)
VALUES ('req-keerthana-hol-d1', 'req-keerthana-hol', '2026-10-01', 'full', 1, NULL);
INSERT INTO leave_request_day (id, leave_request_id, date, portion, is_counted, skip_reason)
VALUES ('req-keerthana-hol-d2', 'req-keerthana-hol', '2026-10-02', 'full', 0, 'holiday');
INSERT INTO leave_request_day (id, leave_request_id, date, portion, is_counted, skip_reason)
VALUES ('req-keerthana-hol-d3', 'req-keerthana-hol', '2026-10-03', 'full', 0, 'weekend');
INSERT INTO leave_request_day (id, leave_request_id, date, portion, is_counted, skip_reason)
VALUES ('req-keerthana-hol-d4', 'req-keerthana-hol', '2026-10-04', 'full', 0, 'weekend');
INSERT INTO leave_request_day (id, leave_request_id, date, portion, is_counted, skip_reason)
VALUES ('req-keerthana-hol-d5', 'req-keerthana-hol', '2026-10-05', 'full', 1, NULL);
INSERT INTO approval_step_instance (id, leave_request_id, step_no, approver_employee_id, approver_user_id, status, decided_at, decision_note)
VALUES ('req-keerthana-hol-step1', 'req-keerthana-hol', 1, 'emp-lakshmi', 'usr-lakshmi', 'pending', NULL, NULL);
INSERT INTO balance_ledger (id, employee_id, leave_type_id, period_id, entry_type, quantity_half_days, effective_on, source_type, source_id, reason, created_by, created_at)
VALUES ('bal-req-keerthana-hol-hold', 'emp-keerthana', 'lt-al', 'lp-2026', 'PENDING_HOLD', -4, '2026-10-01', 'leave_request', 'req-keerthana-hol', 'Pending approval hold', 'sys', '2026-09-20T09:30:00.000Z');
INSERT INTO leave_request (id, employee_id, leave_type_id, policy_version_id, start_date, end_date, half_day_start, half_day_end, total_half_days, lop_half_days, reason, status, submitted_at, decided_at, submitted_by, version, created_at, created_by, updated_at, updated_by)
VALUES ('req-harish-prob', 'emp-harish', 'lt-al', 'lpv-al-1', '2026-10-23', '2026-10-23', 'full', 'full', 2, 0, 'College convocation ceremony in Anna University', 'pending_approval', '2026-09-20T09:30:00.000Z', NULL, 'emp-harish', 1, '2026-09-20T09:30:00.000Z', 'emp-harish', '2026-09-20T09:30:00.000Z', 'emp-harish');
INSERT INTO leave_request_day (id, leave_request_id, date, portion, is_counted, skip_reason)
VALUES ('req-harish-prob-d1', 'req-harish-prob', '2026-10-23', 'full', 1, NULL);
INSERT INTO approval_step_instance (id, leave_request_id, step_no, approver_employee_id, approver_user_id, status, decided_at, decision_note)
VALUES ('req-harish-prob-step1', 'req-harish-prob', 1, 'emp-suresh', 'usr-suresh', 'pending', NULL, NULL);
INSERT INTO balance_ledger (id, employee_id, leave_type_id, period_id, entry_type, quantity_half_days, effective_on, source_type, source_id, reason, created_by, created_at)
VALUES ('bal-req-harish-prob-hold', 'emp-harish', 'lt-al', 'lp-2026', 'PENDING_HOLD', -2, '2026-10-23', 'leave_request', 'req-harish-prob', 'Pending approval hold', 'sys', '2026-09-20T09:30:00.000Z');
INSERT INTO leave_request (id, employee_id, leave_type_id, policy_version_id, start_date, end_date, half_day_start, half_day_end, total_half_days, lop_half_days, reason, status, submitted_at, decided_at, submitted_by, version, created_at, created_by, updated_at, updated_by)
VALUES ('req-bhuvana-canc', 'emp-bhuvana', 'lt-al', 'lpv-al-1', '2026-09-08', '2026-09-09', 'full', 'full', 4, 0, 'Cancelled personal travel plans', 'cancelled', '2026-09-20T09:30:00.000Z', NULL, 'emp-bhuvana', 1, '2026-09-20T09:30:00.000Z', 'emp-bhuvana', '2026-09-20T09:30:00.000Z', 'emp-bhuvana');
INSERT INTO leave_request_day (id, leave_request_id, date, portion, is_counted, skip_reason)
VALUES ('req-bhuvana-canc-d1', 'req-bhuvana-canc', '2026-09-08', 'full', 1, NULL);
INSERT INTO leave_request_day (id, leave_request_id, date, portion, is_counted, skip_reason)
VALUES ('req-bhuvana-canc-d2', 'req-bhuvana-canc', '2026-09-09', 'full', 1, NULL);
INSERT INTO approval_step_instance (id, leave_request_id, step_no, approver_employee_id, approver_user_id, status, decided_at, decision_note)
VALUES ('req-bhuvana-canc-step1', 'req-bhuvana-canc', 1, 'emp-ashwin', 'usr-ashwin', 'pending', NULL, 'Cancellation acknowledged and approved.');
INSERT INTO leave_request (id, employee_id, leave_type_id, policy_version_id, start_date, end_date, half_day_start, half_day_end, total_half_days, lop_half_days, reason, status, submitted_at, decided_at, submitted_by, version, created_at, created_by, updated_at, updated_by)
VALUES ('req-ilango-long', 'emp-ilango', 'lt-al', 'lpv-al-1', '2026-11-16', '2026-11-27', 'full', 'full', 20, 0, 'Brother wedding ceremony and pilgrimage tour', 'pending_approval', '2026-09-20T09:30:00.000Z', NULL, 'emp-ilango', 1, '2026-09-20T09:30:00.000Z', 'emp-ilango', '2026-09-20T09:30:00.000Z', 'emp-ilango');
INSERT INTO leave_request_day (id, leave_request_id, date, portion, is_counted, skip_reason)
VALUES ('req-ilango-long-d1', 'req-ilango-long', '2026-11-16', 'full', 1, NULL);
INSERT INTO leave_request_day (id, leave_request_id, date, portion, is_counted, skip_reason)
VALUES ('req-ilango-long-d2', 'req-ilango-long', '2026-11-17', 'full', 1, NULL);
INSERT INTO leave_request_day (id, leave_request_id, date, portion, is_counted, skip_reason)
VALUES ('req-ilango-long-d3', 'req-ilango-long', '2026-11-18', 'full', 1, NULL);
INSERT INTO leave_request_day (id, leave_request_id, date, portion, is_counted, skip_reason)
VALUES ('req-ilango-long-d4', 'req-ilango-long', '2026-11-19', 'full', 1, NULL);
INSERT INTO leave_request_day (id, leave_request_id, date, portion, is_counted, skip_reason)
VALUES ('req-ilango-long-d5', 'req-ilango-long', '2026-11-20', 'full', 1, NULL);
INSERT INTO leave_request_day (id, leave_request_id, date, portion, is_counted, skip_reason)
VALUES ('req-ilango-long-d6', 'req-ilango-long', '2026-11-21', 'full', 0, 'weekend');
INSERT INTO leave_request_day (id, leave_request_id, date, portion, is_counted, skip_reason)
VALUES ('req-ilango-long-d7', 'req-ilango-long', '2026-11-22', 'full', 0, 'weekend');
INSERT INTO leave_request_day (id, leave_request_id, date, portion, is_counted, skip_reason)
VALUES ('req-ilango-long-d8', 'req-ilango-long', '2026-11-23', 'full', 1, NULL);
INSERT INTO leave_request_day (id, leave_request_id, date, portion, is_counted, skip_reason)
VALUES ('req-ilango-long-d9', 'req-ilango-long', '2026-11-24', 'full', 1, NULL);
INSERT INTO leave_request_day (id, leave_request_id, date, portion, is_counted, skip_reason)
VALUES ('req-ilango-long-d10', 'req-ilango-long', '2026-11-25', 'full', 1, NULL);
INSERT INTO leave_request_day (id, leave_request_id, date, portion, is_counted, skip_reason)
VALUES ('req-ilango-long-d11', 'req-ilango-long', '2026-11-26', 'full', 1, NULL);
INSERT INTO leave_request_day (id, leave_request_id, date, portion, is_counted, skip_reason)
VALUES ('req-ilango-long-d12', 'req-ilango-long', '2026-11-27', 'full', 1, NULL);
INSERT INTO approval_step_instance (id, leave_request_id, step_no, approver_employee_id, approver_user_id, status, decided_at, decision_note)
VALUES ('req-ilango-long-step1', 'req-ilango-long', 1, 'emp-lakshmi', 'usr-lakshmi', 'pending', NULL, NULL);
INSERT INTO balance_ledger (id, employee_id, leave_type_id, period_id, entry_type, quantity_half_days, effective_on, source_type, source_id, reason, created_by, created_at)
VALUES ('bal-req-ilango-long-hold', 'emp-ilango', 'lt-al', 'lp-2026', 'PENDING_HOLD', -20, '2026-11-16', 'leave_request', 'req-ilango-long', 'Pending approval hold', 'sys', '2026-09-20T09:30:00.000Z');
INSERT INTO leave_request (id, employee_id, leave_type_id, policy_version_id, start_date, end_date, half_day_start, half_day_end, total_half_days, lop_half_days, reason, status, submitted_at, decided_at, submitted_by, version, created_at, created_by, updated_at, updated_by)
VALUES ('req-eashwar-with', 'emp-eashwar', 'lt-al', 'lpv-al-1', '2026-10-16', '2026-10-16', 'full', 'full', 2, 0, 'Emergency postponed, withdrawing request', 'withdrawn', '2026-09-20T09:30:00.000Z', NULL, 'emp-eashwar', 1, '2026-09-20T09:30:00.000Z', 'emp-eashwar', '2026-09-20T09:30:00.000Z', 'emp-eashwar');
INSERT INTO leave_request_day (id, leave_request_id, date, portion, is_counted, skip_reason)
VALUES ('req-eashwar-with-d1', 'req-eashwar-with', '2026-10-16', 'full', 1, NULL);
INSERT INTO approval_step_instance (id, leave_request_id, step_no, approver_employee_id, approver_user_id, status, decided_at, decision_note)
VALUES ('req-eashwar-with-step1', 'req-eashwar-with', 1, 'emp-ashwin', 'usr-ashwin', 'withdrawn', NULL, NULL);
INSERT INTO leave_request (id, employee_id, leave_type_id, policy_version_id, start_date, end_date, half_day_start, half_day_end, total_half_days, lop_half_days, reason, status, submitted_at, decided_at, submitted_by, version, created_at, created_by, updated_at, updated_by)
VALUES ('req-saravanan-lop', 'emp-saravanan', 'lt-al', 'lpv-al-1', '2026-10-28', '2026-10-30', 'full', 'full', 6, 6, 'Urgent family work (Requesting Loss of Pay / LOP)', 'pending_approval', '2026-09-20T09:30:00.000Z', NULL, 'emp-saravanan', 1, '2026-09-20T09:30:00.000Z', 'emp-saravanan', '2026-09-20T09:30:00.000Z', 'emp-saravanan');
INSERT INTO leave_request_day (id, leave_request_id, date, portion, is_counted, skip_reason)
VALUES ('req-saravanan-lop-d1', 'req-saravanan-lop', '2026-10-28', 'full', 1, NULL);
INSERT INTO leave_request_day (id, leave_request_id, date, portion, is_counted, skip_reason)
VALUES ('req-saravanan-lop-d2', 'req-saravanan-lop', '2026-10-29', 'full', 1, NULL);
INSERT INTO leave_request_day (id, leave_request_id, date, portion, is_counted, skip_reason)
VALUES ('req-saravanan-lop-d3', 'req-saravanan-lop', '2026-10-30', 'full', 1, NULL);
INSERT INTO approval_step_instance (id, leave_request_id, step_no, approver_employee_id, approver_user_id, status, decided_at, decision_note)
VALUES ('req-saravanan-lop-step1', 'req-saravanan-lop', 1, 'emp-suresh', 'usr-suresh', 'pending', NULL, NULL);

-- 9. Application Settings (Demo Accounts & Version lock)
DELETE FROM app_setting WHERE key IN ('demo.accounts', 'demo.version', 'demo.navalur_seed');
INSERT INTO app_setting (key, value_json, updated_by, updated_at)
VALUES
  ('demo.version', '"3"', 'sys', '2026-01-01T00:00:00.000Z'),
  ('demo.navalur_seed', '"2"', 'sys', '2026-01-01T00:00:00.000Z'),
  ('demo.accounts', '["admin@sns.test","anjusha@sns.test","suresh@sns.test","rajesh@sns.test","dinesh@sns.test","lakshmi@sns.test","ashwin@sns.test","ramesh@sns.test","sanjay@sns.test","meera@sns.test","arun@sns.test","karthi@sns.test","priya@sns.test","vignesh@sns.test","deepa@sns.test","saravanan@sns.test","nithya@sns.test","harish@sns.test","anandhi@sns.test","balaji@sns.test","chitra@sns.test","gowtham@sns.test","janani@sns.test","manikandan@sns.test","poornima@sns.test","sathish@sns.test","shalini@sns.test","gokul@sns.test","hema@sns.test","ilango@sns.test","keerthana@sns.test","mohan@sns.test","nandhini@sns.test","pradeep@sns.test","radhika@sns.test","sandhiya@sns.test","bhuvana@sns.test","chandru@sns.test","divya@sns.test","eashwar@sns.test","gayathri@sns.test","jagadeesh@sns.test","kavin@sns.test","lavanya@sns.test","naveen@sns.test","swetha@sns.test","tharun@sns.test","usha@sns.test","vimal@sns.test","yamini@sns.test","zoya@sns.test"]', 'sys', '2026-01-01T00:00:00.000Z');

-- 10. Re-enable append-only triggers
CREATE OR REPLACE FUNCTION leaveos_forbid_balance_ledger() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'balance_ledger is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION leaveos_forbid_audit_event() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_event is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS balance_ledger_no_update ON balance_ledger;
DROP TRIGGER IF EXISTS balance_ledger_no_delete ON balance_ledger;
DROP TRIGGER IF EXISTS audit_event_no_update ON audit_event;
DROP TRIGGER IF EXISTS audit_event_no_delete ON audit_event;

CREATE TRIGGER balance_ledger_no_update BEFORE UPDATE ON balance_ledger
  FOR EACH ROW EXECUTE FUNCTION leaveos_forbid_balance_ledger();
CREATE TRIGGER balance_ledger_no_delete BEFORE DELETE ON balance_ledger
  FOR EACH ROW EXECUTE FUNCTION leaveos_forbid_balance_ledger();
CREATE TRIGGER audit_event_no_update BEFORE UPDATE ON audit_event
  FOR EACH ROW EXECUTE FUNCTION leaveos_forbid_audit_event();
CREATE TRIGGER audit_event_no_delete BEFORE DELETE ON audit_event
  FOR EACH ROW EXECUTE FUNCTION leaveos_forbid_audit_event();

COMMIT;