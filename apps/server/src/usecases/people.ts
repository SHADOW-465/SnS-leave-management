import { generateTemporaryPassword, hashPassword } from '@sns/auth';
import { withTx } from '@sns/database';
import { DomainError, assertNoManagerCycle, newId } from '@sns/domain';
import { authorizeAction, graphFor, requirePrincipal, type RequestContext } from '../ctx.js';
import { grantOpeningBalances, currentPeriodId } from './setup.js';
import { audit } from './leave.js';
export async function listEmployees(ctx: RequestContext, q: string) {
  const p = requirePrincipal(ctx);
  await authorizeAction(ctx, 'employee.read', p.employeeId);
  const graph = await graphFor(ctx.sqlite, p.employeeId);
  const rows = (await ctx.sqlite
    .prepare(
      `SELECT e.*, d.name AS department_name,
              t.name AS team_name,
              m.first_name || ' ' || m.last_name AS manager_name,
              et.name AS employment_name,
              loc.name AS location_name,
              jt.name AS job_title_name,
              ua.id AS user_account_id,
              ua.is_disabled AS account_disabled
       FROM employee e
       JOIN department d ON d.id = e.department_id
       LEFT JOIN team t ON t.id = e.team_id
       LEFT JOIN employee m ON m.id = e.manager_employee_id
       LEFT JOIN employment_type et ON et.id = e.employment_type_id
       LEFT JOIN location loc ON loc.id = e.location_id
       LEFT JOIN job_title jt ON jt.id = e.job_title_id
       LEFT JOIN user_account ua ON ua.employee_id = e.id
       ORDER BY e.first_name, e.last_name`,
    )
    .all()) as Record<string, unknown>[];
  const canCompany = p.permissions.some((x) => x === 'employee.read:company');
  const canTeam = p.permissions.some((x) => x === 'employee.read:team');
  const filtered = canCompany
    ? rows
    : rows.filter((r) => {
        const id = String(r.id);
        if (id === p.employeeId) return true;
        if (graph.recursiveReports.has(id)) return true;
        if (graph.reports.has(id)) return true;
        if (canTeam && p.teamId && r.team_id === p.teamId) return true;
        return false;
      });
  const needle = q.trim().toLowerCase();
  return filtered.filter((r) => {
    if (!needle) return true;
    const blob =
      `${r.first_name} ${r.last_name} ${r.employee_code ?? ''} ${r.work_email ?? ''} ${r.department_name} ${r.team_name ?? ''} ${r.job_title_name ?? ''} ${r.manager_name ?? ''}`.toLowerCase();
    return blob.includes(needle);
  });
}

export async function getEmployee(ctx: RequestContext, employeeId: string) {
  requirePrincipal(ctx);
  await authorizeAction(ctx, 'employee.read', employeeId);
  const row = (await ctx.sqlite
    .prepare(
      `SELECT e.*, d.name AS department_name,
              t.name AS team_name,
              m.first_name || ' ' || m.last_name AS manager_name,
              et.name AS employment_name,
              loc.name AS location_name,
              jt.name AS job_title_name,
              ua.id AS user_account_id,
              ua.is_disabled AS account_disabled
       FROM employee e
       JOIN department d ON d.id = e.department_id
       LEFT JOIN team t ON t.id = e.team_id
       LEFT JOIN employee m ON m.id = e.manager_employee_id
       LEFT JOIN employment_type et ON et.id = e.employment_type_id
       LEFT JOIN location loc ON loc.id = e.location_id
       LEFT JOIN job_title jt ON jt.id = e.job_title_id
       LEFT JOIN user_account ua ON ua.employee_id = e.id
       WHERE e.id = ?`,
    )
    .get(employeeId)) as Record<string, unknown> | undefined;
  if (!row) throw new DomainError('NOT_FOUND', 'Employee not found.', { httpStatus: 404 });
  return row;
}

