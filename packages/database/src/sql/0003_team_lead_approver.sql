-- Leave now follows the organisation chart: a team member's request is decided by their
-- team lead, a team lead's by their department head, a department head's by HR, and HR's
-- by an administrator. `team_lead` was not an allowed approver kind, so the CHECK
-- constraint has to be widened before the hierarchy can be stored.

CREATE TABLE approval_workflow_step_new (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES approval_workflow(id),
  step_no INTEGER NOT NULL,
  approver_kind TEXT NOT NULL CHECK (
    approver_kind IN (
      'team_lead',
      'department_head',
      'reporting_manager',
      'skip_level',
      'role',
      'specific_employee'
    )
  ),
  approver_ref TEXT,
  is_optional INTEGER NOT NULL CHECK (is_optional IN (0, 1)),
  sla_hours INTEGER NOT NULL,
  UNIQUE (workflow_id, step_no)
);

INSERT INTO approval_workflow_step_new (id, workflow_id, step_no, approver_kind, approver_ref, is_optional, sla_hours)
SELECT id, workflow_id, step_no, approver_kind, approver_ref, is_optional, sla_hours
FROM approval_workflow_step;

DROP TABLE approval_workflow_step;
ALTER TABLE approval_workflow_step_new RENAME TO approval_workflow_step;

-- Records which rung of the ladder actually decided a request, so an escalation is
-- explainable after the fact rather than only at the moment it happened.
ALTER TABLE leave_request ADD COLUMN approver_kind TEXT;

-- The carry-forward expiry date for a ledger entry, so expired days can be found without
-- recomputing policy history.
ALTER TABLE balance_ledger ADD COLUMN expires_on TEXT;

-- Marks the period-opening run so it is never applied twice for the same period.
CREATE TABLE IF NOT EXISTS period_rollover_run (
  id TEXT PRIMARY KEY,
  period_id TEXT NOT NULL REFERENCES leave_period(id),
  employee_id TEXT NOT NULL REFERENCES employee(id),
  leave_type_id TEXT NOT NULL REFERENCES leave_type(id),
  ran_at TEXT NOT NULL,
  UNIQUE (period_id, employee_id, leave_type_id)
);

-- Marks a monthly accrual so a second run in the same month cannot credit twice.
CREATE TABLE IF NOT EXISTS accrual_run (
  id TEXT PRIMARY KEY,
  period_id TEXT NOT NULL REFERENCES leave_period(id),
  employee_id TEXT NOT NULL REFERENCES employee(id),
  leave_type_id TEXT NOT NULL REFERENCES leave_type(id),
  accrual_month TEXT NOT NULL,
  ran_at TEXT NOT NULL,
  UNIQUE (employee_id, leave_type_id, accrual_month)
);
