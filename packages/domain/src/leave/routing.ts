import type { RoleCode } from '../authz/permissions.js';

export type ApproverKind =
  'reporting_manager' | 'skip_level' | 'department_head' | 'role' | 'specific_employee';

export type WorkflowStepDef = {
  stepNo: number;
  approverKind: ApproverKind;
  approverRef: string | null;
  slaHours: number;
};

export type EscalationReason = 'no_active_hr' | 'all_hr_disabled' | 'hr_on_leave' | 'sla_elapsed';

export type RequesterKind = 'employee' | 'manager' | 'hr_officer' | 'admin';

export function requesterKindFromRoles(roles: RoleCode[]): RequesterKind {
  if (roles.includes('admin')) return 'admin';
  if (roles.includes('hr_officer')) return 'hr_officer';
  if (roles.includes('manager')) return 'manager';
  return 'employee';
}

/**
 * Default D-08/D-09 configuration expressed as workflow steps.
 * Managers do not approve. Engine remains general.
 */
export function defaultWorkflowSteps(kind: RequesterKind): WorkflowStepDef[] {
  if (kind === 'hr_officer' || kind === 'admin') {
    return [{ stepNo: 1, approverKind: 'role', approverRef: 'admin', slaHours: 48 }];
  }
  return [{ stepNo: 1, approverKind: 'role', approverRef: 'hr_officer', slaHours: 48 }];
}

export function resolveEscalation(input: {
  hasActiveHr: boolean;
  allHrDisabled: boolean;
  assignedHrOnLeave: boolean;
  slaElapsed: boolean;
}): EscalationReason | null {
  if (!input.hasActiveHr) return 'no_active_hr';
  if (input.allHrDisabled) return 'all_hr_disabled';
  if (input.assignedHrOnLeave) return 'hr_on_leave';
  if (input.slaElapsed) return 'sla_elapsed';
  return null;
}

export function shouldSelfApprove(input: {
  requesterUserId: string;
  candidateApproverUserIds: string[];
  requesterIsAdmin: boolean;
}): { approverUserId: string; selfApproved: boolean } {
  const others = input.candidateApproverUserIds.filter((id) => id !== input.requesterUserId);
  if (others.length > 0) {
    const first = others[0];
    if (!first) throw new Error('expected approver');
    return { approverUserId: first, selfApproved: false };
  }
  if (input.requesterIsAdmin) {
    return { approverUserId: input.requesterUserId, selfApproved: true };
  }
  const fallback = input.candidateApproverUserIds[0];
  if (!fallback) throw new Error('No approver available');
  return { approverUserId: fallback, selfApproved: false };
}
