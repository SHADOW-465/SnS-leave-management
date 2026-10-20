-- Annual Leave is the only leave type. Archive any other type so nobody can apply for it.
-- Nothing is deleted: requests, balances and ledger rows keep pointing at the archived type,
-- so history and reports are unchanged.
UPDATE leave_type
   SET archived_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP, updated_by = 'system'
 WHERE code <> 'AL' AND archived_at IS NULL;
