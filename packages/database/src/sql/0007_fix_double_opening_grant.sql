-- Setup granted each person their yearly entitlement, and then the leave-year job granted
-- it again because setup never recorded that the year had been opened. The ledger is
-- append-only, so the duplicate is reversed with a correcting entry, not deleted.
INSERT INTO balance_ledger (id, employee_id, leave_type_id, period_id, entry_type, quantity_half_days, effective_on, source_type, reason, created_by, created_at)
SELECT 'fix0007-' || g.id, g.employee_id, g.leave_type_id, g.period_id, 'ADJUSTMENT',
       -g.quantity_half_days, g.effective_on, 'manual',
       'Correction: yearly entitlement had been credited twice', 'system', g.created_at
  FROM balance_ledger g
 WHERE g.entry_type = 'ENTITLEMENT_GRANT'
   AND g.reason = 'Opening entitlement for the current leave year'
   AND EXISTS (
         SELECT 1 FROM balance_ledger j
          WHERE j.entry_type = 'ENTITLEMENT_GRANT'
            AND j.employee_id = g.employee_id
            AND j.leave_type_id = g.leave_type_id
            AND j.period_id = g.period_id
            AND j.id <> g.id
            AND j.reason LIKE 'Entitlement for %'
       );
