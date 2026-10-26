-- HR officers may set a temporary password for anyone except an administrator (the server
-- enforces that guardrail). Older databases may lack the grant; add it if missing. Idempotent,
-- inserts only, deletes nothing. On a fresh database (no roles yet) this inserts nothing.
INSERT INTO role_permission (role_id, permission_id)
SELECT r.id, p.id
  FROM role r, permission p
 WHERE r.code = 'hr_officer'
   AND p.code = 'user.password.reset:company'
   AND NOT EXISTS (
     SELECT 1 FROM role_permission rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
   );
