/**
 * A scheduled backup whose own integrity check fails must not count as a backup: it must
 * not push a good older copy out of the retention window.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { openDatabase, type Db } from '@sns/database';
import { runScheduledBackup, writeBackupPolicy } from './backup-job.js';

vi.mock('./backup-file.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./backup-file.js')>();
  return {
    ...actual,
    // The copy is written as usual, then reported as damaged.
    createBackupFile: async (...args: Parameters<typeof actual.createBackupFile>) => ({
      ...(await actual.createBackupFile(...args)),
      integrity: '*** in database main *** Page 7: btreeInitPage() returns error code 11',
    }),
  };
});

const opened: { sqlite: Db; dir: string }[] = [];
afterEach(async () => {
  for (const item of opened.splice(0)) {
    await item.sqlite.close();
    fs.rmSync(item.dir, { recursive: true, force: true });
  }
});

it('a damaged scheduled backup is reported as failed and prunes nothing', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leaveos-backup-bad-'));
  const sqlite = await openDatabase(path.join(dir, 'app.db'));
  opened.push({ sqlite, dir });
  const folder = path.join(dir, 'usb');
  fs.mkdirSync(folder);
  for (let i = 1; i <= 2; i++) {
    const file = path.join(folder, `backup-${i}.db`);
    fs.writeFileSync(file, `good ${i}`);
    const at = new Date(2026, 9, i);
    fs.utimesSync(file, at, at);
  }
  await writeBackupPolicy(sqlite, { enabled: true, directory: folder, retentionCount: 2 }, 'test');

  expect(await runScheduledBackup(sqlite, folder)).toBe('failed');
  const left = fs.readdirSync(folder).sort();
  expect(left).toEqual(['backup-1.db', 'backup-2.db']);
});
