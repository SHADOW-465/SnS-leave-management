import type { RoleCode } from '../authz/permissions.js';

export type ApproverKind =
  | 'team_lead'
  | 'department_head'
  | 'reporting_manager'
  | 'skip_level'
  | 'role'
  | 'specific_employee';

export type WorkflowStepDef = {
  stepNo: number;
  approverKind: ApproverKind;
  approverRef: string | null;
  slaHours: number;
};

export type EscalationReason =
  | 'no_team_lead'
  | 'no_department_head'
  | 'approver_is_requester'
  | 'approver_disabled'
  | 'approver_on_leave'
  | 'no_active_hr'
  | 'all_hr_disabled'
  | 'hr_on_leave'
  | 'sla_elapsed'
  | 'manager_not_senior';

export type RequesterKind =
  'employee' | 'team_lead' | 'department_head' | 'hr_officer' | 'director' | 'admin';

/**
 * The approval hierarchy, lowest to highest:
 *
 *   employee → team lead → manager (department head) → HR → Managing Director / Administrator
 *
 * Leave is always decided at a higher level than the person asking. HR's leave in
 * particular goes only to the Managing Director or an administrator — never to a manager.
 */
export const HIERARCHY_LEVEL: Record<RequesterKind, number> = {
  employee: 1,
  team_lead: 2,
  department_head: 3,
  hr_officer: 4,
  director: 5,
  admin: 5,
};

/** Who can be someone's reporting manager: the next level up (or the one above if it is empty). */
export function allowedManagerKinds(kind: RequesterKind): RequesterKind[] {
  switch (kind) {
    case 'employee':
      return ['team_lead', 'department_head'];
    case 'team_lead':
      return ['department_head'];
    case 'department_head':
      return ['hr_officer'];
    case 'hr_officer':
      return ['director', 'admin'];
    case 'director':
      return ['admin'];
    case 'admin':
      return ['director'];
  }
}

/**
 * Whether someone who is not the assigned approver may still decide (an HR or
 * administrator override). Only a higher level may: HR decides for managers and below, the
 * administrator for everyone. HR never decides another HR person's leave or the MD's.
 */
export function mayOverride(actor: RequesterKind, requester: RequesterKind): boolean {
  if (actor === 'admin') return true;
  return HIERARCHY_LEVEL[actor] > HIERARCHY_LEVEL[requester];
}

export function positionName(kind: RequesterKind): string {
  switch (kind) {
    case 'employee':
      return 'Employee';
    case 'team_lead':
      return 'Team lead';
    case 'department_head':
      return 'Manager';
    case 'hr_officer':
      return 'HR';
    case 'director':
      return 'Managing Director';
    case 'admin':
      return 'Administrator';
  }
}

/**
 * Where a person sits in the approval chain. Position in the org structure decides this,
 * not only the account's role: a team lead is an ordinary `employee` account that happens
 * to lead a team.
 */
export function requesterKindFrom(input: {
  roles: RoleCode[];
  /** The requester leads this team, if any. */
  leadsTeamId: string | null;
  /** The requester heads this department, if any. */
  headsDepartmentId: string | null;
}): RequesterKind {
  if (input.roles.includes('admin')) return 'admin';
  if (input.roles.includes('director')) return 'director';
  if (input.roles.includes('hr_officer')) return 'hr_officer';
  if (input.headsDepartmentId) return 'department_head';
  if (input.leadsTeamId) return 'team_lead';
  return 'employee';
}

/**
 * The escalation ladder, in order — each rung one level higher. The first rung that yields a
 * usable approver wins; a rung is skipped only for a real gap (nobody appointed, the person
 * asking, disabled or on leave).
 *
 *   employee        → team lead → manager → HR → Managing Director → administrator
 *   team lead       → manager → HR → Managing Director → administrator
 *   manager         → HR → Managing Director → administrator
 *   HR              → Managing Director → administrator
 *   Managing Dir.   → administrator
 *   administrator   → Managing Director → another administrator (else a recorded self-approval)
 */
