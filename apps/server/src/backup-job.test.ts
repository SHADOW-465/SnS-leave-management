import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type Db } from '@sns/database';
import { loadConfig, pathsFor } from '@sns/config';
import { buildApp } from './app.js';
import { pruneBackupFiles, runScheduledBackup } from './backup-job.js';

const opened: { sqlite: Db; dir: string }[] = [];

async function boot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leaveos-backup-'));
  const config = loadConfig({ LEAVEOS_DATA_DIR: dir, LEAVEOS_ENV: 'test' });
  const dbPath = pathsFor(config).db;
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const sqlite = await openDatabase(dbPath);
  opened.push({ sqlite, dir });
  const app = await buildApp(config, sqlite);
  await app.ready();
  await app.inject({
    method: 'POST',
    url: '/api/v1/setup',
    payload: {
      companyName: 'Test Co',
      timezone: 'UTC',
      leaveYearStartMonth: 1,
      leaveYearStartDay: 1,
      adminName: 'Ada Example',
      adminEmail: 'admin@example.invalid',
      adminPassword: 'ChangeMe_admin_1',
    },
  });
  return { app, sqlite, dir, backups: pathsFor(config).backups };
}

afterEach(async () => {
  for (const item of opened.splice(0)) {
    await item.sqlite.close();
    fs.rmSync(item.dir, { recursive: true, force: true });
  }
});

describe('scheduled sqlite backup', () => {
  it('skips Postgres and stays off until enabled', async () => {
    const { sqlite, backups } = await boot();
    expect(await runScheduledBackup({ dialect: 'postgres' } as Db, backups)).toBe('postgres');
    expect(await runScheduledBackup(sqlite, backups)).toBe('disabled');
    expect(fs.existsSync(backups)).toBe(false);
  });

  it('writes to the configured folder, keeps a recent file, and drops an old one', async () => {
    const { app, sqlite, dir, backups } = await boot();
    const folder = path.join(dir, 'second-copy');
    const denied = await app.inject({
      method: 'PUT',
      url: '/api/v1/settings/backup',
      payload: { enabled: true, directory: folder, retentionDays: 14 },
    });
    expect(denied.statusCode).toBe(401);

    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'admin@example.invalid', password: 'ChangeMe_admin_1' },
    });
    expect(login.statusCode).toBe(200);
    const pairs = (
      Array.isArray(login.headers['set-cookie'])
        ? login.headers['set-cookie']
        : [String(login.headers['set-cookie'])]
    ).map((c) => String(c).split(';')[0] ?? '');
    const csrf = pairs.find((p) => p.startsWith('leaveos.csrf='))?.slice('leaveos.csrf='.length);
    const cookie = pairs.join('; ');
    expect(csrf).toBeTruthy();
    const saved = await app.inject({
      method: 'PUT',
      url: '/api/v1/settings/backup',
      headers: { cookie, 'x-csrf-token': csrf },
      payload: { enabled: true, directory: folder, retentionDays: 14 },
    });
    expect(saved.statusCode).toBe(200);

    const now = new Date('2026-10-16T12:00:00.000Z');
    expect(await runScheduledBackup(sqlite, backups, { now })).toBe('written');
    const created = fs.readdirSync(folder).filter((name) => name.endsWith('.db'));
    expect(created).toHaveLength(1);
    expect(await runScheduledBackup(sqlite, backups, { now })).toBe('skipped');

    const stale = path.join(folder, 'backup-stale.db');
    fs.writeFileSync(stale, 'old');
    const old = new Date('2026-09-01T00:00:00.000Z');
    fs.utimesSync(stale, old, old);
    fs.writeFileSync(path.join(folder, 'notes.txt'), 'keep');
    await sqlite
      .prepare(`UPDATE backup_record SET started_at = ? WHERE trigger = 'scheduled'`)
      .run('2026-10-01T00:00:00.000Z');
    expect(await runScheduledBackup(sqlite, backups, { now })).toBe('written');
    expect(fs.existsSync(stale)).toBe(false);
    expect(fs.existsSync(path.join(folder, 'notes.txt'))).toBe(true);
    expect(fs.readdirSync(folder).filter((name) => name.endsWith('.db')).length).toBeGreaterThan(0);

    const kept = path.join(folder, 'backup-fresh.db');
    fs.writeFileSync(kept, 'fresh');
    fs.utimesSync(kept, now, now);
    expect(pruneBackupFiles(folder, 14, now.getTime())).not.toContain(kept);
    expect(fs.existsSync(kept)).toBe(true);
  });
});
