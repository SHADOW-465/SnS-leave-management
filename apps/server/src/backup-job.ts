import fs from 'node:fs';
import path from 'node:path';
import type { Db } from '@sns/database';
import { backupSettingsSchema, type BackupSettings } from '@sns/contracts';
import { newId } from '@sns/domain';
import { authorizeAction, type RequestContext } from './ctx.js';
import { createBackupFile } from './backup-file.js';

const KEY = 'ops.backup';
const GAP_MS = 20 * 60 * 60 * 1000;

export async function readBackupPolicy(
  sqlite: Db,
  fallbackDir: string,
  enabledByDefault = false,
): Promise<BackupSettings> {
  const defaults: BackupSettings = {
    enabled: enabledByDefault,
    directory: fallbackDir,
    retentionDays: 14,
  };
  const row = (await sqlite
    .prepare(`SELECT value_json FROM app_setting WHERE key = ?`)
    .get(KEY)) as { value_json: string } | undefined;
  if (!row) return defaults;
  try {
    const parsed = backupSettingsSchema.partial().safeParse(JSON.parse(row.value_json));
    if (!parsed.success) return defaults;
    return {
      ...defaults,
      ...parsed.data,
      directory: parsed.data.directory?.trim() ? parsed.data.directory : defaults.directory,
    };
  } catch {
    return defaults;
  }
}

export async function saveBackupPolicy(ctx: RequestContext, input: BackupSettings) {
  await authorizeAction(ctx, 'system.backup.create', null);
  const settings = backupSettingsSchema.parse(input);
  await ctx.sqlite
    .prepare(
      `INSERT INTO app_setting (key, value_json, updated_by, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    )
    .run(KEY, JSON.stringify(settings), ctx.principal?.userId ?? null, ctx.now);
  await ctx.sqlite
    .prepare(
      `INSERT INTO audit_event (id, occurred_at, actor_user_id, actor_label, action, entity_type, entity_id, after_json, request_id, ip, user_agent, result)
       VALUES (?, ?, ?, ?, 'ops.backup.updated', 'app_setting', ?, ?, ?, ?, ?, 'ok')`,
    )
    .run(
      newId(),
      ctx.now,
      ctx.principal?.userId ?? null,
      ctx.principal?.email ?? 'system',
      KEY,
      JSON.stringify(settings),
      ctx.requestId,
      ctx.ip,
      ctx.userAgent,
    );
  return settings;
}

export function pruneBackupFiles(
  directory: string,
  retentionDays: number,
  now = Date.now(),
): string[] {
  if (!fs.existsSync(directory)) return [];
  const cutoff = now - retentionDays * 24 * 60 * 60 * 1000;
  const removed: string[] = [];
  for (const name of fs.readdirSync(directory)) {
    if (!/^backup-[A-Za-z0-9._-]+\.db$/.test(name)) continue;
    const full = path.join(directory, name);
    if (fs.statSync(full).mtimeMs >= cutoff) continue;
    fs.rmSync(full);
    removed.push(full);
  }
  return removed;
}

export async function runScheduledBackup(
  sqlite: Db,
  fallbackDir: string,
  opts: { enabledByDefault?: boolean; now?: Date } = {},
): Promise<'postgres' | 'disabled' | 'skipped' | 'written'> {
  if (sqlite.dialect !== 'sqlite') return 'postgres';
  const now = opts.now ?? new Date();
  const settings = await readBackupPolicy(sqlite, fallbackDir, opts.enabledByDefault ?? false);
  if (!settings.enabled) return 'disabled';
  const last = (await sqlite
    .prepare(
      `SELECT started_at FROM backup_record WHERE trigger = 'scheduled' AND status = 'ok' ORDER BY started_at DESC LIMIT 1`,
    )
    .get()) as { started_at: string } | undefined;
  if (last && now.getTime() - Date.parse(last.started_at) < GAP_MS) return 'skipped';
  const directory = settings.directory.trim() || fallbackDir;
  await createBackupFile({ sqlite, backupsRoot: directory, now: now.toISOString() }, 'scheduled');
  pruneBackupFiles(directory, settings.retentionDays, now.getTime());
  return 'written';
}
