import { z } from 'zod';
import { dayPortion, isoDate, policyRulesSchema, ulid } from './common.js';

export const previewLeaveQuerySchema = z
  .object({
    leaveTypeId: ulid,
    startDate: isoDate,
    endDate: isoDate,
    halfDayStart: dayPortion.optional(),
    halfDayEnd: dayPortion.optional(),
    employeeId: ulid.optional(),
  })
  .strict();

export const submitLeaveBodySchema = z
  .object({
    leaveTypeId: ulid,
    startDate: isoDate,
    endDate: isoDate,
    halfDayStart: dayPortion.nullable().optional(),
    halfDayEnd: dayPortion.nullable().optional(),
    reason: z.string().min(3).max(2000),
    employeeId: ulid.optional(),
    attachmentId: ulid.nullable().optional(),
  })
  .strict();

export const decideLeaveBodySchema = z
  .object({
    note: z.string().max(2000).optional(),
    expectedVersion: z.number().int().positive(),
  })
  .strict();

export const rejectLeaveBodySchema = z
  .object({
    reason: z.string().min(3).max(2000),
    expectedVersion: z.number().int().positive(),
  })
  .strict();

export const cancelLeaveBodySchema = z
  .object({
    reason: z.string().min(3).max(2000),
    expectedVersion: z.number().int().positive(),
  })
  .strict();

export const adjustBalanceBodySchema = z
  .object({
    employeeId: ulid,
    leaveTypeId: ulid,
    quantityHalfDays: z.number().int(),
    reason: z.string().min(3).max(2000),
  })
  .strict();

export const publishPolicyBodySchema = z
  .object({
    leaveTypeId: ulid,
    effectiveFrom: isoDate,
    rules: policyRulesSchema,
  })
  .strict();

export const leaveYearBodySchema = z
  .object({
    startMonth: z.number().int().min(1).max(12),
    startDay: z.number().int().min(1).max(31),
    confirm: z.literal(true),
  })
  .strict();

export const holidayBodySchema = z
  .object({
    date: isoDate,
    name: z.string().min(2).max(120),
    kind: z.enum(['public', 'optional', 'declared_working']),
    calendarId: ulid.optional(),
  })
  .strict();
