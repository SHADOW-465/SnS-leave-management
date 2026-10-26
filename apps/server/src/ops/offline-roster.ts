/**
 * Loads the office roster into an OFFLINE (SQLite) Leave OS database after first-run setup.
 * Same rules as the hosted 02 script (production-sql.ts): the administrator code gets the
 * admin role and a one-time password, the HR code gets employee + hr_officer, everyone else
 * employee. People other than the administrator get no password, so HR or the administrator
 * sets a temporary one from the Users page. Idempotent by employee code: never changes an
 * existing account, password, or role.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { hashPassword } from '@sns/auth';
import type { Db } from '@sns/database';
import { NO_PASSWORD_HASH, rolesFor, type RosterRow } from './production-sql.js';

export type OfflineRosterOptions = {
  roster: RosterRow[];
  adminCode: string;
  hrCode: string;
  joinedOn: string;
  departmentCode?: string;
  /** Disable administrator accounts that are not on the roster (the setup wizard's admin). */
  disableOtherAdmins?: boolean;
};

export type OfflineRosterResult = {
  created: number;
  existing: number;
  disabledAdmins: number;
  /** Set only when the administrator's account was created by this run. Never log it. */
  adminTemporaryPassword: string | null;
};

/** Reads the people from a hosted 02_partB_employees.sql without its password hash. */
export function rosterFromHostedSql(sql: string): RosterRow[] {
  const block = /INSERT INTO _ops_roster VALUES\r?\n([\s\S]*?);\r?\n/.exec(sql)?.[1];
  if (!block) throw new Error('No roster found in 02_partB_employees.sql.');
  return block
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((line) => {
      const f = [...line.matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1]!.replaceAll("''", "'"));
      if (f.length < 3) throw new Error('Unreadable roster row in 02_partB_employees.sql.');
      const [code, first, last] = f as [string, string, string];
      return { code, name: last === '-' ? first : `${first} ${last}` };
    });
}

function splitName(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return { first: parts[0] ?? name, last: parts.slice(1).join(' ') || '-' };
}

function usernameFor(code: string) {
  return (
    code
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]/g, '')
      .slice(0, 40) || 'staff'
  );
}

