-- Hosted Postgres: password history is only visible to the signed-in account (or to
-- login/setup while app.user_account_id is empty). SQLite has no RLS -- the use-case
-- still updates only the caller's row. Table owner bypasses RLS unless FORCE is set.
ALTER TABLE password_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE password_history FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS password_history_self ON password_history;
CREATE POLICY password_history_self ON password_history
  USING (
    coalesce(current_setting('app.user_account_id', true), '') IN ('', user_account_id)
  )
  WITH CHECK (
    coalesce(current_setting('app.user_account_id', true), '') IN ('', user_account_id)
  );

ALTER TABLE user_account ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_account_visible ON user_account;
CREATE POLICY user_account_visible ON user_account
  USING (true)
  WITH CHECK (true);
