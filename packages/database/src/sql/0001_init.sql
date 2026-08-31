CREATE TABLE IF NOT EXISTS schema_migration (
  id TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE company (
  id TEXT PRIMARY KEY CHECK (id = 'company'),
  name TEXT NOT NULL,
  timezone TEXT NOT NULL,
  leave_year_start_month INTEGER NOT NULL CHECK (leave_year_start_month BETWEEN 1 AND 12),
  leave_year_start_day INTEGER NOT NULL CHECK (leave_year_start_day BETWEEN 1 AND 31),
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

CREATE TABLE location (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  timezone TEXT NOT NULL,
  holiday_calendar_id TEXT,
  archived_at TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

CREATE TABLE department (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  head_employee_id TEXT,
  archived_at TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

CREATE TABLE team (
  id TEXT PRIMARY KEY,
  department_id TEXT NOT NULL REFERENCES department(id),
  name TEXT NOT NULL,
  lead_employee_id TEXT,
  archived_at TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  UNIQUE (department_id, name)
);

CREATE TABLE job_title (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  archived_at TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

CREATE TABLE employment_type (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  is_leave_eligible INTEGER NOT NULL CHECK (is_leave_eligible IN (0, 1)),
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

CREATE TABLE employee (
  id TEXT PRIMARY KEY,
  employee_code TEXT NOT NULL UNIQUE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  work_email TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('active','probation','notice','exited','suspended')),
  joined_on TEXT NOT NULL,
  probation_end_on TEXT,
  exited_on TEXT,
  location_id TEXT NOT NULL REFERENCES location(id),
  department_id TEXT NOT NULL REFERENCES department(id),
  team_id TEXT REFERENCES team(id),
  manager_employee_id TEXT REFERENCES employee(id),
  job_title_id TEXT REFERENCES job_title(id),
  employment_type_id TEXT REFERENCES employment_type(id),
  retention_class TEXT NOT NULL DEFAULT 'standard',
  retention_review_on TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

CREATE TABLE employee_contact (
  employee_id TEXT PRIMARY KEY REFERENCES employee(id),
  personal_email TEXT,
  phone TEXT,
  address_line TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

CREATE TABLE emergency_contact (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employee(id),
  name TEXT NOT NULL,
  relationship TEXT NOT NULL,
  phone TEXT NOT NULL,
  is_primary INTEGER NOT NULL CHECK (is_primary IN (0, 1)),
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

CREATE TABLE employment_history (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employee(id),
  job_title_id TEXT REFERENCES job_title(id),
  employment_type_id TEXT REFERENCES employment_type(id),
  department_id TEXT REFERENCES department(id),
  manager_employee_id TEXT,
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  reason TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE UNIQUE INDEX employment_history_current ON employment_history(employee_id) WHERE effective_to IS NULL;

CREATE TABLE user_account (
  id TEXT PRIMARY KEY,
  employee_id TEXT UNIQUE REFERENCES employee(id),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_algo TEXT NOT NULL,
  must_change_password INTEGER NOT NULL CHECK (must_change_password IN (0, 1)),
  is_disabled INTEGER NOT NULL CHECK (is_disabled IN (0, 1)),
  disabled_reason TEXT,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  last_login_at TEXT,
  password_changed_at TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

CREATE TABLE password_history (
  id TEXT PRIMARY KEY,
  user_account_id TEXT NOT NULL REFERENCES user_account(id),
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE session (
  id TEXT PRIMARY KEY,
  user_account_id TEXT NOT NULL REFERENCES user_account(id),
  token_hash TEXT NOT NULL UNIQUE,
  csrf_token TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  revoked_at TEXT,
  revoked_reason TEXT,
  ip TEXT,
  user_agent TEXT
);

CREATE INDEX session_active ON session(user_account_id) WHERE revoked_at IS NULL;

CREATE TABLE login_attempt (
  id TEXT PRIMARY KEY,
  email_attempted TEXT NOT NULL,
  succeeded INTEGER NOT NULL CHECK (succeeded IN (0, 1)),
  ip TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL,
  failure_reason TEXT
);

CREATE TABLE role (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  is_system INTEGER NOT NULL CHECK (is_system IN (0, 1))
);

CREATE TABLE permission (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  resource TEXT NOT NULL,
  action TEXT NOT NULL,
  scope TEXT NOT NULL,
  description TEXT NOT NULL
);

CREATE TABLE role_permission (
  role_id TEXT NOT NULL REFERENCES role(id),
  permission_id TEXT NOT NULL REFERENCES permission(id),
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE user_role (
  user_account_id TEXT NOT NULL REFERENCES user_account(id),
  role_id TEXT NOT NULL REFERENCES role(id),
  granted_by TEXT NOT NULL,
  granted_at TEXT NOT NULL,
  PRIMARY KEY (user_account_id, role_id)
);

CREATE TABLE leave_period (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  starts_on TEXT NOT NULL,
  ends_on TEXT NOT NULL
);

CREATE TABLE leave_type (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  colour_token TEXT NOT NULL,
  is_paid INTEGER NOT NULL CHECK (is_paid IN (0, 1)),
  unit TEXT NOT NULL DEFAULT 'half_day',
  archived_at TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

CREATE TABLE leave_policy_version (
  id TEXT PRIMARY KEY,
  leave_type_id TEXT NOT NULL REFERENCES leave_type(id),
  version_no INTEGER NOT NULL,
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  rules_json TEXT NOT NULL,
  published_at TEXT,
  published_by TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  UNIQUE (leave_type_id, version_no)
);

CREATE TABLE policy_assignment (
  id TEXT PRIMARY KEY,
  leave_policy_version_id TEXT NOT NULL REFERENCES leave_policy_version(id),
  scope_type TEXT NOT NULL CHECK (scope_type IN ('company','location','department','employment_type','employee')),
  scope_id TEXT,
  priority INTEGER NOT NULL
);

CREATE TABLE holiday_calendar (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  year INTEGER NOT NULL,
  archived_at TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

CREATE TABLE holiday (
  id TEXT PRIMARY KEY,
  holiday_calendar_id TEXT NOT NULL REFERENCES holiday_calendar(id),
  date TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('public','optional','declared_working')),
  UNIQUE (holiday_calendar_id, date, kind)
);

CREATE TABLE approval_workflow (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  is_active INTEGER NOT NULL CHECK (is_active IN (0, 1)),
  match_json TEXT NOT NULL,
  priority INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

CREATE TABLE approval_workflow_step (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES approval_workflow(id),
  step_no INTEGER NOT NULL,
  approver_kind TEXT NOT NULL CHECK (approver_kind IN ('reporting_manager','skip_level','department_head','role','specific_employee')),
  approver_ref TEXT,
  is_optional INTEGER NOT NULL CHECK (is_optional IN (0, 1)),
  sla_hours INTEGER NOT NULL,
  UNIQUE (workflow_id, step_no)
);

CREATE TABLE leave_request (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employee(id),
  leave_type_id TEXT NOT NULL REFERENCES leave_type(id),
  policy_version_id TEXT NOT NULL REFERENCES leave_policy_version(id),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  half_day_start TEXT CHECK (half_day_start IS NULL OR half_day_start IN ('full','am','pm')),
  half_day_end TEXT CHECK (half_day_end IS NULL OR half_day_end IN ('full','am','pm')),
  total_half_days INTEGER NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft','submitted','pending_approval','approved','rejected','withdrawn','cancellation_requested','cancelled')),
  workflow_id TEXT REFERENCES approval_workflow(id),
  current_step_no INTEGER,
  submitted_at TEXT,
  decided_at TEXT,
  was_self_approved INTEGER NOT NULL DEFAULT 0 CHECK (was_self_approved IN (0, 1)),
  escalation_reason TEXT,
  submitted_by TEXT NOT NULL,
  attachment_id TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  CHECK (end_date >= start_date)
);

CREATE INDEX leave_request_employee ON leave_request(employee_id, start_date);
CREATE INDEX leave_request_status ON leave_request(status, current_step_no);

CREATE TABLE leave_request_day (
  id TEXT PRIMARY KEY,
  leave_request_id TEXT NOT NULL REFERENCES leave_request(id),
  date TEXT NOT NULL,
  portion TEXT NOT NULL CHECK (portion IN ('full','am','pm')),
  is_counted INTEGER NOT NULL CHECK (is_counted IN (0, 1)),
  skip_reason TEXT,
  UNIQUE (leave_request_id, date)
);

CREATE INDEX leave_request_day_counted ON leave_request_day(date) WHERE is_counted = 1;

CREATE TABLE approval_step_instance (
  id TEXT PRIMARY KEY,
  leave_request_id TEXT NOT NULL REFERENCES leave_request(id),
  step_no INTEGER NOT NULL,
  approver_employee_id TEXT,
  approver_user_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending','approved','rejected','skipped','withdrawn')),
  decided_at TEXT,
  decision_note TEXT,
  delegated_from TEXT,
  UNIQUE (leave_request_id, step_no)
);

CREATE INDEX approval_step_pending ON approval_step_instance(approver_employee_id, status);

CREATE TABLE leave_comment (
  id TEXT PRIMARY KEY,
  leave_request_id TEXT NOT NULL REFERENCES leave_request(id),
  author_user_id TEXT NOT NULL,
  body TEXT NOT NULL,
  visibility TEXT NOT NULL CHECK (visibility IN ('all','approvers_only')),
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL
);

CREATE TABLE balance_ledger (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employee(id),
  leave_type_id TEXT NOT NULL REFERENCES leave_type(id),
  period_id TEXT NOT NULL REFERENCES leave_period(id),
  entry_type TEXT NOT NULL CHECK (entry_type IN (
    'OPENING','ACCRUAL','ENTITLEMENT_GRANT','CARRY_FORWARD',
    'PENDING_HOLD','HOLD_RELEASE','DEDUCTION','CANCELLATION_CREDIT',
    'EXPIRY','ADJUSTMENT','ENCASHMENT','MIGRATION_OPENING'
  )),
  quantity_half_days INTEGER NOT NULL,
  effective_on TEXT NOT NULL,
  source_type TEXT,
  source_id TEXT,
  reason TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  reverses_entry_id TEXT REFERENCES balance_ledger(id)
);

CREATE INDEX balance_ledger_sum ON balance_ledger(employee_id, leave_type_id, period_id);

CREATE TRIGGER balance_ledger_no_update BEFORE UPDATE ON balance_ledger
BEGIN
  SELECT RAISE(ABORT, 'balance_ledger is append-only');
END;

CREATE TRIGGER balance_ledger_no_delete BEFORE DELETE ON balance_ledger
BEGIN
  SELECT RAISE(ABORT, 'balance_ledger is append-only');
END;

CREATE TABLE attendance_raw (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('import','login')),
  import_batch_id TEXT,
  employee_id TEXT NOT NULL REFERENCES employee(id),
  work_date TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  source_row_no INTEGER,
  source_hash TEXT,
  first_login_at TEXT,
  last_login_at TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  UNIQUE (employee_id, work_date, source)
);

CREATE INDEX attendance_raw_emp ON attendance_raw(employee_id, work_date);

CREATE TABLE attendance_correction (
  id TEXT PRIMARY KEY,
  attendance_raw_id TEXT NOT NULL REFERENCES attendance_raw(id),
  field TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  reason TEXT NOT NULL,
  corrected_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  approved_by TEXT,
  approved_at TEXT
);

CREATE TABLE attachment (
  id TEXT PRIMARY KEY,
  stored_name TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  detected_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  owner_employee_id TEXT REFERENCES employee(id),
  entity_type TEXT,
  entity_id TEXT,
  classification TEXT NOT NULL CHECK (classification IN ('general','medical','payroll','identity')),
  retention_until TEXT,
  retention_class TEXT NOT NULL DEFAULT 'standard',
  uploaded_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE import_batch (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('uploaded','validating','preview_ready','committing','committed','failed','rolled_back')),
  original_filename TEXT NOT NULL,
  file_sha256 TEXT NOT NULL,
  stored_file_path TEXT NOT NULL,
  row_count INTEGER NOT NULL DEFAULT 0,
  ok_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  dry_run INTEGER NOT NULL CHECK (dry_run IN (0, 1)),
  idempotency_key TEXT,
  started_by TEXT NOT NULL,
  started_at TEXT NOT NULL,
  committed_at TEXT,
  summary_json TEXT
);

CREATE TABLE import_row_error (
  id TEXT PRIMARY KEY,
  import_batch_id TEXT NOT NULL REFERENCES import_batch(id),
  row_no INTEGER NOT NULL,
  column TEXT,
  code TEXT NOT NULL,
  message TEXT NOT NULL,
  raw_value TEXT
);

CREATE TABLE audit_event (
  id TEXT PRIMARY KEY,
  occurred_at TEXT NOT NULL,
  actor_user_id TEXT,
  actor_label TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  before_json TEXT,
  after_json TEXT,
  request_id TEXT,
  ip TEXT,
  user_agent TEXT,
  result TEXT NOT NULL
);

CREATE INDEX audit_entity ON audit_event(entity_type, entity_id, occurred_at);
CREATE INDEX audit_actor ON audit_event(actor_user_id, occurred_at);

CREATE TRIGGER audit_event_no_update BEFORE UPDATE ON audit_event
BEGIN
  SELECT RAISE(ABORT, 'audit_event is append-only');
END;

CREATE TRIGGER audit_event_no_delete BEFORE DELETE ON audit_event
BEGIN
  SELECT RAISE(ABORT, 'audit_event is append-only');
END;

CREATE TABLE notification (
  id TEXT PRIMARY KEY,
  recipient_user_id TEXT NOT NULL REFERENCES user_account(id),
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  read_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX notification_unread ON notification(recipient_user_id) WHERE read_at IS NULL;

CREATE TABLE outbox_message (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','sending','sent','dead')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  last_error TEXT,
  created_at TEXT NOT NULL,
  sent_at TEXT
);

CREATE INDEX outbox_drain ON outbox_message(status, next_attempt_at);

CREATE TABLE idempotency_key (
  key TEXT NOT NULL,
  scope TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_json TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (scope, key)
);

CREATE TABLE backup_record (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  size_bytes INTEGER,
  sha256 TEXT,
  integrity_check_result TEXT,
  schema_version TEXT,
  trigger TEXT NOT NULL,
  status TEXT NOT NULL
);

CREATE TABLE app_setting (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE job_run (
  id TEXT PRIMARY KEY,
  job_name TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,
  detail_json TEXT
);

CREATE TABLE credential_sheet (
  id TEXT PRIMARY KEY,
  import_batch_id TEXT,
  payload_json TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  retrieved_at TEXT,
  retrieved_by TEXT
);
