/**
 * Builds the three Postgres scripts an operator pastes into the Supabase SQL editor to turn a
 * hosted sample database into a production one:
 *
 *   00  read-only counts of what 01 would delete and keep
 *   01  deletes sample/demo data (people, requests, ledger, sessions, audit), keeps the schema
 *       and the configuration the app needs
 *   02  upserts a real roster by employee code, one administrator and one HR officer, the rest
 *       employees; idempotent
 *
 * This module has no names in it. The roster is read by scripts/generate-production-sql.ts
 * from a file outside the repository, and the output is written outside the repository.
 * Nothing here opens a database.
 */
import { PG_APPEND_ONLY_TRIGGERS } from '@sns/database';
import {
  PERMISSIONS,
  ROLE_PERMISSIONS,
  SYSTEM_ROLES,
  defaultRulesForCode,
  parsePermission,
  type RoleCode,
} from '@sns/domain';

export type RosterRow = { code: string; name: string };

/** Rows removed completely by 01, in foreign-key-safe order (children first). */
export const WIPE_TABLES = [
  'notification',
  'session',
  'password_history',
  'login_attempt',
  'browser_device',
  'workstation_device',
  'credential_sheet',
  'import_row_error',
  'import_batch',
  'outbox_message',
  'idempotency_key',
  'leave_comment',
  'approval_step_instance',
  'leave_request_day',
  'leave_request',
  'attendance_correction',
  'attendance_raw',
  'attachment',
  'permission_request',
  'approval_override',
  'approval_delegation',
  'accrual_run',
  'period_rollover_run',
  'balance_ledger',
  'user_role',
  'user_account',
  'emergency_contact',
  'employee_contact',
  'employment_history',
  'employee',
  'team',
  'department',
  'job_title',
  'audit_event',
] as const;

/** Configuration the app needs; 01 leaves it alone. */
export const KEEP_TABLES = [
  'company',
  'location',
  'holiday_calendar',
  'holiday',
  'leave_period',
  'leave_type',
  'leave_policy_version',
  'approval_workflow',
  'approval_workflow_step',
  'employment_type',
  'role',
  'permission',
  'role_permission',
  'schema_migration',
  'job_run',
  'backup_record',
] as const;

/** Matches the ISO-8601 millisecond timestamps the application writes. */
const NOW = `to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

export const PRODUCTION_MARKER = 'ops.production_roster';

const q = (v: string) => `'${v.replaceAll("'", "''")}'`;

const SAMPLE_EMAIL = `(lower(email) LIKE '%@sns.test' OR lower(email) LIKE '%@example.invalid')`;

export function buildPreviewSql(): string {
  const wipe = WIPE_TABLES.map(
    (t) => `SELECT 'delete' AS action, '${t}' AS "table", count(*)::bigint AS rows FROM ${t}`,
  );
  const keep = KEEP_TABLES.map(
    (t) => `SELECT 'keep' AS action, '${t}' AS "table", count(*)::bigint AS rows FROM ${t}`,
  );
  return `-- 00 Preview. READ ONLY: counts what 01_partA_wipe_sample.sql would delete and keep.
-- Safe to run any number of times. Changes nothing.

${[...wipe, ...keep].join('\nUNION ALL\n')}
UNION ALL SELECT 'delete', 'policy_assignment (employee/department scope only)', count(*)::bigint
  FROM policy_assignment WHERE scope_type IN ('employee', 'department')
UNION ALL SELECT 'keep', 'policy_assignment (company/location/employment_type scope)', count(*)::bigint
  FROM policy_assignment WHERE scope_type NOT IN ('employee', 'department')
UNION ALL SELECT 'delete', 'app_setting (demo.* keys)', count(*)::bigint
  FROM app_setting WHERE key LIKE 'demo.%'
UNION ALL SELECT 'keep', 'app_setting (all other keys)', count(*)::bigint
  FROM app_setting WHERE key NOT LIKE 'demo.%'
ORDER BY 1, 2;

-- Safety checks for 01. Both must be 0 for 01 to run.
SELECT 'accounts with a non-sample email (01 refuses if > 0)' AS check_name, count(*)::bigint AS n
  FROM user_account WHERE NOT ${SAMPLE_EMAIL.replaceAll('email', 'user_account.email')}
UNION ALL
SELECT 'production roster already loaded (01 refuses if > 0)', count(*)::bigint
  FROM app_setting WHERE key = '${PRODUCTION_MARKER}';
`;
}

