import { z } from 'zod';

export const attendanceSourceSchema = z.enum(['login', 'import', 'all']);
export type AttendanceSource = z.infer<typeof attendanceSourceSchema>;

export const attendanceCorrectionFieldSchema = z.enum([
  'first_login_at',
  'last_login_at',
  'last_logout_at',
  'work_date',
  'notes',
]);
export type AttendanceCorrectionField = z.infer<typeof attendanceCorrectionFieldSchema>;

export const recordAttendanceCorrectionBodySchema = z.object({
  attendanceRawId: z.string().min(1),
  field: attendanceCorrectionFieldSchema,
  newValue: z.string().min(1),
  reason: z.string().min(3, 'Reason must be at least 3 characters'),
});
export type RecordAttendanceCorrectionBody = z.infer<typeof recordAttendanceCorrectionBodySchema>;

export const importAttendanceRowSchema = z.object({
  employeeCode: z.string().min(1),
  workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD format'),
  firstLoginAt: z.string().optional().nullable(),
  lastLoginAt: z.string().optional().nullable(),
  lastLogoutAt: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});
export type ImportAttendanceRow = z.infer<typeof importAttendanceRowSchema>;

export const importAttendanceBodySchema = z.object({
  rows: z.array(importAttendanceRowSchema).min(1, 'At least one row is required'),
});
export type ImportAttendanceBody = z.infer<typeof importAttendanceBodySchema>;
