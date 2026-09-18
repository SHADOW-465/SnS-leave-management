-- Workstation-to-employee 1:1 binding: pairs each office workstation / browser
-- device fingerprint to an employee to prevent cross-account logins ("buddy punching").

CREATE TABLE IF NOT EXISTS workstation_device (
  id TEXT PRIMARY KEY,
  device_fingerprint TEXT NOT NULL UNIQUE,
  employee_id TEXT NOT NULL REFERENCES employee(id),
  device_label TEXT,
  last_seen_at TEXT NOT NULL,
  last_seen_ip TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_workstation_employee ON workstation_device (employee_id);
CREATE INDEX IF NOT EXISTS idx_workstation_fingerprint ON workstation_device (device_fingerprint);