export function buildWipeSql(): string {
  const deletes = WIPE_TABLES.filter((t) => t !== 'employee')
    .map((t) => {
      if (t === 'team')
        return `UPDATE employee SET manager_employee_id = NULL;\nDELETE FROM employee;\nDELETE FROM team;`;
      return `DELETE FROM ${t};`;
    })
    .join('\n');
  return `-- 01 Part A: delete all sample/demo data. Keeps the schema and the configuration listed in
-- README.md. ONE TRANSACTION: it all happens or none of it does.
--
-- Run 00_preview_counts.sql first and read it. Run 02_partB_employees.sql IMMEDIATELY after:
-- with no accounts, the first-run setup page is open again (it still needs SETUP_TOKEN).
--
-- audit_event and balance_ledger are append-only. Their triggers are dropped for this one
-- transaction so the sample rows can go, then recreated before COMMIT. If anything fails,
-- the whole transaction rolls back, triggers included.

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM app_setting WHERE key = '${PRODUCTION_MARKER}') THEN
    RAISE EXCEPTION 'Refusing to wipe: the production roster is already loaded. This script is for sample data only.';
  END IF;
  IF EXISTS (SELECT 1 FROM user_account WHERE NOT ${SAMPLE_EMAIL.replaceAll('email', 'user_account.email')}) THEN
    RAISE EXCEPTION 'Refusing to wipe: an account has an email outside @sns.test / @example.invalid, so this is not purely sample data. Review it first.';
  END IF;
END $$;

DROP TRIGGER IF EXISTS balance_ledger_no_delete ON balance_ledger;
DROP TRIGGER IF EXISTS balance_ledger_no_update ON balance_ledger;
DROP TRIGGER IF EXISTS audit_event_no_delete ON audit_event;
DROP TRIGGER IF EXISTS audit_event_no_update ON audit_event;

${deletes}

-- Rules scoped to a sample employee or department; company-wide rules stay.
DELETE FROM policy_assignment WHERE scope_type IN ('employee', 'department');
-- Sample markers only (demo.accounts, demo.version, demo.navalur_seed). Other settings stay.
DELETE FROM app_setting WHERE key LIKE 'demo.%';

${PG_APPEND_ONLY_TRIGGERS.trim()}

INSERT INTO audit_event (id, occurred_at, actor_user_id, actor_label, action, entity_type, entity_id, result)
VALUES ('ops-wipe-' || md5(random()::text), ${NOW}, NULL, 'operator-sql', 'ops.sample_data.wiped', 'company', 'company', 'ok');

COMMIT;
`;
}

export type RosterOptions = {
  roster: RosterRow[];
  /** Employee code that becomes the administrator. */
  adminCode: string;
  /** Employee code that becomes HR (HR also keeps the Employee role so they can apply for leave). */
  hrCode: string;
  /** argon2id hash of the administrator's one-time password. Everyone else gets no usable password. */
  adminPasswordHash: string;
  /** Placeholder join date (YYYY-MM-DD). Accrual starts from it, so it should not be in the past. */
  joinedOn: string;
};

/** Not an argon2 string, so verification fails closed. The administrator sets a real one. */
export const NO_PASSWORD_HASH = '!no-password-set';

function splitName(name: string): { first: string; last: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return { first: parts[0] ?? name, last: parts.slice(1).join(' ') || '-' };
}

function usernameFor(code: string): string {
  return (
    code
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]/g, '')
      .slice(0, 40) || 'staff'
  );
}

