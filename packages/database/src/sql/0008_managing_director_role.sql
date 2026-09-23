-- The Managing Director sits at the top of the approval hierarchy with the administrator
-- and approves leave for HR. Permissions are defined in code, and this row lets accounts hold it.
INSERT INTO role (id, code, name, is_system)
SELECT 'role-director', 'director', 'Managing Director', 1
 WHERE NOT EXISTS (SELECT 1 FROM role WHERE code = 'director');
