import { z } from 'zod';
import { email, isoDate, ulid } from './common.js';

export const employeeStatus = z.enum(['active', 'probation', 'notice', 'exited', 'suspended']);

export const createEmployeeBodySchema = z
  .object({
    employeeCode: z.string().min(2).max(40),
    firstName: z.string().min(1).max(80),
    lastName: z.string().min(1).max(80),
    workEmail: email,
    joinedOn: isoDate,
    probationEndOn: isoDate.nullable().optional(),
    locationId: ulid,
    departmentId: ulid,
    teamId: ulid.nullable().optional(),
    managerEmployeeId: ulid.nullable().optional(),
    jobTitleId: ulid,
    employmentTypeId: ulid,
    phone: z.string().trim().max(20).optional(),
    hireBackground: z.enum(['fresher', 'experienced']).optional(),
    createAccount: z.boolean().default(true),
    username: z
      .string()
      .trim()
      .min(2)
      .max(40)
      .regex(/^[a-zA-Z0-9._-]+$/, 'Username can only use letters, numbers, dots, _ and -')
      .optional(),
    password: z.string().min(12).max(200).optional(),
    /** Sign-in roles. Defaults to Employee. Only an administrator may include Administrator. */
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
      .max(6)
      .optional(),
  })
  .strict();

export const updateEmployeeBodySchema = z
  .object({
    employeeCode: z.string().min(2).max(40).optional(),
    firstName: z.string().min(1).max(80).optional(),
    lastName: z.string().min(1).max(80).optional(),
    workEmail: email.optional(),
    joinedOn: isoDate.optional(),
    departmentId: ulid.optional(),
    teamId: ulid.nullable().optional(),
    managerEmployeeId: ulid.nullable().optional(),
    locationId: ulid.optional(),
    jobTitleId: ulid.optional(),
    employmentTypeId: ulid.optional(),
    probationEndOn: isoDate.nullable().optional(),
    status: employeeStatus.optional(),
    phone: z.string().trim().max(20).nullable().optional(),
    managerEffectiveFrom: isoDate.nullable().optional(),
    expectedVersion: z.number().int().positive(),
  })
  .strict();

export const deactivateEmployeeBodySchema = z
  .object({
    reason: z.string().min(3).max(500),
    exitedOn: isoDate,
    expectedVersion: z.number().int().positive(),
  })
  .strict();

export const reactivateEmployeeBodySchema = z
  .object({
    expectedVersion: z.number().int().positive(),
  })
  .strict();

export const createDepartmentBodySchema = z
  .object({
    name: z.string().min(1).max(80),
    code: z.string().min(1).max(20),
    headEmployeeId: ulid.nullable().optional(),
  })
  .strict();

export const updateDepartmentBodySchema = z
  .object({
    name: z.string().min(1).max(80).optional(),
    code: z.string().min(1).max(20).optional(),
    headEmployeeId: ulid.nullable().optional(),
  })
  .strict();

export const createTeamBodySchema = z
  .object({
    departmentId: ulid,
    name: z.string().min(1).max(80),
    leadEmployeeId: ulid.nullable().optional(),
  })
  .strict();

export const updateTeamBodySchema = z
  .object({
    departmentId: ulid.optional(),
    name: z.string().min(1).max(80).optional(),
    leadEmployeeId: ulid.nullable().optional(),
  })
  .strict();

export const teamMembersBodySchema = z
  .object({
    addEmployeeIds: z.array(ulid).optional(),
    removeEmployeeIds: z.array(ulid).optional(),
  })
  .strict();

export const departmentMembersBodySchema = teamMembersBodySchema;

export const orgUnitBodySchema = z
  .object({
    name: z.string().min(1).max(80),
    code: z.string().min(1).max(20).optional(),
  })
  .strict();

export const bulkProvisionBodySchema = z
  .object({
    employeeIds: z.array(ulid).min(1).max(250),
  })
  .strict();
