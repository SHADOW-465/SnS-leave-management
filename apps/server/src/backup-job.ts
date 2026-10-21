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
    retentionCount: 14,
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

/** Stores the backup settings. The host panel calls this directly: it is loopback-only and has no signed-in user. */
export async function writeBackupPolicy(sqlite: Db, input: BackupSettings, actor: string) {
  const settings = backupSettingsSchema.parse(input);
  const now = new Date().toISOString();
  await sqlite
    .prepare(
      `INSERT INTO app_setting (key, value_json, updated_by, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    )
    .run(KEY, JSON.stringify(settings), actor, now);
  await sqlite
    .prepare(
      `INSERT INTO audit_event (id, occurred_at, actor_user_id, actor_label, action, entity_type, entity_id, after_json, result)
       VALUES (?, ?, NULL, ?, 'ops.backup.updated', 'app_setting', ?, ?, 'ok')`,
    )
    .run(newId(), now, actor, KEY, JSON.stringify(settings));
  return settings;
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

/** Keeps the newest `keep` backup files in the folder and removes the rest. Other files are never touched. */
export function pruneBackupFiles(directory: string, keep: number): string[] {
  if (!fs.existsSync(directory)) return [];
  const files = fs
    .readdirSync(directory)
    .filter((name) => /^backup-[A-Za-z0-9._-]+\.db$/.test(name))
    .map((name) => {
      const full = path.join(directory, name);
      return { full, mtime: fs.statSync(full).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime || (a.full < b.full ? 1 : -1));
  const removed: string[] = [];
  for (const file of files.slice(Math.max(1, keep))) {
    fs.rmSync(file.full);
    removed.push(file.full);
  }
  return removed;
}

export async function runScheduledBackup(
  sqlite: Db,
  fallbackDir: string,
  opts: { enabledByDefault?: boolean; now?: Date } = {},
): Promise<'postgres' | 'disabled' | 'skipped' | 'written' | 'failed'> {
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
  try {
    const made = await createBackupFile(
      { sqlite, backupsRoot: directory, now: now.toISOString() },
      'scheduled',
    );
    // A copy that fails its own check is recorded as failed (above) and is no backup: it
    // must not push a good older copy out of the retention window.
    if (made.integrity !== 'ok') {
      fs.rmSync(made.path, { force: true });
      return 'failed';
    }
  } catch (err) {
    // A USB drive that is unplugged or a share that is offline must show on the host panel
    // rather than vanish into a swallowed job error.
    await sqlite
      .prepare(
        `INSERT INTO backup_record (id, path, started_at, finished_at, integrity_check_result, trigger, status)
         VALUES (?, ?, ?, ?, ?, 'scheduled', 'failed')`,
      )
      .run(
        newId(),
        directory,
        now.toISOString(),
        now.toISOString(),
        err instanceof Error ? err.message : 'backup failed',
      );
    return 'failed';
  }
  pruneBackupFiles(directory, settings.retentionCount);
  return 'written';
}
