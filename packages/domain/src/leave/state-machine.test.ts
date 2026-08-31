import { describe, expect, it } from 'vitest';
import { LEAVE_STATUSES, applyTransition, isLegalStatusPair, legalEdges } from './state-machine.js';

describe('leave state machine', () => {
  it('allows every legal transition', () => {
    expect(applyTransition('draft', 'submit', 'employee')).toBe('submitted');
    expect(applyTransition('submitted', 'route', 'system')).toBe('pending_approval');
    expect(applyTransition('pending_approval', 'approve_final', 'approver')).toBe('approved');
    expect(applyTransition('pending_approval', 'reject', 'approver')).toBe('rejected');
    expect(applyTransition('pending_approval', 'withdraw', 'employee')).toBe('withdrawn');
    expect(applyTransition('approved', 'request_cancellation', 'employee')).toBe(
      'cancellation_requested',
    );
    expect(applyTransition('cancellation_requested', 'approve_cancellation', 'approver')).toBe(
      'cancelled',
    );
    expect(applyTransition('approved', 'hr_cancel', 'hr')).toBe('cancelled');
  });

  it('rejects illegal transitions', () => {
    expect(() => applyTransition('approved', 'reject', 'approver')).toThrow(/Cannot reject/);
    expect(() => applyTransition('rejected', 'approve_final', 'approver')).toThrow();
    expect(() => applyTransition('cancelled', 'withdraw', 'employee')).toThrow();
  });

  it('enumerates all 64 from/to pairs', () => {
    const legal = new Set(legalEdges().map((e) => `${e.from}->${e.to}`));
    let pairs = 0;
    for (const from of LEAVE_STATUSES) {
      for (const to of LEAVE_STATUSES) {
        pairs += 1;
        const allowed = isLegalStatusPair(from, to);
        if (allowed) {
          expect(legal.has(`${from}->${to}`) || from === to).toBe(true);
        }
      }
    }
    expect(pairs).toBe(64);
  });

  it('rejects the wrong actor even on a legal edge', () => {
    expect(() => applyTransition('pending_approval', 'approve_final', 'employee')).toThrow();
  });
});
