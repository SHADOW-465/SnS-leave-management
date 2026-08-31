import { ForbiddenError } from '../errors.js';
import { parsePermission, scopeAtLeast, type RoleCode, type Scope } from './permissions.js';
import { ROLE_PERMISSIONS } from './roles.js';

export type Principal = {
  userId: string;
  employeeId: string | null;
  email: string;
  roles: RoleCode[];
  permissions: string[];
  locationId: string | null;
  departmentId: string | null;
  teamId: string | null;
};

export type EmployeeGraphNode = {
  id: string;
  managerEmployeeId: string | null;
  locationId: string | null;
  departmentId: string | null;
  teamId: string | null;
};

export type TargetRef = {
  employeeId: string | null;
};

export function permissionsForRoles(roles: RoleCode[]): string[] {
  const set = new Set<string>();
  for (const r of roles) {
    for (const p of ROLE_PERMISSIONS[r]) set.add(p);
  }
  return [...set];
}

export function holds(
  principal: Principal,
  resourceAction: string,
  neededScope: Scope = 'company',
): boolean {
  return principal.permissions.some((p) => {
    const parsed = parsePermission(p);
    const held = `${parsed.resource}.${parsed.action}`;
    return held === resourceAction && scopeAtLeast(parsed.scope, neededScope);
  });
}

export function matchingPermissions(
  principal: Principal,
  resourceAction: string,
): { scope: Scope }[] {
  return principal.permissions
    .map((p) => parsePermission(p))
    .filter((p) => `${p.resource}.${p.action}` === resourceAction)
    .map((p) => ({ scope: p.scope }));
}

export function targetInScope(input: {
  scope: Scope;
  actor: Principal;
  target: EmployeeGraphNode | null;
  reports: Set<string>;
  recursiveReports: Set<string>;
}): boolean {
  const { scope, actor, target } = input;
  if (scope === 'company') return true;
  if (!actor.employeeId) return false;
  if (!target) return false;
  if (scope === 'self') return target.id === actor.employeeId;
  if (scope === 'direct_reports') {
    return target.id === actor.employeeId || input.reports.has(target.id);
  }
  if (scope === 'reports_recursive') {
    return target.id === actor.employeeId || input.recursiveReports.has(target.id);
  }
  if (scope === 'team') {
    return Boolean(actor.teamId) && target.teamId === actor.teamId;
  }
  if (scope === 'department') {
    return Boolean(actor.departmentId) && target.departmentId === actor.departmentId;
  }
  if (scope === 'location') {
    return Boolean(actor.locationId) && target.locationId === actor.locationId;
  }
  return false;
}

export function authorize(
  principal: Principal,
  resourceAction: string,
  target: EmployeeGraphNode | null,
  graph: { reports: Set<string>; recursiveReports: Set<string> },
): void {
  const matches = matchingPermissions(principal, resourceAction);
  if (matches.length === 0) {
    throw new ForbiddenError();
  }
  const ok = matches.some((m) =>
    targetInScope({
      scope: m.scope,
      actor: principal,
      target,
      reports: graph.reports,
      recursiveReports: graph.recursiveReports,
    }),
  );
  if (!ok) throw new ForbiddenError();
}

export function collectReports(
  employees: EmployeeGraphNode[],
  managerId: string,
): { reports: Set<string>; recursiveReports: Set<string> } {
  const byManager = new Map<string, string[]>();
  for (const e of employees) {
    if (!e.managerEmployeeId) continue;
    const list = byManager.get(e.managerEmployeeId) ?? [];
    list.push(e.id);
    byManager.set(e.managerEmployeeId, list);
  }
  const reports = new Set(byManager.get(managerId) ?? []);
  const recursiveReports = new Set<string>();
  const stack = [...reports];
  while (stack.length) {
    const id = stack.pop()!;
    if (recursiveReports.has(id)) continue;
    recursiveReports.add(id);
    for (const child of byManager.get(id) ?? []) stack.push(child);
  }
  return { reports, recursiveReports };
}

export function assertNoManagerCycle(
  employees: { id: string; managerEmployeeId: string | null }[],
  employeeId: string,
  newManagerId: string | null,
): void {
  if (!newManagerId) return;
  if (newManagerId === employeeId) {
    throw new Error('An employee cannot be their own manager.');
  }
  const map = new Map(employees.map((e) => [e.id, e.managerEmployeeId]));
  map.set(employeeId, newManagerId);
  const seen = new Set<string>();
  let cursor: string | null = newManagerId;
  while (cursor) {
    if (cursor === employeeId) {
      throw new Error('Reporting graph contains a cycle.');
    }
    if (seen.has(cursor)) break;
    seen.add(cursor);
    cursor = map.get(cursor) ?? null;
  }
}