export function rolesFor(code: string, o: Pick<RosterOptions, 'adminCode' | 'hrCode'>): RoleCode[] {
  if (code.toLowerCase() === o.adminCode.toLowerCase()) return ['admin'];
  if (code.toLowerCase() === o.hrCode.toLowerCase()) return ['employee', 'hr_officer'];
  return ['employee'];
}

export function buildRosterSql(o: RosterOptions): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(o.joinedOn)) throw new Error('joinedOn must be YYYY-MM-DD.');
  const codes = o.roster.map((r) => r.code.trim().toLowerCase());
  if (new Set(codes).size !== codes.length) throw new Error('The roster repeats an employee code.');
  for (const c of [o.adminCode, o.hrCode]) {
    if (!codes.includes(c.toLowerCase())) throw new Error(`${c} is not in the roster.`);
  }
  if (o.adminCode.toLowerCase() === o.hrCode.toLowerCase()) {
    throw new Error('The administrator and HR must be different people.');
  }

  const roleRows = SYSTEM_ROLES.map(
    (r) => `(${q(`role-${r.code}`)}, ${q(r.code)}, ${q(r.name)}, 1)`,
  );
  const permRows = PERMISSIONS.map((code) => {
    const p = parsePermission(code);
    return `(${q(`perm:${code}`)}, ${q(code)}, ${q(p.resource)}, ${q(p.action)}, ${q(p.scope)}, ${q(code)})`;
  });
  const rolePermRows: string[] = [];
  for (const [role, perms] of Object.entries(ROLE_PERMISSIONS) as [RoleCode, readonly string[]][]) {
    for (const p of perms) rolePermRows.push(`(${q(role)}, ${q(p)})`);
  }

  const people = o.roster
    .map((r) => {
      const { first, last } = splitName(r.name);
      const code = r.code.trim();
      const hash =
        code.toLowerCase() === o.adminCode.toLowerCase() ? o.adminPasswordHash : NO_PASSWORD_HASH;
      const roles = rolesFor(code, o).join(',');
      return `  (${q(code)}, ${q(first)}, ${q(last)}, ${q(`${usernameFor(code)}@example.invalid`)}, ${q(usernameFor(code))}, ${q(hash)}, ${q(roles)})`;
    })
    .join(',\n');

  const chains: { name: string; kinds: string[]; steps: [string, string | null][] }[] = [
    {
      name: 'Team member → team lead',
      kinds: ['employee'],
      steps: [
        ['team_lead', null],
        ['department_head', null],
        ['role', 'hr_officer'],
      ],
    },
    {
      name: 'Team lead → department head',
      kinds: ['team_lead'],
      steps: [
        ['department_head', null],
        ['role', 'hr_officer'],
      ],
    },
    { name: 'Department head → HR', kinds: ['department_head'], steps: [['role', 'hr_officer']] },
    {
      name: 'HR and administrator requests → administrator',
      kinds: ['hr_officer', 'admin'],
      steps: [['role', 'admin']],
    },
  ];
  const workflows = chains
    .map((c, i) => {
      const id = q(`ops-wf-${i + 1}`);
      const steps = c.steps
        .map(
          ([kind, ref], n) =>
            `INSERT INTO approval_workflow_step (id, workflow_id, step_no, approver_kind, approver_ref, is_optional, sla_hours)
SELECT ${q(`ops-wf-${i + 1}-s${n + 1}`)}, w.id, ${n + 1}, ${q(kind)}, ${ref ? q(ref) : 'NULL'}, 0, 48
  FROM approval_workflow w WHERE w.id = ${id}
ON CONFLICT DO NOTHING;`,
        )
        .join('\n');
      return `INSERT INTO approval_workflow (id, name, is_active, match_json, priority, created_at, created_by, updated_at, updated_by)
SELECT ${id}, ${q(c.name)}, 1, ${q(JSON.stringify({ requesterRoles: c.kinds }))}, ${(i + 1) * 10}, ${NOW}, 'ops-sql', ${NOW}, 'ops-sql'
 WHERE NOT EXISTS (SELECT 1 FROM approval_workflow WHERE id NOT LIKE 'ops-wf-%')
ON CONFLICT (id) DO NOTHING;
${steps}`;
    })
    .join('\n');

  return `-- 02 Part B: load the production roster. Idempotent: safe to run again, never duplicates a
-- person, never changes a password, never resets a role an administrator has since changed.
-- ONE TRANSACTION.
--
-- Placeholder values (the roster has only an id and a name). Correct them in Leave OS afterwards:
--   work email   <code>@example.invalid   (unique; used only as a login alias)
--   join date    ${o.joinedOn}   (accrual counts from it, so set the real date before month-end)
--   department   General (GEN)            location: the existing first location
--   job title / employment type / manager / team: left blank
-- Balances: none posted. They stay at zero until the monthly accrual job or HR credits them.

BEGIN;

-- 1. System roles and permissions (what the app's first-run setup would insert). No-ops if present.
INSERT INTO role (id, code, name, is_system) VALUES
  ${roleRows.join(',\n  ')}
ON CONFLICT (code) DO NOTHING;

INSERT INTO permission (id, code, resource, action, scope, description) VALUES
  ${permRows.join(',\n  ')}
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permission (role_id, permission_id)
SELECT r.id, p.id
  FROM (VALUES
  ${rolePermRows.join(',\n  ')}
  ) AS v(role_code, permission_code)
  JOIN role r ON r.code = v.role_code
  JOIN permission p ON p.code = v.permission_code
ON CONFLICT DO NOTHING;

-- 2. Organisation basics, only where missing (the first-run setup creates the same rows).
INSERT INTO company (id, name, timezone, leave_year_start_month, leave_year_start_day, created_at, created_by, updated_at, updated_by)
VALUES ('company', 'Simon & Sons', 'Asia/Kolkata', 1, 1, ${NOW}, 'ops-sql', ${NOW}, 'ops-sql')
ON CONFLICT (id) DO NOTHING;

INSERT INTO location (id, name, code, timezone, created_at, created_by, updated_at, updated_by)
SELECT 'ops-loc-hq', 'Headquarters', 'HQ', 'Asia/Kolkata', ${NOW}, 'ops-sql', ${NOW}, 'ops-sql'
 WHERE NOT EXISTS (SELECT 1 FROM location);

INSERT INTO leave_period (id, label, starts_on, ends_on)
SELECT 'ops-lp-' || to_char(CURRENT_DATE, 'YYYY'), to_char(CURRENT_DATE, 'YYYY'),
       to_char(CURRENT_DATE, 'YYYY') || '-01-01', to_char(CURRENT_DATE, 'YYYY') || '-12-31'
 WHERE NOT EXISTS (
   SELECT 1 FROM leave_period WHERE starts_on <= CURRENT_DATE::text AND ends_on >= CURRENT_DATE::text
 );

INSERT INTO leave_type (id, code, name, colour_token, is_paid, created_at, created_by, updated_at, updated_by)
VALUES ('ops-lt-al', 'AL', 'Annual Leave', 'accent', 1, ${NOW}, 'ops-sql', ${NOW}, 'ops-sql')
ON CONFLICT (code) DO NOTHING;

INSERT INTO leave_policy_version (id, leave_type_id, version_no, effective_from, rules_json, published_at, published_by, created_at, created_by)
SELECT 'ops-lpv-al-1', t.id, 1, to_char(CURRENT_DATE, 'YYYY') || '-01-01', ${q(JSON.stringify(defaultRulesForCode('AL')))}, ${NOW}, 'ops-sql', ${NOW}, 'ops-sql'
  FROM leave_type t
 WHERE t.code = 'AL'
   AND NOT EXISTS (SELECT 1 FROM leave_policy_version v WHERE v.leave_type_id = t.id);

INSERT INTO policy_assignment (id, leave_policy_version_id, scope_type, scope_id, priority)
SELECT 'ops-pa-al-1', v.id, 'company', 'company', 0
  FROM leave_policy_version v JOIN leave_type t ON t.id = v.leave_type_id
 WHERE t.code = 'AL'
   AND NOT EXISTS (SELECT 1 FROM policy_assignment)
 ORDER BY v.version_no DESC LIMIT 1;

${workflows}

INSERT INTO employment_type (id, name, code, is_leave_eligible, created_at, created_by, updated_at, updated_by)
SELECT 'ops-et-perm', 'Permanent', 'PERM', 1, ${NOW}, 'ops-sql', ${NOW}, 'ops-sql'
 WHERE NOT EXISTS (SELECT 1 FROM employment_type);

INSERT INTO job_title (id, name, created_at, created_by, updated_at, updated_by)
SELECT 'ops-jt-staff', 'Staff', ${NOW}, 'ops-sql', ${NOW}, 'ops-sql'
 WHERE NOT EXISTS (SELECT 1 FROM job_title);

INSERT INTO department (id, name, code, created_at, created_by, updated_at, updated_by)
VALUES ('ops-dept-gen', 'General', 'GEN', ${NOW}, 'ops-sql', ${NOW}, 'ops-sql')
ON CONFLICT (code) DO NOTHING;

-- 3. The roster.
CREATE TEMP TABLE _ops_roster (
  code TEXT, first_name TEXT, last_name TEXT, email TEXT, username TEXT, password_hash TEXT, roles TEXT
) ON COMMIT DROP;

INSERT INTO _ops_roster VALUES
${people};

INSERT INTO employee (id, employee_code, first_name, last_name, work_email, status, joined_on,
                      location_id, department_id, retention_class, created_at, created_by, updated_at, updated_by)
SELECT 'emp-' || lower(r.code), r.code, r.first_name, r.last_name, r.email, 'active', '${o.joinedOn}',
       (SELECT id FROM location ORDER BY created_at LIMIT 1),
       (SELECT id FROM department WHERE code = 'GEN'),
       'standard', ${NOW}, 'ops-sql', ${NOW}, 'ops-sql'
  FROM _ops_roster r
ON CONFLICT (employee_code) DO UPDATE
   SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name,
       updated_at = EXCLUDED.updated_at, updated_by = 'ops-sql';

-- A sign-in for anyone without one. The administrator gets a one-time password that must be
-- changed at first sign-in; everyone else has no usable password until an administrator
-- resets it from Users & access (that also forces a change at first sign-in).
INSERT INTO user_account (id, employee_id, email, username, password_hash, password_algo, must_change_password, is_disabled,
                          created_at, created_by, updated_at, updated_by)
SELECT 'usr-' || lower(r.code), e.id, e.work_email, r.username, r.password_hash, 'argon2id', 1, 0,
       ${NOW}, 'ops-sql', ${NOW}, 'ops-sql'
  FROM _ops_roster r
  JOIN employee e ON e.employee_code = r.code
 WHERE NOT EXISTS (SELECT 1 FROM user_account u WHERE u.employee_id = e.id);

-- Roles only for accounts that have none, so a later change in Users & access is kept.
INSERT INTO user_role (user_account_id, role_id, granted_by, granted_at)
SELECT u.id, ro.id, 'ops-sql', ${NOW}
  FROM _ops_roster r
  JOIN employee e ON e.employee_code = r.code
  JOIN user_account u ON u.employee_id = e.id
  JOIN role ro ON ro.code = ANY (string_to_array(r.roles, ','))
 WHERE NOT EXISTS (SELECT 1 FROM user_role x WHERE x.user_account_id = u.id);

-- 4. Closes the wipe script to this database and records the load.
INSERT INTO app_setting (key, value_json, updated_by, updated_at)
VALUES ('${PRODUCTION_MARKER}', '{"loaded":true}', 'ops-sql', ${NOW})
ON CONFLICT (key) DO NOTHING;

INSERT INTO audit_event (id, occurred_at, actor_user_id, actor_label, action, entity_type, entity_id, after_json, result)
VALUES ('ops-roster-load-v1', ${NOW}, NULL, 'operator-sql', 'ops.roster.loaded', 'company', 'company',
        '{"people":${o.roster.length}}', 'ok')
ON CONFLICT (id) DO NOTHING;

COMMIT;
`;
}
