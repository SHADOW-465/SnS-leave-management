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

/** Office LAN name. `sns-leave` is what staff type. `.local` is added for mDNS. */
export const DEFAULT_LAN_HOSTNAME = 'sns-leave';

export const lanHostnameSettingsSchema = z
  .object({
    hostname: z.preprocess(
      (value) => {
        if (typeof value !== 'string') return value;
        return value
          .trim()
          .toLowerCase()
          .replace(/\.local$/, '');
      },
      z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/),
    ),
  })
  .strict();

export type LanHostnameSettings = z.infer<typeof lanHostnameSettingsSchema>;

export const rebindDeviceBodySchema = z.object({ userId: z.string().min(1).max(40) }).strict();
