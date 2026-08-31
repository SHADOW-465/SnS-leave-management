import { daysInMonth, monthIndex } from '../dates.js';
import type { LeavePolicyRules } from './policy.js';

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
