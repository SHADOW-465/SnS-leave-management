import { applyCarryForwardCap } from './ledger.js';
import type { LeavePolicyRules } from './policy.js';
import { prorateJoinerHalfDays } from './accrual.js';

/**
 * What has to happen to one employee's balance for one leave type when a new leave
 * year begins.
 *
 * Balances are scoped to a leave period. When the leave year rolls over, a new period
 * exists and it has no ledger entries, so without this every balance reads zero. The
 * previous implementation had no rollover at all: on the first day of the leave year the
 * entire company lost its entitlement.
 */
export type RolloverPlan = {
  /** New entitlement for the opening period, before carry-forward. */
  grantHalfDays: number;
  /** Unused days carried into the new period, after the policy cap. */
  carriedHalfDays: number;
  /** Unused days that exceeded the cap and are lost. Recorded, not silently dropped. */
  expiredHalfDays: number;
  /** Date carried days lapse, or null when they never do. */
  carryExpiresOn: string | null;
};

export function planRollover(input: {
  rules: LeavePolicyRules;
  /** Remaining balance in the period that is ending. May be negative. */
  closingBalanceHalfDays: number;
  /** Employee joining date, for pro-rating a mid-year joiner. */
  joinedOn: string;
  /** First day of the new period, `YYYY-MM-DD`. */
  periodStartsOn: string;
  employeeStatus: string;
}): RolloverPlan {
  if (input.employeeStatus === 'exited') {
    return { grantHalfDays: 0, carriedHalfDays: 0, expiredHalfDays: 0, carryExpiresOn: null };
  }

  // `annual_grant` hands over the whole entitlement at the start of the year. `monthly`
  // is credited by the accrual job instead, so the opening grant is zero. `none` never
  // grants automatically.
  let grantHalfDays = 0;
  if (input.rules.accrualMethod === 'annual_grant') {
    grantHalfDays = input.rules.entitlementHalfDays;
    if (input.rules.midYearProrate && input.joinedOn > input.periodStartsOn) {
      grantHalfDays = prorateRemainingYear(
        input.rules.entitlementHalfDays,
        input.joinedOn,
        input.periodStartsOn,
      );
    }
  }

  // Only a positive closing balance can be carried. A negative balance (where the policy
  // allows one) is not carried as a debt; it stays recorded in the period it arose in.
  const { carried, expired } = applyCarryForwardCap(
    Math.max(0, input.closingBalanceHalfDays),
    input.rules.carryForwardCapHalfDays,
  );

  return {
    grantHalfDays,
    carriedHalfDays: carried,
    expiredHalfDays: expired,
    carryExpiresOn:
      carried > 0 && input.rules.carryForwardExpiryMonths > 0
        ? addMonths(input.periodStartsOn, input.rules.carryForwardExpiryMonths)
        : null,
  };
}

/** Entitlement for someone who joins part-way through a leave year. */
export function prorateRemainingYear(
  entitlementHalfDays: number,
  joinedOn: string,
  periodStartsOn: string,
): number {
  const start = Date.parse(`${periodStartsOn}T00:00:00Z`);
  const joined = Date.parse(`${joinedOn}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(joined) || joined <= start) return entitlementHalfDays;
  const yearEnd = Date.parse(`${addMonths(periodStartsOn, 12)}T00:00:00Z`);
  const total = yearEnd - start;
  if (total <= 0) return entitlementHalfDays;
  const remaining = Math.max(0, yearEnd - joined);
  return Math.round((entitlementHalfDays * remaining) / total);
}

/** Adds whole months, clamping to the last valid day (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

/** True when `today` is on or after the first day of a period that has no ledger yet. */
export function periodNeedsOpening(today: string, periodStartsOn: string): boolean {
  return today >= periodStartsOn;
}

export { prorateJoinerHalfDays };
