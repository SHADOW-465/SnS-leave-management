import { describe, expect, it } from 'vitest';
import {
  applyCarryForwardCap,
  deductionQuantity,
  holdQuantity,
  releaseQuantity,
  reverseQuantity,
  sumHalfDays,
} from './ledger.js';

describe('balance ledger arithmetic', () => {
  it('sums mixed entry types without floating point', () => {
    const sum = sumHalfDays([
      { entryType: 'ENTITLEMENT_GRANT', quantityHalfDays: 24 },
      { entryType: 'PENDING_HOLD', quantityHalfDays: -4 },
      { entryType: 'HOLD_RELEASE', quantityHalfDays: 4 },
      { entryType: 'DEDUCTION', quantityHalfDays: -4 },
      { entryType: 'ADJUSTMENT', quantityHalfDays: 1 },
    ]);
    expect(sum).toBe(21);
    expect(Number.isInteger(sum)).toBe(true);
  });

  it('pending hold reduces available', () => {
    const available = sumHalfDays([
      { entryType: 'OPENING', quantityHalfDays: 10 },
      { entryType: 'PENDING_HOLD', quantityHalfDays: holdQuantity(4) },
    ]);
    expect(available).toBe(6);
  });

  it('hold release restores', () => {
    const hold = { entryType: 'PENDING_HOLD' as const, quantityHalfDays: holdQuantity(4) };
    const available = sumHalfDays([
      { entryType: 'OPENING', quantityHalfDays: 10 },
      hold,
      { entryType: 'HOLD_RELEASE', quantityHalfDays: releaseQuantity(hold) },
    ]);
    expect(available).toBe(10);
  });

  it('deduction after approval', () => {
    const hold = { entryType: 'PENDING_HOLD' as const, quantityHalfDays: holdQuantity(4) };
    const available = sumHalfDays([
      { entryType: 'OPENING', quantityHalfDays: 10 },
      hold,
      { entryType: 'HOLD_RELEASE', quantityHalfDays: releaseQuantity(hold) },
      { entryType: 'DEDUCTION', quantityHalfDays: deductionQuantity(4) },
    ]);
    expect(available).toBe(6);
  });

  it('reversing entry undoes an adjustment', () => {
    const adj = 3;
    expect(
      sumHalfDays([
        { entryType: 'ADJUSTMENT', quantityHalfDays: adj },
        { entryType: 'ADJUSTMENT', quantityHalfDays: reverseQuantity(adj) },
      ]),
    ).toBe(0);
  });

  it('carry-forward cap truncates the remainder', () => {
    expect(applyCarryForwardCap(16, 10)).toEqual({ carried: 10, expired: 6 });
    expect(applyCarryForwardCap(10, 10)).toEqual({ carried: 10, expired: 0 });
    expect(applyCarryForwardCap(4, 10)).toEqual({ carried: 4, expired: 0 });
    expect(applyCarryForwardCap(-2, 10)).toEqual({ carried: 0, expired: 0 });
  });

  it('rejects non-integer quantities', () => {
    expect(() => sumHalfDays([{ entryType: 'OPENING', quantityHalfDays: 1.5 }])).toThrow(/integer/);
  });
});