export function approvalLadder(kind: RequesterKind): ApproverKind[] {
  switch (kind) {
    case 'employee':
      return ['team_lead', 'department_head', 'role', 'role', 'role'];
    case 'team_lead':
      return ['department_head', 'role', 'role', 'role'];
    case 'department_head':
      return ['role', 'role', 'role'];
    case 'hr_officer':
      return ['role', 'role'];
    case 'director':
      return ['role'];
    case 'admin':
      return ['role', 'role'];
  }
}

/** Which role each `role` rung means for this requester, in order. */
export function roleRungsFor(kind: RequesterKind): RoleCode[] {
  if (kind === 'hr_officer') return ['director', 'admin'];
  if (kind === 'director') return ['admin'];
  if (kind === 'admin') return ['director', 'admin'];
  return ['hr_officer', 'director', 'admin'];
}

export type ApproverCandidate = {
  userId: string;
  employeeId: string | null;
  isDisabled: boolean;
  onLeave: boolean;
};

export type ResolvedApprover = {
  approverUserId: string;
  approverEmployeeId: string | null;
  approverKind: ApproverKind;
  /** For a `role` rung, which role was used. Null for team lead / department head. */
  approverRole: RoleCode | null;
  /** Null when the first rung of the ladder was used. */
  escalation: EscalationReason | null;
  selfApproved: boolean;
  /**
   * When the usual approver has handed over to someone for a period, the employee they
   * handed over from. The request goes to the delegate; this records why.
   */
  delegatedFromEmployeeId: string | null;
};

/**
 * Walks the chain and returns the first usable approver.
 *
 * The person's **reporting manager**, when one is assigned, decides first. Only when
 * there is none, or they cannot decide (away, disabled, or the person asking), does the
 * request walk the ladder: team lead → department head → HR → administrator.
 *
 * A **delegation** hands one approver's decisions to someone else for a date range, so
 *   when a team lead is on holiday their team's leave goes to the cover they chose
 *   rather than jumping straight to the department head.
 *
 * A rung is skipped when nobody fills it, when everyone in it is disabled or on leave, or
 * when the only candidate is the requester — nobody approves their own leave, with the
 * single documented exception of a lone administrator, who has nobody above them.
 */
export function resolveApproverChain(input: {
  requesterUserId: string;
  requesterKind: RequesterKind;
  /** Candidates per rung, in ladder order. Missing rungs are empty arrays. */
  candidatesByKind: {
    team_lead: ApproverCandidate[];
    department_head: ApproverCandidate[];
    roles: Record<string, ApproverCandidate[]>;
  };
  /**
   * The requester's assigned reporting manager, with their position. It is used only when
   * they sit at the level directly above the requester; otherwise the ladder decides.
   */
  reportingManager?: (ApproverCandidate & { kind: RequesterKind }) | null;
  /** Active cover, keyed by the employee id of the approver who is handing over. */
  delegations?: Record<string, ApproverCandidate>;
}): ResolvedApprover {
  const delegations = input.delegations ?? {};
  let firstFailure: EscalationReason | null = null;
  let usedFirstRung = true;

  // Swap an approver for their cover when a delegation is active and the cover is usable.
  const withCover = (c: ApproverCandidate): { c: ApproverCandidate; from: string | null } => {
    const cover = c.employeeId ? delegations[c.employeeId] : undefined;
    if (cover && usable(cover, input.requesterUserId)) {
      return { c: cover, from: c.employeeId };
    }
    return { c, from: null };
  };

  if (
    input.reportingManager &&
    !allowedManagerKinds(input.requesterKind).includes(input.reportingManager.kind)
  ) {
    firstFailure = 'manager_not_senior';
    usedFirstRung = false;
  } else if (input.reportingManager) {
    const { c, from } = withCover(input.reportingManager);
    if (usable(c, input.requesterUserId)) {
      return {
        approverUserId: c.userId,
        approverEmployeeId: c.employeeId,
        approverKind: 'reporting_manager',
        approverRole: null,
        escalation: null,
        selfApproved: false,
        delegatedFromEmployeeId: from,
      };
    }
    firstFailure = rungFailureReason('reporting_manager', [c], input.requesterUserId);
    usedFirstRung = false;
  }

  const ladder = approvalLadder(input.requesterKind);
  const roleRungs = roleRungsFor(input.requesterKind);
  let roleIndex = 0;

  for (const rung of ladder) {
    let raw: ApproverCandidate[];
    let rungRole: RoleCode | null = null;
    if (rung === 'role') {
      rungRole = roleRungs[roleIndex] ?? roleRungs[roleRungs.length - 1] ?? 'admin';
      roleIndex += 1;
      raw = input.candidatesByKind.roles[rungRole] ?? [];
    } else if (rung === 'team_lead') {
      raw = input.candidatesByKind.team_lead;
    } else if (rung === 'department_head') {
      raw = input.candidatesByKind.department_head;
    } else {
      raw = [];
    }

    const covered = raw.map(withCover);
    const pool = covered.map((x) => x.c);
    const reason = rungFailureReason(rung, pool, input.requesterUserId);
    if (reason === null) {
      const index = pool.findIndex((c) => usable(c, input.requesterUserId));
      const chosen = covered[index]!;
      return {
        approverUserId: chosen.c.userId,
        approverEmployeeId: chosen.c.employeeId,
        approverKind: rung === 'role' ? 'role' : rung,
        approverRole: rungRole,
        escalation: usedFirstRung ? null : firstFailure,
        selfApproved: false,
        delegatedFromEmployeeId: chosen.from,
      };
    }
    firstFailure ??= reason;
    usedFirstRung = false;
  }

  // Nobody above them. Only an administrator may decide their own request, and it is
  // recorded as a self-approval so it is never mistaken for an ordinary one.
  if (input.requesterKind === 'admin') {
    return {
      approverUserId: input.requesterUserId,
      approverEmployeeId: null,
      approverKind: 'role',
      approverRole: 'admin',
      escalation: firstFailure,
      selfApproved: true,
      delegatedFromEmployeeId: null,
    };
  }
  throw new NoApproverError(firstFailure ?? 'no_active_hr');
}

