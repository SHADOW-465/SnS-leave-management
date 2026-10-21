import { z } from 'zod';
import { email } from './common.js';

export const loginBodySchema = z
  .object({
    /** Username, work email, or employee ID. */
    email: z.string().trim().min(1).max(254),
    password: z.string().min(1).max(200),
    workstationId: z.string().min(1).max(200).optional(),
  })
  .strict();

export const changePasswordBodySchema = z
  .object({
    currentPassword: z.string().min(1).max(200),
    newPassword: z.string().min(12).max(200),
  })
  .strict();

function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const setupBodySchema = z
  .object({
    companyName: z.string().min(2).max(120),
    // An IANA name such as Asia/Kolkata. Every request computes "today" in it, so a name the
    // runtime rejects ("IST", "India Standard Time") would break the whole app after setup.
    timezone: z
      .string()
      .min(3)
      .max(80)
      .refine(isTimeZone, 'Use a time zone name such as Asia/Kolkata.'),
    leaveYearStartMonth: z.number().int().min(1).max(12),
    leaveYearStartDay: z.number().int().min(1).max(31),
    adminName: z.string().min(2).max(120),
    adminEmail: email,
    adminPassword: z.string().min(12).max(200),
    loadSampleData: z.boolean().default(false),
  })
  .strict();

export const sessionViewSchema = z
  .object({
    id: z.string(),
    email: z.string(),
    displayName: z.string(),
    roles: z.array(z.string()),
    permissions: z.array(z.string()),
    employeeId: z.string().nullable(),
    mustChangePassword: z.boolean(),
    companyName: z.string(),
    timezone: z.string(),
  })
  .strict();
