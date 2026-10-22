import { describe, expect, it } from 'vitest';
import { isoDate } from './common.js';

describe('isoDate', () => {
  it('accepts a real calendar date, including 29 February in a leap year', () => {
    expect(isoDate.safeParse('2026-10-22').success).toBe(true);
    expect(isoDate.safeParse('2028-02-29').success).toBe(true);
  });

  it('refuses a date that does not exist on the calendar', () => {
    for (const bad of ['2026-02-30', '2026-02-29', '2026-13-01', '2026-00-10', '2026-04-31']) {
      expect(isoDate.safeParse(bad).success, bad).toBe(false);
    }
  });
});
