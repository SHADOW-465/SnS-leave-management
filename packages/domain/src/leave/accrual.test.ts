import { describe, expect, it } from 'vitest';
import { monthCreditHalfDays, monthlyRateHalfDays } from './accrual.js';
import { DEFAULT_POLICY, parseRules } from './policy.js';

const rules = { ...DEFAULT_POLICY, entitlementHalfDays: 48, accrualMethod: 'monthly' as const };

describe('monthly rate by staff category', () => {
  it('uses the standard rate by default: 24 days a year is 2 days a month', () => {
    expect(monthlyRateHalfDays(rules, { categoryCode: 'PERM', onProbation: false })).toBe(4);
  });
  it('gives a category its own rate, e.g. management 2.5 days a month', () => {
    const r = { ...rules, categoryMonthlyHalfDays: { MGMT: 5 } };
    expect(monthlyRateHalfDays(r, { categoryCode: 'MGMT', onProbation: false })).toBe(5);
    expect(monthlyRateHalfDays(r, { categoryCode: 'PERM', onProbation: false })).toBe(4);
  });
  it('uses the probation rate while on probation, whatever the category', () => {
    const r = { ...rules, categoryMonthlyHalfDays: { MGMT: 5 }, probationMonthlyHalfDays: 2 };
    expect(monthlyRateHalfDays(r, { categoryCode: 'MGMT', onProbation: true })).toBe(2);
  });
});

describe('joining month', () => {
  const base = { rateHalfDays: 4, joinedOn: '2026-09-15', monthIso: '2026-09' };
  it('full: the whole month', () => {
    expect(monthCreditHalfDays({ ...base, joinMonthAccrual: 'full' })).toBe(4);
  });
  it('none: nothing until next month', () => {
    expect(monthCreditHalfDays({ ...base, joinMonthAccrual: 'none' })).toBe(0);
  });
  it('prorated: 16 of 30 days is about half the month', () => {
    expect(monthCreditHalfDays({ ...base, joinMonthAccrual: 'prorated' })).toBe(2);
  });
  it('later months always get the full rate', () => {
    expect(monthCreditHalfDays({ ...base, monthIso: '2026-10', joinMonthAccrual: 'none' })).toBe(4);
  });
});

describe('stored rules', () => {
  it('fills settings added after a version was published', () => {
    const r = parseRules(JSON.stringify({ entitlementHalfDays: 20 }));
    expect(r.entitlementHalfDays).toBe(20);
    expect(r.excludeWeekends).toBe(true);
    expect(r.categoryMonthlyHalfDays).toEqual({});
  });
});
