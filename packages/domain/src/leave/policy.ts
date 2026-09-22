import { DomainError } from '../errors.js';
import { compareIsoDate } from '../dates.js';
import type { DayPortion } from './working-days.js';

export type AccrualMethod = 'none' | 'monthly' | 'annual_grant';
export type ProbationRestriction = 'none' | 'forbid' | 'limited';
/** What someone earns for the month they join in. */
export type JoinMonthAccrual = 'full' | 'prorated' | 'none';

export type LeavePolicyRules = {
  entitlementHalfDays: number;
  accrualMethod: AccrualMethod;
  accrualCadenceMonths: number;
  midYearProrate: boolean;
  carryForwardCapHalfDays: number;
  carryForwardExpiryMonths: number;
  probationRestriction: ProbationRestriction;
  probationMaxHalfDays: number;
  halfDaysAllowed: boolean;
  minNoticeDays: number;
  maxConsecutiveDays: number;
  negativeBalanceAllowed: boolean;
  /** null = never required. Counted working half-days. */
  attachmentRequiredAfterHalfDays: number | null;
  /** Weekends inside a request are not counted as leave. */
  excludeWeekends: boolean;
  /** Public holidays inside a request are not counted as leave. */
  excludeHolidays: boolean;
  /** Monthly accrual for the joining month: the full month, pro-rated, or nothing. */
  joinMonthAccrual: JoinMonthAccrual;
  /**
   * Monthly credit (half-days) by staff category — the employment type code — when it
   * differs from the standard rate. e.g. { MGMT: 5 } gives management 2.5 days a month.
   */
  categoryMonthlyHalfDays: Record<string, number>;
  /** Monthly credit while on probation; null = same as everyone else. */
  probationMonthlyHalfDays: number | null;
  /** Accrual stops once the balance reaches this; 0 = no ceiling. */
  maxBalanceHalfDays: number;
};

export const DEFAULT_POLICY: LeavePolicyRules = {
  entitlementHalfDays: 24,
  accrualMethod: 'annual_grant',
  accrualCadenceMonths: 12,
  midYearProrate: true,
  carryForwardCapHalfDays: 10,
  carryForwardExpiryMonths: 3,
  probationRestriction: 'limited',
  probationMaxHalfDays: 6,
  halfDaysAllowed: true,
  minNoticeDays: 0,
  maxConsecutiveDays: 15,
  negativeBalanceAllowed: false,
  attachmentRequiredAfterHalfDays: 6,
  excludeWeekends: true,
  excludeHolidays: true,
  joinMonthAccrual: 'prorated',
  categoryMonthlyHalfDays: {},
  probationMonthlyHalfDays: null,
  maxBalanceHalfDays: 0,
};

/**
 * Reads stored rules. Versions published before a setting existed simply lack it, so every
 * missing field falls back to the default rather than arriving as undefined.
 */
export function parseRules(raw: string | Partial<LeavePolicyRules>): LeavePolicyRules {
  const obj = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Partial<LeavePolicyRules>;
  return { ...DEFAULT_POLICY, ...obj, categoryMonthlyHalfDays: obj.categoryMonthlyHalfDays ?? {} };
}

export function defaultRulesForCode(code: string): LeavePolicyRules {
  const base = { ...DEFAULT_POLICY };
  switch (code) {
    case 'CL':
      return { ...base, entitlementHalfDays: 24, attachmentRequiredAfterHalfDays: null };
    case 'SL':
      return { ...base, entitlementHalfDays: 24, attachmentRequiredAfterHalfDays: 6 };
    case 'EL':
      return {
        ...base,
        // Functional framework default: 2 days credited each month, 24 days a year.
        entitlementHalfDays: 48,
        accrualMethod: 'monthly',
        accrualCadenceMonths: 1,
        halfDaysAllowed: false,
        minNoticeDays: 7,
        attachmentRequiredAfterHalfDays: null,
      };
    case 'LOP':
      return {
        ...base,
        entitlementHalfDays: 0,
        accrualMethod: 'none',
        negativeBalanceAllowed: true,
        probationRestriction: 'none',
        attachmentRequiredAfterHalfDays: null,
      };
    default:
      return base;
  }
}

export function validatePolicyAgainstRequest(input: {
  rules: LeavePolicyRules;
  countedHalfDays: number;
  startDate: string;
  today: string;
  joinedOn: string;
  probationEndOn: string | null;
  employeeStatus: string;
  halfDayStart: DayPortion | null;
  halfDayEnd: DayPortion | null;
  hasAttachment: boolean;
  availableHalfDays: number;
}): void {
  const { rules } = input;

  if ((input.halfDayStart || input.halfDayEnd) && !rules.halfDaysAllowed) {
    throw new DomainError('LEAVE_HALF_DAY_FORBIDDEN', 'This leave type does not allow half-days.', {
      details: [{ path: 'duration', message: 'Half-days are not permitted for this type.' }],
    });
  }

  if (input.countedHalfDays <= 0) {
    throw new DomainError('LEAVE_NO_WORKING_DAYS', 'These dates contain no working days.', {
      details: [{ path: 'endDate', message: 'Choose dates that include a working day.' }],
    });
  }

  const consecutiveDays = input.countedHalfDays / 2;
  if (consecutiveDays > rules.maxConsecutiveDays) {
    throw new DomainError(
      'LEAVE_MAX_CONSECUTIVE',
      `This type allows at most ${rules.maxConsecutiveDays} consecutive days.`,
      { details: [{ path: 'endDate', message: 'Shorten the range.' }] },
    );
  }

  if (rules.minNoticeDays > 0) {
    const minStart = addDaysSafe(input.today, rules.minNoticeDays);
    if (compareIsoDate(input.startDate, minStart) < 0) {
      throw new DomainError(
        'LEAVE_MIN_NOTICE',
        `This type needs ${rules.minNoticeDays} days of notice.`,
        { details: [{ path: 'startDate', message: 'Choose a later start date.' }] },
      );
    }
  }

  const onProbation =
    input.employeeStatus === 'probation' ||
    (input.probationEndOn !== null && compareIsoDate(input.startDate, input.probationEndOn) < 0);

  if (onProbation && rules.probationRestriction === 'forbid') {
    throw new DomainError(
      'LEAVE_PROBATION_FORBIDDEN',
      'This leave type cannot be taken during probation.',
    );
  }

  if (onProbation && rules.probationRestriction === 'limited') {
    if (input.countedHalfDays > rules.probationMaxHalfDays) {
      throw new DomainError(
        'LEAVE_PROBATION_CAP',
        'This request exceeds the probation allowance for this type.',
      );
    }
  }

  const needAttachment =
    rules.attachmentRequiredAfterHalfDays !== null &&
    input.countedHalfDays >= rules.attachmentRequiredAfterHalfDays;
  if (needAttachment && !input.hasAttachment) {
    throw new DomainError(
      'LEAVE_ATTACHMENT_REQUIRED',
      'An attachment is required for this request.',
      { details: [{ path: 'attachment', message: 'Upload the required document.' }] },
    );
  }

  if (!rules.negativeBalanceAllowed && input.countedHalfDays > input.availableHalfDays) {
    const short = (input.countedHalfDays - input.availableHalfDays) / 2;
    throw new DomainError('LEAVE_INSUFFICIENT_BALANCE', 'Not enough leave for these dates.', {
      details: [
        {
          path: 'endDate',
          message: `Exceeds available balance by ${short} day(s).`,
        },
      ],
    });
  }
}

function addDaysSafe(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}
