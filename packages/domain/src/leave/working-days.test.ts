import { describe, expect, it } from 'vitest';
import { classifyRequestDays, totalCountedHalfDays } from './working-days.js';

const holidays = [
  { date: '2026-08-15', kind: 'public' as const, name: 'Independence Day' },
  { date: '2026-08-28', kind: 'optional' as const, name: 'Onam' },
  { date: '2026-09-12', kind: 'declared_working' as const, name: 'Stock count' },
];

describe('working-day calculation', () => {
  it('excludes weekends', () => {
    const days = classifyRequestDays({
      startDate: '2026-08-21',
      endDate: '2026-08-24',
      holidays: [],
    });
    expect(days.filter((d) => !d.isCounted).map((d) => d.date)).toEqual([
      '2026-08-22',
      '2026-08-23',
    ]);
    expect(totalCountedHalfDays(days)).toBe(4);
  });

  it('excludes public holidays', () => {
    const days = classifyRequestDays({
      startDate: '2026-08-14',
      endDate: '2026-08-17',
      holidays,
    });
    const skipped = days.find((d) => d.date === '2026-08-15');
    expect(skipped?.isCounted).toBe(false);
    expect(skipped?.skipReason).toBe('public_holiday');
  });

  it('does not auto-exclude optional holidays', () => {
    const days = classifyRequestDays({
      startDate: '2026-08-28',
      endDate: '2026-08-28',
      holidays,
    });
    expect(days[0]?.isCounted).toBe(true);
  });

  it('counts declared_working weekends', () => {
    const days = classifyRequestDays({
      startDate: '2026-09-12',
      endDate: '2026-09-12',
      holidays,
    });
    expect(dayOfWeekSafe('2026-09-12')).toBe(6);
    expect(days[0]?.isCounted).toBe(true);
  });

  it('handles a range that is entirely holidays', () => {
    const days = classifyRequestDays({
      startDate: '2026-08-15',
      endDate: '2026-08-15',
      holidays,
    });
    expect(totalCountedHalfDays(days)).toBe(0);
  });

  it('counts a single working day as 2 half-days', () => {
    const days = classifyRequestDays({
      startDate: '2026-08-24',
      endDate: '2026-08-24',
      holidays: [],
    });
    expect(totalCountedHalfDays(days)).toBe(2);
  });

  it('crosses a year boundary', () => {
    const days = classifyRequestDays({
      startDate: '2026-12-31',
      endDate: '2027-01-02',
      holidays: [],
    });
    expect(days.map((d) => d.date)).toEqual(['2026-12-31', '2027-01-01', '2027-01-02']);
  });

  it('AM-only half-day is 1 half-day', () => {
    const days = classifyRequestDays({
      startDate: '2026-08-24',
      endDate: '2026-08-24',
      holidays: [],
      halfDayStart: 'am',
    });
    expect(days[0]?.portion).toBe('am');
    expect(totalCountedHalfDays(days)).toBe(1);
  });

  it('PM-only half-day is 1 half-day', () => {
    const days = classifyRequestDays({
      startDate: '2026-08-24',
      endDate: '2026-08-24',
      holidays: [],
      halfDayEnd: 'pm',
    });
    expect(totalCountedHalfDays(days)).toBe(1);
  });

  it('does not count a half-day on a holiday', () => {
    const days = classifyRequestDays({
      startDate: '2026-08-15',
      endDate: '2026-08-15',
      holidays,
      halfDayStart: 'am',
    });
    expect(totalCountedHalfDays(days)).toBe(0);
  });
});

function dayOfWeekSafe(iso: string): number {
  return new Date(iso + 'T00:00:00Z').getUTCDay();
}
