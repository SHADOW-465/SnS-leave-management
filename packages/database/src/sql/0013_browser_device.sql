-- Browser device binding. The cookie is an httpOnly signed token, not a client header.
-- status: pending (awaiting an administrator), approved (bound to user_account_id), revoked.

CREATE TABLE IF NOT EXISTS browser_device (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'revoked')),
  user_account_id TEXT REFERENCES user_account(id),
  employee_id TEXT REFERENCES employee(id),
  label TEXT,
  lan_ip TEXT,
  user_agent TEXT,
  last_seen_at TEXT,
  last_login_at TEXT,
  created_at TEXT NOT NULL,
  approved_at TEXT,
  approved_by TEXT,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_browser_device_user ON browser_device (user_account_id, status);
CREATE INDEX IF NOT EXISTS idx_browser_device_status ON browser_device (status, created_at);
