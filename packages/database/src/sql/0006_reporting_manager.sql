-- The reporting manager is now the one place that says who approves someone's leave.
-- Administrator overrides were the same idea under another name: fold them in, so
-- nobody's approver changes on upgrade, and stop using the override table.
UPDATE employee
   SET manager_employee_id = (
         SELECT o.approver_employee_id FROM approval_override o WHERE o.employee_id = employee.id
       )
 WHERE id IN (SELECT employee_id FROM approval_override);

DELETE FROM approval_override;
