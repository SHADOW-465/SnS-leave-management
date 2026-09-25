import { withTx } from '@sns/database';
import { DomainError, newId } from '@sns/domain';
import type { ImportAttendanceBody, RecordAttendanceCorrectionBody } from '@sns/contracts';
import { authorizeAction, graphFor, requirePrincipal, type RequestContext } from '../ctx.js';
import { audit } from './leave.js';

export interface AttendanceFilter {
  date?: string;
  source?: string;
  departmentId?: string;
  search?: string;
}

export async function listAttendance(ctx: RequestContext, filters: AttendanceFilter = {}) {
  const p = requirePrincipal(ctx);
  await authorizeAction(ctx, 'attendance.read', p.employeeId);
  const graph = await graphFor(ctx.sqlite, p.employeeId);

  const canCompany = p.permissions.some((x) => x === 'attendance.read:company');
  const canDirectReports = p.permissions.some((x) => x === 'attendance.read:direct_reports');

  const rows = (await ctx.sqlite
    .prepare(
      `SELECT a.id, a.source, a.work_date, a.payload_json, a.first_login_at, a.last_login_at,
              a.last_logout_at, a.created_at,
              a.employee_id, e.first_name || ' ' || e.last_name AS name, e.employee_code, e.work_email,
              e.department_id, d.name AS department_name, jt.name AS job_title_name
       FROM attendance_raw a
       JOIN employee e ON e.id = a.employee_id
       LEFT JOIN department d ON d.id = e.department_id
       LEFT JOIN job_title jt ON jt.id = e.job_title_id
       ORDER BY a.work_date DESC, a.first_login_at DESC
       LIMIT 500`,
    )
    .all()) as Record<string, unknown>[];

  // RBAC scope filtering
  let scoped = rows;
  if (!canCompany) {
    scoped = rows.filter((r) => {
      const empId = String(r.employee_id);
      if (empId === p.employeeId) return true;
      if (canDirectReports && graph.reports.has(empId)) return true;
      if (graph.recursiveReports.has(empId)) return true;
      return false;
    });
  }

  // Fetch corrections for all fetched attendance rows
  const allCorrections = (await ctx.sqlite
    .prepare(
      `SELECT c.id, c.attendance_raw_id, c.field, c.old_value, c.new_value, c.reason,
              c.corrected_by, c.created_at,
              u.first_name || ' ' || u.last_name AS corrector_name
       FROM attendance_correction c
       LEFT JOIN employee u ON u.id = c.corrected_by
       ORDER BY c.created_at DESC`,
    )
    .all()) as Record<string, unknown>[];

  const correctionsByRawId = new Map<string, Array<Record<string, unknown>>>();
  for (const c of allCorrections) {
    const rawId = String(c.attendance_raw_id);
    const list = correctionsByRawId.get(rawId) ?? [];
    list.push(c);
    correctionsByRawId.set(rawId, list);
  }

  // Apply user filters
  const dateFilter = filters.date?.trim();
  const sourceFilter = filters.source?.trim().toLowerCase();
  const deptFilter = filters.departmentId?.trim();
  const searchFilter = filters.search?.trim().toLowerCase();

  const filtered = scoped.filter((r) => {
    if (dateFilter && r.work_date !== dateFilter) return false;
    if (sourceFilter && sourceFilter !== 'all' && r.source !== sourceFilter) return false;
    if (deptFilter && r.department_id !== deptFilter) return false;
    if (searchFilter) {
      const name = String(r.name ?? '').toLowerCase();
      const code = String(r.employee_code ?? '').toLowerCase();
      const email = String(r.work_email ?? '').toLowerCase();
      if (
        !name.includes(searchFilter) &&
        !code.includes(searchFilter) &&
        !email.includes(searchFilter)
      ) {
        return false;
      }
    }
    return true;
  });

  // Calculate high-level summary KPIs for today & overall
  const today = ctx.today;
  const todayRows = scoped.filter((r) => r.work_date === today);
  const todayLoginRows = todayRows.filter((r) => r.source === 'login' && r.first_login_at);

  let earliestLoginToday: { time: string; employeeName: string } | null = null;
  let latestLoginToday: { time: string; employeeName: string } | null = null;
  let latestLogoutToday: { time: string; employeeName: string } | null = null;

  for (const r of todayLoginRows) {
    const loginTime = String(r.first_login_at || '');
    const empName = String(r.name || 'Unknown');
    if (!earliestLoginToday || loginTime < earliestLoginToday.time) {
      earliestLoginToday = { time: loginTime, employeeName: empName };
    }
    const lastTime = String(r.last_login_at || r.first_login_at || '');
    if (!latestLoginToday || lastTime > latestLoginToday.time) {
      latestLoginToday = { time: lastTime, employeeName: empName };
    }
    const logoutTime = r.last_logout_at ? String(r.last_logout_at) : '';
    if (logoutTime && (!latestLogoutToday || logoutTime > latestLogoutToday.time)) {
      latestLogoutToday = { time: logoutTime, employeeName: empName };
    }
  }

  const enrichedRows = filtered.map((r) => {
    const rawId = String(r.id);
    return {
      ...r,
      corrections: correctionsByRawId.get(rawId) ?? [],
    };
  });

  return {
    notice: 'Login rows are presence signals only. A missing login is not an absence (ADR 0011).',
    metrics: {
      totalRecords: scoped.length,
      todayRecords: todayRows.length,
      todayLoginSignals: todayLoginRows.length,
      earliestLoginToday,
      latestLoginToday,
      latestLogoutToday,
      totalLoginSignals: scoped.filter((r) => r.source === 'login').length,
      totalImportedSignals: scoped.filter((r) => r.source === 'import').length,
    },
    rows: enrichedRows,
  };
}

