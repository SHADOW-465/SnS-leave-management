-- Last sign-out of the day, distinct from the last sign-in.
ALTER TABLE attendance_raw ADD COLUMN last_logout_at TEXT;
