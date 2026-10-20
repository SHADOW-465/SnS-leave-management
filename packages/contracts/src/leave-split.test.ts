import { describe, expect, it } from 'vitest';
import { splitLeaveDays } from './leave-split.js';

const split = (availableHalfDays: number, requestedHalfDays: number) =>
  splitLeaveDays({ availableHalfDays, requestedHalfDays });

describe('splitLeaveDays', () => {
  it('is all paid when the balance covers the request', () => {
    expect(split(10, 4)).toEqual({ paidHalfDays: 4, lopHalfDays: 0 });
    expect(split(4, 4)).toEqual({ paidHalfDays: 4, lopHalfDays: 0 });
  });
  it('makes the shortfall loss of pay', () => {
    expect(split(4, 10)).toEqual({ paidHalfDays: 4, lopHalfDays: 6 });
  });
  it('handles half days: 1.5 days left, 2.5 days asked', () => {
    expect(split(3, 5)).toEqual({ paidHalfDays: 3, lopHalfDays: 2 });
    expect(split(1, 1)).toEqual({ paidHalfDays: 1, lopHalfDays: 0 });
    expect(split(1, 3)).toEqual({ paidHalfDays: 1, lopHalfDays: 2 });
  });
  it('is all loss of pay at a zero balance', () => {
    expect(split(0, 6)).toEqual({ paidHalfDays: 0, lopHalfDays: 6 });
  });
  it('treats a negative balance as zero, and never returns negative days', () => {
    expect(split(-4, 2)).toEqual({ paidHalfDays: 0, lopHalfDays: 2 });
    expect(split(5, 0)).toEqual({ paidHalfDays: 0, lopHalfDays: 0 });
    expect(split(5, -2)).toEqual({ paidHalfDays: 0, lopHalfDays: 0 });
  });
  it('always adds back up to the request', () => {
    for (let a = -2; a <= 8; a++)
      for (let r = 0; r <= 8; r++) {
        const s = split(a, r);
        expect(s.paidHalfDays + s.lopHalfDays).toBe(r);
      }
  });
});
