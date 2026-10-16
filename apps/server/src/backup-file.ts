import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { sha256Hex } from '@sns/auth';
import { backupTo } from '@sns/database';
import { newId } from '@sns/domain';
import type { Db } from '@sns/database';

export async function createBackupFile(
  ctx: { sqlite: Db; backupsRoot: string; now: string },
  trigger: 'manual' | 'scheduled' = 'manual',
  directory?: string,
): Promise<{ id: string; path: string; integrity: string }> {
  if (ctx.sqlite.dialect !== 'sqlite') {
    throw new Error(
      'File backup is available on the office SQLite deployment, not on the preview database.',
    );
  }
  const folder = directory && directory.trim() ? directory : ctx.backupsRoot;
  fs.mkdirSync(folder, { recursive: true });
  const dest = path.join(folder, `backup-${Date.now()}.db`);
  await backupTo(ctx.sqlite, dest);
  const copy = new DatabaseSync(dest, { readOnly: true });
  const checkRow = copy.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
  const check = checkRow.integrity_check;
  copy.close();
  const buf = fs.readFileSync(dest);
  const id = newId();
  await ctx.sqlite
    .prepare(
      `INSERT INTO backup_record (id, path, started_at, finished_at, size_bytes, sha256, integrity_check_result, schema_version, trigger, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, '0001_init', ?, ?)`,
    )
    .run(
      id,
      dest,
      ctx.now,
      new Date().toISOString(),
      buf.length,
      sha256Hex(buf),
      String(check),
      trigger,
      String(check) === 'ok' ? 'ok' : 'failed',
    );
  return { id, path: dest, integrity: String(check) };
}

/** Copy a backup that already lives in an allowed folder to `<db>.restore` for the next open. */
export function stageRestoreFile(
  backupsRoot: string | string[],
  dbPath: string,
  fileName: string,
): string {
  if (!/^backup-[A-Za-z0-9._-]+\.db$/.test(fileName)) {
    throw new Error('Choose a backup file from the list.');
  }
  const roots = (Array.isArray(backupsRoot) ? backupsRoot : [backupsRoot]).filter(Boolean);
  let source = '';
  for (const root of roots) {
    const candidate = path.resolve(root, fileName);
    if (path.resolve(path.dirname(candidate)) !== path.resolve(root)) continue;
    if (fs.existsSync(candidate)) {
      source = candidate;
      break;
    }
  }
  if (!source) {
    throw new Error('That backup file is not in the backup folder.');
  }
  const staged = `${dbPath}.restore`;
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  fs.copyFileSync(source, staged);
  return staged;
}
