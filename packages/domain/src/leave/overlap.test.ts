import { describe, expect, it } from 'vitest';
import { leaveRangesOverlap } from './overlap.js';

describe('leaveRangesOverlap', () => {
  it('rejects two full-day ranges that share a date', () => {
    expect(
      leaveRangesOverlap(
        { startDate: '2026-09-10', endDate: '2026-09-12' },
        { startDate: '2026-09-12', endDate: '2026-09-14' },
      ),
    ).toBe(true);
  });

  it('allows ranges that do not touch', () => {
    expect(
      leaveRangesOverlap(
        { startDate: '2026-09-10', endDate: '2026-09-11' },
        { startDate: '2026-09-12', endDate: '2026-09-13' },
      ),
    ).toBe(false);
  });

  it('allows morning and afternoon on the same day', () => {
    expect(
      leaveRangesOverlap(
        { startDate: '2026-09-10', endDate: '2026-09-10', halfDayStart: 'am' },
        { startDate: '2026-09-10', endDate: '2026-09-10', halfDayStart: 'pm' },
      ),
    ).toBe(false);
  });

  it('rejects two mornings on the same day', () => {
    expect(
      leaveRangesOverlap(
        { startDate: '2026-09-10', endDate: '2026-09-10', halfDayStart: 'am' },
        { startDate: '2026-09-10', endDate: '2026-09-10', halfDayStart: 'am' },
      ),
    ).toBe(true);
  });
});
