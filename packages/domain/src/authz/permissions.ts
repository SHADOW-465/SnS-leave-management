export const SCOPES = [
  'self',
  'direct_reports',
  'reports_recursive',
  'team',
  'department',
  'location',
  'company',
] as const;

export type Scope = (typeof SCOPES)[number];

export type PermissionCode = `${string}.${string}:${Scope}`;

export const PERMISSIONS = [
  'employee.read:self',
  'employee.read:reports_recursive',
  'employee.read:team',
  'employee.read:company',
  'employee.create:company',
  'employee.update:self',
  'employee.update:company',
  'employee.archive:company',
  'employee.field.payroll.read:self',
  'employee.field.payroll.read:company',
  'employee.field.payroll.update:company',
  'employee.field.identity.read:self',
  'employee.field.identity.read:company',
  'employee.field.contact.read:self',
  'employee.field.contact.read:direct_reports',
  'employee.field.contact.read:company',
  'org.structure.read:company',
  'org.structure.manage:company',
  'leave.request.create:self',
  'leave.request.create:direct_reports',
  'leave.request.create:reports_recursive',
  'leave.request.create:team',
  'leave.request.create:company',
  'workstation.manage:company',
  'leave.request.read:self',
  'leave.request.read:reports_recursive',
  'leave.request.read:company',
  'leave.request.approve:company',
  'leave.request.reject:company',
  'leave.request.self_approve:self',
  'leave.request.withdraw:self',
  'leave.request.cancel:company',
  'leave.balance.read:self',
  'leave.balance.read:direct_reports',
  'leave.balance.read:company',
  'leave.balance.adjust:company',
  'leave.policy.read:company',
  'leave.policy.manage:company',
  'holiday.calendar.read:company',
  'holiday.calendar.manage:company',
  'approval.workflow.manage:company',
  // Who approves whom: overrides, cover while someone is away, appointing leads and heads,
  // and reassigning a stuck request. Deliberately separate from org.structure.manage so
  // HR can maintain departments and teams without deciding the approval chain.
  'approval.routing.manage:company',
  'team.availability.read:team',
  'team.availability.read:reports_recursive',
  'team.availability.read:company',
  'attachment.upload:self',
  'attachment.upload:company',
  'attachment.read:self',
  'attachment.read:direct_reports',
  'attachment.read:company',
  'attachment.medical.read:self',
  'attachment.medical.read:company',
  'attendance.import:company',
  'attendance.read:self',
  'attendance.read:direct_reports',
  'attendance.read:company',
  'attendance.correct:direct_reports',
  'attendance.correct:company',
  'report.leave.view:reports_recursive',
  'report.leave.view:company',
  'report.export:reports_recursive',
  'report.export:company',
  'payroll.export:company',
  'notification.read:self',
  'audit.read:company',
  'user.account.read:self',
  'user.account.read:company',
  'user.account.create:company',
  'user.account.disable:company',
  'user.password.reset:company',
  'user.session.revoke:self',
  'user.session.revoke:company',
  'role.assign:company',
  'system.config.manage:company',
  'system.backup.create:company',
  'system.backup.restore:company',
  'system.health.read:company',
  'system.logs.read:company',
  'data.export.full:company',
  'import.run:company',
] as const satisfies readonly PermissionCode[];

export type KnownPermission = (typeof PERMISSIONS)[number];

export function parsePermission(code: string): {
  resource: string;
  action: string;
  scope: Scope;
} {
  const [left, scope] = code.split(':');
  const dot = left?.lastIndexOf('.') ?? -1;
  if (!left || !scope || dot <= 0) {
    throw new Error(`Invalid permission: ${code}`);
  }
  return {
    resource: left.slice(0, dot),
    action: left.slice(dot + 1),
    scope: scope as Scope,
  };
}

export const ROLE_CODES = [
  'employee',
  'manager',
  'hr_officer',
  'payroll_officer',
  'admin',
  'auditor',
  'director',
] as const;

export type RoleCode = (typeof ROLE_CODES)[number];

const SCOPE_RANK: Record<Scope, number> = {
  self: 0,
  direct_reports: 1,
  reports_recursive: 2,
  team: 3,
  department: 4,
  location: 5,
  company: 6,
};

export function scopeAtLeast(held: Scope, needed: Scope): boolean {
  return SCOPE_RANK[held] >= SCOPE_RANK[needed];
}