export async function updateEmployee(
  ctx: RequestContext,
  employeeId: string,
  input: {
    employeeCode?: string;
    firstName?: string;
    lastName?: string;
    workEmail?: string;
    joinedOn?: string;
    departmentId?: string;
    teamId?: string | null;
    managerEmployeeId?: string | null;
    locationId?: string;
    jobTitleId?: string;
    employmentTypeId?: string;
    probationEndOn?: string | null;
    status?: 'active' | 'probation' | 'notice' | 'exited' | 'suspended';
    expectedVersion: number;
  },
) {
  const p = requirePrincipal(ctx);
  await authorizeAction(ctx, 'employee.update', employeeId);

  const existing = (await ctx.sqlite
    .prepare(`SELECT * FROM employee WHERE id = ?`)
    .get(employeeId)) as Record<string, unknown> | undefined;
  if (!existing) {
    throw new DomainError('NOT_FOUND', 'Employee not found.', { httpStatus: 404 });
  }
  if (existing.version !== input.expectedVersion) {
    throw new DomainError(
      'CONFLICT',
      'This record has already changed. Please reload and try again.',
      {
        httpStatus: 409,
      },
    );
  }

  // Prevent manager cycle if managerEmployeeId is set and changed
  if (
    input.managerEmployeeId !== undefined &&
    input.managerEmployeeId !== null &&
    input.managerEmployeeId !== existing.manager_employee_id
  ) {
    const employees = (await ctx.sqlite
      .prepare(`SELECT id, manager_employee_id AS managerEmployeeId FROM employee`)
      .all()) as { id: string; managerEmployeeId: string | null }[];
    assertNoManagerCycle(employees, employeeId, input.managerEmployeeId);
  }

  // Check unique constraints if employeeCode or workEmail changed
  if (input.employeeCode && input.employeeCode !== existing.employee_code) {
    const dupeCode = await ctx.sqlite
      .prepare(`SELECT id FROM employee WHERE employee_code = ? AND id != ?`)
      .get(input.employeeCode, employeeId);
    if (dupeCode) {
      throw new DomainError(
        'DUPLICATE',
        `Employee code '${input.employeeCode}' is already taken.`,
        {
          httpStatus: 409,
        },
      );
    }
  }

  if (input.workEmail && input.workEmail !== existing.work_email) {
    const dupeEmail = await ctx.sqlite
      .prepare(`SELECT id FROM employee WHERE work_email = ? AND id != ?`)
      .get(input.workEmail, employeeId);
    if (dupeEmail) {
      throw new DomainError('DUPLICATE', `Work email '${input.workEmail}' is already in use.`, {
        httpStatus: 409,
      });
    }
  }

  const updatedVersion = (existing.version as number) + 1;

  await withTx(ctx.sqlite, async () => {
    const newCode = input.employeeCode ?? (existing.employee_code as string);
    const newFirstName = input.firstName ?? (existing.first_name as string);
    const newLastName = input.lastName ?? (existing.last_name as string);
    const newWorkEmail = input.workEmail ?? (existing.work_email as string);
    const newJoinedOn = input.joinedOn ?? (existing.joined_on as string);
    const newDeptId = input.departmentId ?? (existing.department_id as string);
    const newTeamId =
      input.teamId !== undefined ? input.teamId : (existing.team_id as string | null);
    const newManagerId =
      input.managerEmployeeId !== undefined
        ? input.managerEmployeeId
        : (existing.manager_employee_id as string | null);
    const newLocId = input.locationId ?? (existing.location_id as string);
    const newJobId = input.jobTitleId ?? (existing.job_title_id as string);
    const newEmpTypeId = input.employmentTypeId ?? (existing.employment_type_id as string);
    const newProbationEndOn =
      input.probationEndOn !== undefined
        ? input.probationEndOn
        : (existing.probation_end_on as string | null);
    const newStatus = input.status ?? (existing.status as string);

    await ctx.sqlite
      .prepare(
        `UPDATE employee
         SET employee_code = ?,
             first_name = ?,
             last_name = ?,
             work_email = ?,
             joined_on = ?,
             department_id = ?,
             team_id = ?,
             manager_employee_id = ?,
             location_id = ?,
             job_title_id = ?,
             employment_type_id = ?,
             probation_end_on = ?,
             status = ?,
             version = ?,
             updated_at = ?,
             updated_by = ?
         WHERE id = ? AND version = ?`,
      )
      .run(
        newCode,
        newFirstName,
        newLastName,
        newWorkEmail,
        newJoinedOn,
        newDeptId,
        newTeamId,
        newManagerId,
        newLocId,
        newJobId,
        newEmpTypeId,
        newProbationEndOn,
        newStatus,
        updatedVersion,
        ctx.now,
        p.userId,
        employeeId,
        input.expectedVersion,
      );

    // If work email changed, update associated user_account email
    if (input.workEmail && input.workEmail !== existing.work_email) {
      await ctx.sqlite
        .prepare(
          `UPDATE user_account SET email = ?, updated_at = ?, updated_by = ? WHERE employee_id = ?`,
        )
        .run(input.workEmail, ctx.now, p.userId, employeeId);
    }

    // If status transitioned to 'exited', revoke sessions and disable user account
    if (input.status === 'exited' && existing.status !== 'exited') {
      const account = (await ctx.sqlite
        .prepare(`SELECT id FROM user_account WHERE employee_id = ?`)
        .get(employeeId)) as { id: string } | undefined;
      if (account) {
        await ctx.sqlite
          .prepare(
            `UPDATE user_account SET is_disabled = 1, disabled_reason = 'exited', updated_at = ?, updated_by = ? WHERE id = ?`,
          )
          .run(ctx.now, p.userId, account.id);
        await ctx.sqlite
          .prepare(
            `UPDATE session SET revoked_at = ?, revoked_reason = 'employee_exited' WHERE user_account_id = ? AND revoked_at IS NULL`,
          )
          .run(ctx.now, account.id);
      }
    }

    await audit(ctx, 'employee.updated', 'employee', employeeId, null, {
      changes: {
        firstName: input.firstName,
        lastName: input.lastName,
        employeeCode: input.employeeCode,
        workEmail: input.workEmail,
        status: input.status,
        departmentId: input.departmentId,
        managerEmployeeId: input.managerEmployeeId,
      },
    });
  });

  return { id: employeeId, version: updatedVersion };
}
export async function createEmployee(
  ctx: RequestContext,
  input: {
    employeeCode: string;
    firstName: string;
    lastName: string;
    workEmail: string;
    joinedOn: string;
    probationEndOn?: string | null;
    locationId: string;
    departmentId: string;
    teamId?: string | null;
    managerEmployeeId?: string | null;
    jobTitleId: string;
    employmentTypeId: string;
    createAccount: boolean;
  },
) {
  const p = requirePrincipal(ctx);
  await authorizeAction(ctx, 'employee.create', null);
  const employees = (await ctx.sqlite
    .prepare(`SELECT id, manager_employee_id AS managerEmployeeId FROM employee`)
    .all()) as {
    id: string;
    managerEmployeeId: string | null;
  }[];
  if (input.managerEmployeeId) {
    assertNoManagerCycle(
      [...employees, { id: 'new', managerEmployeeId: null }],
      'new',
      input.managerEmployeeId,
    );
  }
  const id = newId();
  const userId = newId();
  let temp: string | null = null;
  if (input.createAccount) {
    temp = generateTemporaryPassword();
  }
  const hash = temp ? await hashPassword(temp) : null;
  await withTx(ctx.sqlite, async () => {
    await ctx.sqlite
      .prepare(
        `INSERT INTO employee (id, employee_code, first_name, last_name, work_email, status, joined_on, probation_end_on, location_id, department_id, team_id, manager_employee_id, job_title_id, employment_type_id, retention_class, created_at, created_by, updated_at, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'standard', ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.employeeCode,
        input.firstName,
        input.lastName,
        input.workEmail,
        input.probationEndOn && input.probationEndOn > ctx.today ? 'probation' : 'active',
        input.joinedOn,
        input.probationEndOn ?? null,
        input.locationId,
        input.departmentId,
        input.teamId ?? null,
        input.managerEmployeeId ?? null,
        input.jobTitleId,
        input.employmentTypeId,
        ctx.now,
        p.userId,
        ctx.now,
        p.userId,
      );
    if (hash && temp) {
      await ctx.sqlite
        .prepare(
          `INSERT INTO user_account (id, employee_id, email, password_hash, password_algo, must_change_password, is_disabled, created_at, created_by, updated_at, updated_by)
           VALUES (?, ?, ?, ?, 'argon2id', 0, 0, ?, ?, ?, ?)`,
        )
        .run(userId, id, input.workEmail, hash, ctx.now, p.userId, ctx.now, p.userId);
      const role = (await ctx.sqlite
        .prepare(`SELECT id FROM role WHERE code = 'employee'`)
        .get()) as {
        id: string;
      };
      await ctx.sqlite
        .prepare(
          `INSERT INTO user_role (user_account_id, role_id, granted_by, granted_at) VALUES (?, ?, ?, ?)`,
        )
        .run(userId, role.id, p.userId, ctx.now);
    }
    await grantOpeningBalances(ctx, id, await currentPeriodId(ctx), p.userId);
    await audit(ctx, 'employee.created', 'employee', id, null, {
      employeeCode: input.employeeCode,
    });
  });
  return { id, temporaryPassword: temp };
}
export async function deactivateEmployee(
  ctx: RequestContext,
  employeeId: string,
  input: {
    reason: string;
    exitedOn: string;
    expectedVersion: number;
  },
) {
  const p = requirePrincipal(ctx);
  await authorizeAction(ctx, 'employee.archive', employeeId);
  await withTx(ctx.sqlite, async () => {
    const bump = await ctx.sqlite
      .prepare(
        `UPDATE employee SET status = 'exited', exited_on = ?, version = version + 1, updated_at = ?, updated_by = ? WHERE id = ? AND version = ?`,
      )
      .run(input.exitedOn, ctx.now, p.userId, employeeId, input.expectedVersion);
    if (bump.changes !== 1)
      throw new DomainError('CONFLICT', 'This record has already changed.', { httpStatus: 409 });
    const account = (await ctx.sqlite
      .prepare(`SELECT id FROM user_account WHERE employee_id = ?`)
      .get(employeeId)) as
      | {
          id: string;
        }
      | undefined;
    if (account) {
      await ctx.sqlite
        .prepare(
          `UPDATE user_account SET is_disabled = 1, disabled_reason = ?, updated_at = ?, updated_by = ? WHERE id = ?`,
        )
        .run(input.reason, ctx.now, p.userId, account.id);
      await ctx.sqlite
        .prepare(
          `UPDATE session SET revoked_at = ?, revoked_reason = 'employee_exited' WHERE user_account_id = ? AND revoked_at IS NULL`,
        )
        .run(ctx.now, account.id);
    }
    await audit(ctx, 'employee.exited', 'employee', employeeId, null, { reason: input.reason });
  });
}
export async function bulkProvision(ctx: RequestContext, employeeIds: string[]) {
  const p = requirePrincipal(ctx);
  await authorizeAction(ctx, 'user.account.create', null);
  const issued: {
    email: string;
    temporaryPassword: string;
    name: string;
  }[] = [];
  for (const empId of employeeIds) {
    const emp = (await ctx.sqlite.prepare(`SELECT * FROM employee WHERE id = ?`).get(empId)) as
      | {
          work_email: string;
          first_name: string;
          last_name: string;
        }
      | undefined;
    if (!emp) continue;
    const existing = await ctx.sqlite
      .prepare(`SELECT id FROM user_account WHERE employee_id = ?`)
      .get(empId);
    if (existing) continue;
    const temp = generateTemporaryPassword();
    const hash = await hashPassword(temp);
    const userId = newId();
    await ctx.sqlite
      .prepare(
        `INSERT INTO user_account (id, employee_id, email, password_hash, password_algo, must_change_password, is_disabled, created_at, created_by, updated_at, updated_by)
         VALUES (?, ?, ?, ?, 'argon2id', 0, 0, ?, ?, ?, ?)`,
      )
      .run(userId, empId, emp.work_email, hash, ctx.now, p.userId, ctx.now, p.userId);
    const role = (await ctx.sqlite
      .prepare(`SELECT id FROM role WHERE code = 'employee'`)
      .get()) as {
      id: string;
    };
    await ctx.sqlite
      .prepare(
        `INSERT INTO user_role (user_account_id, role_id, granted_by, granted_at) VALUES (?, ?, ?, ?)`,
      )
      .run(userId, role.id, p.userId, ctx.now);
    issued.push({
      email: emp.work_email,
      temporaryPassword: temp,
      name: `${emp.first_name} ${emp.last_name}`,
    });
  }
  const sheetId = newId();
  await ctx.sqlite
    .prepare(
      `INSERT INTO credential_sheet (id, payload_json, created_by, created_at) VALUES (?, ?, ?, ?)`,
    )
    .run(sheetId, JSON.stringify(issued), p.userId, ctx.now);
  await audit(ctx, 'user.account.bulk_provisioned', 'credential_sheet', sheetId, null, {
    count: issued.length,
  });
  return { sheetId, count: issued.length };
}
export async function retrieveCredentialSheet(ctx: RequestContext, sheetId: string) {
  const p = requirePrincipal(ctx);
  await authorizeAction(ctx, 'user.account.create', null);
  const row = (await ctx.sqlite
    .prepare(`SELECT * FROM credential_sheet WHERE id = ?`)
    .get(sheetId)) as
    | {
        payload_json: string;
        retrieved_at: string | null;
      }
    | undefined;
  if (!row)
    throw new DomainError('NOT_FOUND', 'That credential sheet does not exist.', {
      httpStatus: 404,
    });
  if (row.retrieved_at) {
    throw new DomainError(
      'SHEET_USED',
      'This credential sheet has already been viewed and cannot be retrieved again.',
      {
        httpStatus: 409,
      },
    );
  }
  await ctx.sqlite
    .prepare(`UPDATE credential_sheet SET retrieved_at = ?, retrieved_by = ? WHERE id = ?`)
    .run(ctx.now, p.userId, sheetId);
  await audit(ctx, 'credential_sheet.retrieved', 'credential_sheet', sheetId, null, {});
  return JSON.parse(row.payload_json) as {
    email: string;
    temporaryPassword: string;
    name: string;
  }[];
}

export async function reactivateEmployee(
  ctx: RequestContext,
  employeeId: string,
  input: { expectedVersion: number },
) {
  const p = requirePrincipal(ctx);
  await authorizeAction(ctx, 'employee.update', employeeId);

  const existing = (await ctx.sqlite
    .prepare(`SELECT * FROM employee WHERE id = ?`)
    .get(employeeId)) as Record<string, unknown> | undefined;
  if (!existing) {
    throw new DomainError('NOT_FOUND', 'Employee not found.', { httpStatus: 404 });
  }
  if (existing.version !== input.expectedVersion) {
    throw new DomainError('CONFLICT', 'This record has already changed. Please reload.', {
      httpStatus: 409,
    });
  }

  const updatedVersion = (existing.version as number) + 1;

  await withTx(ctx.sqlite, async () => {
    await ctx.sqlite
      .prepare(
        `UPDATE employee
         SET status = 'active',
             exited_on = NULL,
             version = ?,
             updated_at = ?,
             updated_by = ?
         WHERE id = ? AND version = ?`,
      )
      .run(updatedVersion, ctx.now, p.userId, employeeId, input.expectedVersion);

    const account = (await ctx.sqlite
      .prepare(`SELECT id FROM user_account WHERE employee_id = ?`)
      .get(employeeId)) as { id: string } | undefined;
    if (account) {
      await ctx.sqlite
        .prepare(
          `UPDATE user_account
           SET is_disabled = 0,
               disabled_reason = NULL,
               updated_at = ?,
               updated_by = ?
           WHERE id = ?`,
        )
        .run(ctx.now, p.userId, account.id);
    }

    await audit(ctx, 'employee.reactivated', 'employee', employeeId, null, {
      previousStatus: existing.status,
    });
  });

  return { id: employeeId, version: updatedVersion, status: 'active' };
}

export async function listDepartments(ctx: RequestContext) {
  requirePrincipal(ctx);
  await authorizeAction(ctx, 'org.structure.read', null);
  const rows = (await ctx.sqlite
    .prepare(
      `SELECT d.*,
              h.first_name || ' ' || h.last_name AS head_employee_name,
              (SELECT COUNT(*) FROM employee e WHERE e.department_id = d.id AND e.status != 'exited') AS employee_count,
              (SELECT COUNT(*) FROM team t WHERE t.department_id = d.id AND t.archived_at IS NULL) AS team_count
       FROM department d
       LEFT JOIN employee h ON h.id = d.head_employee_id
       ORDER BY d.name`,
    )
    .all()) as Record<string, unknown>[];
  return rows;
}

export async function getDepartment(ctx: RequestContext, departmentId: string) {
  requirePrincipal(ctx);
  await authorizeAction(ctx, 'org.structure.read', null);
  const dept = (await ctx.sqlite
    .prepare(
      `SELECT d.*,
              h.first_name || ' ' || h.last_name AS head_employee_name
       FROM department d
       LEFT JOIN employee h ON h.id = d.head_employee_id
       WHERE d.id = ?`,
    )
    .get(departmentId)) as Record<string, unknown> | undefined;
  if (!dept) throw new DomainError('NOT_FOUND', 'Department not found.', { httpStatus: 404 });

  const employees = (await ctx.sqlite
    .prepare(
      `SELECT e.id, e.employee_code, e.first_name, e.last_name, e.work_email, e.status, jt.name AS job_title_name
       FROM employee e
       LEFT JOIN job_title jt ON jt.id = e.job_title_id
       WHERE e.department_id = ? AND e.status != 'exited'
       ORDER BY e.first_name, e.last_name`,
    )
    .all(departmentId)) as Record<string, unknown>[];

  const teams = (await ctx.sqlite
    .prepare(
      `SELECT t.*,
              l.first_name || ' ' || l.last_name AS lead_employee_name,
              (SELECT COUNT(*) FROM employee e WHERE e.team_id = t.id AND e.status != 'exited') AS member_count
       FROM team t
       LEFT JOIN employee l ON l.id = t.lead_employee_id
       WHERE t.department_id = ? AND t.archived_at IS NULL
       ORDER BY t.name`,
    )
    .all(departmentId)) as Record<string, unknown>[];

  return { ...dept, employees, teams };
}

export async function createDepartment(
  ctx: RequestContext,
  input: {
    name: string;
    code: string;
    headEmployeeId?: string | null;
  },
) {
  const p = requirePrincipal(ctx);
  await authorizeAction(ctx, 'org.structure.manage', null);
  if (input.headEmployeeId) {
    // Appointing who approves is reserved to administrators.
    await authorizeAction(ctx, 'approval.routing.manage', null);
  }

  const cleanName = input.name.trim();
  const cleanCode = input.code.trim().toUpperCase();

  const dupe = await ctx.sqlite
    .prepare(`SELECT id FROM department WHERE UPPER(code) = ?`)
    .get(cleanCode);
  if (dupe) {
    throw new DomainError('DUPLICATE', `Department code '${cleanCode}' is already taken.`, {
      httpStatus: 409,
    });
  }

  if (input.headEmployeeId) {
    const head = await ctx.sqlite
      .prepare(`SELECT id FROM employee WHERE id = ?`)
      .get(input.headEmployeeId);
    if (!head) {
      throw new DomainError('NOT_FOUND', 'Designated department head does not exist.', {
        httpStatus: 404,
      });
    }
  }

  const id = newId();
  await ctx.sqlite
    .prepare(
      `INSERT INTO department (id, name, code, head_employee_id, created_at, created_by, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      cleanName,
      cleanCode,
      input.headEmployeeId ?? null,
      ctx.now,
      p.userId,
      ctx.now,
      p.userId,
    );

  await audit(ctx, 'department.created', 'department', id, null, {
    name: cleanName,
    code: cleanCode,
    headEmployeeId: input.headEmployeeId ?? null,
  });

  return { id, name: cleanName, code: cleanCode, headEmployeeId: input.headEmployeeId ?? null };
}

export async function updateDepartment(
  ctx: RequestContext,
  departmentId: string,
  input: {
    name?: string;
    code?: string;
    headEmployeeId?: string | null;
  },
) {
  const p = requirePrincipal(ctx);
  await authorizeAction(ctx, 'org.structure.manage', null);

  const existing = (await ctx.sqlite
    .prepare(`SELECT * FROM department WHERE id = ?`)
    .get(departmentId)) as Record<string, unknown> | undefined;
  if (!existing) {
    throw new DomainError('NOT_FOUND', 'Department not found.', { httpStatus: 404 });
  }
  // Who heads a department decides whose leave they approve, so changing it is an
  // approval-routing decision reserved to administrators, not a structure edit.
  if (
    input.headEmployeeId !== undefined &&
    input.headEmployeeId !== (existing.head_employee_id as string | null)
  ) {
    await authorizeAction(ctx, 'approval.routing.manage', null);
  }

  const cleanName = input.name ? input.name.trim() : (existing.name as string);
  const cleanCode = input.code ? input.code.trim().toUpperCase() : (existing.code as string);

  if (input.code && cleanCode !== (existing.code as string)) {
    const dupe = await ctx.sqlite
      .prepare(`SELECT id FROM department WHERE UPPER(code) = ? AND id != ?`)
      .get(cleanCode, departmentId);
    if (dupe) {
      throw new DomainError('DUPLICATE', `Department code '${cleanCode}' is already taken.`, {
        httpStatus: 409,
      });
    }
  }

  const headId =
    input.headEmployeeId !== undefined
      ? input.headEmployeeId
      : (existing.head_employee_id as string | null);

  if (headId) {
    const head = await ctx.sqlite.prepare(`SELECT id FROM employee WHERE id = ?`).get(headId);
    if (!head) {
      throw new DomainError('NOT_FOUND', 'Designated department head does not exist.', {
        httpStatus: 404,
      });
    }
  }

  await ctx.sqlite
    .prepare(
      `UPDATE department
       SET name = ?,
           code = ?,
           head_employee_id = ?,
           updated_at = ?,
           updated_by = ?
       WHERE id = ?`,
    )
    .run(cleanName, cleanCode, headId, ctx.now, p.userId, departmentId);

  await audit(ctx, 'department.updated', 'department', departmentId, null, {
    changes: { name: cleanName, code: cleanCode, headEmployeeId: headId },
  });

  return { id: departmentId, name: cleanName, code: cleanCode, headEmployeeId: headId };
}

export async function archiveDepartment(ctx: RequestContext, departmentId: string) {
  const p = requirePrincipal(ctx);
  await authorizeAction(ctx, 'org.structure.manage', null);

  const existing = (await ctx.sqlite
    .prepare(`SELECT * FROM department WHERE id = ?`)
    .get(departmentId)) as Record<string, unknown> | undefined;
  if (!existing) {
    throw new DomainError('NOT_FOUND', 'Department not found.', { httpStatus: 404 });
  }

  // Check if active employees belong to this department
  const assigned = (await ctx.sqlite
    .prepare(
      `SELECT COUNT(*) AS count FROM employee WHERE department_id = ? AND status != 'exited'`,
    )
    .get(departmentId)) as { count: number };
  if (assigned.count > 0) {
    throw new DomainError(
      'IN_USE',
      `Cannot deactivate department with ${assigned.count} active employee(s). Please reassign them to another department first.`,
      { httpStatus: 409 },
    );
  }

  await ctx.sqlite
    .prepare(`UPDATE department SET archived_at = ?, updated_at = ?, updated_by = ? WHERE id = ?`)
    .run(ctx.now, ctx.now, p.userId, departmentId);

  await audit(ctx, 'department.archived', 'department', departmentId, null, {});

  return { id: departmentId, archived: true };
}

export async function listTeams(ctx: RequestContext, departmentId?: string) {
  requirePrincipal(ctx);
  await authorizeAction(ctx, 'org.structure.read', null);
  // The CAST is required. Postgres cannot infer the type of a bare parameter compared
  // with IS NULL and rejects the whole query; SQLite accepts the cast unchanged.
  const rows = (await ctx.sqlite
    .prepare(
      `SELECT t.*,
              d.name AS department_name,
              d.code AS department_code,
              l.first_name || ' ' || l.last_name AS lead_employee_name,
              (SELECT COUNT(*) FROM employee e WHERE e.team_id = t.id AND e.status != 'exited') AS member_count
       FROM team t
       JOIN department d ON d.id = t.department_id
       LEFT JOIN employee l ON l.id = t.lead_employee_id
       WHERE (CAST(? AS TEXT) IS NULL OR t.department_id = CAST(? AS TEXT))
       ORDER BY d.name, t.name`,
    )
    .all(departmentId ?? null, departmentId ?? null)) as Record<string, unknown>[];
  return rows;
}

export async function getTeam(ctx: RequestContext, teamId: string) {
  requirePrincipal(ctx);
  await authorizeAction(ctx, 'org.structure.read', null);
  const team = (await ctx.sqlite
    .prepare(
      `SELECT t.*,
              d.name AS department_name,
              d.code AS department_code,
              l.first_name || ' ' || l.last_name AS lead_employee_name
       FROM team t
       JOIN department d ON d.id = t.department_id
       LEFT JOIN employee l ON l.id = t.lead_employee_id
       WHERE t.id = ?`,
    )
    .get(teamId)) as Record<string, unknown> | undefined;
  if (!team) throw new DomainError('NOT_FOUND', 'Team not found.', { httpStatus: 404 });

  const members = (await ctx.sqlite
    .prepare(
      `SELECT e.id, e.employee_code, e.first_name, e.last_name, e.work_email, e.status, jt.name AS job_title_name
       FROM employee e
       LEFT JOIN job_title jt ON jt.id = e.job_title_id
       WHERE e.team_id = ? AND e.status != 'exited'
       ORDER BY e.first_name, e.last_name`,
    )
    .all(teamId)) as Record<string, unknown>[];

  return { ...team, members };
}

export async function createTeam(
  ctx: RequestContext,
  input: {
    departmentId: string;
    name: string;
    leadEmployeeId?: string | null;
  },
) {
  const p = requirePrincipal(ctx);
  await authorizeAction(ctx, 'org.structure.manage', null);
  if (input.leadEmployeeId) {
    // Appointing who approves is reserved to administrators.
    await authorizeAction(ctx, 'approval.routing.manage', null);
  }

  const cleanName = input.name.trim();

  const dept = await ctx.sqlite
    .prepare(`SELECT id FROM department WHERE id = ?`)
    .get(input.departmentId);
  if (!dept) {
    throw new DomainError('NOT_FOUND', 'Department not found.', { httpStatus: 404 });
  }

  const dupe = await ctx.sqlite
    .prepare(`SELECT id FROM team WHERE department_id = ? AND LOWER(name) = LOWER(?)`)
    .get(input.departmentId, cleanName);
  if (dupe) {
    throw new DomainError(
      'DUPLICATE',
      `A team named '${cleanName}' already exists in this department.`,
      {
        httpStatus: 409,
      },
    );
  }

  if (input.leadEmployeeId) {
    const lead = await ctx.sqlite
      .prepare(`SELECT id FROM employee WHERE id = ?`)
      .get(input.leadEmployeeId);
    if (!lead) {
      throw new DomainError('NOT_FOUND', 'Designated team lead does not exist.', {
        httpStatus: 404,
      });
    }
  }

  const id = newId();
  await ctx.sqlite
    .prepare(
      `INSERT INTO team (id, department_id, name, lead_employee_id, created_at, created_by, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.departmentId,
      cleanName,
      input.leadEmployeeId ?? null,
      ctx.now,
      p.userId,
      ctx.now,
      p.userId,
    );

  await audit(ctx, 'team.created', 'team', id, null, {
    departmentId: input.departmentId,
    name: cleanName,
    leadEmployeeId: input.leadEmployeeId ?? null,
  });

  return {
    id,
    departmentId: input.departmentId,
    name: cleanName,
    leadEmployeeId: input.leadEmployeeId ?? null,
  };
}

export async function updateTeam(
  ctx: RequestContext,
  teamId: string,
  input: {
    departmentId?: string;
    name?: string;
    leadEmployeeId?: string | null;
  },
) {
  const p = requirePrincipal(ctx);
  await authorizeAction(ctx, 'org.structure.manage', null);

  const existing = (await ctx.sqlite.prepare(`SELECT * FROM team WHERE id = ?`).get(teamId)) as
    Record<string, unknown> | undefined;
  if (!existing) {
    throw new DomainError('NOT_FOUND', 'Team not found.', { httpStatus: 404 });
  }
  // The team lead approves the team's leave, so changing it is reserved to administrators.
  if (
    input.leadEmployeeId !== undefined &&
    input.leadEmployeeId !== (existing.lead_employee_id as string | null)
  ) {
    await authorizeAction(ctx, 'approval.routing.manage', null);
  }

  const newDeptId = input.departmentId ?? (existing.department_id as string);
  const newName = input.name ? input.name.trim() : (existing.name as string);

  if (input.departmentId && input.departmentId !== existing.department_id) {
    const dept = await ctx.sqlite.prepare(`SELECT id FROM department WHERE id = ?`).get(newDeptId);
    if (!dept) throw new DomainError('NOT_FOUND', 'Department not found.', { httpStatus: 404 });
  }

  if (
    (input.name && newName !== existing.name) ||
    (input.departmentId && newDeptId !== existing.department_id)
  ) {
    const dupe = await ctx.sqlite
      .prepare(`SELECT id FROM team WHERE department_id = ? AND LOWER(name) = LOWER(?) AND id != ?`)
      .get(newDeptId, newName, teamId);
    if (dupe) {
      throw new DomainError(
        'DUPLICATE',
        `A team named '${newName}' already exists in this department.`,
        {
          httpStatus: 409,
        },
      );
    }
  }

  const leadId =
    input.leadEmployeeId !== undefined
      ? input.leadEmployeeId
      : (existing.lead_employee_id as string | null);

  if (leadId) {
    const lead = await ctx.sqlite.prepare(`SELECT id FROM employee WHERE id = ?`).get(leadId);
    if (!lead) {
      throw new DomainError('NOT_FOUND', 'Designated team lead does not exist.', {
        httpStatus: 404,
      });
    }
  }

  await ctx.sqlite
    .prepare(
      `UPDATE team
       SET department_id = ?,
           name = ?,
           lead_employee_id = ?,
           updated_at = ?,
           updated_by = ?
       WHERE id = ?`,
    )
    .run(newDeptId, newName, leadId, ctx.now, p.userId, teamId);

  await audit(ctx, 'team.updated', 'team', teamId, null, {
    changes: { departmentId: newDeptId, name: newName, leadEmployeeId: leadId },
  });

  return { id: teamId, departmentId: newDeptId, name: newName, leadEmployeeId: leadId };
}

export async function archiveTeam(ctx: RequestContext, teamId: string) {
  const p = requirePrincipal(ctx);
  await authorizeAction(ctx, 'org.structure.manage', null);

  const existing = (await ctx.sqlite.prepare(`SELECT * FROM team WHERE id = ?`).get(teamId)) as
    Record<string, unknown> | undefined;
  if (!existing) {
    throw new DomainError('NOT_FOUND', 'Team not found.', { httpStatus: 404 });
  }

  await withTx(ctx.sqlite, async () => {
    // Unlink members from team
    await ctx.sqlite
      .prepare(
        `UPDATE employee SET team_id = NULL, updated_at = ?, updated_by = ? WHERE team_id = ?`,
      )
      .run(ctx.now, p.userId, teamId);

    // Archive team
    await ctx.sqlite
      .prepare(`UPDATE team SET archived_at = ?, updated_at = ?, updated_by = ? WHERE id = ?`)
      .run(ctx.now, ctx.now, p.userId, teamId);

    await audit(ctx, 'team.archived', 'team', teamId, null, {});
  });

  return { id: teamId, archived: true };
}

export async function manageTeamMembers(
  ctx: RequestContext,
  teamId: string,
  input: {
    addEmployeeIds?: string[];
    removeEmployeeIds?: string[];
  },
) {
  const p = requirePrincipal(ctx);
  await authorizeAction(ctx, 'org.structure.manage', null);

  const team = (await ctx.sqlite.prepare(`SELECT * FROM team WHERE id = ?`).get(teamId)) as
    { id: string; department_id: string } | undefined;
  if (!team) throw new DomainError('NOT_FOUND', 'Team not found.', { httpStatus: 404 });

  await withTx(ctx.sqlite, async () => {
    if (input.removeEmployeeIds && input.removeEmployeeIds.length > 0) {
      for (const empId of input.removeEmployeeIds) {
        await ctx.sqlite
          .prepare(
            `UPDATE employee
             SET team_id = NULL,
                 version = version + 1,
                 updated_at = ?,
                 updated_by = ?
             WHERE id = ? AND team_id = ?`,
          )
          .run(ctx.now, p.userId, empId, teamId);
      }
    }

    if (input.addEmployeeIds && input.addEmployeeIds.length > 0) {
      for (const empId of input.addEmployeeIds) {
        await ctx.sqlite
          .prepare(
            `UPDATE employee
             SET team_id = ?,
                 department_id = ?,
                 version = version + 1,
                 updated_at = ?,
                 updated_by = ?
             WHERE id = ?`,
          )
          .run(teamId, team.department_id, ctx.now, p.userId, empId);
      }
    }

    await audit(ctx, 'team.members_updated', 'team', teamId, null, {
      teamId,
      added: input.addEmployeeIds ?? [],
      removed: input.removeEmployeeIds ?? [],
    });
  });

  return { id: teamId, success: true };
}
