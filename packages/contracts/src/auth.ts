import { z } from 'zod';
import { email } from './common.js';

export const loginBodySchema = z
  .object({
    /** Work email or employee ID. */
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

export const setupBodySchema = z
  .object({
    companyName: z.string().min(2).max(120),
    timezone: z.string().min(3).max(80),
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
