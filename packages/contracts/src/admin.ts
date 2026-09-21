import { z } from 'zod';
import { isoDate, ulid } from './common.js';

const note = z.string().trim().max(300).nullable().optional();

export const setApproverBodySchema = z
  .object({
    /** Null clears the appointment. */
    employeeId: ulid.nullable(),
  })
  .strict();

export const setOverrideBodySchema = z
  .object({
    /** Null removes the override and the person follows their team and department again. */
    approverEmployeeId: ulid.nullable(),
    note,
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
      .array(z.enum(['employee', 'manager', 'hr_officer', 'payroll_officer', 'admin', 'auditor']))
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

export const bulkHolidayBodySchema = z
  .object({
    dates: z.array(isoDate).min(1).max(400),
    /** Null returns the days to normal. */
    kind: z.enum(['public', 'optional', 'declared_working']).nullable(),
    name: z.string().trim().max(120).optional(),
    calendarId: ulid.optional(),
  })
  .strict();