export async function recordAttendanceCorrection(
  ctx: RequestContext,
  input: RecordAttendanceCorrectionBody,
) {
  const p = requirePrincipal(ctx);

  const raw = (await ctx.sqlite
    .prepare(`SELECT * FROM attendance_raw WHERE id = ?`)
    .get(input.attendanceRawId)) as Record<string, unknown> | undefined;

  if (!raw) {
    throw new DomainError('NOT_FOUND', 'Attendance record not found');
  }

  await authorizeAction(ctx, 'attendance.correct', String(raw.employee_id));

  const oldValue = raw[input.field] ? String(raw[input.field]) : null;
  const correctionId = newId();

  await withTx(ctx.sqlite, async () => {
    await ctx.sqlite
      .prepare(
        `INSERT INTO attendance_correction (id, attendance_raw_id, field, old_value, new_value, reason, corrected_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        correctionId,
        input.attendanceRawId,
        input.field,
        oldValue,
        input.newValue,
        input.reason,
        p.employeeId,
        ctx.now,
      );

    await audit(
      ctx,
      'attendance.corrected',
      'attendance_raw',
      input.attendanceRawId,
      { [input.field]: oldValue },
      { [input.field]: input.newValue, reason: input.reason },
    );
  });

  return {
    id: correctionId,
    attendanceRawId: input.attendanceRawId,
    field: input.field,
    oldValue,
    newValue: input.newValue,
    reason: input.reason,
    correctedBy: p.employeeId,
    createdAt: ctx.now,
  };
}

export async function importAttendanceCsv(ctx: RequestContext, input: ImportAttendanceBody) {
  const p = requirePrincipal(ctx);
  await authorizeAction(ctx, 'attendance.import', null);

  const employees = (await ctx.sqlite
    .prepare(`SELECT id, employee_code FROM employee`)
    .all()) as Array<{ id: string; employee_code: string }>;

  const empByCode = new Map<string, string>();
  for (const emp of employees) {
    empByCode.set(emp.employee_code.toLowerCase(), emp.id);
  }

  let importedCount = 0;
  let updatedCount = 0;

  await withTx(ctx.sqlite, async () => {
    for (let i = 0; i < input.rows.length; i++) {
      const row = input.rows[i];
      if (!row) continue;
      const employeeId = empByCode.get(row.employeeCode.toLowerCase());
      if (!employeeId) {
        throw new DomainError(
          'BAD_REQUEST',
          `Employee with code "${row.employeeCode}" does not exist (row ${i + 1})`,
        );
      }

      const existing = (await ctx.sqlite
        .prepare(
          `SELECT id FROM attendance_raw WHERE employee_id = ? AND work_date = ? AND source = 'import'`,
        )
        .get(employeeId, row.workDate)) as { id: string } | undefined;

      const payloadJson = JSON.stringify({
        notes: row.notes || null,
        imported_at: ctx.now,
      });

      if (existing) {
        await ctx.sqlite
          .prepare(
            `UPDATE attendance_raw
           SET first_login_at = COALESCE(?, first_login_at),
               last_login_at = COALESCE(?, last_login_at),
               last_logout_at = COALESCE(?, last_logout_at),
               payload_json = ?
           WHERE id = ?`,
          )
          .run(
            row.firstLoginAt || null,
            row.lastLoginAt || null,
            row.lastLogoutAt || null,
            payloadJson,
            existing.id,
          );
        updatedCount++;
      } else {
        await ctx.sqlite
          .prepare(
            `INSERT INTO attendance_raw (id, source, employee_id, work_date, payload_json, first_login_at, last_login_at, last_logout_at, created_at, created_by, source_row_no)
           VALUES (?, 'import', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            newId(),
            employeeId,
            row.workDate,
            payloadJson,
            row.firstLoginAt || null,
            row.lastLoginAt || null,
            row.lastLogoutAt || null,
            ctx.now,
            p.employeeId,
            i + 1,
          );
        importedCount++;
      }
    }

    await audit(
      ctx,
      'attendance.imported',
      'attendance_raw',
      p.employeeId ?? p.userId ?? 'system',
      null,
      {
        totalRows: input.rows.length,
        importedCount,
        updatedCount,
      },
    );
  });

  return {
    success: true,
    totalRows: input.rows.length,
    importedCount,
    updatedCount,
  };
}
