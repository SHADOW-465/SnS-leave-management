import { daysInMonth, monthIndex } from '../dates.js';
import type { JoinMonthAccrual, LeavePolicyRules } from './policy.js';

export function monthlyAccrualHalfDays(entitlementHalfDays: number): number {
  // Nearest half-day of entitlement/12.
  const exact = entitlementHalfDays / 12;
  return Math.round(exact);
}

export function prorateJoinerHalfDays(input: {
  entitlementHalfDays: number;
  joinedOn: string;
  monthIso: string;
}): number {
  const full = monthlyAccrualHalfDays(input.entitlementHalfDays);
  const joined = monthIndex(input.joinedOn);
  const month = monthIndex(input.monthIso + '-01');
  if (joined.year !== month.year || joined.month !== month.month) {
    return full;
  }
  const dim = daysInMonth(joined.year, joined.month);
  const remaining = dim - Number(input.joinedOn.slice(8, 10)) + 1;
  return Math.round((full * remaining) / dim);
}

export function shouldAccrue(input: {
  rules: LeavePolicyRules;
  employeeStatus: string;
  onProbation: boolean;
}): boolean {
  if (input.employeeStatus === 'exited') return false;
  if (input.rules.accrualMethod === 'none') return false;
  if (input.onProbation && input.rules.probationRestriction === 'forbid') return false;
  return true;
}

export function capAccrual(
  currentHalfDays: number,
  grantHalfDays: number,
  capHalfDays: number,
): number {
  if (capHalfDays <= 0) return grantHalfDays;
  const room = capHalfDays - currentHalfDays;
  if (room <= 0) return 0;
  return Math.min(grantHalfDays, room);
}

/**
 * The monthly credit for one person: the probation rate while on probation (if one is
 * set), else their staff category's rate (if one is set), else the standard rate.
 */
/** Whole years of service completed on `asOf`. The anniversary month counts once the day is reached. */
export function completedServiceYears(joinedOn: string, asOf: string): number {
  let years = Number(asOf.slice(0, 4)) - Number(joinedOn.slice(0, 4));
  const anniversary = `${asOf.slice(0, 4)}-${joinedOn.slice(5, 10)}`;
  if (asOf < anniversary) years -= 1;
  return Math.max(0, years);
}

export function monthlyRateHalfDays(
  rules: LeavePolicyRules,
  who: {
    categoryCode: string | null;
    onProbation: boolean;
    yearsOfService?: number;
    fresher?: boolean;
  },
): number {
  if (who.onProbation && who.fresher && rules.probationFresherMonthlyHalfDays != null) {
    return rules.probationFresherMonthlyHalfDays;
  }
  if (who.onProbation && !who.fresher && rules.probationExperiencedMonthlyHalfDays != null) {
    return rules.probationExperiencedMonthlyHalfDays;
  }
  if (who.onProbation && rules.probationMonthlyHalfDays != null) {
    return rules.probationMonthlyHalfDays;
  }
  const byCategory = who.categoryCode
    ? rules.categoryMonthlyHalfDays?.[who.categoryCode]
    : undefined;
  if (byCategory != null) return byCategory;
  const years = who.yearsOfService ?? 0;
  if (rules.confirmedFromMonthlyHalfDays != null && years >= rules.confirmedTenureYears) {
    return rules.confirmedFromMonthlyHalfDays;
  }
  if (rules.confirmedUnderMonthlyHalfDays != null) return rules.confirmedUnderMonthlyHalfDays;
  return monthlyAccrualHalfDays(rules.entitlementHalfDays);
}

/**
 * What a month is worth to someone: the full rate, except in the month they join, where
 * the policy decides between the full month, a pro-rated share, or nothing.
 */
export function monthCreditHalfDays(input: {
  rateHalfDays: number;
  joinMonthAccrual: JoinMonthAccrual;
  joinedOn: string;
  monthIso: string;
}): number {
  if (input.joinedOn.slice(0, 7) !== input.monthIso) return input.rateHalfDays;
  if (input.joinMonthAccrual === 'none') return 0;
  if (input.joinMonthAccrual === 'full') return input.rateHalfDays;
  const joined = monthIndex(input.joinedOn);
  const dim = daysInMonth(joined.year, joined.month);
  const remaining = dim - Number(input.joinedOn.slice(8, 10)) + 1;
  return Math.round((input.rateHalfDays * remaining) / dim);
}
