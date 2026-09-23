import { z } from 'zod';
import { isoDate, policyRulesSchema, ulid } from './common.js';

const note = z.string().trim().max(300).nullable().optional();

export const setApproverBodySchema = z
  .object({
    /** Null clears the appointment. */
    employeeId: ulid.nullable(),
  })
  .strict();

export const assignManagerBodySchema = z
  .object({
    employeeIds: z.array(ulid).min(1).max(500),
    /** Null clears it: their leave then goes to their team lead or department head. */
    managerEmployeeId: ulid.nullable(),
    /** Defaults to today. Earlier dates keep the history accurate. */
    effectiveFrom: isoDate.nullable().optional(),
    reason: note,
  })
  .strict();

export const createDelegationBodySchema = z
  .object({
    approverEmployeeId: ulid,
    delegateEmployeeId: ulid,
    startsOn: isoDate,
    endsOn: isoDate,
    note,
  })
  .strict();

export const reassignRequestBodySchema = z
  .object({
    approverEmployeeId: ulid,
    note,
  })
  .strict();

export const setRolesBodySchema = z
  .object({
    roles: z
      .array(
        z.enum([
          'employee',
          'manager',
          'hr_officer',
          'payroll_officer',
          'admin',
          'auditor',
          'director',
        ]),
      )
      .min(1, 'Choose at least one role.'),
  })
  .strict();

export const setDisabledBodySchema = z.object({ disabled: z.boolean() }).strict();

export const setAllowanceBodySchema = z
  .object({
    employeeIds: z.array(ulid).min(1).max(500),
    leaveTypeId: ulid,
    /** The yearly allowance to end up with, in half days. */
    allowanceHalfDays: z.number().int().min(0).max(730),
    reason: z.string().trim().min(3).max(300),
  })
  .strict();

export const updateAccountBodySchema = z
  .object({
    firstName: z.string().trim().min(1).max(80).optional(),
    lastName: z.string().trim().min(1).max(80).optional(),
    email: z.string().trim().email().max(254).optional(),
    employeeCode: z.string().trim().min(2).max(40).optional(),
    /** Required when the sign-in belongs to an employee. */
    expectedVersion: z.number().int().positive().optional(),
  })
  .strict();

export const createLoginBodySchema = z
  .object({
    employeeId: ulid,
    email: z.string().trim().email().max(254).nullable().optional(),
    roles: z
      .array(
        z.enum([
          'employee',
          'manager',
          'hr_officer',
          'payroll_officer',
          'admin',
          'auditor',
          'director',
        ]),
      )
      .max(6),
  })
  .strict();

export const createLeaveTypeBodySchema = z
  .object({
    name: z.string().trim().min(2).max(60),
    code: z.string().trim().min(2).max(8),
    isPaid: z.boolean(),
    /** Start from a template's rules (AL), or null for a custom type. */
    template: z.string().trim().max(8).nullable(),
    /** For a custom type: its rules straight away, instead of publishing them afterwards. */
    rules: policyRulesSchema.optional(),
    colour: z.string().max(40).optional(),
  })
  .strict();

export const updateLeaveTypeBodySchema = z
  .object({
    name: z.string().trim().min(2).max(60).optional(),
    isPaid: z.boolean().optional(),
    colour: z.string().max(40).optional(),
  })
  .strict();

export const workWeekBodySchema = z
  .object({ weekendDays: z.array(z.number().int().min(0).max(6)).max(3) })
  .strict();

export const bulkHolidayBodySchema = z
  .object({
    dates: z.array(isoDate).min(1).max(400),
    /** Null returns the days to normal. */
    kind: z.enum(['public', 'optional', 'declared_working']).nullable(),
    name: z.string().trim().max(120).optional(),
    calendarId: ulid.optional(),
  })
  .strict();

export const importHolidayRowSchema = z
  .object({
    date: isoDate,
    name: z.string().trim().min(2).max(120),
    kind: z.enum(['public', 'optional', 'declared_working']).default('public'),
  })
  .strict();

export const holidayFileBodySchema = z
  .object({
    filename: z.string().trim().min(1).max(200),
    /** The file itself, base64-encoded. Spreadsheets of holidays are tiny. */
    contentBase64: z.string().min(4).max(3_000_000),
    calendarId: ulid.optional(),
  })
  .strict();

export const importHolidaysBodySchema = z
  .object({
    rows: z.array(importHolidayRowSchema).min(1).max(400),
    calendarId: ulid.optional(),
  })
  .strict();