export async function loadOfflineRoster(
  sqlite: Db,
  o: OfflineRosterOptions,
): Promise<OfflineRosterResult> {
  if (sqlite.dialect === 'postgres') throw new Error('Use the hosted SQL scripts for Postgres.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(o.joinedOn)) throw new Error('joinedOn must be YYYY-MM-DD.');
  const codes = o.roster.map((r) => r.code.trim().toLowerCase());
  if (new Set(codes).size !== codes.length) throw new Error('The roster repeats an employee code.');
  for (const c of [o.adminCode, o.hrCode]) {
    if (!codes.includes(c.toLowerCase())) throw new Error(`${c} is not in the roster.`);
  }
  if (o.adminCode.toLowerCase() === o.hrCode.toLowerCase()) {
    throw new Error('The administrator and HR must be different people.');
  }
  const deptCode = o.departmentCode ?? 'GEN';
  const dept = (await sqlite.prepare(`SELECT id FROM department WHERE code = ?`).get(deptCode)) as
    { id: string } | undefined;
  const location = (await sqlite
    .prepare(`SELECT id FROM location ORDER BY created_at LIMIT 1`)
    .get()) as { id: string } | undefined;
  const actor = (await sqlite
    .prepare(
      `SELECT ua.id AS id FROM user_account ua JOIN user_role ur ON ur.user_account_id = ua.id
         JOIN role r ON r.id = ur.role_id WHERE r.code = 'admin' AND ua.is_disabled = 0 LIMIT 1`,
    )
    .get()) as { id: string } | undefined;
  if (!dept || !location || !actor) {
    throw new Error('Run first-run setup before loading the roster.');
  }
  const roleIds = new Map<string, string>();
  for (const r of (await sqlite.prepare(`SELECT id, code FROM role`).all()) as {
    id: string;
    code: string;
  }[]) {
    roleIds.set(r.code, r.id);
  }

  const now = new Date().toISOString();
  const result: OfflineRosterResult = {
    created: 0,
    existing: 0,
    disabledAdmins: 0,
    adminTemporaryPassword: null,
  };
  const rosterEmployeeIds: string[] = [];
  for (const person of o.roster) {
    const code = person.code.trim();
    const { first, last } = splitName(person.name);
    const email = `${usernameFor(code)}@example.invalid`;
    let emp = (await sqlite
      .prepare(`SELECT id FROM employee WHERE LOWER(employee_code) = LOWER(?)`)
      .get(code)) as { id: string } | undefined;
    if (!emp) {
      emp = { id: randomUUID() };
      await sqlite
        .prepare(
          `INSERT INTO employee (id, employee_code, first_name, last_name, work_email, status, joined_on,
             location_id, department_id, retention_class, created_at, created_by, updated_at, updated_by)
           VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, 'standard', ?, ?, ?, ?)`,
        )
        .run(
          emp.id,
          code,
          first,
          last,
          email,
          o.joinedOn,
          location.id,
          dept.id,
          now,
          actor.id,
          now,
          actor.id,
        );
    }
    rosterEmployeeIds.push(emp.id);
    const account = await sqlite
      .prepare(`SELECT id FROM user_account WHERE employee_id = ?`)
      .get(emp.id);
    if (account) {
      result.existing += 1;
      continue;
    }
    const isAdmin = code.toLowerCase() === o.adminCode.toLowerCase();
    let hash = NO_PASSWORD_HASH;
    if (isAdmin) {
      result.adminTemporaryPassword = randomBytes(12).toString('base64url');
      hash = await hashPassword(result.adminTemporaryPassword);
    }
    const userId = randomUUID();
    await sqlite
      .prepare(
        `INSERT INTO user_account (id, employee_id, email, username, password_hash, password_algo,
           must_change_password, is_disabled, created_at, created_by, updated_at, updated_by)
         VALUES (?, ?, ?, ?, ?, 'argon2id', 1, 0, ?, ?, ?, ?)`,
      )
      .run(userId, emp.id, email, usernameFor(code), hash, now, actor.id, now, actor.id);
    for (const role of rolesFor(code, o)) {
      const roleId = roleIds.get(role);
      if (!roleId) throw new Error(`The ${role} role is missing.`);
      await sqlite
        .prepare(
          `INSERT INTO user_role (user_account_id, role_id, granted_by, granted_at) VALUES (?, ?, ?, ?)`,
        )
        .run(userId, roleId, actor.id, now);
    }
    await sqlite
      .prepare(
        `INSERT INTO audit_event (id, occurred_at, actor_user_id, actor_label, action, entity_type, entity_id, after_json, result)
         VALUES (?, ?, ?, 'offline-roster', 'employee.imported', 'employee', ?, ?, 'ok')`,
      )
      .run(randomUUID(), now, actor.id, emp.id, JSON.stringify({ employeeCode: code }));
    result.created += 1;
  }

  if (o.disableOtherAdmins) {
    const others = (await sqlite
      .prepare(
        `SELECT DISTINCT ua.id AS id, ua.employee_id AS employee_id FROM user_account ua
           JOIN user_role ur ON ur.user_account_id = ua.id JOIN role r ON r.id = ur.role_id
          WHERE r.code = 'admin' AND ua.is_disabled = 0`,
      )
      .all()) as { id: string; employee_id: string | null }[];
    for (const a of others) {
      if (a.employee_id && rosterEmployeeIds.includes(a.employee_id)) continue;
      await sqlite
        .prepare(`UPDATE user_account SET is_disabled = 1, updated_at = ? WHERE id = ?`)
        .run(now, a.id);
      await sqlite.prepare(`DELETE FROM session WHERE user_account_id = ?`).run(a.id);
      result.disabledAdmins += 1;
    }
  }
  return result;
}
