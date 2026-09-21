-- Administrator controls over who approves whom.

-- A named approver for one person, overriding what their team and department imply.
-- One row per employee: setting a new override replaces the old one.
CREATE TABLE approval_override (
  employee_id TEXT PRIMARY KEY REFERENCES employee(id),
  approver_employee_id TEXT NOT NULL REFERENCES employee(id),
  note TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  CHECK (employee_id != approver_employee_id)
);

-- Cover while an approver is away: between the two dates, anything that would have gone
-- to approver_employee_id goes to delegate_employee_id instead.
CREATE TABLE approval_delegation (
  id TEXT PRIMARY KEY,
  approver_employee_id TEXT NOT NULL REFERENCES employee(id),
  delegate_employee_id TEXT NOT NULL REFERENCES employee(id),
  starts_on TEXT NOT NULL,
  ends_on TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  CHECK (ends_on >= starts_on),
  CHECK (approver_employee_id != delegate_employee_id)
);

CREATE INDEX idx_delegation_approver
  ON approval_delegation (approver_employee_id, starts_on, ends_on);
