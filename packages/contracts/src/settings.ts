import { z } from 'zod';

/** Office device-binding switches. Stored in app_setting and editable by an administrator. */
export const deviceBindingSettingsSchema = z
  .object({
    enabled: z.boolean(),
    requireApproval: z.boolean(),
    ipMatch: z.boolean(),
  })
  .strict();

export type DeviceBindingSettings = z.infer<typeof deviceBindingSettingsSchema>;

/** Where daily SQLite copies go, and how long they are kept. */
export const backupSettingsSchema = z
  .object({
    enabled: z.boolean(),
    directory: z.string().max(500),
    retentionDays: z.number().int().min(1).max(3650),
  })
  .strict();

export type BackupSettings = z.infer<typeof backupSettingsSchema>;

export const rebindDeviceBodySchema = z.object({ userId: z.string().min(1).max(40) }).strict();
