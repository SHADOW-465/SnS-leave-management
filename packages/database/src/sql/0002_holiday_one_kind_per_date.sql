-- A date has exactly one kind. The original UNIQUE (holiday_calendar_id, date, kind)
-- let the same date be public AND optional AND a declared working day at once, so
-- re-marking a day added a row instead of replacing one and the calendar showed
-- whichever row happened to be read first.

-- Keep one row per (calendar, date): the most recently inserted wins.
DELETE FROM holiday
WHERE rowid NOT IN (
  SELECT MAX(rowid) FROM holiday GROUP BY holiday_calendar_id, date
);

CREATE TABLE holiday_new (
  id TEXT PRIMARY KEY,
  holiday_calendar_id TEXT NOT NULL REFERENCES holiday_calendar(id),
  date TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('public','optional','declared_working')),
  UNIQUE (holiday_calendar_id, date)
);

INSERT INTO holiday_new (id, holiday_calendar_id, date, name, kind)
SELECT id, holiday_calendar_id, date, name, kind FROM holiday;

DROP TABLE holiday;
ALTER TABLE holiday_new RENAME TO holiday;

CREATE INDEX idx_holiday_calendar_date ON holiday (holiday_calendar_id, date);
