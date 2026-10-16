import fs from 'node:fs';
import { X509Certificate } from 'node:crypto';
import type { Db } from '@sns/database';
import { integrityCheck } from '@sns/database';

export type HostHealth = {
  at: string;
  integrity: string;
  backupAgeHours: number | null;
  certExpiresAt: string | null;
  diskFreeBytes: number | null;
};

export async function collectHealth(
  sqlite: Db,
  opts: { backupsRoot?: string; certPath?: string; now?: Date } = {},
): Promise<HostHealth> {
  const now = opts.now ?? new Date();
  let integrity = 'unknown';
  try {
    integrity = await integrityCheck(sqlite);
  } catch {
    integrity = 'unavailable';
  }
  let backupAgeHours: number | null = null;
  if (sqlite.dialect === 'sqlite') {
    const row = (await sqlite
      .prepare(
        `SELECT finished_at FROM backup_record WHERE status = 'ok' ORDER BY finished_at DESC LIMIT 1`,
      )
      .get()) as { finished_at: string | null } | undefined;
    if (row?.finished_at) {
      backupAgeHours = Math.max(0, (now.getTime() - Date.parse(row.finished_at)) / 3600000);
    }
  }
  let certExpiresAt: string | null = null;
  if (opts.certPath && fs.existsSync(opts.certPath)) {
    try {
      certExpiresAt = new X509Certificate(fs.readFileSync(opts.certPath)).validTo;
    } catch {
      certExpiresAt = null;
    }
  }
  let diskFreeBytes: number | null = null;
  const diskTarget = opts.backupsRoot ?? opts.certPath;
  if (diskTarget) {
    try {
      const stat = fs.statfsSync(diskTarget);
      diskFreeBytes = Number(stat.bavail) * Number(stat.bsize);
    } catch {
      diskFreeBytes = null;
    }
  }
  return {
    at: now.toISOString(),
    integrity,
    backupAgeHours,
    certExpiresAt,
    diskFreeBytes,
  };
}

export async function writeHealth(
  sqlite: Db,
  opts: { backupsRoot?: string; certPath?: string } = {},
): Promise<HostHealth> {
  const report = await collectHealth(sqlite, opts);
  if (sqlite.dialect === 'sqlite' || sqlite.dialect === 'postgres') {
    await sqlite
      .prepare(
        `INSERT INTO app_setting (key, value_json, updated_by, updated_at) VALUES ('host.health', ?, 'system', ?)
         ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
      )
      .run(JSON.stringify(report), report.at);
  }
  return report;
}
