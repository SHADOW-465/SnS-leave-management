import { z } from 'zod';

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
export const email = z.string().email().max(320);
export const ulid = z.string().min(16).max(40);
export const cursorQuery = z
  .object({
    cursor: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();

export const leaveStatus = z.enum([
  'draft',
  'submitted',
  'pending_approval',
  'approved',
  'rejected',
  'withdrawn',
  'cancellation_requested',
  'cancelled',
]);

export const dayPortion = z.enum(['full', 'am', 'pm']);

export const policyRulesSchema = z
  .object({
    entitlementHalfDays: z.number().int().min(0).max(400),
    accrualMethod: z.enum(['none', 'monthly', 'annual_grant']),
    accrualCadenceMonths: z.number().int().min(1).max(12),
    midYearProrate: z.boolean(),
    carryForwardCapHalfDays: z.number().int().min(0).max(400),
    carryForwardExpiryMonths: z.number().int().min(0).max(24),
    probationRestriction: z.enum(['none', 'forbid', 'limited']),
    probationMaxHalfDays: z.number().int().min(0).max(400),
    halfDaysAllowed: z.boolean(),
    minNoticeDays: z.number().int().min(0).max(90),
    maxConsecutiveDays: z.number().int().min(1).max(365),
    negativeBalanceAllowed: z.boolean(),
    attachmentRequiredAfterHalfDays: z.number().int().min(0).max(400).nullable(),
  })
  .strict();
