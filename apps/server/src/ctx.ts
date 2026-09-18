import type { AppConfig } from '@sns/config';
import type { Db } from '@sns/database';
import {
  ForbiddenError,
  NotAuthenticatedError,
  authorize,
  collectReports,
  newId,
  permissionsForRoles,
  type EmployeeGraphNode,
  type Principal,
  type RoleCode,
} from '@sns/domain';
import { todayInTimeZone } from './time.js';
export type RequestContext = {
  requestId: string;
  sqlite: Db;
  config: AppConfig;
  principal: Principal | null;
  ip: string;
  userAgent: string;
  now: string;
  today: string;
  attachmentsRoot: string;
  backupsRoot: string;
};
export function requirePrincipal(ctx: RequestContext): Principal {
  if (!ctx.principal) throw new NotAuthenticatedError();
  return ctx.principal;
}
export async function loadPrincipal(sqlite: Db, userId: string): Promise<Principal | null> {
  const user = (await sqlite
    .prepare(
      `SELECT ua.id, ua.email, ua.employee_id, ua.is_disabled, e.location_id, e.department_id, e.team_id
       FROM user_account ua
       LEFT JOIN employee e ON e.id = ua.employee_id
       WHERE ua.id = ?`,
    )
    .get(userId)) as
    | {
        id: string;
        email: string;
        employee_id: string | null;
        is_disabled: number;
        location_id: string | null;
        department_id: string | null;
        team_id: string | null;
      }
    | undefined;
  if (!user || user.is_disabled) return null;
  const roles = (
    await sqlite
      .prepare(
        `SELECT r.code FROM user_role ur JOIN role r ON r.id = ur.role_id WHERE ur.user_account_id = ?`,
      )
      .all(userId)
  ).map(
    (r) =>
      (
        r as {
          code: RoleCode;
        }
      ).code,
  );
  if (user.employee_id) {
    const isLeadOrHead = await sqlite
      .prepare(
        `SELECT 1 FROM team WHERE lead_employee_id = ? AND archived_at IS NULL
         UNION
         SELECT 1 FROM department WHERE head_employee_id = ? AND archived_at IS NULL
         UNION
         SELECT 1 FROM employee WHERE manager_employee_id = ?
         LIMIT 1`,
      )
      .get(user.employee_id, user.employee_id, user.employee_id);
    if (isLeadOrHead && !roles.includes('manager')) {
      roles.push('manager');
    }
  }
  return {
    userId: user.id,
    employeeId: user.employee_id,
    email: user.email,
    roles,
    permissions: permissionsForRoles(roles),
    locationId: user.location_id,
    departmentId: user.department_id,
    teamId: user.team_id,
  };
}
export async function graphFor(sqlite: Db, actorEmployeeId: string | null) {
  const employees = (await sqlite
    .prepare(
      `SELECT id, manager_employee_id AS managerEmployeeId, location_id AS locationId,
              department_id AS departmentId, team_id AS teamId FROM employee`,
    )
    .all()) as EmployeeGraphNode[];
  if (!actorEmployeeId) {
    return { employees, reports: new Set<string>(), recursiveReports: new Set<string>() };
  }
  const g = collectReports(employees, actorEmployeeId);
  return { employees, ...g };
}
export async function authorizeAction(
  ctx: RequestContext,
  resourceAction: string,
  targetEmployeeId: string | null,
): Promise<void> {
  const principal = requirePrincipal(ctx);
  const graph = await graphFor(ctx.sqlite, principal.employeeId);
  const target =
    targetEmployeeId === null
      ? null
      : (graph.employees.find((e) => e.id === targetEmployeeId) ??
        ({
          id: targetEmployeeId,
          managerEmployeeId: null,
          locationId: null,
          departmentId: null,
          teamId: null,
        } satisfies EmployeeGraphNode));
  try {
    authorize(principal, resourceAction, target, graph);
  } catch (err) {
    if (err instanceof ForbiddenError) {
      await ctx.sqlite
        .prepare(
          `INSERT INTO audit_event (id, occurred_at, actor_user_id, actor_label, action, entity_type, entity_id, request_id, ip, user_agent, result)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'denied')`,
        )
        .run(
          newId(),
          ctx.now,
          principal.userId,
          principal.email,
          resourceAction,
          'authorization',
          targetEmployeeId,
          ctx.requestId,
          ctx.ip,
          ctx.userAgent,
        );
    }
    throw err;
  }
}
export async function companyToday(ctx: RequestContext): Promise<string> {
  const company = (await ctx.sqlite
    .prepare('SELECT timezone FROM company WHERE id = ?')
    .get('company')) as
    | {
        timezone: string;
      }
    | undefined;
  return todayInTimeZone(company?.timezone ?? 'UTC');
}
