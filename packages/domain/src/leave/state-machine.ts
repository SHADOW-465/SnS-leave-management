import { DomainError } from '../errors.js';

export const LEAVE_STATUSES = [
  'draft',
  'submitted',
  'pending_approval',
  'approved',
  'rejected',
  'withdrawn',
  'cancellation_requested',
  'cancelled',
] as const;

export type LeaveStatus = (typeof LEAVE_STATUSES)[number];

export type TransitionActor = 'employee' | 'approver' | 'hr' | 'system';

export type LeaveTransition =
  | 'submit'
  | 'route'
  | 'approve_step'
  | 'approve_final'
  | 'reject'
  | 'withdraw'
  | 'discard'
  | 'request_cancellation'
  | 'approve_cancellation'
  | 'reject_cancellation'
  | 'hr_cancel';

type Edge = {
  from: LeaveStatus;
  to: LeaveStatus;
  action: LeaveTransition;
  actor: TransitionActor;
};

const EDGES: Edge[] = [
  { from: 'draft', to: 'submitted', action: 'submit', actor: 'employee' },
  { from: 'draft', to: 'draft', action: 'discard', actor: 'employee' },
  { from: 'submitted', to: 'pending_approval', action: 'route', actor: 'system' },
  { from: 'submitted', to: 'withdrawn', action: 'withdraw', actor: 'employee' },
  {
    from: 'pending_approval',
    to: 'pending_approval',
    action: 'approve_step',
    actor: 'approver',
  },
  {
    from: 'pending_approval',
    to: 'approved',
    action: 'approve_final',
    actor: 'approver',
  },
  { from: 'pending_approval', to: 'rejected', action: 'reject', actor: 'approver' },
  { from: 'pending_approval', to: 'withdrawn', action: 'withdraw', actor: 'employee' },
  {
    from: 'approved',
    to: 'cancellation_requested',
    action: 'request_cancellation',
    actor: 'employee',
  },
  {
    from: 'cancellation_requested',
    to: 'cancelled',
    action: 'approve_cancellation',
    actor: 'approver',
  },
  {
    from: 'cancellation_requested',
    to: 'approved',
    action: 'reject_cancellation',
    actor: 'approver',
  },
  { from: 'approved', to: 'cancelled', action: 'hr_cancel', actor: 'hr' },
];

export function isLeaveStatus(value: string): value is LeaveStatus {
  return (LEAVE_STATUSES as readonly string[]).includes(value);
}

export function canTransition(
  from: LeaveStatus,
  action: LeaveTransition,
  actor: TransitionActor,
): boolean {
  return EDGES.some((e) => e.from === from && e.action === action && e.actor === actor);
}

export function applyTransition(
  from: LeaveStatus,
  action: LeaveTransition,
  actor: TransitionActor,
): LeaveStatus {
  const edge = EDGES.find((e) => e.from === from && e.action === action && e.actor === actor);
  if (!edge) {
    throw new DomainError('LEAVE_ILLEGAL_TRANSITION', `Cannot ${action} a ${from} request.`, {
      httpStatus: 409,
    });
  }
  return edge.to;
}

/** Every (from, to) pair. Used by the 64-pair enumeration test. */
export function isLegalStatusPair(from: LeaveStatus, to: LeaveStatus): boolean {
  if (from === to) {
    return EDGES.some((e) => e.from === from && e.to === to);
  }
  return EDGES.some((e) => e.from === from && e.to === to);
}

export function legalEdges(): readonly Edge[] {
  return EDGES;
}
