import { describe, expect, it } from 'vitest';
import {
  NoApproverError,
  approvalLadder,
  requesterKindFrom,
  resolveApproverChain,
  roleRungsFor,
  type ApproverCandidate,
} from './routing.js';

const ok = (userId: string): ApproverCandidate => ({
  userId,
  employeeId: `emp-${userId}`,
  isDisabled: false,
  onLeave: false,
});
const away = (userId: string): ApproverCandidate => ({ ...ok(userId), onLeave: true });
const disabled = (userId: string): ApproverCandidate => ({ ...ok(userId), isDisabled: true });

function chain(
  requesterUserId: string,
  requesterKind: Parameters<typeof resolveApproverChain>[0]['requesterKind'],
  parts: Partial<{
    team_lead: ApproverCandidate[];
    department_head: ApproverCandidate[];
    roles: Record<string, ApproverCandidate[]>;
  }> = {},
) {
  return resolveApproverChain({
    requesterUserId,
    requesterKind,
    candidatesByKind: {
      team_lead: parts.team_lead ?? [],
      department_head: parts.department_head ?? [],
      roles: parts.roles ?? {},
    },
  });
}

describe('where a person sits in the chain', () => {
  it('reads position from the org chart, not only the account role', () => {
    expect(
      requesterKindFrom({ roles: ['employee'], leadsTeamId: null, headsDepartmentId: null }),
    ).toBe('employee');
    // An ordinary employee account that happens to lead a team is a team lead.
    expect(
      requesterKindFrom({ roles: ['employee'], leadsTeamId: 't1', headsDepartmentId: null }),
    ).toBe('team_lead');
    expect(
      requesterKindFrom({ roles: ['employee'], leadsTeamId: 't1', headsDepartmentId: 'd1' }),
    ).toBe('department_head');
  });

  it('lets an HR or admin role outrank an org position', () => {
    expect(
      requesterKindFrom({ roles: ['hr_officer'], leadsTeamId: 't1', headsDepartmentId: null }),
    ).toBe('hr_officer');
    expect(
      requesterKindFrom({ roles: ['admin'], leadsTeamId: null, headsDepartmentId: 'd1' }),
    ).toBe('admin');
  });
});

describe('the ladder', () => {
  it('starts a member at their team lead, not at HR', () => {
    expect(approvalLadder('employee')[0]).toBe('team_lead');
  });

  it('starts a team lead at their department head', () => {
    expect(approvalLadder('team_lead')[0]).toBe('department_head');
  });

  it('sends HR only to the Managing Director or an administrator, never back to HR', () => {
    expect(roleRungsFor('hr_officer')).toEqual(['director', 'admin']);
    expect(roleRungsFor('employee')).toEqual(['hr_officer', 'director', 'admin']);
    expect(approvalLadder('hr_officer')).not.toContain('department_head');
    expect(approvalLadder('hr_officer')).not.toContain('team_lead');
  });

  it('follows ADMIN/MD → HR → manager → team lead → employee', () => {
    expect(approvalLadder('employee').slice(0, 2)).toEqual(['team_lead', 'department_head']);
    expect(approvalLadder('department_head')[0]).toBe('role');
    expect(roleRungsFor('department_head')[0]).toBe('hr_officer');
  });
});

