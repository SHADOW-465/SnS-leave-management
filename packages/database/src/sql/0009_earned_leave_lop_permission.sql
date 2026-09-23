-- How someone was hired, so probation accrual can differ for freshers and experienced hires.
ALTER TABLE employee ADD COLUMN hire_background TEXT NOT NULL DEFAULT 'experienced';

-- Working days in a request that are not covered by earned leave.
ALTER TABLE leave_request ADD COLUMN lop_half_days INTEGER NOT NULL DEFAULT 0;

-- Short permission: up to 2 hours a month, taken as 1 or 2 hours.
CREATE TABLE IF NOT EXISTS permission_request (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employee(id),
  on_date TEXT NOT NULL,
  hours INTEGER NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL,
  approver_employee_id TEXT,
  decided_at TEXT,
  decision_note TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL
);