function usable(c: ApproverCandidate, requesterUserId: string): boolean {
  return c.userId !== requesterUserId && !c.isDisabled && !c.onLeave;
}

function rungFailureReason(
  rung: ApproverKind,
  pool: ApproverCandidate[],
  requesterUserId: string,
): EscalationReason | null {
  if (pool.length === 0) {
    if (rung === 'team_lead') return 'no_team_lead';
    if (rung === 'department_head') return 'no_department_head';
    return 'no_active_hr';
  }
  const others = pool.filter((c) => c.userId !== requesterUserId);
  if (others.length === 0) return 'approver_is_requester';
  if (others.every((c) => c.isDisabled)) {
    return rung === 'role' ? 'all_hr_disabled' : 'approver_disabled';
  }
  if (others.every((c) => c.isDisabled || c.onLeave)) {
    return rung === 'role' ? 'hr_on_leave' : 'approver_on_leave';
  }
  return null;
}

export class NoApproverError extends Error {
  readonly reason: EscalationReason;
  constructor(reason: EscalationReason) {
    super('No approver is available for this request.');
    this.name = 'NoApproverError';
    this.reason = reason;
  }
}

/** Plain-English description of a chain, for the UI. */
export function describeApprover(kind: ApproverKind, roleCode?: string | null): string {
  switch (kind) {
    case 'team_lead':
      return 'Team lead';
    case 'department_head':
      return 'Department head';
    case 'reporting_manager':
      return 'Reporting manager';
    case 'skip_level':
      return "Manager's manager";
    case 'specific_employee':
      return 'Assigned approver';
    case 'role':
      return roleCode === 'admin'
        ? 'Administrator'
        : roleCode === 'director'
          ? 'Managing Director'
          : 'HR';
  }
}

export function describeEscalation(reason: EscalationReason): string {
  switch (reason) {
    case 'no_team_lead':
      return 'no team lead is appointed';
    case 'no_department_head':
      return 'no department head is appointed';
    case 'approver_is_requester':
      return 'the usual approver is the person asking';
    case 'approver_disabled':
      return 'the usual approver’s account is disabled';
    case 'approver_on_leave':
      return 'the usual approver is on leave';
    case 'no_active_hr':
      return 'no active HR account exists';
    case 'all_hr_disabled':
      return 'every HR account is disabled';
    case 'hr_on_leave':
      return 'HR is on leave';
    case 'sla_elapsed':
      return 'it was not decided in time';
    case 'manager_not_senior':
      return 'the assigned reporting manager is not above them in the hierarchy';
  }
}
