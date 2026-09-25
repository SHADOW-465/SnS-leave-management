import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { verifyPassword } from '@sns/auth';
import { toPostgresSql, PG_APPEND_ONLY_TRIGGERS } from '@sns/database';

function splitSql(sql: string): string[] {
  const parts: string[] = [];
  let buf = '';
  let inDollar = false;
  for (let i = 0; i < sql.length; i++) {
    if (sql.startsWith('$$', i)) {
      inDollar = !inDollar;
      buf += '$$';
      i++;
      continue;
    }
    if (!inDollar && sql[i] === ';') {
      if (buf.trim()) parts.push(buf.trim());
      buf = '';
      continue;
    }
    buf += sql[i];
  }
  if (buf.trim()) parts.push(buf.trim());
  return parts;
}

describe('Simon & Sons Navalur Chennai Dataset', () => {
  it('applies cleanly and verifies departments, teams, members, and real-life edge cases', async () => {
    const pg = new PGlite();

    // 1. Run migrations 0001 through 0012 to establish schema
    const rootDir = path.resolve(import.meta.dirname, '../../..');
    const migrationsDir = path.join(rootDir, 'packages/database/src/sql');
    const migrationFiles = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    for (const f of migrationFiles) {
      const sql = fs.readFileSync(path.join(migrationsDir, f), 'utf8');
      const stripped = sql.replace(/CREATE TRIGGER[\s\S]*?^END;/gm, '');
      const pgSql = `${toPostgresSql(stripped)}\n${PG_APPEND_ONLY_TRIGGERS}`;
      await pg.exec(pgSql);
    }

    // 2. Load the generated reset script
    const sqlFile = path.join(rootDir, 'scripts/reset-simon-and-sons-navalur.sql');
    expect(fs.existsSync(sqlFile)).toBe(true);
    const rawSql = fs.readFileSync(sqlFile, 'utf8');

    const cleanSql = rawSql
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^--.*$/gm, '')
      .trim();

    const stmts = splitSql(cleanSql).filter(Boolean);
    for (const stmt of stmts) {
      await pg.exec(stmt + ';');
    }

    // 3. Verify Organization Architecture
    const depts = await pg.query<{ code: string; name: string }>(
      `SELECT code, name FROM department WHERE code != 'ADM' ORDER BY code`,
    );
    expect(depts.rows).toHaveLength(5);
    expect(depts.rows.map((d) => d.code)).toEqual(['HR', 'ITES', 'PUB', 'QA', 'TECH']);

    const teams = await pg.query<{ id: string; name: string }>(
      `SELECT id, name FROM team ORDER BY id`,
    );
    expect(teams.rows).toHaveLength(5);

    // Verify 10 members per team
    const teamCounts = await pg.query<{ name: string; count: string }>(`
      SELECT t.name, COUNT(e.id) as count
      FROM team t
      LEFT JOIN employee e ON e.team_id = t.id
      GROUP BY t.id, t.name
      ORDER BY t.name
    `);
    for (const row of teamCounts.rows) {
      expect(Number(row.count)).toBe(10);
    }

    // Total employees: 50 in teams + 1 Admin = 51
    const empTotal = await pg.query<{ count: string }>(`SELECT COUNT(*) as count FROM employee`);
    expect(Number(empTotal.rows[0]!.count)).toBe(51);

    // 4. Verify Key Person Names & Roles
    const admin = await pg.query<{
      name: string;
      email: string;
      role: string;
      password_hash: string;
    }>(`
      SELECT e.first_name || ' ' || e.last_name as name, ua.email, r.code as role, ua.password_hash
      FROM user_account ua
      JOIN employee e ON e.id = ua.employee_id
      JOIN user_role ur ON ur.user_account_id = ua.id
      JOIN role r ON r.id = ur.role_id
      WHERE ua.email = 'admin@sns.test'
    `);
    expect(admin.rows[0]!.name).toBe('Vijay Antony');
    expect(admin.rows[0]!.role).toBe('admin');
    expect(await verifyPassword(admin.rows[0]!.password_hash, 'ChangeMe_admin_1')).toBe(true);

    const hr = await pg.query<{
      name: string;
      email: string;
      role: string;
      password_hash: string;
    }>(`
      SELECT e.first_name || ' ' || e.last_name as name, ua.email, r.code as role, ua.password_hash
      FROM user_account ua
      JOIN employee e ON e.id = ua.employee_id
      JOIN user_role ur ON ur.user_account_id = ua.id
      JOIN role r ON r.id = ur.role_id
      WHERE ua.email = 'anjusha@sns.test'
    `);
    expect(hr.rows[0]!.name).toBe('Anjusha R');
    expect(hr.rows[0]!.role).toBe('hr_officer');
    expect(await verifyPassword(hr.rows[0]!.password_hash, 'ChangeMe_demo_1')).toBe(true);

    const mgr = await pg.query<{
      name: string;
      email: string;
      role: string;
      password_hash: string;
    }>(`
      SELECT e.first_name || ' ' || e.last_name as name, ua.email, r.code as role, ua.password_hash
      FROM user_account ua
      JOIN employee e ON e.id = ua.employee_id
      JOIN user_role ur ON ur.user_account_id = ua.id
      JOIN role r ON r.id = ur.role_id
      WHERE ua.email = 'suresh@sns.test'
    `);
    expect(mgr.rows[0]!.name).toBe('Suresh Kumar');
    expect(mgr.rows[0]!.role).toBe('manager');
    expect(await verifyPassword(mgr.rows[0]!.password_hash, 'ChangeMe_demo_1')).toBe(true);

    // 5. Verify Real-Life Edge Cases
    const requests = await pg.query<{ id: string; status: string; total_half_days: number }>(`
      SELECT id, status, total_half_days FROM leave_request ORDER BY id
    `);
    expect(requests.rows.length).toBeGreaterThanOrEqual(14);

    // Weekend skipping check (Balaji: 4 calendar days, only 2 counted)
    const weekendDays = await pg.query<{ count: string; uncounted: string }>(`
      SELECT
        COUNT(*) as count,
        SUM(CASE WHEN is_counted = 0 AND skip_reason = 'weekend' THEN 1 ELSE 0 END) as uncounted
      FROM leave_request_day
      WHERE leave_request_id = 'req-balaji-weekend'
    `);
    expect(Number(weekendDays.rows[0]!.count)).toBe(4);
    expect(Number(weekendDays.rows[0]!.uncounted)).toBe(2);

    // Holiday skipping check (Keerthana: Gandhi Jayanti + weekend skipped)
    const holidayDays = await pg.query<{ holiday_skipped: string }>(`
      SELECT COUNT(*) as holiday_skipped
      FROM leave_request_day
      WHERE leave_request_id = 'req-keerthana-hol' AND is_counted = 0 AND skip_reason = 'holiday'
    `);
    expect(Number(holidayDays.rows[0]!.holiday_skipped)).toBe(1);

    // Rejection note check (Priya)
    const rejectionStep = await pg.query<{ decision_note: string }>(`
      SELECT decision_note FROM approval_step_instance WHERE leave_request_id = 'req-priya-nov'
    `);
    expect(rejectionStep.rows[0]!.decision_note).toContain('release cycle');

    // HR leave routes to MD (Anjusha -> Rajesh)
    const hrStep = await pg.query<{ approver_email: string }>(`
      SELECT ua.email as approver_email
      FROM approval_step_instance asi
      JOIN user_account ua ON ua.id = asi.approver_user_id
      WHERE asi.leave_request_id = 'req-anjusha-md'
    `);
    expect(hrStep.rows[0]!.approver_email).toBe('rajesh@sns.test');

    // Manager leave routes to HR (Suresh -> Anjusha)
    const mgrStep = await pg.query<{ approver_email: string }>(`
      SELECT ua.email as approver_email
      FROM approval_step_instance asi
      JOIN user_account ua ON ua.id = asi.approver_user_id
      WHERE asi.leave_request_id = 'req-suresh-hr'
    `);
    expect(mgrStep.rows[0]!.approver_email).toBe('anjusha@sns.test');

    await pg.close();
  });
});