describe('resolving an approver', () => {
  it('routes a member to their team lead, leaving HR out of it', () => {
    const r = chain('u-amina', 'employee', {
      team_lead: [ok('u-ravi')],
      department_head: [ok('u-sofia')],
      roles: { hr_officer: [ok('u-helen')], admin: [ok('u-ada')] },
    });
    expect(r.approverUserId).toBe('u-ravi');
    expect(r.approverKind).toBe('team_lead');
    expect(r.escalation).toBeNull();
  });

  it('escalates to the department head when no lead is appointed', () => {
    const r = chain('u-amina', 'employee', {
      department_head: [ok('u-sofia')],
      roles: { hr_officer: [ok('u-helen')], admin: [ok('u-ada')] },
    });
    expect(r.approverUserId).toBe('u-sofia');
    expect(r.escalation).toBe('no_team_lead');
  });

  it('escalates past a lead who is on leave', () => {
    const r = chain('u-amina', 'employee', {
      team_lead: [away('u-ravi')],
      department_head: [ok('u-sofia')],
      roles: { hr_officer: [ok('u-helen')] },
    });
    expect(r.approverUserId).toBe('u-sofia');
    expect(r.escalation).toBe('approver_on_leave');
  });

  it('escalates past a lead whose account is disabled', () => {
    const r = chain('u-amina', 'employee', {
      team_lead: [disabled('u-ravi')],
      department_head: [ok('u-sofia')],
      roles: { hr_officer: [ok('u-helen')] },
    });
    expect(r.escalation).toBe('approver_disabled');
  });

  it('never routes a lead to themselves', () => {
    // Ravi leads Platform and is asking. His own rung must be skipped.
    const r = chain('u-ravi', 'team_lead', {
      team_lead: [ok('u-ravi')],
      department_head: [ok('u-sofia')],
      roles: { hr_officer: [ok('u-helen')] },
    });
    expect(r.approverUserId).toBe('u-sofia');
  });

  it('sends a department head to HR', () => {
    const r = chain('u-sofia', 'department_head', {
      department_head: [ok('u-sofia')],
      roles: { hr_officer: [ok('u-helen')], admin: [ok('u-ada')] },
    });
    expect(r.approverUserId).toBe('u-helen');
  });

  it('sends HR to the Managing Director first, then an administrator', () => {
    const md = chain('u-helen', 'hr_officer', {
      department_head: [ok('u-sofia')],
      roles: { director: [ok('u-rajesh')], admin: [ok('u-ada')] },
    });
    expect(md.approverUserId).toBe('u-rajesh');
    const noMd = chain('u-helen', 'hr_officer', {
      department_head: [ok('u-sofia')],
      roles: { admin: [ok('u-ada')] },
    });
    expect(noMd.approverUserId).toBe('u-ada');
    expect(noMd.selfApproved).toBe(false);
  });

  it('never sends HR leave to a manager, even one assigned as their reporting manager', () => {
    const r = resolveApproverChain({
      requesterUserId: 'u-helen',
      requesterKind: 'hr_officer',
      candidatesByKind: {
        team_lead: [],
        department_head: [ok('u-sofia')],
        roles: { director: [ok('u-rajesh')], admin: [ok('u-ada')] },
      },
      reportingManager: { ...ok('u-sofia'), kind: 'department_head' },
    });
    expect(r.approverUserId).toBe('u-rajesh');
    expect(r.escalation).toBe('manager_not_senior');
  });

  it('prefers a second administrator over self-approval', () => {
    const r = chain('u-ada', 'admin', { roles: { admin: [ok('u-ada'), ok('u-ben')] } });
    expect(r.approverUserId).toBe('u-ben');
    expect(r.selfApproved).toBe(false);
  });

  it('allows a lone administrator to self-approve, and marks it', () => {
    const r = chain('u-ada', 'admin', { roles: { admin: [ok('u-ada')] } });
    expect(r.approverUserId).toBe('u-ada');
    expect(r.selfApproved).toBe(true);
  });

  it('falls all the way through to an administrator when nothing else exists', () => {
    const r = chain('u-amina', 'employee', { roles: { admin: [ok('u-ada')] } });
    expect(r.approverUserId).toBe('u-ada');
    expect(r.escalation).toBe('no_team_lead');
  });

  it('refuses rather than inventing an approver when the chain is empty', () => {
    expect(() => chain('u-amina', 'employee')).toThrow(NoApproverError);
  });

  it('reports the first reason it had to escalate, not the last', () => {
    const r = chain('u-amina', 'employee', {
      department_head: [ok('u-sofia')],
      roles: { hr_officer: [ok('u-helen')] },
    });
    expect(r.escalation).toBe('no_team_lead');
  });
});

describe('administrator controls', () => {
  const org = {
    team_lead: [ok('u-ravi')],
    department_head: [ok('u-sofia')],
    roles: { hr_officer: [ok('u-helen')], admin: [ok('u-ada')] },
  };

  it('the reporting manager beats the team structure', () => {
    const r = resolveApproverChain({
      requesterUserId: 'u-amina',
      requesterKind: 'employee',
      candidatesByKind: org,
      reportingManager: { ...ok('u-ravi2'), kind: 'department_head' },
    });
    expect(r.approverUserId).toBe('u-ravi2');
    expect(r.approverKind).toBe('reporting_manager');
    expect(r.escalation).toBeNull();
  });

  it('a reporting manager who is away falls back to the normal chain and says why', () => {
    const r = resolveApproverChain({
      requesterUserId: 'u-amina',
      requesterKind: 'employee',
      candidatesByKind: org,
      reportingManager: { ...away('u-ravi2'), kind: 'department_head' },
    });
    expect(r.approverUserId).toBe('u-ravi');
    expect(r.escalation).toBe('approver_on_leave');
  });

  it('a reporting manager who is the requester is ignored', () => {
    const r = resolveApproverChain({
      requesterUserId: 'u-amina',
      requesterKind: 'employee',
      candidatesByKind: org,
      reportingManager: { ...ok('u-amina'), kind: 'team_lead' },
    });
    expect(r.approverUserId).toBe('u-ravi');
  });

  it('delegation sends a lead’s decisions to their cover instead of skipping up', () => {
    const r = resolveApproverChain({
      requesterUserId: 'u-amina',
      requesterKind: 'employee',
      candidatesByKind: { ...org, team_lead: [away('u-ravi')] },
      delegations: { 'emp-u-ravi': ok('u-paul') },
    });
    expect(r.approverUserId).toBe('u-paul');
    expect(r.approverKind).toBe('team_lead');
    expect(r.delegatedFromEmployeeId).toBe('emp-u-ravi');
  });

  it('a delegate who is unavailable does not block the normal escalation', () => {
    const r = resolveApproverChain({
      requesterUserId: 'u-amina',
      requesterKind: 'employee',
      candidatesByKind: { ...org, team_lead: [away('u-ravi')] },
      delegations: { 'emp-u-ravi': disabled('u-paul') },
    });
    expect(r.approverUserId).toBe('u-sofia');
    expect(r.delegatedFromEmployeeId).toBeNull();
  });

  it('never delegates a request to the person asking', () => {
    const r = resolveApproverChain({
      requesterUserId: 'u-paul',
      requesterKind: 'employee',
      candidatesByKind: org,
      delegations: { 'emp-u-ravi': ok('u-paul') },
    });
    expect(r.approverUserId).toBe('u-ravi');
  });
});
